/**
 * Segunda saída da música: além da saída padrão do sistema (o fone, onde também toca o
 * retorno da voz), a música pode tocar ao mesmo tempo em outro dispositivo (caixa de som,
 * TV). Só a música vai para lá, nunca o retorno do microfone.
 *
 * Funciona onde o browser tem `HTMLMediaElement.setSinkId` (Chrome, Edge, Firefox recente).
 */

/** Sem segunda saída: a música toca só na saída padrão. */
export const NO_SECOND_OUTPUT = "";

/** Ids que o browser usa para apontar a saída padrão, não um aparelho de verdade. */
const PSEUDO_DEVICE_IDS = new Set(["", "default", "communications"]);

export interface OutputChoice {
  deviceId: string;
  label: string;
  /** O browser mostrou o nome do aparelho (só depois da permissão do microfone). */
  named: boolean;
}

/**
 * Aparelhos de saída que podem ser a segunda saída. Tira os apelidos da saída padrão (ela já
 * toca a música) e numera os que vêm sem nome (sem permissão, o browser esconde o nome).
 */
export function outputChoices(devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]): OutputChoice[] {
  const choices: OutputChoice[] = [];
  const seen = new Set<string>();
  for (const device of devices) {
    if (device.kind !== "audiooutput" || PSEUDO_DEVICE_IDS.has(device.deviceId) || seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    const label = device.label.trim();
    choices.push({ deviceId: device.deviceId, label: label || `Saída ${choices.length + 1}`, named: label !== "" });
  }
  return choices;
}

/** O browser deixa escolher o aparelho de saída de um elemento de áudio? */
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** Saídas disponíveis agora. Vazio sem suporte ou sem `mediaDevices`. */
export async function listOutputChoices(): Promise<OutputChoice[]> {
  if (!supportsOutputSelection() || !navigator.mediaDevices?.enumerateDevices) return [];
  return outputChoices(await navigator.mediaDevices.enumerateDevices());
}

export interface SecondOutput {
  /** Nó onde a música é ligada para tocar também no segundo aparelho. */
  readonly input: AudioNode;
  /** Para de tocar e solta o elemento de áudio. */
  stop(): void;
}

/**
 * Cria a segunda saída: um `MediaStreamAudioDestinationNode` do mesmo `AudioContext` (mesmo
 * relógio da música) tocado por um `<audio>` apontado para o aparelho. Chamar logo no clique
 * de "Começar", para o `play()` valer como gesto do usuário. Nulo sem suporte ou se o aparelho
 * sumiu: a música segue só na saída padrão.
 */
export async function createSecondOutput(context: AudioContext, deviceId: string): Promise<SecondOutput | null> {
  if (deviceId === NO_SECOND_OUTPUT || !supportsOutputSelection()) return null;
  const destination = context.createMediaStreamDestination();
  const element = new Audio();
  element.srcObject = destination.stream;
  const stop = () => {
    element.pause();
    element.srcObject = null;
    destination.disconnect();
  };
  try {
    const playing = element.play();
    await element.setSinkId(deviceId);
    await playing;
  } catch {
    stop();
    return null;
  }
  return { input: destination, stop };
}

const STORAGE_KEY = "cantor.ia:second-output";

/** Aparelho memorizado neste dispositivo; nenhum sem `localStorage` ou sem escolha. */
export function loadSecondOutput(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? NO_SECOND_OUTPUT;
  } catch {
    return NO_SECOND_OUTPUT;
  }
}

export function saveSecondOutput(deviceId: string): void {
  try {
    if (deviceId === NO_SECOND_OUTPUT) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // sem storage: a escolha vale só nesta sessão
  }
}
