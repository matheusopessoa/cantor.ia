"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "./alert";
import { SearchIcon } from "./icons";
import { ApiError, api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { API_UNAVAILABLE_COPY, type ErrorCopy } from "@/lib/reference-errors";
import type { ReferenceStatus, SongSearchItem } from "@/lib/types";
import { youtubeThumbnailUrl } from "@/lib/youtube";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 400;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; items: SongSearchItem[] }
  | { kind: "error"; copy: ErrorCopy };

const BADGE: Record<ReferenceStatus, { className: string; label: string }> = {
  READY: { className: "ct-badge--ready", label: "Pronta" },
  PROCESSING: { className: "ct-badge--processing", label: "Preparando" },
  FAILED: { className: "ct-badge--failed", label: "Falhou" },
  NONE: { className: "ct-badge--none", label: "Sem referência" },
};

const NO_LYRICS_COPY: ErrorCopy = {
  tone: "warning",
  title: "Essa música não tem letra sincronizada",
  body: "Sem a letra no tempo não dá para dar nota. Tente outra versão ou outra música.",
};

function StatusBadge({ status }: { status: ReferenceStatus | null }) {
  if (status === null) return <span className="ct-badge ct-badge--none">Nova</span>;
  const badge = BADGE[status];
  return <span className={`ct-badge ${badge.className}`}>{badge.label}</span>;
}

function Cover({ item }: { item: SongSearchItem }) {
  if (item.youtubeVideoId) {
    return (
      <span className="ct-song-row__cover" aria-hidden="true">
        <Image src={youtubeThumbnailUrl(item.youtubeVideoId, "default")} alt="" width={48} height={48} unoptimized />
      </span>
    );
  }
  return (
    <span className="ct-song-row__cover" aria-hidden="true">
      {item.title.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function RowBody({ item, creating }: { item: SongSearchItem; creating: boolean }) {
  return (
    <>
      <Cover item={item} />
      <span className="min-w-0">
        <span className="ct-song-row__title block truncate">{item.title}</span>
        <span className="ct-song-row__artist block truncate">
          {item.artist}
          {item.album ? ` · ${item.album}` : ""}
        </span>
      </span>
      <span className="ct-song-row__meta">
        <span className="ct-numeric">{formatDuration(item.durationMs)}</span>
        {creating ? <span className="ct-badge ct-badge--processing">Cadastrando</span> : <StatusBadge status={item.referenceStatus} />}
      </span>
    </>
  );
}

/** Busca no LRCLIB (via API) com debounce; escolher uma música cadastra e abre a preparação. */
export function SongSearch() {
  const router = useRouter();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [creating, setCreating] = useState<number | null>(null);
  const [createError, setCreateError] = useState<ErrorCopy | null>(null);
  const requestId = useRef(0);

  const changeQuery = (value: string) => {
    setQuery(value);
    setState(value.trim().length < MIN_QUERY ? { kind: "idle" } : { kind: "loading" });
  };

  // Debounce: a busca só sai depois de DEBOUNCE_MS sem digitar; respostas atrasadas são ignoradas.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;

    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const items = await api.searchSongs(q);
        if (requestId.current === id) setState({ kind: "done", items });
      } catch {
        if (requestId.current === id) setState({ kind: "error", copy: API_UNAVAILABLE_COPY });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  const choose = async (item: SongSearchItem) => {
    if (creating !== null) return;
    setCreateError(null);
    setCreating(item.lrclibId);
    try {
      const song = await api.createSong(item.lrclibId);
      router.push(`/songs/${song.id}`);
    } catch (error) {
      setCreating(null);
      setCreateError(error instanceof ApiError && error.status === 422 ? NO_LYRICS_COPY : API_UNAVAILABLE_COPY);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="ct-field">
        <label className="ct-field__label" htmlFor={inputId}>
          Buscar música
        </label>
        <div className="ct-search">
          <SearchIcon className="ct-search__icon" />
          <input
            id={inputId}
            className="ct-input"
            type="search"
            placeholder="Artista ou título"
            autoComplete="off"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </div>
        <span className="ct-field__hint">Só entram músicas com letra sincronizada. Em dúvida, busque em inglês ou só pelo artista.</span>
      </div>

      {createError ? <Alert tone={createError.tone} title={createError.title} body={createError.body} /> : null}

      {state.kind === "error" ? <Alert tone={state.copy.tone} title={state.copy.title} body={state.copy.body} /> : null}

      {state.kind === "loading" ? (
        <p className="ct-label" aria-live="polite">
          Buscando…
        </p>
      ) : null}

      {state.kind === "done" && state.items.length === 0 ? (
        <p className="text-fg-2" aria-live="polite">
          Nada encontrado. Tente outro nome ou só o artista.
        </p>
      ) : null}

      {state.kind === "done" && state.items.length > 0 ? (
        <ul className="grid list-none gap-3 p-0" aria-label="Resultados">
          {state.items.map((item) => (
            <li key={item.lrclibId}>
              {item.songId ? (
                <Link href={`/songs/${item.songId}`} className="ct-song-row">
                  <RowBody item={item} creating={false} />
                </Link>
              ) : (
                <button
                  type="button"
                  className="ct-song-row w-full text-left"
                  disabled={creating !== null}
                  aria-busy={creating === item.lrclibId}
                  onClick={() => choose(item)}
                >
                  <RowBody item={item} creating={creating === item.lrclibId} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
