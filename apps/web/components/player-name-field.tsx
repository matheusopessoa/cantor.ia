"use client";

import { useId, useState } from "react";
import { AlertIcon } from "./icons";
import { PLAYER_NAME_MAX, playerNameError } from "@/lib/player-name";

interface PlayerNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  autoFocus?: boolean;
}

/** "INSIRA SEU NOME" de fliperama (`.ct-name-entry`), validado com a regra da API. */
export function PlayerNameField({ value, onChange, hint, autoFocus }: PlayerNameFieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const error = touched ? playerNameError(value) : null;

  return (
    <div className="ct-field">
      <label className="ct-field__label" htmlFor={id}>
        Nome do jogador
      </label>
      <input
        id={id}
        className="ct-input ct-name-entry"
        value={value}
        maxLength={PLAYER_NAME_MAX}
        placeholder="AAA"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
      />
      {error ? (
        <span className="ct-field__error" id={`${id}-hint`}>
          <AlertIcon width={16} height={16} />
          {error}
        </span>
      ) : (
        <span className="ct-field__hint" id={`${id}-hint`}>
          {hint ?? `Até ${PLAYER_NAME_MAX} caracteres. Fica no ranking desta música.`}
        </span>
      )}
    </div>
  );
}
