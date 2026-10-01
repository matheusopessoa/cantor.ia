"""Etapa 0 (go/no-go) da sdd-011 e da sdd-014: transcrição da voz + escolha da letra entre as
fontes reais, com os módulos de produção (`app/transcription.py`, `app/lyrics_selection.py`).

Uso:
    uv run python scripts/transcribe_spike.py MUSICA [MUSICA ...] [--api http://localhost:3333]
        [--keep-audio DIR] [--provider openai|local] [--model large-v3-turbo] [--songs-file songs.json]

`--provider` (sdd-014): `openai` = `whisper-1` na API da OpenAI (precisa de `OPENAI_API_KEY` no
ambiente ou no `.env` da raiz; o tempo medido inclui a codificação em MP3 e o upload) ou
`local` = `faster-whisper` na CPU (`--model`). Padrão: o provedor que o worker usaria. Com
`openai`, o resumo mostra os minutos de áudio enviados e o custo estimado
(`WHISPER1_USD_PER_MIN`; confira o preço vigente no painel da OpenAI). Se a OpenAI falhar numa
música, a transcrição cai no Whisper local, como no worker, e o resumo marca a música.

`MUSICA` é o id de uma música cadastrada (a API dá vídeo, artista, título e a letra do LRCLIB)
ou `yt:<videoId>` (metadados e letra pelo YouTube Music). Com `--songs-file` (lista de
`{ id, artist, title, durationMs, youtubeVideoId, lyrics }` exportada do banco) a API não é
consultada. Para cada uma:

1. isola a voz (Demucs; `--keep-audio` reaproveita o cache de `.vocals.npy`);
2. transcreve com o Whisper, com artista e título no prompt;
3. coleta as candidatas como a API vai coletar (LRCLIB por artista/título/duração, synced
   antes de plain, até 2; YouTube Music pelo `videoId`) e roda `lyrics_selection.choose`;
4. mede o WER da transcrição contra o gabarito do texto (a letra cadastrada, ou a do YouTube
   Music, ou a do LRCLIB) e quantos versos da letra escolhida o MMS_FA aceita (score ≥ 0,4).

Os quatro modelos ficam carregados juntos, como no worker, para o pico de RAM valer.
Critério de go no §6 de `specs/sdd-011-lyrics-from-video/tasks.md`.
"""

import argparse
import json
import resource
import shutil
import statistics
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import alignment, audio, config, lyrics_selection, pitch, separation, transcription, youtube, ytmusic  # noqa: E402
from app.schemas import LyricsCandidate, LyricsLine  # noqa: E402

LRCLIB = "https://lrclib.net"
DURATION_TOLERANCE_MS = 10_000
MIN_SCORE = 0.4
# Preço do `whisper-1` por minuto de áudio (sdd-014). Só para a estimativa do resumo.
WHISPER1_USD_PER_MIN = 0.006


def peak_rss_gb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 ** 3) if sys.platform == "darwin" else rss / (1024 ** 2)


def get_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"user-agent": "cantor.ia spike (github.com/matheusopessoa/cantor.ia)"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def parse_lrc(text: str) -> list[LyricsLine]:
    lines = []
    for raw in text.splitlines():
        if not raw.startswith("[") or "]" not in raw:
            continue
        stamp, _, lyric = raw[1:].partition("]")
        try:
            minutes, seconds = stamp.split(":")
            lines.append(LyricsLine(text=lyric.strip(), startMs=round((int(minutes) * 60 + float(seconds)) * 1000)))
        except ValueError:
            continue
    return lines


def lrclib_candidates(artist: str, title: str, duration_ms: int) -> list[LyricsCandidate]:
    """Mesma regra que a API vai usar (`lyrics-source.service.ts`, regra 5)."""
    query = urllib.parse.urlencode({"artist_name": artist, "track_name": title})
    try:
        tracks = get_json(f"{LRCLIB}/api/search?{query}")
    except Exception as exc:
        print(f"  LRCLIB falhou: {exc}")
        return []
    if not isinstance(tracks, list):
        return []
    near = [t for t in tracks if abs(round((t.get("duration") or 0) * 1000) - duration_ms) <= DURATION_TOLERANCE_MS]
    near.sort(key=lambda t: 0 if t.get("syncedLyrics") else 1)
    out = []
    for track in near:
        if track.get("syncedLyrics"):
            lines = parse_lrc(track["syncedLyrics"])
        elif track.get("plainLyrics"):
            lines = [LyricsLine(text=l.strip(), startMs=None) for l in track["plainLyrics"].splitlines() if l.strip()]
        else:
            continue
        if lines:
            out.append(LyricsCandidate(source="lrclib", lines=lines))
        if len(out) == 2:
            break
    return out


def ytmusic_candidate(video_id: str) -> tuple[LyricsCandidate | None, dict | None]:
    try:
        song = ytmusic.song(video_id)
    except Exception as exc:
        print(f"  YouTube Music falhou: {exc}")
        return None, None
    meta = {"artist": song.artist, "title": song.title, "durationMs": round((song.durationS or 0) * 1000)}
    if song.lyrics.status not in ("synced", "plain") or not song.lyrics.lines:
        return None, meta
    lines = [LyricsLine(text=l.text, startMs=l.startMs) for l in song.lyrics.lines]
    return LyricsCandidate(source="ytmusic", lines=lines), meta


def load_vocals(video_id: str, keep_audio: Path | None) -> tuple[np.ndarray, float]:
    t0 = time.perf_counter()
    cache = keep_audio / f"{video_id}.vocals.npy" if keep_audio else None
    if cache and cache.exists():
        return np.load(cache), time.perf_counter() - t0
    tmp = Path(tempfile.mkdtemp(prefix="transcribe-spike-"))
    try:
        vocals = separation.vocals(audio.decode(youtube.download_audio(video_id, tmp)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.save(cache, vocals)
    return vocals, time.perf_counter() - t0


def run(item: str, args: argparse.Namespace) -> dict:
    if item.startswith("yt:"):
        video_id = item[3:]
        yt_candidate, meta = ytmusic_candidate(video_id)
        if meta is None:
            raise SystemExit(f"{video_id}: YouTube Music não conhece o vídeo")
        artist, title, duration_ms = meta["artist"], meta["title"], meta["durationMs"]
        stored = None
    else:
        song = args.songs[item] if args.songs is not None else get_json(f"{args.api}/api/songs/{item}")
        video_id, artist, title, duration_ms = song["youtubeVideoId"], song["artist"], song["title"], song["durationMs"]
        stored = [LyricsLine(text=l["text"], startMs=l["startMs"]) for l in song["lyrics"]]
        yt_candidate, _ = ytmusic_candidate(video_id)

    candidates = ([yt_candidate] if yt_candidate else []) + lrclib_candidates(artist, title, duration_ms)
    truth = stored or (yt_candidate.lines if yt_candidate else None) or (candidates[0].lines if candidates else None)
    truth_source = "cadastrada" if stored else ("ytmusic" if yt_candidate else ("lrclib" if candidates else "nenhum"))
    print(f"\n{'=' * 100}\n{artist} — {title} ({video_id}); candidatas: {[c.source for c in candidates]}; gabarito: {truth_source}")

    vocals, t_vocals = load_vocals(video_id, args.keep_audio)
    fell_back = False
    t0 = time.perf_counter()
    if args.provider == "openai":
        try:
            transcript = transcription._openai(vocals, f"{artist} - {title}", None)
        except Exception as exc:  # noqa: BLE001 — como no worker: a reserva local cobre
            print(f"  OpenAI falhou ({transcription._describe(exc)}); usando o Whisper local")
            fell_back = True
            transcript = transcription._local(vocals, f"{artist} - {title}")
    else:
        transcript = transcription.transcribe(vocals, f"{artist} - {title}")
    t_whisper = time.perf_counter() - t0

    hyp = [w for word in transcript.words for w in lyrics_selection.words(word.text)]
    ref = [w for line in truth or [] for w in lyrics_selection.words(line.text)]
    wer = round(lyrics_selection.wer(ref, hyp), 3) if ref else None

    t0 = time.perf_counter()
    chosen = lyrics_selection.choose(candidates, transcript, round(len(vocals) / audio.SAMPLE_RATE * 1000))
    t_choose = time.perf_counter() - t0

    t0 = time.perf_counter()
    log_probs = alignment.emissions(vocals)
    aligned = alignment.align_lines(log_probs, chosen.lines)
    t_mms = time.perf_counter() - t0
    text_lines = [a for line, a in zip(chosen.lines, aligned) if len(alignment.normalize_line(line.text)) >= alignment.MIN_TOKENS]
    accepted = sum(1 for a in text_lines if a.score is not None and a.score >= MIN_SCORE)

    print(f"escolhida: {chosen.source} (wer {chosen.wer}); candidatas: {[(c.source, c.wer) for c in chosen.candidates]}")
    for line, a in list(zip(chosen.lines, aligned))[: args.show]:
        score = f"{a.score:.2f}" if a.score is not None else "  — "
        start = f"{a.startMs / 1000:7.2f}s" if a.startMs is not None else "    —   "
        print(f"  dica {line.startMs / 1000:7.2f}s  mms {start} {score}  {line.text[:70]}")

    summary = {
        "name": f"{artist} — {title}",
        "provider": "local (reserva)" if fell_back else args.provider,
        "audioMinutes": round(len(vocals) / audio.SAMPLE_RATE / 60, 2),
        "language": transcript.language,
        "werTranscript": wer,
        "truth": truth_source,
        "chosen": chosen.source,
        "chosenWer": chosen.wer,
        "candidates": [(c.source, c.wer) for c in chosen.candidates],
        "accepted": accepted,
        "textLines": len(text_lines),
        "seconds": {"vocals": round(t_vocals, 1), "whisper": round(t_whisper, 1), "choose": round(t_choose, 2), "mms": round(t_mms, 1)},
        "peakRssGb": round(peak_rss_gb(), 2),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("songs", nargs="+")
    parser.add_argument("--api", default="http://localhost:3333")
    parser.add_argument("--keep-audio", type=Path, default=None)
    parser.add_argument("--songs-file", type=Path, default=None, help="músicas exportadas do banco, em vez da API")
    parser.add_argument("--provider", choices=["openai", "local"], default=None, help="padrão: o que o worker usaria")
    parser.add_argument("--model", default=transcription.MODEL_NAME, help="modelo do Whisper local")
    parser.add_argument("--show", type=int, default=12, help="quantos versos da letra escolhida imprimir")
    args = parser.parse_args()

    items = args.songs
    args.songs = {s["id"]: s for s in json.loads(args.songs_file.read_text())} if args.songs_file else None
    transcription.MODEL_NAME = args.model
    args.provider = args.provider or transcription.provider()
    if args.provider == "openai" and config.settings().OPENAI_API_KEY is None:
        raise SystemExit("--provider openai precisa de OPENAI_API_KEY no ambiente ou no .env da raiz")
    if args.provider == "local":
        # Mesmo com a chave configurada: o local de verdade, sem passar pela OpenAI.
        config.settings = lambda: config.Settings(OPENAI_API_KEY=None)
    started = time.perf_counter()
    separation.load()
    pitch.load()
    alignment.load()
    if args.provider == "local":
        transcription.load()   # como no worker: com a OpenAI, o local só carrega se for preciso
    print(f"modelos carregados em {time.perf_counter() - started:.1f}s ({args.provider}), RAM {peak_rss_gb():.2f} GB")

    summaries = [run(item, args) for item in items]
    label = f"openai {transcription.OPENAI_MODEL}" if args.provider == "openai" else f"local {args.model}"
    print(f"\n{'=' * 100}\nresumo ({label})")
    for s in summaries:
        cands = ", ".join(f"{src} {w:.0%}" if w is not None else f"{src} —" for src, w in s["candidates"])
        wer = f"{s['werTranscript']:.0%}" if s["werTranscript"] is not None else "—"
        print(
            f"{s['name'][:44]:<44} {s['language'] or '?':>2}  WER {wer:>4} ({s['truth']})  escolhida {s['chosen']:<7}"
            f"  [{cands}]  MMS {s['accepted']}/{s['textLines']}  whisper {s['seconds']['whisper']}s  RAM {s['peakRssGb']} GB"
            + ("  [reserva local]" if s["provider"] == "local (reserva)" else "")
        )
    wers = [s["werTranscript"] for s in summaries if s["werTranscript"] is not None]
    if wers:
        print(f"WER mediano: {statistics.median(wers):.0%}")
    times = [s["seconds"]["whisper"] for s in summaries]
    print(f"transcrição: {min(times)}–{max(times)} s por música (mediana {statistics.median(times)} s)")
    if args.provider == "openai":
        minutes = sum(s["audioMinutes"] for s in summaries if s["provider"] == "openai")
        print(f"áudio enviado: {minutes:.1f} min · custo estimado US$ {minutes * WHISPER1_USD_PER_MIN:.3f} (a US$ {WHISPER1_USD_PER_MIN}/min)")


if __name__ == "__main__":
    main()
