"use client";

import { useEffect, useRef, type RefObject } from "react";
import { HOP_MS, foldToReference } from "@/lib/pitch";
import type { PitchTrack } from "@/lib/types";

/**
 * `pitch`: curvas de afinação (médio e difícil). `activity`: presença de voz em barras
 * (fácil, sdd-009 regra 10): a afinação não conta, então o palco não pode sugerir que conta.
 */
export type PitchCanvasMode = "pitch" | "activity";

interface PitchCanvasProps {
  reference: PitchTrack;
  /** Frames da voz, preenchidos pelo recorder (mesmo índice da referência). */
  voiceFrames: RefObject<(number | null)[]>;
  /** Tempo atual da música em ms (relógio do AudioContext). */
  getTimeMs: () => number;
  running: boolean;
  mode: PitchCanvasMode;
}

/** Janela de tempo: futuro no alto (as notas vêm na direção de quem canta), passado embaixo. */
const LOOKAHEAD_MS = 4000;
const LOOKBACK_MS = 1500;
/** Folga (semitons) em volta da extensão da melodia. */
const PITCH_PAD = 3;
/** Sem referência no frame, a voz é dobrada para a última nota da referência até aqui. */
const FOLD_MEMORY_FRAMES = 100;
/** Modo `activity`: faixa da referência e faixa da voz, como frações da largura (lado a lado no centro). */
const ACTIVITY_REFERENCE_LANE: readonly [number, number] = [0.3, 0.48];
const ACTIVITY_VOICE_LANE: readonly [number, number] = [0.52, 0.7];

type Frames = readonly (number | null)[];

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

function pitchRange(midi: Frames): { lo: number; hi: number } {
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

/** Barras verticais para cada trecho contínuo com voz em [first, last], numa faixa horizontal [x0, x1]. */
function drawActivityBars(
  context: CanvasRenderingContext2D,
  frames: Frames,
  first: number,
  last: number,
  yFor: (tMs: number) => number,
  x0: number,
  x1: number,
  radius: number,
): void {
  let start = -1;
  for (let i = first; i <= last + 1; i++) {
    const voiced = i <= last && frames[i] !== null && frames[i] !== undefined;
    if (voiced && start < 0) start = i;
    if (!voiced && start >= 0) {
      const top = yFor(i * HOP_MS);
      const bottom = yFor(start * HOP_MS);
      context.beginPath();
      if (typeof context.roundRect === "function") {
        context.roundRect(x0, top, x1 - x0, Math.max(1, bottom - top), radius);
      } else {
        context.rect(x0, top, x1 - x0, Math.max(1, bottom - top));
      }
      context.fill();
      start = -1;
    }
  }
}

/**
 * Highway ao vivo dentro de `.ct-highway__lane`, com a referência em `--pitch-reference` e a
 * voz em `--pitch-voice`, lidas dos tokens uma vez na montagem. No modo `pitch` desenha as
 * curvas de afinação (a voz dobrada para a oitava da referência, igual à regra da nota); no
 * modo `activity` desenha barras de presença de voz, lado a lado, sem altura de nota.
 */
export function PitchCanvas({ reference, voiceFrames, getTimeMs, running, mode }: PitchCanvasProps) {
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

    const drawPitch = (width: number, first: number, last: number, nowIndex: number, yFor: (tMs: number) => number) => {
      const xFor = (midi: number) => Math.min(width, Math.max(0, (width * (midi - lo)) / (hi - lo)));

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

    const drawActivity = (width: number, first: number, last: number, nowIndex: number, yFor: (tMs: number) => number) => {
      const radius = 4 * dpr;

      // Referência: onde a música tem voz (futuro e passado), com brilho
      const [r0, r1] = ACTIVITY_REFERENCE_LANE;
      context.fillStyle = palette.reference;
      context.globalAlpha = 0.25;
      drawActivityBars(context, ref, first, last, yFor, width * r0 - 4 * dpr, width * r1 + 4 * dpr, radius);
      context.globalAlpha = 0.9;
      drawActivityBars(context, ref, first, last, yFor, width * r0, width * r1, radius);

      // Voz: onde a pessoa cantou (só passado, até o frame atual)
      const [v0, v1] = ACTIVITY_VOICE_LANE;
      const voice = voiceFrames.current ?? [];
      context.fillStyle = palette.voice;
      context.globalAlpha = 0.9;
      drawActivityBars(context, voice, first, Math.min(nowIndex, last), yFor, width * v0, width * v1, radius);
      context.globalAlpha = 1;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      const now = getTimeMs();
      const span = LOOKAHEAD_MS + LOOKBACK_MS;
      const yFor = (tMs: number) => (height * (now + LOOKAHEAD_MS - tMs)) / span;

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
      const voiceLength = voiceFrames.current?.length ?? 0;
      const nowIndex = Math.min(voiceLength - 1, Math.floor(now / HOP_MS));

      if (mode === "activity") drawActivity(width, first, last, nowIndex, yFor);
      else drawPitch(width, first, last, nowIndex, yFor);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [reference, voiceFrames, getTimeMs, running, mode]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
