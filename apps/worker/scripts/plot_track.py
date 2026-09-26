"""Plota um PitchTrack em PNG para conferir a curva a olho.

Uso:
    uv run python scripts/plot_track.py <audio.mp3> [saida.png] [--no-separate]
    uv run python scripts/plot_track.py --json <track.json> [saida.png]
"""

import json
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import _extract_sync  # noqa: E402


def load_track(args: list[str]) -> tuple[dict, str]:
    if args[0] == "--json":
        src = Path(args[1])
        return json.loads(src.read_text()), src.stem
    src = Path(args[0])
    separate = "--no-separate" not in args
    started = time.perf_counter()
    track = _extract_sync(src, separate=separate).model_dump()
    print(f"extraído em {time.perf_counter() - started:.1f}s (separate={separate})")
    return track, src.stem


def main() -> None:
    args = [a for a in sys.argv[1:]]
    if not args:
        print(__doc__)
        sys.exit(1)
    track, name = load_track(args)
    positional = [a for a in args if not a.startswith("--")]
    out = Path(positional[-1]) if positional[-1].endswith(".png") else Path(f"{name}.png")

    hop_s = track["hopMs"] / 1000
    xs = [i * hop_s for i, m in enumerate(track["midi"]) if m is not None]
    ys = [m for m in track["midi"] if m is not None]
    voiced = len(ys) / max(len(track["midi"]), 1)

    fig, ax = plt.subplots(figsize=(16, 5))
    ax.scatter(xs, ys, s=1)
    ax.set_xlabel("tempo (s)")
    ax.set_ylabel("nota MIDI (69 = A4)")
    ax.set_title(f"{name} · {track['durationMs'] / 1000:.1f}s · {voiced:.0%} dos frames com voz")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=120)
    print(f"salvo em {out}")


if __name__ == "__main__":
    main()
