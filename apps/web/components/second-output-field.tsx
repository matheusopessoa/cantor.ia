"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { NO_SECOND_OUTPUT, listOutputChoices, supportsOutputSelection, type OutputChoice } from "@/lib/music-output";

interface SecondOutputFieldProps {
  value: string;
  onChange: (deviceId: string) => void;
}

const noopSubscribe = () => () => {};

/**
 * Aparelho onde a música também toca, além da saída padrão (o fone). Some nos browsers sem
 * `setSinkId` (Safari). Sem a permissão do microfone o browser esconde os aparelhos, então um
 * botão pede a permissão e lista de novo.
 */
export function SecondOutputField({ value, onChange }: SecondOutputFieldProps) {
  const id = useId();
  const supported = useSyncExternalStore(noopSubscribe, supportsOutputSelection, () => false);
  const [choices, setChoices] = useState<OutputChoice[] | null>(null);
  const [asking, setAsking] = useState(false);

  // setState só no retorno da promessa (callback de sistema externo), nunca no corpo do efeito.
  const refresh = useCallback(() => listOutputChoices().then(setChoices, () => setChoices([])), []);

  useEffect(() => {
    if (!supported) return;
    const devices = navigator.mediaDevices;
    const onChange = () => void refresh();
    onChange();
    devices?.addEventListener("devicechange", onChange);
    return () => devices?.removeEventListener("devicechange", onChange);
  }, [supported, refresh]);

  if (!supported) return null;

  const askPermission = async () => {
    setAsking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // negado: a lista fica como está e o pedido volta no "Começar"
    }
    await refresh();
    setAsking(false);
  };

  const list = choices ?? [];
  // Antes da primeira lista não dá para dizer que o aparelho sumiu.
  const missing = choices !== null && value !== NO_SECOND_OUTPUT && !list.some((choice) => choice.deviceId === value);
  const hidden = choices !== null && (list.length === 0 || list.some((choice) => !choice.named));

  return (
    <div className="ct-field">
      <label className="ct-field__label" htmlFor={id}>
        Tocar a música também em
      </label>
      <select id={id} className="ct-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={NO_SECOND_OUTPUT}>Nenhum outro aparelho (só o fone)</option>
        {list.map((choice) => (
          <option key={choice.deviceId} value={choice.deviceId}>
            {choice.label}
          </option>
        ))}
        {value !== NO_SECOND_OUTPUT && !list.some((choice) => choice.deviceId === value) ? (
          <option value={value}>{missing ? "Aparelho escolhido antes (desconectado)" : "Aparelho escolhido antes"}</option>
        ) : null}
      </select>
      {hidden ? (
        <button
          type="button"
          className="ct-btn ct-btn--ghost ct-btn--sm justify-self-start"
          disabled={asking}
          onClick={() => void askPermission()}
        >
          {asking ? "Procurando" : "Procurar caixas de som"}
        </button>
      ) : null}
      <span className="ct-field__hint">
        Só a música vai para lá; sua voz continua só no fone. O microfone também escuta essa caixa: deixe-a longe
        dele e num volume baixo, senão a nota sai errada. {missing ? "O aparelho escolhido não está conectado: a música toca só no fone." : null}
      </span>
    </div>
  );
}
