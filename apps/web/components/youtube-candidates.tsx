"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { YoutubeCandidateDto, YoutubeSuggestion } from "@/lib/types";
import { candidateBadges, formatViews, youtubeShortUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "@/lib/youtube";

export type SuggestionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; suggestion: YoutubeSuggestion }
  | { kind: "error" };

type FetchResult = Extract<SuggestionState, { kind: "done" | "error" }>;

/**
 * Busca os candidatos do YouTube (sdd-008) sem bloquear a página: `loading` enquanto a API
 * responde, `error` quando ela falha (a tela mostra o campo manual). Refaz a busca sempre que
 * `enabled` volta a ser verdadeiro (ex.: a referência falhou); a API guarda o resultado por
 * 10 min, então repetir é barato.
 */
export function useYoutubeSuggestion(songId: string, enabled: boolean): SuggestionState {
  const [result, setResult] = useState<FetchResult | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api
      .getYoutubeCandidates(songId, controller.signal)
      .then((suggestion) => setResult({ kind: "done", suggestion }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ kind: "error" });
      });
    return () => controller.abort();
  }, [songId, enabled]);

  if (!enabled) return { kind: "idle" };
  return result ?? { kind: "loading" };
}

function stats(candidate: YoutubeCandidateDto): string {
  const duration = formatDuration(candidate.durationMs);
  return candidate.viewCount === null ? duration : `${duration} · ${formatViews(candidate.viewCount)} visualizações`;
}

function Badges({ reasons }: { reasons: readonly string[] }) {
  const badges = candidateBadges(reasons);
  if (badges.length === 0) return null;
  return (
    <ul className="flex list-none flex-wrap gap-2 p-0" aria-label="Por que sugerimos">
      {badges.map((badge) => (
        <li key={badge.label} className="ct-badge">
          {badge.label}
        </li>
      ))}
    </ul>
  );
}

interface CandidateProps {
  candidate: YoutubeCandidateDto;
  busy: boolean;
  onChoose: (videoId: string) => void;
}

/** O melhor candidato numa `.ct-tv`, com a única ação principal da tela. */
function FeaturedCandidate({ candidate, busy, onChoose }: CandidateProps) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <figure className="ct-tv">
        <div className="ct-tv__screen ct-crt">
          <Image
            src={youtubeThumbnailUrl(candidate.videoId, "hq")}
            alt={`Miniatura do vídeo ${candidate.title}`}
            width={480}
            height={360}
            unoptimized
          />
        </div>
        <figcaption className="ct-tv__caption">
          <span>{youtubeShortUrl(candidate.videoId)}</span>
        </figcaption>
      </figure>
      <div className="grid content-start gap-4">
        <div className="grid gap-1">
          <strong className="text-fg">{candidate.title}</strong>
          <span className="text-fg-2">{candidate.channel ?? "Canal não informado"}</span>
          <span className="ct-numeric text-fg-3">{stats(candidate)}</span>
        </div>
        <Badges reasons={candidate.reasons} />
        <button
          type="button"
          className="ct-btn ct-btn--primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onChoose(candidate.videoId)}
        >
          {busy ? "Enviando…" : "Usar este vídeo"}
        </button>
        <a className="ct-field__hint" href={youtubeWatchUrl(candidate.videoId)} target="_blank" rel="noopener noreferrer">
          Conferir no YouTube
        </a>
      </div>
    </div>
  );
}

/**
 * Alternativa como `.ct-song-row` clicável (miniatura pequena, canal, selos, duração e
 * visualizações). O "Usar" é só visual: o nome acessível do botão é a ação mais o título.
 */
function CandidateRow({ candidate, busy, onChoose }: CandidateProps) {
  const badges = candidateBadges(candidate.reasons);
  return (
    <button
      type="button"
      className="ct-song-row w-full text-left"
      aria-label={`Usar ${candidate.title}`}
      disabled={busy}
      onClick={() => onChoose(candidate.videoId)}
    >
      <span className="ct-song-row__cover" aria-hidden="true">
        <Image src={youtubeThumbnailUrl(candidate.videoId, "default")} alt="" width={48} height={48} unoptimized />
      </span>
      <span className="min-w-0">
        <span className="ct-song-row__title block truncate">{candidate.title}</span>
        <span className="ct-song-row__artist block truncate">
          {candidate.channel ?? "Canal não informado"}
          {badges.length > 0 ? ` · ${badges.map((badge) => badge.label).join(" · ")}` : ""}
        </span>
      </span>
      <span className="ct-song-row__meta">
        <span className="ct-numeric hidden sm:inline">{stats(candidate)}</span>
        <span className="ct-numeric sm:hidden">{formatDuration(candidate.durationMs)}</span>
        <span className="ct-btn ct-btn--secondary ct-btn--sm" aria-hidden="true">
          Usar
        </span>
      </span>
    </button>
  );
}

interface YoutubeCandidatesProps {
  suggestion: YoutubeSuggestion;
  /**
   * Com destaque (confiança `high`/`medium`): o melhor na TV com "Usar este vídeo" e o resto
   * como alternativas. Sem destaque (`low`): só a lista, "Talvez seja um destes".
   */
  featured: boolean;
  busy: boolean;
  onChoose: (videoId: string) => void;
}

/** Candidatos do YouTube para a referência. Nunca processa sozinho: sempre espera o clique. */
export function YoutubeCandidates({ suggestion, featured, busy, onChoose }: YoutubeCandidatesProps) {
  const [top, ...rest] = suggestion.candidates;
  if (!top) return null;

  const rows = featured ? rest : suggestion.candidates;
  const heading = featured
    ? top.tier === 1
      ? "Achamos a versão oficial"
      : "O mais visto com a duração da letra"
    : "Talvez seja um destes";
  const intro = featured
    ? "Confira o título e o canal e confirme. Nada é processado antes do clique."
    : "Não temos certeza. Confira o título e o canal antes de usar.";

  return (
    <section className="ct-panel grid gap-5" aria-label="Vídeos sugeridos">
      <div className="grid gap-1">
        <span className="ct-label">{heading}</span>
        <p className="text-fg-2">{intro}</p>
      </div>
      {featured ? <FeaturedCandidate candidate={top} busy={busy} onChoose={onChoose} /> : null}
      {rows.length > 0 ? (
        <ul className="grid list-none gap-3 p-0" aria-label={featured ? "Outras opções" : "Vídeos encontrados"}>
          {rows.map((candidate) => (
            <li key={candidate.videoId}>
              <CandidateRow candidate={candidate} busy={busy} onChoose={onChoose} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
