import { PitchDetector } from "pitchy";
import { HOP_MS, detectionToMidi } from "./pitch";

/** Janela de análise do pitchy (amostras). ~43 ms a 48 kHz: resolve até ~65 Hz. */
const WINDOW_SAMPLES = 2048;

export interface RecorderOptions {
  context: AudioContext;
  stream: MediaStream;
  /** Instante, no relógio do `AudioContext`, em que a música começa a tocar. */
  startTime: number;
  /**
   * Latência (s) descontada de cada amostra: `outputLatency + baseLatency`. No Safari
   * `outputLatency` pode não existir; aí fica só `baseLatency`.
   */
  latency: number;
  /** Chamado a cada frame de 10 ms gravado (índice e nota), para o gráfico ao vivo. */
  onFrame?: (index: number, midi: number | null) => void;
}

export interface Recorder {
  /** Frames gravados até agora, um a cada 10 ms desde `startTime` (vazios = `null`). */
  readonly frames: (number | null)[];
  /** Tempo médio por hop (ms), para o critério de "< 2 ms" do plano. */
  averageHopMs(): number;
  /** Para de gravar e libera o worklet e as tracks do microfone. */
  stop(): void;
}

interface CaptureMessage {
  samples: Float32Array;
  endTime: number;
}

/** Restrições de captura: sem processamento, para o pitch não ser "corrigido". */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

export function audioLatencySeconds(context: AudioContext): number {
  const output = typeof context.outputLatency === "number" && Number.isFinite(context.outputLatency)
    ? context.outputLatency
    : 0;
  return output + context.baseLatency;
}

/** Carrega o worklet uma vez por contexto. */
export async function loadCaptureWorklet(context: AudioContext): Promise<void> {
  await context.audioWorklet.addModule("/worklets/capture.worklet.js");
}

/**
 * Liga o microfone ao worklet e converte cada hop em um frame do `PitchTrack`. Frames
 * anteriores a `startTime` são descartados; buracos (mensagens perdidas) viram `null`.
 */
export function createRecorder(options: RecorderOptions): Recorder {
  const { context, stream, startTime, latency, onFrame } = options;
  const sampleRate = context.sampleRate;
  const hopSamples = Math.round(sampleRate / (1000 / HOP_MS));

  const detector = PitchDetector.forFloat32Array(WINDOW_SAMPLES);
  const window = new Float32Array(WINDOW_SAMPLES);
  const frames: (number | null)[] = [];

  let totalHopMs = 0;
  let hops = 0;
  let stopped = false;

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "cantor-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: { hopSamples },
  });

  node.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
    if (stopped) return;
    const { samples, endTime } = event.data;
    const began = performance.now();

    // Janela deslizante: entra o hop novo, sai o mais antigo.
    window.copyWithin(0, samples.length);
    window.set(samples, WINDOW_SAMPLES - samples.length);

    let energy = 0;
    for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / samples.length);

    const [hz, clarity] = detector.findPitch(window, sampleRate);
    const midi = detectionToMidi(hz, clarity, rms);

    const index = Math.round(((endTime - startTime - latency) * 1000) / HOP_MS);
    if (index >= 0) {
      while (frames.length < index) frames.push(null);
      frames[index] = midi;
      onFrame?.(index, midi);
    }

    totalHopMs += performance.now() - began;
    hops++;
  };

  source.connect(node);

  return {
    frames,
    averageHopMs: () => (hops === 0 ? 0 : totalHopMs / hops),
    stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // já desconectado
      }
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
