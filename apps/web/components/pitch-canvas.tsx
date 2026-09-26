"use client";

import { useEffect, useRef, type RefObject } from "react";
import { HOP_MS, foldToReference } from "@/lib/pitch";
import type { PitchTrack } from "@/lib/types";

interface PitchCanvasProps {
  reference: PitchTrack;
  /** Frames da voz, preenchidos pelo recorder (mesmo índice da referência). */
  voiceFrames: RefObject<(number | null)[]>;
  /** Tempo atual da música em ms (relógio do AudioContext). */
  getTimeMs: () => number;
  running: boolean;
}

/** Janela de tempo: futuro no alto (as notas vêm na direção de quem canta), passado embaixo. */
const LOOKAHEAD_MS = 4000;
const LOOKBACK_MS = 1500;
/** Folga (semitons) em volta da extensão da melodia. */
const PITCH_PAD = 3;
/** Sem referência no frame, a voz é dobrada para a última nota da referência até aqui. */
const FOLD_MEMORY_FRAMES = 100;

interface Palette {
  reference: string;
  voice: string;
  now: string;
}

function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  return {
    reference: styles.getPropertyValue("--pitch-reference").trim(),
    voice: styles.getPropertyValue("--pitch-voice").trim(),
    now: styles.getPropertyValue("--text-primary").trim(),
  };
}

function pitchRange(midi: readonly (number | null)[]): { lo: number; hi: number } {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const value of midi) {
    if (value === null) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  if (!Number.isFinite(lo)) return { lo: 48, hi: 72 };
  return { lo: lo - PITCH_PAD, hi: Math.max(hi + PITCH_PAD, lo + 12) };
}

/**
 * Curvas de pitch ao vivo dentro de `.ct-highway__lane`: referência em `--pitch-reference`
 * e voz em `--pitch-voice`, lidas dos tokens uma vez na montagem. A voz é dobrada para a
 * oitava da referência, igual à regra da nota.
 */
export function PitchCanvas({ reference, voiceFrames, getTimeMs, running }: PitchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !running) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette = readPalette(canvas);
    const { lo, hi } = pitchRange(reference.midi);
    const ref = reference.midi;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement ?? canvas;
      const width = Math.max(1, Math.round(parent.clientWidth * dpr));
      const height = Math.max(1, Math.round(parent.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      const now = getTimeMs();
      const span = LOOKAHEAD_MS + LOOKBACK_MS;
      const yFor = (tMs: number) => (height * (now + LOOKAHEAD_MS - tMs)) / span;
      const xFor = (midi: number) => Math.min(width, Math.max(0, (width * (midi - lo)) / (hi - lo)));

      context.clearRect(0, 0, width, height);

      // Linha do "agora"
      const nowY = yFor(now);
      context.strokeStyle = palette.now;
      context.globalAlpha = 0.25;
      context.lineWidth = 1 * dpr;
      context.beginPath();
      context.moveTo(0, nowY);
      context.lineTo(width, nowY);
      context.stroke();
      context.globalAlpha = 1;

      const first = Math.max(0, Math.floor((now - LOOKBACK_MS) / HOP_MS));
      const last = Math.min(ref.length - 1, Math.ceil((now + LOOKAHEAD_MS) / HOP_MS));

      // Referência (melodia original)
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const [alpha, widthPx] of [
        [0.25, 14],
        [1, 6],
      ] as const) {
        context.strokeStyle = palette.reference;
        context.globalAlpha = alpha;
        context.lineWidth = widthPx * dpr;
        context.beginPath();
        let open = false;
        for (let i = first; i <= last; i++) {
          const midi = ref[i];
          if (midi === null || midi === undefined) {
            open = false;
            continue;
          }
          const x = xFor(midi);
          const y = yFor(i * HOP_MS);
          if (open) context.lineTo(x, y);
          else context.moveTo(x, y);
          open = true;
        }
        context.stroke();
      }
      context.globalAlpha = 1;

      // Voz (só passado, até o frame atual), dobrada para a oitava da referência
      const voice = voiceFrames.current ?? [];
      const nowIndex = Math.min(voice.length - 1, Math.floor(now / HOP_MS));
      context.strokeStyle = palette.voice;
      context.lineWidth = 4 * dpr;
      context.beginPath();
      let open = false;
      let lastRef: number | null = null;
      let lastRefIndex = -1;
      for (let i = first; i <= nowIndex; i++) {
        const r = ref[i];
        if (r !== null && r !== undefined) {
          lastRef = r;
          lastRefIndex = i;
        }
        const sung = voice[i];
        if (sung === null || sung === undefined) {
          open = false;
          continue;
        }
        const anchor = lastRef !== null && i - lastRefIndex <= FOLD_MEMORY_FRAMES ? lastRef : null;
        const x = xFor(foldToReference(sung, anchor));
        const y = yFor(i * HOP_MS);
        if (open) context.lineTo(x, y);
        else context.moveTo(x, y);
        open = true;
      }
      context.stroke();
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [reference, voiceFrames, getTimeMs, running]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
