"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, type AlertTone } from "./alert";
import { FileDropzone } from "./file-dropzone";
import { LinkIcon, UploadIcon } from "./icons";
import { PlayerNameField } from "./player-name-field";
import { RankingList } from "./ranking-list";
import { ApiError, api } from "@/lib/api";
import { formatAlignmentShift, formatDuration, formatElapsed } from "@/lib/format";
import { isValidPlayerName } from "@/lib/player-name";
import { API_UNAVAILABLE_COPY, referenceErrorCopy, type ErrorCopy } from "@/lib/reference-errors";
import type { LyricsAlignment, RankingItem, ReferenceStatus, SongDto } from "@/lib/types";
import { usePlayerName } from "@/lib/use-prefs";
import { youtubeSearchUrl, youtubeShortUrl, youtubeThumbnailUrl } from "@/lib/youtube";

/** Intervalo do polling enquanto a referência está em `PROCESSING`. */
const POLL_MS = 3000;

type SourceTab = "youtube" | "file";

const BADGE: Record<ReferenceStatus, { className: string; label: string }> = {
  READY: { className: "ct-badge--ready", label: "Pronta" },
  PROCESSING: { className: "ct-badge--processing", label: "Preparando" },
  FAILED: { className: "ct-badge--failed", label: "Falhou" },
  NONE: { className: "ct-badge--none", label: "Sem referência" },
};

const EMPTY_LINK_COPY: ErrorCopy = {
  tone: "warning",
  title: "Cole o link do vídeo",
  body: "Abra a música no YouTube, copie o endereço e cole aqui.",
};

interface AlignmentCopy {
  tone: AlertTone;
  title: string;
  body: string;
}

const NOT_ALIGNED_COPY: AlignmentCopy = {
  tone: "warning",
  title: "Não conseguimos alinhar a letra",
  body: "Se ela aparecer fora do tempo, use o ajuste fino na tela de cantar.",
};

/** Resultado do alinhamento automático da letra ao áudio (sdd-007). */
function alignmentCopy(alignment: LyricsAlignment): AlignmentCopy {
  if (!alignment.aligned) return NOT_ALIGNED_COPY;
  return {
    tone: "success",
    title: `Letra alinhada ao áudio (${formatAlignmentShift(alignment.shiftMs)})`,
    body: "A letra foi encaixada na voz da música. Se ainda aparecer fora do tempo, use o ajuste fino na tela de cantar.",
  };
}

interface SongPrepProps {
  song: SongDto;
  ranking: RankingItem[];
}

/** Preparação da música: referência (link do YouTube ou arquivo), nome do jogador, ranking e "Cantar". */
export function SongPrep({ song: initialSong, ranking }: SongPrepProps) {
  const router = useRouter();
  const ids = { youtubeTab: useId(), fileTab: useId(), link: useId() };
  const [song, setSong] = useState<SongDto>(initialSong);
  const [tab, setTab] = useState<SourceTab>("youtube");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const { name, setName, commit: commitName } = usePlayerName();
  const [elapsedMs, setElapsedMs] = useState(0);
  const processingSinceRef = useRef<number | null>(null);

  const status = song.referenceStatus;

  // Polling do status enquanto processa; para em READY/FAILED e ao desmontar.
  useEffect(() => {
    if (status !== "PROCESSING") return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await api.getSong(song.id);
        if (alive) setSong(fresh);
      } catch {
        // API fora do ar no meio do polling: tenta de novo no próximo tick
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [status, song.id]);

  // Relógio de espera (tempo decorrido; nunca porcentagem inventada). Quem dispara um novo
  // processamento zera o relógio no próprio handler.
  useEffect(() => {
    if (status !== "PROCESSING") {
      processingSinceRef.current = null;
      return;
    }
    processingSinceRef.current ??= Date.now();
    const since = processingSinceRef.current;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - since), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const startProcessing = (next: SongDto) => {
    processingSinceRef.current = Date.now();
    setElapsedMs(0);
    // Nova referência, novo alinhamento: o anterior não vale mais (a API também zera).
    setSong({ ...next, alignedLyrics: null, lyricsAlignment: null });
  };

  const failWith = async (caught: unknown) => {
    if (caught instanceof ApiError) {
      if (caught.code) {
        setError(referenceErrorCopy(caught.code, { songMs: song.durationMs, audioMs: song.referenceAudioMs }));
        return;
      }
      if (caught.status === 409) {
        // Outra aba já começou (ou terminou): sincroniza com o servidor.
        try {
          setSong(await api.getSong(song.id));
          return;
        } catch {
          // cai no aviso genérico
        }
      }
      if (caught.status === 413) {
        setError(referenceErrorCopy("INVALID_AUDIO", { songMs: song.durationMs, audioMs: null }));
        return;
      }
    }
    setError(API_UNAVAILABLE_COPY);
  };

  const submitVideo = async () => {
    const link = url.trim();
    if (link.length === 0) {
      setError(EMPTY_LINK_COPY);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await api.setReferenceFromYoutube(song.id, link);
      startProcessing({ ...song, referenceStatus: started.status, youtubeVideoId: started.youtubeVideoId, referenceError: null });
    } catch (caught) {
      await failWith(caught);
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.uploadReference(song.id, file);
      startProcessing({ ...song, referenceStatus: started.status, youtubeVideoId: null, referenceError: null });
    } catch (caught) {
      await failWith(caught);
    } finally {
      setBusy(false);
    }
  };

  const sing = () => {
    if (!isValidPlayerName(name)) return;
    commitName(name);
    router.push(`/songs/${song.id}/sing`);
  };

  const badge = BADGE[status];
  const failedCopy =
    status === "FAILED"
      ? referenceErrorCopy(song.referenceError ?? "INTERNAL", { songMs: song.durationMs, audioMs: song.referenceAudioMs })
      : null;
  const alignment = status === "READY" && song.lyricsAlignment ? alignmentCopy(song.lyricsAlignment) : null;

  return (
    <div className="mx-auto grid w-full max-w-[var(--content-max)] gap-8 px-4 py-8">
      <header className="grid gap-2">
        <span className="ct-label">Preparar a música</span>
        <h1>{song.title}</h1>
        <p className="text-fg-2">
          {song.artist}
          {song.album ? ` · ${song.album}` : ""} · <span className="ct-numeric">{formatDuration(song.durationMs)}</span>
        </p>
        <span className={`ct-badge ${badge.className} justify-self-start`}>{badge.label}</span>
      </header>

      {error ? <Alert tone={error.tone} title={error.title} body={error.body} /> : null}

      {status === "NONE" || status === "FAILED" ? (
        <section className="ct-panel grid gap-5" aria-label="Fonte do áudio">
          {failedCopy ? <Alert tone={failedCopy.tone} title={failedCopy.title} body={failedCopy.body} /> : null}
          <p className="text-fg-2">
            Para dar nota, a gente precisa aprender a melodia uma vez. Cole o link do YouTube ou envie o arquivo de áudio.
          </p>
          <div className="ct-tabs justify-self-start" role="tablist" aria-label="Fonte do áudio">
            <button
              type="button"
              className="ct-tab"
              role="tab"
              id={ids.youtubeTab}
              aria-selected={tab === "youtube"}
              aria-controls={`${ids.youtubeTab}-panel`}
              onClick={() => setTab("youtube")}
            >
              <LinkIcon />
              Link do YouTube
            </button>
            <button
              type="button"
              className="ct-tab"
              role="tab"
              id={ids.fileTab}
              aria-selected={tab === "file"}
              aria-controls={`${ids.fileTab}-panel`}
              onClick={() => setTab("file")}
            >
              <UploadIcon />
              Enviar arquivo
            </button>
          </div>

          {tab === "youtube" ? (
            <form
              id={`${ids.youtubeTab}-panel`}
              role="tabpanel"
              aria-labelledby={ids.youtubeTab}
              className="ct-field"
              onSubmit={(event) => {
                event.preventDefault();
                void submitVideo();
              }}
            >
              <label className="ct-field__label" htmlFor={ids.link}>
                Link do vídeo
              </label>
              <div className="ct-input-group">
                <input
                  id={ids.link}
                  className="ct-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://youtu.be/..."
                  autoComplete="off"
                  value={url}
                  disabled={busy}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <button type="submit" className="ct-btn ct-btn--primary" disabled={busy} aria-busy={busy}>
                  {busy ? "Enviando…" : "Usar vídeo"}
                </button>
              </div>
              <span className="ct-field__hint">
                Prefira vídeos &quot;official audio&quot; ou &quot;lyric video&quot;: clipes costumam ter introdução diferente.{" "}
                <a href={youtubeSearchUrl(song.artist, song.title)} target="_blank" rel="noopener noreferrer">
                  Procurar no YouTube
                </a>
              </span>
            </form>
          ) : (
            <div id={`${ids.fileTab}-panel`} role="tabpanel" aria-labelledby={ids.fileTab}>
              <FileDropzone
                title="Solte o arquivo de áudio aqui"
                description="Ou clique para escolher. MP3, M4A, WAV, OGG ou FLAC de até 20 MB. Usamos só para aprender a melodia e apagamos depois."
                busy={busy}
                onFile={(file) => void uploadFile(file)}
              />
            </div>
          )}
        </section>
      ) : null}

      {status === "PROCESSING" ? (
        <section className="grid items-center gap-6 md:grid-cols-2" aria-label="Preparando a música">
          {song.youtubeVideoId ? (
            <figure className="ct-tv">
              <div className="ct-tv__screen ct-crt">
                <Image
                  src={youtubeThumbnailUrl(song.youtubeVideoId, "hq")}
                  alt={`Miniatura do vídeo escolhido para ${song.title}`}
                  width={480}
                  height={360}
                  unoptimized
                />
              </div>
              <figcaption className="ct-tv__caption">
                <span>{youtubeShortUrl(song.youtubeVideoId)}</span>
              </figcaption>
            </figure>
          ) : (
            <div className="ct-panel ct-panel--sunken grid place-items-center gap-3 py-10 text-center text-fg-2">
              <UploadIcon className="size-10 text-neon-purple" />
              <span>Arquivo enviado. Ele é apagado assim que a melodia fica pronta.</span>
            </div>
          )}
          <div className="ct-loading" aria-live="polite">
            <span className="ct-badge ct-badge--processing">Preparando</span>
            <span className="ct-loading__title">Aprendendo a melodia</span>
            <div className="ct-loading__bar" role="progressbar" aria-label="Preparando a música" />
            <span className="ct-loading__elapsed">{formatElapsed(elapsedMs)}</span>
            <p className="ct-loading__hint">Leva uns 2 a 3 minutos e só acontece uma vez por música. Pode escolher seu nome enquanto isso.</p>
          </div>
        </section>
      ) : null}

      {status === "PROCESSING" || status === "READY" ? (
        <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="Jogador e ranking">
          <div className="ct-panel grid content-start gap-5">
            {alignment ? <Alert tone={alignment.tone} title={alignment.title} body={alignment.body} /> : null}
            <PlayerNameField value={name} onChange={setName} />
            {status === "READY" ? (
              <button
                type="button"
                className="ct-btn ct-btn--primary ct-btn--start ct-btn--block"
                disabled={!isValidPlayerName(name)}
                onClick={sing}
              >
                Cantar
              </button>
            ) : (
              <p className="ct-field__hint">O botão de cantar aparece quando a melodia ficar pronta.</p>
            )}
          </div>
          <RankingList items={ranking} />
        </section>
      ) : null}

      <p>
        <Link href="/" className="ct-btn ct-btn--ghost ct-btn--sm">
          Outra música
        </Link>
      </p>
    </div>
  );
}
