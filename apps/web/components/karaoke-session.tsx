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
import { SecondOutputField } from "./second-output-field";
import { api } from "@/lib/api";
import { durationMatches, readAudioDurationMs } from "@/lib/audio-duration";
import { getSongAudio, saveSongAudio } from "@/lib/audio-store";
import { DIFFICULTY_DESCRIPTION, DIFFICULTY_LABEL } from "@/lib/difficulty";
import { formatDuration, formatOffset } from "@/lib/format";
import { currentLineIndex, effectiveLyrics, lineProgress } from "@/lib/lyrics";
import { MONITOR_MAX, MONITOR_MIN, MONITOR_STEP, monitorGain } from "@/lib/monitor-volume";
import { SINGER_MAX, SINGER_MIN, SINGER_STEP, singerGain, stemsMatchOriginal } from "@/lib/singer-volume";
import { getSongStems, saveSongStems, type SongStems } from "@/lib/stems-store";
import { createSecondOutput, type SecondOutput } from "@/lib/music-output";
import { OFFSET_MAX_MS, OFFSET_MIN_MS, OFFSET_STEP_MS, normalizeOffsetMs } from "@/lib/lyrics-offset";
import {
  DIFFICULTY_THRESHOLDS,
  HOP_MS,
  framesToTrack,
  hitForCents,
  meanCentsError,
  presenceHit,
  type Hit,
  type PresenceHit,
} from "@/lib/pitch";
import { isValidPlayerName, normalizePlayerName } from "@/lib/player-name";
import { MIC_CONSTRAINTS, audioLatencySeconds, createRecorder, loadCaptureWorklet, type Recorder } from "@/lib/recorder";
import type { PerformanceResult, PitchTrack, RankingItem, SongDto } from "@/lib/types";
import { useDifficulty, useLyricsOffset, useMonitorVolume, usePlayerName, useSecondOutput, useSingerVolume } from "@/lib/use-prefs";

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

/**
 * Trilhas separadas (voz e instrumental, sdd-013) desta música neste aparelho: `idle` antes
 * de o áudio estar pronto, `preparing` enquanto o worker separa (1–2 min, só na primeira
 * vez), `ready` com as duas em cache, `failed` quando não deu (a música toca como o original).
 */
type StemsStatus = "idle" | "preparing" | "ready" | "failed";

interface StemBuffers {
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}

/** Feedback ao vivo: PERFECT/GOOD/MISS (médio e difícil) ou ON TIME/MISS (fácil, sdd-009). */
type LiveHit = Hit | PresenceHit;

const COUNTDOWN_S = 3;
/** Feedback a cada 250 ms, sobre os 250 ms anteriores. */
const HIT_INTERVAL_MS = 250;
const HIT_WINDOW_FRAMES = HIT_INTERVAL_MS / HOP_MS;
/** Os últimos frames ainda não chegaram do microfone (latência): avalia 100 ms atrás. */
const HIT_LAG_FRAMES = 10;
/** Atualiza a barra de progresso do download no máximo a cada 150 ms. */
const PROGRESS_THROTTLE_MS = 150;
/** Mudança de volume da voz do cantor sem estalo: `setTargetAtTime` com esta constante de tempo. */
const SINGER_GAIN_RAMP_S = 0.02;

const HIT_LABEL: Record<LiveHit, string> = { perfect: "Perfect", good: "Good", miss: "Miss", ontime: "On time" };

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
  const shifted = value !== 0;
  return (
    <div className="ct-field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="ct-field__label" htmlFor={id}>
          Ajuste fino da letra: <span className="ct-numeric text-neon-cyan">{formatOffset(value)}</span>
        </label>
        {shifted ? (
          <button type="button" className="ct-btn ct-btn--ghost ct-btn--sm" onClick={() => onChange(0)}>
            Zerar
          </button>
        ) : null}
      </div>
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
        {shifted ? (
          <>
            {" "}
            <strong>A nota de tempo cobra a entrada de cada verso já deslocado</strong>: cante seguindo a
            letra da tela ou zere o ajuste.
          </>
        ) : null}
      </span>
    </div>
  );
}

interface MonitorFieldProps {
  value: number;
  onChange: (value: number) => void;
}

/** Volume da própria voz no fone (retorno do microfone). 0 desliga. */
function MonitorField({ value, onChange }: MonitorFieldProps) {
  const id = useId();
  return (
    <div className="ct-field">
      <label className="ct-field__label" htmlFor={id}>
        Sua voz no fone:{" "}
        <span className="ct-numeric text-neon-cyan">{value === 0 ? "desligada" : `${value}%`}</span>
      </label>
      <input
        id={id}
        className="ct-range"
        type="range"
        min={MONITOR_MIN}
        max={MONITOR_MAX}
        step={MONITOR_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="ct-field__hint">
        Só com fone: sem ele, a caixa de som devolve a voz ao microfone e dá microfonia. No Bluetooth a voz volta
        atrasada; se atrapalhar, desligue.
      </span>
    </div>
  );
}

/**
 * Decodifica as duas trilhas no mesmo `AudioContext` da música. `null` quando alguma não
 * decodifica ou não tem a duração do original (regra 7): a sessão toca o original.
 */
async function decodeStems(context: AudioContext, stems: SongStems, originalMs: number): Promise<StemBuffers | null> {
  try {
    const [vocals, instrumental] = await Promise.all([
      context.decodeAudioData(await stems.vocals.arrayBuffer()),
      context.decodeAudioData(await stems.instrumental.arrayBuffer()),
    ]);
    const vocalsMs = Math.round(vocals.duration * 1000);
    const instrumentalMs = Math.round(instrumental.duration * 1000);
    if (!stemsMatchOriginal(vocalsMs, instrumentalMs, originalMs)) return null;
    return { vocals, instrumental };
  } catch {
    return null;
  }
}

interface SingerVolumeFieldProps {
  value: number;
  onChange: (value: number) => void;
  status: StemsStatus;
  /** No palco: a rodada está tocando as trilhas (`true`) ou o original (`false`). Fora dele, `null`. */
  playingStems: boolean | null;
}

/** Volume da voz do cantor original (sdd-013). Só mexe em algo com as trilhas separadas. */
function SingerVolumeField({ value, onChange, status, playingStems }: SingerVolumeFieldProps) {
  const id = useId();
  const enabled = playingStems === null ? status === "ready" : playingStems;
  let hint: string;
  if (playingStems === false) {
    hint = "Nesta rodada a música toca como o original; o controle vale a partir da próxima.";
  } else if (status === "preparing") {
    hint = "Separando a voz do cantor do instrumental (leva 1 a 2 min, só na primeira vez). Enquanto isso, a música toca como o original.";
  } else if (status === "failed") {
    hint = "Não deu para separar a voz do cantor: a música toca como o original.";
  } else if (status === "idle") {
    hint = "A voz do cantor é separada assim que a música estiver pronta.";
  } else {
    hint = "100% é a música como veio; 0% deixa só o instrumental (pode sobrar um resto da voz). Muda na hora, até no meio da música.";
  }
  return (
    <div className="ct-field">
      <label className="ct-field__label" htmlFor={id}>
        Voz do cantor:{" "}
        <span className="ct-numeric text-neon-cyan">{value === 0 ? "desligada" : `${value}%`}</span>
      </label>
      <input
        id={id}
        className="ct-range"
        type="range"
        min={SINGER_MIN}
        max={SINGER_MAX}
        step={SINGER_STEP}
        value={value}
        disabled={!enabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {status === "preparing" && playingStems === null ? (
        <div className="ct-loading" aria-live="polite">
          <span className="ct-loading__title">Preparando a voz do cantor</span>
          <div className="ct-loading__bar" role="progressbar" aria-label="Preparando a voz do cantor" />
        </div>
      ) : null}
      <span id={`${id}-hint`} className="ct-field__hint">
        {hint}
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
  // O ajuste é guardado por versão da letra: o da original não vale para a alinhada.
  const [offsetMs, setOffsetMs] = useLyricsOffset(song.id, aligned);
  // Nível escolhido na preparação (sdd-009): limiares do feedback, HUD, highway e nota.
  const [difficulty] = useDifficulty();
  // Retorno do microfone no fone: ajustável antes e durante a cantoria.
  const [monitorVolume, setMonitorVolume] = useMonitorVolume();
  // Aparelho onde a música também toca (caixa de som, TV); o retorno da voz fica só no fone.
  const [secondOutputId, setSecondOutputId] = useSecondOutput();
  // Voz do cantor original (sdd-013): vale quando as trilhas separadas estão prontas.
  const [singerVolume, setSingerVolume] = useSingerVolume();
  const [stemsStatus, setStemsStatus] = useState<StemsStatus>("idle");
  /** No palco: a rodada toca as trilhas (`true`) ou o original (`false`). */
  const [playingStems, setPlayingStems] = useState(false);
  const thresholds = DIFFICULTY_THRESHOLDS[difficulty];
  const easy = difficulty === "EASY";
  const [durationMs, setDurationMs] = useState(song.durationMs);
  const [hud, setHud] = useState<Hud>({ timeMs: 0, lineIndex: -1, progress: 0 });
  /** Fração das janelas sem MISS: "Afinação" no médio e no difícil, "Ritmo" no fácil. */
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [hit, setHit] = useState<{ kind: LiveHit; key: number } | null>(null);

  const mountedRef = useRef(false);
  const referenceRef = useRef<PitchTrack | null>(null);
  const audioRef = useRef<Blob | null>(null);
  const durationRef = useRef(song.durationMs);
  const contextRef = useRef<AudioContext | null>(null);
  /** As fontes da rodada: só o original, ou voz + instrumental (sdd-013). */
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const singerGainRef = useRef<GainNode | null>(null);
  const stemsRef = useRef<SongStems | null>(null);
  const stemsAbortRef = useRef<AbortController | null>(null);
  const secondOutputRef = useRef<SecondOutput | null>(null);
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

  /** Para as fontes da rodada (a que ainda não começou não reclama). */
  const stopSources = () => {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // ainda não tinha começado ou já parou
      }
    }
    sourcesRef.current = [];
    singerGainRef.current = null;
  };

  /** Solta tudo: laços, microfone, fontes e AudioContext. */
  const teardown = useCallback(() => {
    finishedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(hitTimerRef.current);
    recorderRef.current?.stop();
    recorderRef.current = null;
    stopSources();
    secondOutputRef.current?.stop();
    secondOutputRef.current = null;
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

  /**
   * Trilhas separadas deste áudio (sdd-013, regra 2): do cache do aparelho ou geradas em segundo
   * plano pelo worker, uma vez por música por aparelho. Nunca trava a cantoria: em falha, a
   * música toca como o original (regra 3).
   */
  const prepareStems = useCallback(
    async (blob: Blob) => {
      stemsAbortRef.current?.abort();
      const controller = new AbortController();
      stemsAbortRef.current = controller;
      stemsRef.current = null;

      const cached = await getSongStems(song.id);
      if (controller.signal.aborted) return;
      if (cached && cached.sourceSize === blob.size) {
        stemsRef.current = cached;
        setStemsStatus("ready");
        return;
      }

      setStemsStatus("preparing");
      try {
        const { vocals, instrumental } = await api.separateStems(song.id, blob, controller.signal);
        if (controller.signal.aborted) return;
        const stems: SongStems = { vocals, instrumental, sourceSize: blob.size };
        await saveSongStems(song.id, stems);
        if (controller.signal.aborted) return;
        stemsRef.current = stems;
        setStemsStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStemsStatus("failed");
      }
    },
    [song.id],
  );

  /** Valida a duração (regra 4), guarda o áudio para tocar e dispara as trilhas (sdd-013). */
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
      void prepareStems(blob);
    },
    [song.durationMs, prepareStems],
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
      stemsAbortRef.current?.abort();
      teardown();
    };
  }, [song.id, song.youtubeVideoId, acceptAudio, teardown]);

  const changeMonitorVolume = (value: number) => {
    setMonitorVolume(value);
    recorderRef.current?.setMonitorGain(monitorGain(value));
  };

  /** Muda o volume da voz do cantor na hora, sem estalo (regra 4). */
  const changeSingerVolume = (value: number) => {
    setSingerVolume(value);
    const gain = singerGainRef.current;
    const context = contextRef.current;
    if (gain && context) gain.gain.setTargetAtTime(singerGain(value), context.currentTime, SINGER_GAIN_RAMP_S);
  };

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
      const from = end - HIT_WINDOW_FRAMES;
      let kind: LiveHit;
      if (easy) {
        // Fácil: só se cantou no lugar certo, em qualquer tom (sdd-009 regra 6).
        const presence = presenceHit(track.midi, voiceFramesRef.current, from, end);
        if (presence === null) return;
        kind = presence;
      } else {
        const error = meanCentsError(track.midi, voiceFramesRef.current, from, end, thresholds);
        if (error === null) return;
        kind = hitForCents(error, thresholds);
      }
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
    stopSources();
    secondOutputRef.current?.stop();
    secondOutputRef.current = null;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();

    if (!mountedRef.current) return;
    setPhase({ kind: "submitting" });

    const track = framesToTrack(frames, elapsedMs);
    try {
      const result = await api.submitPerformance(song.id, { playerName, offsetMs: offsetRef.current, difficulty, track });
      const ranking = await api.getRanking(song.id, 10, result.difficulty);
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
    // Ainda no gesto do clique, para o play() do segundo aparelho ser liberado.
    const secondOutput = createSecondOutput(context, secondOutputId);
    try {
      await context.resume();
    } catch {
      // alguns browsers só liberam depois; a fonte começa no start()
    }
    secondOutputRef.current = await secondOutput;
    if (contextRef.current !== context) {
      // "Parar" ou desmontagem enquanto o aparelho abria
      secondOutputRef.current?.stop();
      secondOutputRef.current = null;
      return;
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

    let buffer: AudioBuffer | null;
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

    // Trilhas separadas (sdd-013): decodificadas no mesmo contexto; fora da duração do original
    // ou com falha, a rodada toca o original. Prontas no meio de uma rodada valem na próxima.
    const stems = stemsRef.current;
    const stemBuffers = stems ? await decodeStems(context, stems, decodedMs) : null;
    if (!mountedRef.current || contextRef.current !== context) {
      for (const track of stream.getTracks()) track.stop();
      teardown();
      return;
    }
    if (stemBuffers) buffer = null; // o original não é mais necessário nesta rodada

    const latency = audioLatencySeconds(context);
    outputLatencyRef.current = latency - context.baseLatency;
    const startTime = context.currentTime + COUNTDOWN_S;
    startTimeRef.current = startTime;

    // Tudo que é música passa pelo bus: fone e segunda saída recebem a mesma mistura (regra 6);
    // o retorno do microfone continua ligado só ao fone, pelo recorder.
    const bus = context.createGain();
    bus.connect(context.destination);
    if (secondOutputRef.current) bus.connect(secondOutputRef.current.input);

    const sources: AudioBufferSourceNode[] = [];
    if (stemBuffers) {
      const singer = context.createGain();
      singer.gain.value = singerGain(singerVolume);
      singer.connect(bus);
      singerGainRef.current = singer;

      const vocals = context.createBufferSource();
      vocals.buffer = stemBuffers.vocals;
      vocals.connect(singer);
      const instrumental = context.createBufferSource();
      instrumental.buffer = stemBuffers.instrumental;
      instrumental.connect(bus);
      instrumental.onended = () => void finish(playerName);
      sources.push(vocals, instrumental);
    } else {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bus);
      source.onended = () => void finish(playerName);
      sources.push(source);
    }
    // O mesmo `start` no mesmo relógio: as trilhas ficam em sincronia entre si e com a letra.
    for (const source of sources) source.start(startTime);
    sourcesRef.current = sources;
    setPlayingStems(stemBuffers !== null);

    const recorder = createRecorder({ context, stream, startTime, latency, monitorGain: monitorGain(monitorVolume) });
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
        <span className="ct-badge justify-self-start">{DIFFICULTY_LABEL[difficulty]}</span>
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
          <MonitorField value={monitorVolume} onChange={changeMonitorVolume} />
          <SingerVolumeField value={singerVolume} onChange={changeSingerVolume} status={stemsStatus} playingStems={null} />
          <SecondOutputField value={secondOutputId} onChange={setSecondOutputId} />
          <p className="ct-field__hint">
            Nível {DIFFICULTY_LABEL[difficulty].toLowerCase()}: {DIFFICULTY_DESCRIPTION[difficulty]} Para trocar, volte à música.
          </p>
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
                <span className="ct-label">{easy ? "Ritmo" : "Afinação"}</span>
                <span className="ct-hud__value ct-neon-cyan">{accuracy === null ? "--" : `${Math.round(accuracy * 100)}%`}</span>
              </div>
            </div>
            <div className="ct-highway">
              <div className="ct-highway__lane">
                {reference ? (
                  <PitchCanvas
                    reference={reference}
                    voiceFrames={voiceFramesRef}
                    getTimeMs={getTimeMs}
                    running={onStage}
                    mode={easy ? "activity" : "pitch"}
                  />
                ) : null}
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
            <div className="grid gap-4">
              <OffsetField value={offsetMs} onChange={changeOffset} aligned={aligned} />
              <MonitorField value={monitorVolume} onChange={changeMonitorVolume} />
              <SingerVolumeField value={singerVolume} onChange={changeSingerVolume} status={stemsStatus} playingStems={playingStems} />
            </div>
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
          <RankingList items={phase.ranking} difficulty={phase.result.difficulty} highlightId={phase.result.id} />
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
