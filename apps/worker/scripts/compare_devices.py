"""Compara a extração em `cpu` e em `mps` numa música real (sdd-016 §6/§7): tempo por etapa e
o que muda na curva de pitch e no alinhamento da letra. Roda o pipeline em processo (sem
servidor), baixando o áudio uma vez.

    uv run python scripts/compare_devices.py tyE1PFSSdg8 --lrclib "Tiago Iorc" "Tempo Perdido"
    uv run python scripts/compare_devices.py <videoId> --lyrics letra.json   # LyricsLine[]

Critérios do plano: ≥ 99 % dos frames iguais em voz/sem voz; nos frames com voz nos dois,
≥ 99 % dentro de 50 cents; cada linha da letra com início dentro de ±40 ms.
"""

import argparse
import json
import re
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import alignment, audio, config, device, main, pitch, separation, youtube  # noqa: E402
from app.schemas import LyricsLine  # noqa: E402

LRC_LINE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")


def lyrics_from_lrclib(artist: str, title: str) -> list[LyricsLine]:
    query = urllib.parse.urlencode({"artist_name": artist, "track_name": title})
    with urllib.request.urlopen(f"https://lrclib.net/api/search?{query}", timeout=10) as response:
        tracks = json.load(response)
    synced = next((t["syncedLyrics"] for t in tracks if t.get("syncedLyrics")), None)
    if not synced:
        raise SystemExit("LRCLIB sem letra sincronizada para essa música")
    lines = []
    for raw in synced.splitlines():
        match = LRC_LINE.match(raw.strip())
        if not match:
            continue
        text = match.group(3).strip()
        if text:
            lines.append(LyricsLine(text=text, startMs=int((int(match.group(1)) * 60 + float(match.group(2))) * 1000)))
    return lines


def timed(module, name: str, timings: dict[str, float]):
    original = getattr(module, name)

    def wrapper(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            return original(*args, **kwargs)
        finally:
            timings[name] = timings.get(name, 0.0) + time.perf_counter() - t0

    setattr(module, name, wrapper)
    return lambda: setattr(module, name, original)


def run(dev: str, path: Path, lines: list[LyricsLine]):
    config.settings = lambda: config.Settings(OPENAI_API_KEY=None, WORKER_DEVICE=dev)  # type: ignore[assignment]
    device._current = None
    separation._separator = None
    alignment._model = None
    timings: dict[str, float] = {}
    restores = [
        timed(separation, "stems", timings),
        timed(pitch, "track", timings),
        timed(alignment, "align", timings),
        timed(audio, "encode_aac", timings),
    ]
    t0 = time.perf_counter()
    separation.load()
    alignment.load()
    timings["load"] = time.perf_counter() - t0
    t0 = time.perf_counter()
    result, stems = main._extract_sync(path, separate=True, lyrics=main.LyricsInput(lyrics=lines), stems=True)
    timings["total"] = time.perf_counter() - t0
    for restore in restores:
        restore()
    return result, timings


def compare(a, b) -> dict[str, float]:
    va = [m is not None for m in a.midi]
    vb = [m is not None for m in b.midi]
    n = min(len(va), len(vb))
    same_voicing = sum(1 for i in range(n) if va[i] == vb[i]) / n
    both = [(a.midi[i], b.midi[i]) for i in range(n) if va[i] and vb[i]]
    within_50c = sum(1 for x, y in both if abs(x - y) * 100 <= 50) / max(1, len(both))
    out = {"frames": n, "same_voicing": same_voicing, "within_50_cents": within_50c}
    if a.alignment and b.alignment:
        pairs = [(la, lb) for la, lb in zip(a.alignment.lines, b.alignment.lines) if la.startMs is not None and lb.startMs is not None]
        out["lines"] = len(pairs)
        out["start_within_40ms"] = sum(1 for la, lb in pairs if abs(la.startMs - lb.startMs) <= 40) / max(1, len(pairs))
        out["max_start_diff_ms"] = max((abs(la.startMs - lb.startMs) for la, lb in pairs), default=0)
        out["mean_score_diff"] = sum(abs((la.score or 0) - (lb.score or 0)) for la, lb in pairs) / max(1, len(pairs))
    return out


def main_cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video_id")
    parser.add_argument("--lyrics", type=Path, help="arquivo JSON com LyricsLine[]")
    parser.add_argument("--lrclib", nargs=2, metavar=("ARTISTA", "TITULO"), help="letra sincronizada do LRCLIB")
    parser.add_argument("--devices", default="cpu,mps")
    args = parser.parse_args()

    if args.lyrics:
        lines = [LyricsLine(**item) for item in json.loads(args.lyrics.read_text())]
    elif args.lrclib:
        lines = lyrics_from_lrclib(*args.lrclib)
    else:
        lines = []
    print(f"letra: {len(lines)} linhas", flush=True)

    tmp_dir = Path(tempfile.mkdtemp(prefix="cantor-compare-"))
    t0 = time.perf_counter()
    path = youtube.download_audio(args.video_id, tmp_dir, threading.Event())
    print(f"download: {time.perf_counter() - t0:.1f} s ({path.name}, {path.stat().st_size / 1e6:.1f} MB)", flush=True)

    # `--devices cpu,cpu` mede o ruído entre duas rodadas no mesmo device: o Demucs usa um
    # deslocamento aleatório (`shifts=1`), então nem duas rodadas em CPU são iguais.
    results = []
    for dev in args.devices.split(","):
        result, timings = run(dev, path, lines)
        results.append(result)
        stages = ", ".join(f"{k} {v:.1f} s" for k, v in timings.items())
        print(f"{dev}: {stages}", flush=True)

    if len(results) == 2:
        print("comparação:", json.dumps(compare(*results), indent=2), flush=True)


if __name__ == "__main__":
    main_cli()
