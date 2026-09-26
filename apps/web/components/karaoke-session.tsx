"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Alert, type AlertTone } from "./alert";
import { FileDropzone } from "./file-dropzone";
import { LyricsView } from "./lyrics-view";
import { PitchCanvas } from "./pitch-canvas";
import { PlayerNameField } from "./player-name-field";
import { RankingList } from "./ranking-list";
import { ScoreResult } from "./score-result";
import { api } from "@/lib/api";
import { durationMatches, readAudioDurationMs } from "@/lib/audio-duration";
import { getSongAudio, saveSongAudio } from "@/lib/audio-store";
import { formatDuration, formatOffset } from "@/lib/format";
import { currentLineIndex, effectiveLyrics, lineProgress } from "@/lib/lyrics";
import { OFFSET_MAX_MS, OFFSET_MIN_MS, OFFSET_STEP_MS, normalizeOffsetMs } from "@/lib/lyrics-offset";
import { HOP_MS, framesToTrack, hitForCents, meanCentsError, type Hit } from "@/lib/pitch";
import { isValidPlayerName, normalizePlayerName } from "@/lib/player-name";
import { MIC_CONSTRAINTS, audioLatencySeconds, createRecorder, loadCaptureWorklet, type Recorder } from "@/lib/recorder";
import type { PerformanceResult, PitchTrack, RankingItem, SongDto } from "@/lib/types";
import { useLyricsOffset, usePlayerName } from "@/lib/use-prefs";

interface Notice {
  tone: AlertTone;
  title: string;
  body: string;
}

type Phase =
  | { kind: "loading-audio" }
  | { kind: "downloading-audio"; loaded: number; total: number | null }
  | { kind: "pick-file"; notice: Notice }
  | { kind: "checking-duration" }
  | { kind: "ready"; notice: Notice | null }
  | { kind: "mic-permission" }
  | { kind: "countdown"; value: number }
  | { kind: "singing" }
  | { kind: "submitting" }
  | { kind: "result"; result: PerformanceResult; ranking: RankingItem[] }
  | { kind: "error"; notice: Notice };

interface Hud {
  timeMs: number;
  lineIndex: number;
  progress: number;
}

const COUNTDOWN_S = 3;
/** Feedback PERFECT/GOOD/MISS a cada 250 ms, sobre os 250 ms anteriores. */
const HIT_INTERVAL_MS = 250;
const HIT_WINDOW_FRAMES = HIT_INTERVAL_MS / HOP_MS;
/** Os últimos frames ainda não chegaram do microfone (latência): avalia 100 ms atrás. */
const HIT_LAG_FRAMES = 10;
/** Atualiza a barra de progresso do download no máximo a cada 150 ms. */
const PROGRESS_THROTTLE_MS = 150;

const HIT_LABEL: Record<Hit, string> = { perfect: "Perfect", good: "Good", miss: "Miss" };

const HEADPHONES_COPY: Notice = {
  tone: "warning",
  title: "Coloque o fone",
  body: "Sem fone, o microfone escuta a música e a nota sai errada. Fone com fio atrasa menos que Bluetooth.",
};
const MIC_DENIED_COPY: Notice = {
  tone: "danger",
  title: "Microfone bloqueado",
  body: "Libere o microfone no cadeado da barra de endereço e tente de novo.",
};
const REFERENCE_LOAD_COPY: Notice = {
  tone: "danger",
  title: "Não deu para carregar a melodia",
  body: "Confira se a API está no ar e tente de novo.",
};
const DOWNLOAD_FAILED_COPY: Notice = {
  tone: "danger",
  title: "Não foi possível baixar do YouTube",
  body: "Envie o arquivo de áudio da música. Ele fica só neste dispositivo.",
};
const UPLOAD_ONLY_COPY: Notice = {
  tone: "info",
  title: "Escolha o arquivo da música",
  body: "A melodia veio de um arquivo, então o áudio para tocar fica só no seu dispositivo.",
};
const UNREADABLE_FILE_COPY: Notice = {
  tone: "danger",
  title: "Não conseguimos ler esse arquivo",
  body: "Escolha um MP3, M4A, WAV, OGG ou FLAC.",
};
const DECODE_FAILED_COPY: Notice = {
  tone: "danger",
  title: "Não deu para preparar o áudio",
  body: "O navegador não conseguiu decodificar a música. Escolha outro arquivo.",
};
const SUBMIT_FAILED_COPY: Notice = {
  tone: "danger",
  title: "Não deu para enviar sua cantoria",
  body: "Confira se a API está no ar e cante de novo.",
};

function mismatchCopy(audioMs: number, songMs: number): Notice {
  return {
    tone: "warning",
    title: "Duração não bate com a letra",
    body: `O áudio tem ${formatDuration(audioMs)} e a letra, ${formatDuration(songMs)}. Escolha a mesma versão da música.`,
  };
}

function LoadingBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="ct-loading" aria-live="polite">
      <span className="ct-loading__title">{title}</span>
      <div className="ct-loading__bar" role="progressbar" aria-label={title} />
      {hint ? <p className="ct-loading__hint">{hint}</p> : null}
    </div>
  );
}

interface OffsetFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** A API já alinhou a letra ao áudio (sdd-007): o slider vira ajuste fino. */
  aligned: boolean;
}

function OffsetField({ value, onChange, aligned }: OffsetFieldProps) {
  const id = useId();
  return (
    <div className="ct-field">
      <label className="ct-field__label" htmlFor={id}>
        Ajuste fino da letra: <span className="ct-numeric text-neon-cyan">{formatOffset(value)}</span>
      </label>
      <input
        id={id}
        className="ct-range"
        type="range"
        min={OFFSET_MIN_MS}
        max={OFFSET_MAX_MS}
        step={OFFSET_STEP_MS}
        value={value}
        onChange={(event) => onChange(normalizeOffsetMs(Number(event.target.value)))}
      />
      <span className="ct-field__hint">
        {aligned ? "A letra já vem alinhada ao áudio. Se ainda aparecer" : "A letra aparece"} atrasada? Arraste para a
        direita. Adiantada? Para a esquerda. O ajuste só desloca a letra, a velocidade é sempre a da música.
      </span>
    </div>
  );
}

/** Sessão de karaokê: áudio (cache → download → arquivo), microfone, contagem, palco, nota. */
export function KaraokeSession({ song }: { song: SongDto }) {
  // Letra, canvas e nota usam as mesmas linhas: a alinhada ao áudio, quando a API conseguiu (sdd-007).
  const lines = effectiveLyrics(song);
  const aligned = song.lyricsAlignment?.aligned ?? false;
  const [phase, setPhase] = useState<Phase>({ kind: "loading-audio" });
  const [reference, setReference] = useState<PitchTrack | null>(null);
  const { name, setName, commit: commitName } = usePlayerName();
  const [offsetMs, setOffsetMs] = useLyricsOffset(song.id);
  const [durationMs, setDurationMs] = useState(song.durationMs);
  const [hud, setHud] = useState<Hud>({ timeMs: 0, lineIndex: -1, progress: 0 });
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [hit, setHit] = useState<{ kind: Hit; key: number } | null>(null);

  const mountedRef = useRef(false);
  const referenceRef = useRef<PitchTrack | null>(null);
  const audioRef = useRef<Blob | null>(null);
  const durationRef = useRef(song.durationMs);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const voiceFramesRef = useRef<(number | null)[]>([]);
  const startTimeRef = useRef(0);
  const outputLatencyRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);
  const hitTimerRef = useRef(0);
  const finishedRef = useRef(false);
  const hitStatsRef = useRef({ hits: 0, total: 0 });

  /** Tempo da música em ms, no que a pessoa está ouvindo (desconta a latência de saída). */
  const getTimeMs = useCallback(() => {
    const context = contextRef.current;
    if (!context) return 0;
    return (context.currentTime - startTimeRef.current - outputLatencyRef.current) * 1000;
  }, []);

  /** Solta tudo: laços, microfone, fonte e AudioContext. */
  const teardown = useCallback(() => {
    finishedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(hitTimerRef.current);
    recorderRef.current?.stop();
    recorderRef.current = null;
    try {
      sourceRef.current?.stop();
    } catch {
      // ainda não tinha começado
    }
    sourceRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  const resetHud = useCallback(() => {
    setHud({ timeMs: 0, lineIndex: -1, progress: 0 });
    setAccuracy(null);
    setHit(null);
    hitStatsRef.current = { hits: 0, total: 0 };
  }, []);

  /** Valida a duração (regra 4) e guarda o áudio para tocar. */
  const acceptAudio = useCallback(
    async (blob: Blob, origin: "cache" | "download" | "file", signal?: AbortSignal) => {
      setPhase({ kind: "checking-duration" });
      const audioMs = await readAudioDurationMs(blob);
      if (!mountedRef.current || signal?.aborted) return;

      if (audioMs === null) {
        if (origin === "file") {
          setPhase({ kind: "pick-file", notice: UNREADABLE_FILE_COPY });
          return;
        }
        // Metadados ilegíveis no áudio baixado: a decodificação, na hora de cantar, decide.
      } else if (!durationMatches(audioMs, song.durationMs)) {
        setPhase({ kind: "pick-file", notice: mismatchCopy(audioMs, song.durationMs) });
        return;
      }

      audioRef.current = blob;
      durationRef.current = audioMs ?? song.durationMs;
      setDurationMs(durationRef.current);
      setPhase({ kind: "ready", notice: null });
    },
    [song.durationMs],
  );

  useEffect(() => {
    mountedRef.current = true;
    // Cancela as requisições desta montagem ao desmontar (inclui o duplo mount do Strict Mode
    // em dev), para não baixar o áudio duas vezes.
    const controller = new AbortController();
    const { signal } = controller;

    const loadAudio = async () => {
      const cached = await getSongAudio(song.id);
      if (signal.aborted) return;
      if (cached) {
        await acceptAudio(cached, "cache", signal);
        return;
      }

      if (song.youtubeVideoId) {
        setPhase({ kind: "downloading-audio", loaded: 0, total: null });
        let lastUpdate = 0;
        try {
          const blob = await api.downloadSongAudio(
            song.id,
            (loaded, total) => {
              const now = performance.now();
              if (signal.aborted || (now - lastUpdate < PROGRESS_THROTTLE_MS && loaded !== total)) return;
              lastUpdate = now;
              setPhase({ kind: "downloading-audio", loaded, total });
            },
            signal,
          );
          if (signal.aborted) return;
          await saveSongAudio(song.id, blob);
          await acceptAudio(blob, "download", signal);
        } catch {
          if (!signal.aborted) setPhase({ kind: "pick-file", notice: DOWNLOAD_FAILED_COPY });
        }
        return;
      }

      setPhase({ kind: "pick-file", notice: UPLOAD_ONLY_COPY });
    };

    void (async () => {
      try {
        // A referência é buscada uma vez por sessão.
        const track = await api.getReference(song.id, signal);
        if (signal.aborted) return;
        referenceRef.current = track;
        setReference(track);
      } catch {
        if (!signal.aborted) setPhase({ kind: "error", notice: REFERENCE_LOAD_COPY });
        return;
      }
      await loadAudio();
    })();

    return () => {
      mountedRef.current = false;
      controller.abort();
      teardown();
    };
  }, [song.id, song.youtubeVideoId, acceptAudio, teardown]);

  const changeOffset = (value: number) => {
    offsetRef.current = normalizeOffsetMs(value);
    setOffsetMs(value);
  };

  const startLoops = () => {
    let singing = false;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const t = getTimeMs();
      if (t < 0) {
        const value = Math.min(COUNTDOWN_S, Math.max(1, Math.ceil(-t / 1000)));
        setPhase((prev) => (prev.kind === "countdown" && prev.value === value ? prev : { kind: "countdown", value }));
        return;
      }
      if (!singing) {
        singing = true;
        setPhase({ kind: "singing" });
      }
      const offset = offsetRef.current;
      const lineIndex = currentLineIndex(lines, t, offset);
      const progress = Math.round(lineProgress(lines, lineIndex, t, offset) * 100) / 100;
      const timeMs = Math.floor(t / 100) * 100;
      setHud((prev) =>
        prev.lineIndex === lineIndex && prev.progress === progress && prev.timeMs === timeMs
          ? prev
          : { timeMs, lineIndex, progress },
      );
    };
    rafRef.current = requestAnimationFrame(loop);

    hitTimerRef.current = window.setInterval(() => {
      const track = referenceRef.current;
      if (!track) return;
      const t = getTimeMs();
      if (t < 0) return;
      const end = Math.floor(t / HOP_MS) - HIT_LAG_FRAMES;
      const error = meanCentsError(track.midi, voiceFramesRef.current, end - HIT_WINDOW_FRAMES, end);
      if (error === null) return;
      const kind = hitForCents(error);
      const stats = hitStatsRef.current;
      stats.total++;
      if (kind !== "miss") stats.hits++;
      setAccuracy(stats.hits / stats.total);
      setHit((prev) => ({ kind, key: (prev?.key ?? 0) + 1 }));
    }, HIT_INTERVAL_MS);
  };

  /** Fim da música ou "Terminar": envia a performance (parcial, se for o caso). */
  const finish = async (playerName: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(hitTimerRef.current);

    const context = contextRef.current;
    const recorder = recorderRef.current;
    const elapsedMs = context ? Math.min(durationRef.current, Math.max(HOP_MS, getTimeMs())) : durationRef.current;
    const frames = recorder?.frames ?? [];

    recorder?.stop();
    recorderRef.current = null;
    try {
      sourceRef.current?.stop();
    } catch {
      // já parou
    }
    sourceRef.current = null;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();

    if (!mountedRef.current) return;
    setPhase({ kind: "submitting" });

    const track = framesToTrack(frames, elapsedMs);
    try {
      const result = await api.submitPerformance(song.id, { playerName, offsetMs: offsetRef.current, track });
      const ranking = await api.getRanking(song.id, 10);
      if (mountedRef.current) setPhase({ kind: "result", result, ranking });
    } catch {
      if (mountedRef.current) setPhase({ kind: "ready", notice: SUBMIT_FAILED_COPY });
    }
  };

  /** "Parar": descarta a cantoria e volta ao início. */
  const stopSinging = () => {
    teardown();
    resetHud();
    setPhase({ kind: "ready", notice: null });
  };

  /** "Começar": gesto do usuário que libera o AudioContext e pede o microfone. */
  const begin = async () => {
    const blob = audioRef.current;
    if (!blob || !referenceRef.current || !isValidPlayerName(name)) return;
    const playerName = normalizePlayerName(name);
    commitName(playerName);
    offsetRef.current = offsetMs;
    resetHud();
    finishedRef.current = false;

    const context = new AudioContext();
    contextRef.current = context;
    try {
      await context.resume();
    } catch {
      // alguns browsers só liberam depois; a fonte começa no start()
    }

    setPhase({ kind: "mic-permission" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      teardown();
      if (mountedRef.current) setPhase({ kind: "ready", notice: MIC_DENIED_COPY });
      return;
    }
    if (!mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    let buffer: AudioBuffer;
    try {
      await loadCaptureWorklet(context);
      buffer = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
      for (const track of stream.getTracks()) track.stop();
      teardown();
      if (mountedRef.current) setPhase({ kind: "pick-file", notice: DECODE_FAILED_COPY });
      return;
    }
    if (!mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      teardown();
      return;
    }

    const decodedMs = Math.round(buffer.duration * 1000);
    if (!durationMatches(decodedMs, song.durationMs)) {
      for (const track of stream.getTracks()) track.stop();
      teardown();
      setPhase({ kind: "pick-file", notice: mismatchCopy(decodedMs, song.durationMs) });
      return;
    }
    durationRef.current = decodedMs;
    setDurationMs(decodedMs);

    const latency = audioLatencySeconds(context);
    outputLatencyRef.current = latency - context.baseLatency;
    const startTime = context.currentTime + COUNTDOWN_S;
    startTimeRef.current = startTime;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => void finish(playerName);
    source.start(startTime);
    sourceRef.current = source;

    const recorder = createRecorder({ context, stream, startTime, latency });
    recorderRef.current = recorder;
    voiceFramesRef.current = recorder.frames;

    setPhase({ kind: "countdown", value: COUNTDOWN_S });
    startLoops();
  };

  const onStage = phase.kind === "countdown" || phase.kind === "singing";
  const songProgress = durationMs > 0 ? Math.min(1, hud.timeMs / durationMs) : 0;

  return (
    <div className="mx-auto grid w-full max-w-[var(--stage-max)] gap-6 px-4 py-6">
      <header className="grid gap-1">
        <span className="ct-label">Karaokê</span>
        <h1>{song.title}</h1>
        <p className="text-fg-2">{song.artist}</p>
      </header>

      {phase.kind === "loading-audio" ? <LoadingBlock title="Carregando a música" hint="Procurando o áudio neste dispositivo." /> : null}

      {phase.kind === "checking-duration" ? <LoadingBlock title="Conferindo o áudio" /> : null}

      {phase.kind === "downloading-audio" ? (
        phase.total !== null && phase.total > 0 ? (
          <div className="grid max-w-[420px] gap-2 justify-self-center w-full" aria-live="polite">
            <div className="ct-meter__head">
              <span className="ct-label">Baixando a música</span>
              <span className="ct-numeric text-sm text-neon-cyan">{Math.round((phase.loaded / phase.total) * 100)}%</span>
            </div>
            <div
              className="ct-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((phase.loaded / phase.total) * 100)}
              aria-label="Baixando a música"
            >
              <div className="ct-progress__fill" style={{ "--value": phase.loaded / phase.total } as CSSProperties} />
            </div>
            <p className="ct-field__hint">Só na primeira vez: depois a música toca direto daqui.</p>
          </div>
        ) : (
          <LoadingBlock title="Baixando a música" hint="Só na primeira vez: depois a música toca direto daqui." />
        )
      ) : null}

      {phase.kind === "pick-file" ? (
        <section className="grid gap-5" aria-label="Arquivo da música">
          <Alert tone={phase.notice.tone} title={phase.notice.title} body={phase.notice.body} />
          <FileDropzone
            title="Solte o arquivo da música aqui"
            description={`Ou clique para escolher. Fica só neste dispositivo e precisa ter a duração da letra (${formatDuration(song.durationMs)}).`}
            busyLabel="Conferindo"
            onFile={(file) => void acceptAudio(file, "file")}
          />
          <p>
            <Link href={`/songs/${song.id}`} className="ct-btn ct-btn--ghost ct-btn--sm">
              Voltar
            </Link>
          </p>
        </section>
      ) : null}

      {phase.kind === "ready" ? (
        <section className="ct-panel grid gap-5" aria-label="Antes de cantar">
          <Alert tone={HEADPHONES_COPY.tone} title={HEADPHONES_COPY.title} body={HEADPHONES_COPY.body} icon="headphones" />
          {phase.notice ? <Alert tone={phase.notice.tone} title={phase.notice.title} body={phase.notice.body} /> : null}
          <PlayerNameField value={name} onChange={setName} />
          <OffsetField value={offsetMs} onChange={changeOffset} aligned={aligned} />
          <button
            type="button"
            className="ct-btn ct-btn--primary ct-btn--start ct-btn--block"
            disabled={!isValidPlayerName(name)}
            onClick={() => void begin()}
          >
            Começar
          </button>
          <p>
            <Link href={`/songs/${song.id}`} className="ct-btn ct-btn--ghost ct-btn--sm">
              Voltar
            </Link>
          </p>
        </section>
      ) : null}

      {phase.kind === "mic-permission" ? (
        <LoadingBlock title="Liberando o microfone" hint="Aceite o pedido do navegador para o microfone." />
      ) : null}

      {onStage ? (
        <>
          {/* w-full: o margin-inline auto do .ct-stage encolheria o palco ao conteúdo dentro do grid */}
          <div className="ct-stage ct-crt w-full">
            <div className="ct-hud">
              <div className="ct-hud__item">
                <span className="ct-label">Jogador 1</span>
                <span className="ct-hud__value ct-neon-pink">{normalizePlayerName(name)}</span>
              </div>
              <div className="ct-hud__item min-w-0 max-w-[360px] flex-1">
                <span className="ct-label truncate">{song.title}</span>
                <div className="ct-progress" aria-hidden="true">
                  <div className="ct-progress__fill" style={{ "--value": songProgress } as CSSProperties} />
                </div>
              </div>
              <div className="ct-hud__item text-right">
                <span className="ct-label">Afinação</span>
                <span className="ct-hud__value ct-neon-cyan">{accuracy === null ? "--" : `${Math.round(accuracy * 100)}%`}</span>
              </div>
            </div>
            <div className="ct-highway">
              <div className="ct-highway__lane">
                {reference ? <PitchCanvas reference={reference} voiceFrames={voiceFramesRef} getTimeMs={getTimeMs} running={onStage} /> : null}
              </div>
              <div className="ct-highway__hitline" />
              {hit ? (
                <div className="absolute right-6 top-4">
                  <span key={hit.key} className={`ct-hit ct-hit--${hit.kind}`}>
                    {HIT_LABEL[hit.kind]}
                  </span>
                </div>
              ) : null}
              {phase.kind === "countdown" ? (
                <div className="absolute inset-0 z-[var(--z-hud)] grid place-items-center" aria-live="assertive">
                  <div key={phase.value} className="ct-countdown">
                    {phase.value}
                  </div>
                </div>
              ) : null}
            </div>
            <LyricsView lines={lines} currentIndex={hud.lineIndex} progress={hud.progress} />
          </div>
          <div className="ct-panel grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <OffsetField value={offsetMs} onChange={changeOffset} aligned={aligned} />
            <div className="flex flex-wrap gap-3">
              <button type="button" className="ct-btn ct-btn--secondary" onClick={() => void finish(normalizePlayerName(name))}>
                Terminar
              </button>
              <button type="button" className="ct-btn ct-btn--danger" onClick={stopSinging}>
                Parar
              </button>
            </div>
          </div>
        </>
      ) : null}

      {phase.kind === "submitting" ? <LoadingBlock title="Calculando a nota" /> : null}

      {phase.kind === "result" ? (
        <section className="grid items-start gap-6 md:grid-cols-2" aria-label="Fim de jogo">
          <ScoreResult
            result={phase.result}
            songId={song.id}
            onRetry={() => {
              resetHud();
              setPhase({ kind: "ready", notice: null });
            }}
          />
          <RankingList items={phase.ranking} highlightId={phase.result.id} />
        </section>
      ) : null}

      {phase.kind === "error" ? (
        <section className="grid gap-4" aria-label="Erro">
          <Alert tone={phase.notice.tone} title={phase.notice.title} body={phase.notice.body} />
          <div className="flex flex-wrap gap-3">
            <button type="button" className="ct-btn ct-btn--primary" onClick={() => window.location.reload()}>
              Tentar de novo
            </button>
            <Link href={`/songs/${song.id}`} className="ct-btn ct-btn--ghost">
              Voltar
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
