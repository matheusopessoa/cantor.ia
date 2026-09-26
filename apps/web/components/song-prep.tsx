"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, type AlertTone } from "./alert";
import { DifficultyTabs } from "./difficulty-tabs";
import { FileDropzone } from "./file-dropzone";
import { LinkIcon, UploadIcon } from "./icons";
import { PlayerNameField } from "./player-name-field";
import { RankingList } from "./ranking-list";
import { YoutubeCandidates, useYoutubeSuggestion } from "./youtube-candidates";
import { ApiError, api } from "@/lib/api";
import { DEFAULT_DIFFICULTY } from "@/lib/difficulty";
import { formatDuration, formatElapsed } from "@/lib/format";
import { lyricsSourceNotice } from "@/lib/lyrics-source";
import { isValidPlayerName } from "@/lib/player-name";
import { API_UNAVAILABLE_COPY, referenceErrorCopy, type ErrorCopy } from "@/lib/reference-errors";
import { isProcessingStale } from "@/lib/reference-status";
import type { Difficulty, LyricsAlignment, RankingItem, ReferenceStatus, SongDto } from "@/lib/types";
import { useDifficulty, usePlayerName } from "@/lib/use-prefs";
import { youtubeSearchUrl, youtubeShortUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "@/lib/youtube";

/** Intervalo do polling enquanto a referência está em `PROCESSING`. */
const POLL_MS = 3000;

type SourceTab = "youtube" | "file";

const BADGE: Record<ReferenceStatus, { className: string; label: string }> = {
  READY: { className: "ct-badge--ready", label: "Pronta" },
  PROCESSING: { className: "ct-badge--processing", label: "Preparando" },
  FAILED: { className: "ct-badge--failed", label: "Falhou" },
  NONE: { className: "ct-badge--none", label: "Sem referência" },
};

/** `PROCESSING` parado há mais de 15 min (achado da sdd-011): a API já aceita um novo pedido. */
const STALE_COPY: ErrorCopy = {
  tone: "warning",
  title: "A preparação parece ter travado",
  body: "Está assim há mais de 15 minutos. Tente de novo; leva uns 2 a 3 minutos.",
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

/**
 * Resultado do alinhamento automático da letra ao áudio: pelo texto cantado (`forced`,
 * sdd-010) ou pelas pausas da voz (`onset`, sdd-007; também nas músicas alinhadas antes da
 * sdd-010, que não têm `method`).
 */
function alignmentCopy(alignment: LyricsAlignment): AlignmentCopy {
  if (!alignment.aligned) return NOT_ALIGNED_COPY;
  const how =
    alignment.method === "forced"
      ? "Cada verso foi encaixado onde ele é cantado de verdade."
      : "A letra foi encaixada nas entradas da voz. Se quiser o alinhamento verso a verso, refaça a melodia e a letra.";
  return {
    tone: "success",
    // Sem o `shiftMs`: ele já está embutido na letra e confundia com o ajuste fino da tela de
    // cantar (que começa em 0 por cima da letra alinhada).
    title: "Letra alinhada ao áudio",
    body: `${how} Se ainda aparecer fora do tempo, use o ajuste fino na tela de cantar.`,
  };
}

interface SongPrepProps {
  song: SongDto;
  /** Ranking do nível padrão (`DEFAULT_DIFFICULTY`), buscado no servidor. */
  ranking: RankingItem[];
}

/**
 * Preparação da música: referência, nível, nome do jogador, ranking do nível e "Cantar".
 * Música nova (sdd-011, `sourceVideoId`): o vídeo já veio da busca e a preparação começa
 * sozinha; em falha, "Tentar de novo" ou arquivo. Música antiga: vídeo sugerido, link do
 * YouTube ou arquivo; a sugestão (sdd-008) nunca processa sozinha, sempre espera o clique.
 */
export function SongPrep({ song: initialSong, ranking }: SongPrepProps) {
  const router = useRouter();
  const ids = { youtubeTab: useId(), fileTab: useId(), link: useId() };
  const [song, setSong] = useState<SongDto>(initialSong);
  const [tab, setTab] = useState<SourceTab>("youtube");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const { name, setName, commit: commitName } = usePlayerName();
  const [difficulty, setDifficulty] = useDifficulty();
  // Rankings são por nível (sdd-009): o do padrão vem do servidor; os outros são buscados na
  // primeira vez que a aba é escolhida.
  const [rankings, setRankings] = useState<Partial<Record<Difficulty, RankingItem[]>>>({
    [DEFAULT_DIFFICULTY]: ranking,
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  // Hora do relógio de espera: nulo até o primeiro tique (nada de `Date.now()` no render).
  const [now, setNow] = useState<number | null>(null);
  const processingSinceRef = useRef<number | null>(null);

  const status = song.referenceStatus;
  // Música nova (sdd-011): o vídeo já foi escolhido na busca e a letra vem sozinha.
  const sourceVideoId = song.sourceVideoId;
  // "Refazer melodia e letra" (sdd-010) numa música pronta: por YouTube reenvia o mesmo vídeo
  // na hora; por arquivo abre as abas de fonte de novo. Tudo o que sai daqui vai com `redo`.
  const [redoOpen, setRedoOpen] = useState(false);
  const redo = status === "READY";
  // `PROCESSING` travado (API caiu sem reiniciar, worker preso): a API aceita um novo pedido
  // depois de 15 min. Música antiga reabre as abas de fonte pelo mesmo `redoOpen`.
  const stale = status === "PROCESSING" && now !== null && isProcessingStale(song.referenceUpdatedAt, now);
  const choosingSource =
    status === "NONE" || status === "FAILED" || (status === "READY" && redoOpen) || (stale && sourceVideoId === null && redoOpen);

  // Candidatos do YouTube (sdd-008), buscados sem bloquear a página. Em `high`/`medium` o
  // melhor vem em destaque e o campo manual vai para baixo; em `low` o campo manual vem
  // primeiro e os candidatos viram "Talvez seja um destes" (regra 5).
  const suggestion = useYoutubeSuggestion(song.id, choosingSource && sourceVideoId === null);
  const found = suggestion.kind === "done" && suggestion.suggestion.candidates.length > 0 ? suggestion.suggestion : null;
  const featured = found !== null && (found.confidence === "high" || found.confidence === "medium");

  useEffect(() => {
    if (rankings[difficulty]) return;
    let alive = true;
    api
      .getRanking(song.id, 10, difficulty)
      .then((items) => {
        if (alive) setRankings((prev) => ({ ...prev, [difficulty]: items }));
      })
      .catch(() => {
        // API fora do ar: o ranking desse nível fica vazio até a próxima visita
      });
    return () => {
      alive = false;
    };
  }, [difficulty, rankings, song.id]);

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
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setElapsedMs(tick - since);
      setNow(tick);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const startProcessing = (next: SongDto) => {
    processingSinceRef.current = Date.now();
    setElapsedMs(0);
    setRedoOpen(false);
    // Nova referência, novo alinhamento: o anterior não vale mais (a API também zera). O
    // `referenceUpdatedAt` recomeça agora, senão um retry de um travado continuaria "travado"
    // até o próximo polling.
    setSong({ ...next, alignedLyrics: null, lyricsAlignment: null, referenceUpdatedAt: new Date().toISOString() });
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

  /** Link colado ou candidato escolhido: os dois chamam a mesma rota de referência por YouTube. */
  const submitLink = async (link: string) => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.setReferenceFromYoutube(song.id, link, { redo });
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
      const started = await api.uploadReference(song.id, file, { redo });
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

  const submitTypedLink = () => {
    const link = url.trim();
    if (link.length === 0) {
      setError(EMPTY_LINK_COPY);
      return;
    }
    void submitLink(link);
  };

  const chooseCandidate = (videoId: string) => {
    void submitLink(youtubeWatchUrl(videoId));
  };

  /** Música pronta: refaz melodia e letra com o mesmo vídeo, ou pede o arquivo de novo. */
  const redoReference = () => {
    if (song.youtubeVideoId) {
      void submitLink(youtubeWatchUrl(song.youtubeVideoId));
    } else {
      setTab("file");
      setRedoOpen(true);
    }
  };

  /** Travado: música nova refaz com o vídeo da busca; antiga reabre as abas de fonte. */
  const retryStale = () => {
    if (sourceVideoId !== null) {
      void submitLink(youtubeWatchUrl(sourceVideoId));
    } else {
      setTab("youtube");
      setRedoOpen(true);
    }
  };

  const badge = BADGE[status];
  const failedCopy =
    status === "FAILED"
      ? referenceErrorCopy(song.referenceError ?? "INTERNAL", { songMs: song.durationMs, audioMs: song.referenceAudioMs })
      : null;
  const searchFailedCopy =
    suggestion.kind === "error" ? referenceErrorCopy("SEARCH_FAILED", { songMs: song.durationMs, audioMs: null }) : null;
  const alignment = status === "READY" && song.lyricsAlignment ? alignmentCopy(song.lyricsAlignment) : null;
  const lyricsNotice = status === "READY" ? lyricsSourceNotice(song.lyricsSelection) : null;

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

      {choosingSource && sourceVideoId !== null ? (
        <section className="grid gap-5" aria-label="Preparar de novo">
          {failedCopy ? <Alert tone={failedCopy.tone} title={failedCopy.title} body={failedCopy.body} /> : null}
          <p className="text-fg-2">
            {redo
              ? "Envie o arquivo de novo (ou use o vídeo da busca) para refazer a melodia e a letra. A referência atual continua valendo até a nova ficar pronta."
              : "Tente de novo com o vídeo que você escolheu na busca, ou envie o arquivo de áudio da música."}
          </p>
          <button
            type="button"
            // No refazer o "Cantar" continua na tela e é a ação principal (um rosa por tela).
            className={`ct-btn ${redo ? "ct-btn--secondary" : "ct-btn--primary"} justify-self-start`}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void submitLink(youtubeWatchUrl(sourceVideoId))}
          >
            {busy ? "Enviando…" : redo ? "Refazer com o vídeo da busca" : "Tentar de novo"}
          </button>
          <FileDropzone
            title="Solte o arquivo de áudio aqui"
            description="Ou clique para escolher. MP3, M4A, WAV, OGG ou FLAC de até 20 MB. Usamos só para aprender a melodia e a letra e apagamos depois."
            busy={busy}
            onFile={(file) => void uploadFile(file)}
          />
        </section>
      ) : null}

      {choosingSource && sourceVideoId === null ? (
        <div className="grid gap-5">
          {failedCopy ? <Alert tone={failedCopy.tone} title={failedCopy.title} body={failedCopy.body} /> : null}
          <p className="text-fg-2">
            {redo
              ? "Envie o arquivo de novo (ou escolha um vídeo) para refazer a melodia e o alinhamento da letra. A referência atual continua valendo até a nova ficar pronta."
              : `Para dar nota, a gente precisa aprender a melodia uma vez. ${featured ? "Confira o vídeo que achamos ou escolha outro." : "Cole o link do YouTube ou envie o arquivo de áudio."}`}
          </p>

          {suggestion.kind === "loading" ? (
            <p className="ct-label" aria-live="polite">
              Procurando o áudio oficial…
            </p>
          ) : null}
          {searchFailedCopy ? <Alert tone={searchFailedCopy.tone} title={searchFailedCopy.title} body={searchFailedCopy.body} /> : null}

          {found && featured ? <YoutubeCandidates suggestion={found} featured busy={busy} onChoose={chooseCandidate} /> : null}

          <section className="ct-panel grid gap-5" aria-label={featured ? "Outro vídeo ou arquivo" : "Fonte do áudio"}>
            {featured ? <span className="ct-label">Outro vídeo ou arquivo</span> : null}
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
                  submitTypedLink();
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
                  <button
                    type="submit"
                    className={`ct-btn ${featured ? "ct-btn--secondary" : "ct-btn--primary"}`}
                    disabled={busy}
                    aria-busy={busy}
                  >
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

          {found && !featured ? <YoutubeCandidates suggestion={found} featured={false} busy={busy} onChoose={chooseCandidate} /> : null}
        </div>
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
            <span className="ct-loading__title">{sourceVideoId !== null ? "Aprendendo a melodia e a letra" : "Aprendendo a melodia"}</span>
            <div className="ct-loading__bar" role="progressbar" aria-label="Preparando a música" />
            <span className="ct-loading__elapsed">{formatElapsed(elapsedMs)}</span>
            <p className="ct-loading__hint">Leva uns 2 a 3 minutos e só acontece uma vez por música. Pode escolher seu nome enquanto isso.</p>
            {stale ? (
              <div className="grid gap-3">
                <Alert tone={STALE_COPY.tone} title={STALE_COPY.title} body={STALE_COPY.body} />
                {redoOpen ? null : (
                  <button
                    type="button"
                    className="ct-btn ct-btn--primary justify-self-start"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={retryStale}
                  >
                    {busy ? "Enviando…" : "Tentar de novo"}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {status === "PROCESSING" || status === "READY" ? (
        <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="Jogador e ranking">
          <div className="ct-panel grid content-start gap-5">
            {lyricsNotice ? <Alert tone={lyricsNotice.tone} title={lyricsNotice.title} body={lyricsNotice.body} /> : null}
            {alignment ? <Alert tone={alignment.tone} title={alignment.title} body={alignment.body} /> : null}
            <DifficultyTabs value={difficulty} onChange={setDifficulty} />
            <PlayerNameField value={name} onChange={setName} />
            {status === "READY" ? (
              <>
                <button
                  type="button"
                  className="ct-btn ct-btn--primary ct-btn--start ct-btn--block"
                  disabled={!isValidPlayerName(name)}
                  onClick={sing}
                >
                  Cantar
                </button>
                <div className="grid gap-1">
                  <button
                    type="button"
                    className="ct-btn ct-btn--ghost ct-btn--sm justify-self-start"
                    disabled={busy || redoOpen}
                    aria-busy={busy}
                    onClick={redoReference}
                  >
                    {busy ? "Enviando…" : "Refazer melodia e letra"}
                  </button>
                  <span className="ct-field__hint">
                    {sourceVideoId !== null
                      ? "Aprende a melodia de novo, busca a letra de novo nos sites e realinha verso a verso. Leva uns 2 a 3 minutos."
                      : song.youtubeVideoId
                        ? "Aprende a melodia de novo com o mesmo vídeo e realinha a letra verso a verso. Leva uns 2 a 3 minutos."
                        : "Pede o arquivo de áudio de novo e realinha a letra verso a verso."}
                  </span>
                </div>
              </>
            ) : (
              <p className="ct-field__hint">O botão de cantar aparece quando a melodia ficar pronta.</p>
            )}
          </div>
          <RankingList items={rankings[difficulty] ?? []} difficulty={difficulty} />
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
