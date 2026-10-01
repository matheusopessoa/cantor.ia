"""Spike (go/no-go) do alinhamento forçado da letra: Demucs + MMS_FA em músicas reais.

Uso:
    uv run python scripts/align_spike.py songs.json [--min-score 0.4] [--no-star] [--keep-audio DIR]

`songs.json` é uma lista de `{ name, videoId, offsetMs?, lyrics: [{ startMs, text }] }`.
`offsetMs` é o ajuste que a jogadora precisou pôr no slider (a letra "certa" é
`original − offsetMs`, convenção de `lib/lyrics.ts`); com ele o script imprime a diferença
entre o alinhamento e esse gabarito. Para cada música sai uma linha por verso (original,
alinhado, score, delta) e um resumo com a fração de linhas aceitas, o erro da primeira linha
cantada, o tempo de cada etapa e o pico de RAM. Critério de go no §6 da
`specs/sdd-010-lyrics-forced-alignment/tasks.md`.
"""

import argparse
import json

import numpy as np
import resource
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import alignment, audio, separation, youtube  # noqa: E402
from app.schemas import LyricsLine  # noqa: E402

STAR_LOG_PROB: float | None = None


def peak_rss_gb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 ** 3) if sys.platform == "darwin" else rss / (1024 ** 2)   # bytes no Mac, KB no Linux


def fmt(ms: int | None) -> str:
    if ms is None:
        return "     —  "
    return f"{ms / 1000:7.2f}s"


def run_song(song: dict, min_score: float, keep_audio: Path | None) -> dict:
    name, video_id = song["name"], song["videoId"]
    offset = song.get("offsetMs")
    lines = [LyricsLine(text=l["text"], startMs=l["startMs"]) for l in song["lyrics"]]
    print(f"\n=== {name} ({video_id}) — {len(lines)} linhas, offset da jogadora: {offset}")

    tmp = Path(tempfile.mkdtemp(prefix="align-spike-"))
    try:
        cached = keep_audio and next(keep_audio.glob(f"{video_id}.*"), None)
        t0 = time.perf_counter()
        if cached:
            path = cached
        else:
            path = youtube.download_audio(video_id, tmp)
            if keep_audio:
                keep_audio.mkdir(parents=True, exist_ok=True)
                path = Path(shutil.copy(path, keep_audio / f"{video_id}{path.suffix}"))
        t_download = time.perf_counter() - t0

        t0 = time.perf_counter()
        vocals_cache = keep_audio / f"{video_id}.vocals.npy" if keep_audio else None
        if vocals_cache and vocals_cache.exists():
            vocals = np.load(vocals_cache)
        else:
            wav = audio.decode(path)
            vocals = separation.vocals(wav)
            if vocals_cache:
                np.save(vocals_cache, vocals)
        t_demucs = time.perf_counter() - t0

        t0 = time.perf_counter()
        log_probs = alignment.emissions(vocals)
        if STAR_LOG_PROB is not None:
            log_probs = log_probs.clone()
            log_probs[:, alignment._STAR_ID] = STAR_LOG_PROB
        t_emission = time.perf_counter() - t0

        t0 = time.perf_counter()
        aligned = alignment.align_lines(log_probs, lines)
        t_align = time.perf_counter() - t0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"frames: {log_probs.shape[0]} ({log_probs.shape[0] * alignment.FRAME_MS / 1000:.1f}s), tokens: {len(alignment._targets(lines)[0])}")
    print(f"{'#':>3} {'original':>9} {'gabarito':>9} {'alinhado':>9} {'fim':>9} {'score':>6} {'delta':>8}  texto")
    accepted = 0
    text_lines = 0
    deltas: list[int] = []
    first_error: int | None = None
    for line, result in zip(song["lyrics"], aligned):
        has_text = len(alignment.normalize_line(line["text"])) >= alignment.MIN_TOKENS
        text_lines += has_text
        target = line["startMs"] - offset if offset is not None else None
        ok = result.score is not None and result.score >= min_score
        accepted += ok and has_text
        delta = result.startMs - target if (target is not None and result.startMs is not None) else None
        if ok and delta is not None:
            deltas.append(delta)
            if first_error is None:
                first_error = delta
        mark = "✓" if ok else ("·" if not has_text else "✗")
        score = f"{result.score:6.2f}" if result.score is not None else "     —"
        print(f"{result.index:3d} {fmt(line['startMs'])} {fmt(target)} {fmt(result.startMs)} {fmt(result.endMs)} {score} {fmt(delta):>9} {mark} {line['text'][:48]}")

    ratio = accepted / text_lines if text_lines else 0.0
    summary = {
        "name": name,
        "textLines": text_lines,
        "accepted": accepted,
        "acceptedRatio": round(ratio, 3),
        "firstLineErrorMs": first_error,
        "medianDeltaMs": round(statistics.median(deltas)) if deltas else None,
        "p90AbsDeltaMs": round(sorted(abs(d) for d in deltas)[int(0.9 * (len(deltas) - 1))]) if deltas else None,
        "seconds": {"download": round(t_download, 1), "demucs": round(t_demucs, 1), "emissions": round(t_emission, 1), "forced_align": round(t_align, 2)},
        "peakRssGb": round(peak_rss_gb(), 2),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("songs", type=Path)
    parser.add_argument("--min-score", type=float, default=0.4)
    parser.add_argument("--no-star", action="store_true", help="não insere `*` entre linhas com intervalo longo")
    parser.add_argument("--star-gap-ms", type=int, default=alignment.STAR_GAP_MS)
    parser.add_argument("--star-logprob", type=float, default=None, help="log-prob fixa do `*` (o torchaudio usa 0 = prob. 1, que absorve tudo)")
    parser.add_argument("--keep-audio", type=Path, default=None, help="pasta para guardar/reaproveitar o áudio baixado e a voz separada")
    args = parser.parse_args()

    global STAR_LOG_PROB
    STAR_LOG_PROB = args.star_logprob
    alignment.STAR_GAP_MS = 10 ** 9 if args.no_star else args.star_gap_ms

    songs = json.loads(args.songs.read_text())
    started = time.perf_counter()
    separation.load()
    alignment.load()
    print(f"modelos carregados em {time.perf_counter() - started:.1f}s")

    summaries = [run_song(song, args.min_score, args.keep_audio) for song in songs]
    print("\n=== resumo")
    for s in summaries:
        print(f"{s['name']:<32} aceitas {s['accepted']:>3}/{s['textLines']:<3} ({s['acceptedRatio']:.0%})  1ª linha {s['firstLineErrorMs']} ms  mediana {s['medianDeltaMs']} ms  p90 |Δ| {s['p90AbsDeltaMs']} ms  demucs {s['seconds']['demucs']}s + mms {s['seconds']['emissions']}s  RAM {s['peakRssGb']} GB")


if __name__ == "__main__":
    main()
