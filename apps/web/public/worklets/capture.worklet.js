/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */

/**
 * Captura do microfone (sdd-004). Roda na thread de áudio: junta os blocos de 128
 * amostras (mono) até completar um hop (10 ms = sampleRate / 100 amostras) e manda o
 * bloco para a main thread com o instante, no relógio do AudioContext, da última amostra.
 * A detecção de pitch (pitchy) acontece na main thread, em `lib/recorder.ts`.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const hop = options && options.processorOptions && options.processorOptions.hopSamples;
    this.hopSamples = hop > 0 ? hop : Math.round(sampleRate / 100);
    this.buffer = new Float32Array(this.hopSamples);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // `currentTime` é o início deste bloco; cada amostra avança 1 / sampleRate.
    const blockStart = currentTime;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.filled++] = channel[i];

      if (this.filled === this.hopSamples) {
        const samples = this.buffer;
        this.buffer = new Float32Array(this.hopSamples);
        this.filled = 0;
        this.port.postMessage({ samples, endTime: blockStart + (i + 1) / sampleRate }, [samples.buffer]);
      }
    }

    return true;
  }
}

registerProcessor("cantor-capture", CaptureProcessor);
