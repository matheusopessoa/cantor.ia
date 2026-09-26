"use client";

import { useId } from "react";
import { DIFFICULTIES, DIFFICULTY_DESCRIPTION, DIFFICULTY_LABEL } from "@/lib/difficulty";
import type { Difficulty } from "@/lib/types";

interface DifficultyTabsProps {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
}

/** Escolha do nível (sdd-009): `.ct-tabs` "Fácil | Médio | Difícil" com a descrição do escolhido. */
export function DifficultyTabs({ value, onChange }: DifficultyTabsProps) {
  const id = useId();
  return (
    <div className="ct-field">
      <span className="ct-field__label" id={`${id}-label`}>
        Nível
      </span>
      <div className="ct-tabs justify-self-start" role="tablist" aria-labelledby={`${id}-label`}>
        {DIFFICULTIES.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            className="ct-tab"
            role="tab"
            id={`${id}-${difficulty}`}
            aria-selected={value === difficulty}
            aria-controls={`${id}-hint`}
            onClick={() => onChange(difficulty)}
          >
            {DIFFICULTY_LABEL[difficulty]}
          </button>
        ))}
      </div>
      <span className="ct-field__hint" id={`${id}-hint`} role="tabpanel" aria-labelledby={`${id}-${value}`}>
        {DIFFICULTY_DESCRIPTION[value]}
      </span>
    </div>
  );
}
