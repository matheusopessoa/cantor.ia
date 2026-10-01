"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "./alert";
import { SearchIcon } from "./icons";
import { ApiError, api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { ErrorCopy } from "@/lib/reference-errors";
import { DEFAULT_SEARCH_MODE, SEARCH_MODES, searchErrorCopy, videoFallback, type SearchMode } from "@/lib/song-search";
import type { LyricsSearchItem, ReferenceStatus, SongSearchItem } from "@/lib/types";
import { youtubeThumbnailUrl } from "@/lib/youtube";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 400;
const MODES: SearchMode[] = ["lyrics", "video"];

/** Resultado de qualquer uma das buscas, no formato da linha. */
interface Row {
  /** Chave estável da linha e de "qual está sendo aberta". */
  key: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
  /** Vídeo da miniatura; sem ele, a capa é a inicial do título. */
  thumbnailVideoId: string | null;
  /** Cadastra a música (pela letra fica em `NONE`; pelo vídeo já começa a preparar). */
  create: () => Promise<{ id: string }>;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; rows: Row[] }
  | { kind: "error"; copy: ErrorCopy };

const BADGE: Record<ReferenceStatus, { className: string; label: string }> = {
  READY: { className: "ct-badge--ready", label: "Pronta" },
  PROCESSING: { className: "ct-badge--processing", label: "Preparando" },
  FAILED: { className: "ct-badge--failed", label: "Falhou" },
  NONE: { className: "ct-badge--none", label: "Sem referência" },
};

function fromLyrics(item: LyricsSearchItem): Row {
  return {
    key: `lyrics:${item.lrclibId}`,
    title: item.title,
    artist: item.artist,
    album: item.album,
    durationMs: item.durationMs,
    songId: item.songId,
    referenceStatus: item.referenceStatus,
    thumbnailVideoId: item.youtubeVideoId,
    create: () => api.createSongFromLyrics(item.lrclibId),
  };
}

function fromVideo(item: SongSearchItem): Row {
  return {
    key: `video:${item.videoId}`,
    title: item.title,
    artist: item.artist,
    album: item.album,
    durationMs: item.durationMs,
    songId: item.songId,
    referenceStatus: item.referenceStatus,
    thumbnailVideoId: item.videoId,
    create: () => api.createSong(item.videoId),
  };
}

async function searchRows(mode: SearchMode, q: string): Promise<Row[]> {
  return mode === "lyrics" ? (await api.searchLyrics(q)).map(fromLyrics) : (await api.searchSongs(q)).map(fromVideo);
}

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? (error.code ?? null) : null;
}

function StatusBadge({ status }: { status: ReferenceStatus | null }) {
  if (status === null) return <span className="ct-badge ct-badge--none">Nova</span>;
  const badge = BADGE[status];
  return <span className={`ct-badge ${badge.className}`}>{badge.label}</span>;
}

function Cover({ row }: { row: Row }) {
  return (
    <span className="ct-song-row__cover" aria-hidden="true">
      {row.thumbnailVideoId ? (
        <Image src={youtubeThumbnailUrl(row.thumbnailVideoId, "default")} alt="" width={48} height={48} unoptimized />
      ) : (
        row.title.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}

function RowBody({ row, creating }: { row: Row; creating: boolean }) {
  return (
    <>
      <Cover row={row} />
      <span className="min-w-0">
        <span className="ct-song-row__title block truncate">{row.title}</span>
        <span className="ct-song-row__artist block truncate">
          {row.artist}
          {row.album ? ` · ${row.album}` : ""}
        </span>
      </span>
      <span className="ct-song-row__meta">
        {row.durationMs !== null ? <span className="ct-numeric">{formatDuration(row.durationMs)}</span> : null}
        {creating ? <span className="ct-badge ct-badge--processing">Abrindo</span> : <StatusBadge status={row.referenceStatus} />}
      </span>
    </>
  );
}

/**
 * Busca com debounce em dois modos (sdd-015): "Pela letra" (LRCLIB, padrão; escolher cadastra
 * e abre a preparação, que sugere o vídeo) e "Pelo vídeo" (YouTube Music, sdd-011; escolher
 * cadastra e já começa a preparar melodia e letra). Sem resultado pela letra, a tela oferece
 * procurar pelo vídeo com o mesmo texto.
 */
export function SongSearch() {
  const router = useRouter();
  const ids = { input: useId(), results: useId() };
  const [mode, setMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [creating, setCreating] = useState<string | null>(null);
  const [createError, setCreateError] = useState<ErrorCopy | null>(null);
  const requestId = useRef(0);

  const pendingState = (value: string): SearchState => (value.trim().length < MIN_QUERY ? { kind: "idle" } : { kind: "loading" });

  const changeQuery = (value: string) => {
    setQuery(value);
    setState(pendingState(value));
  };

  const changeMode = (next: SearchMode) => {
    if (next === mode) return;
    setMode(next);
    setCreateError(null);
    setState(pendingState(query));
  };

  // Debounce: a busca só sai depois de DEBOUNCE_MS sem digitar; respostas atrasadas (de outro
  // texto ou do outro modo) são ignoradas.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;

    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchRows(mode, q);
        if (requestId.current === id) setState({ kind: "done", rows });
      } catch (error) {
        if (requestId.current === id) setState({ kind: "error", copy: searchErrorCopy(mode, errorCode(error)) });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, mode]);

  const choose = async (row: Row) => {
    if (creating !== null) return;
    setCreateError(null);
    setCreating(row.key);
    try {
      const song = await row.create();
      router.push(`/songs/${song.id}`);
    } catch (error) {
      setCreating(null);
      setCreateError(searchErrorCopy(mode, errorCode(error)));
    }
  };

  const fallback =
    state.kind === "done"
      ? videoFallback(mode, state.rows.length === 0 ? "empty" : "results")
      : state.kind === "error" || createError !== null
        ? videoFallback(mode, "error")
        : null;

  const videoButton = (className: string) => (
    <button type="button" className={`ct-btn ${className} justify-self-start`} onClick={() => changeMode("video")}>
      Procurar pelo vídeo
    </button>
  );

  return (
    <div className="grid gap-5">
      <div className="ct-tabs justify-self-start" role="tablist" aria-label="Como buscar">
        {MODES.map((value) => (
          <button
            key={value}
            type="button"
            className="ct-tab"
            role="tab"
            aria-selected={mode === value}
            aria-controls={ids.results}
            onClick={() => changeMode(value)}
          >
            {SEARCH_MODES[value].tab}
          </button>
        ))}
      </div>

      <div className="ct-field">
        <label className="ct-field__label" htmlFor={ids.input}>
          Buscar música
        </label>
        <div className="ct-search">
          <SearchIcon className="ct-search__icon" />
          <input
            id={ids.input}
            className="ct-input"
            type="search"
            placeholder="Artista ou título"
            autoComplete="off"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </div>
        <span className="ct-field__hint">{SEARCH_MODES[mode].hint}</span>
      </div>

      <div id={ids.results} role="tabpanel" className="grid gap-5">
        {createError ? <Alert tone={createError.tone} title={createError.title} body={createError.body} /> : null}

        {state.kind === "error" ? <Alert tone={state.copy.tone} title={state.copy.title} body={state.copy.body} /> : null}

        {state.kind === "loading" ? (
          <p className="ct-label" aria-live="polite">
            Buscando…
          </p>
        ) : null}

        {state.kind === "done" && state.rows.length === 0 ? (
          <p className="text-fg-2" aria-live="polite">
            {mode === "lyrics"
              ? "Nada com letra sincronizada. Tente outro nome, só o artista, ou procure pelo vídeo."
              : "Nada encontrado. Tente outro nome ou só o artista."}
          </p>
        ) : null}

        {fallback === "prominent" ? videoButton("ct-btn--secondary") : null}

        {state.kind === "done" && state.rows.length > 0 ? (
          <ul className="grid list-none gap-3 p-0" aria-label="Resultados">
            {state.rows.map((row) => (
              <li key={row.key}>
                {row.songId ? (
                  <Link href={`/songs/${row.songId}`} className="ct-song-row">
                    <RowBody row={row} creating={false} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="ct-song-row w-full text-left"
                    disabled={creating !== null}
                    aria-busy={creating === row.key}
                    onClick={() => choose(row)}
                  >
                    <RowBody row={row} creating={creating === row.key} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {fallback === "subtle" ? (
          <p className="grid gap-2 text-fg-2">
            Não achou a versão certa?
            {videoButton("ct-btn--ghost ct-btn--sm")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
