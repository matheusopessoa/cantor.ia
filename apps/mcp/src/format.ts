import type { AppliedSong, ReviewApiError, ReviewCheck, ReviewSongDetail, ReviewSongSummary } from "./api-client.js";

/** Texto das respostas das ferramentas, para o Claude ler. Funções puras. */

export function formatMs(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

export function formatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)} %`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

const SOURCE_LABEL: Record<string, string> = {
  whisper: "transcrição automática (whisper) — prioridade de revisão",
  ytmusic: "YouTube Music",
  lrclib: "LRCLIB",
};

function sourceLabel(source: string | null): string {
  if (source === null) return "LRCLIB (música antiga)";
  return SOURCE_LABEL[source] ?? source;
}

function lineText(text: string): string {
  return text.trim() === "" ? "(instrumental)" : text;
}

export function formatSongList(songs: ReviewSongSummary[]): string {
  if (songs.length === 0) return "Nenhuma música pronta para revisar (só músicas com a referência READY entram na lista).";

  const rows = songs.map((song) => {
    const parts = [
      `${song.artist} — ${song.title}`,
      `id: ${song.id}`,
      `letra: ${sourceLabel(song.lyricsSource)}`,
      `${song.lines} versos`,
      `encaixe no áudio: ${formatPercent(song.matchedRatio)}`,
      song.reviewedAt ? `revisada em ${formatDate(song.reviewedAt)}` : "ainda não revisada",
    ];
    return `- ${parts.join(" · ")}`;
  });

  return [
    `${songs.length} música(s) para revisar, da mais urgente para a menos (letra transcrita da voz primeiro, depois menor encaixe):`,
    ...rows,
    "",
    "Use get_song_lyrics com o id para ler a letra, a transcrição e as letras dos sites.",
  ].join("\n");
}

export function formatSongDetail(song: ReviewSongDetail): string {
  const out: string[] = [
    `${song.artist} — ${song.title}`,
    `id: ${song.id} · vídeo: ${song.youtubeVideoId ?? "nenhum (referência por arquivo: não dá para conferir no áudio)"} · versão da letra: ${song.lyricsRevision}`,
    `origem da letra: ${sourceLabel(song.selection?.source ?? null)}${song.selection?.wer !== null && song.selection?.wer !== undefined ? ` (WER ${formatPercent(song.selection.wer)} contra a voz)` : ""}${song.selection?.reviewedAt ? ` · revisada em ${formatDate(song.selection.reviewedAt)}` : ""}`,
    "",
    `Letra em uso (${song.lines.length} versos; índice · entrada · texto):`,
    ...song.lines.map((line) => `  ${String(line.index).padStart(3)}  [${formatMs(line.startMs)}]  ${lineText(line.text)}`),
  ];

  if (song.transcriptLines === null) {
    out.push("", "Sem transcrição da voz guardada (música antiga ou preparada antes desta versão): revise só com base na letra em uso; se precisar da transcrição, refaça a referência da música.");
  } else if (song.transcriptLines.length === 0) {
    out.push("", "Transcrição da voz: vazia (o Whisper não ouviu nada aproveitável).");
  } else {
    out.push(
      "",
      `O que o Whisper ouviu na gravação (${song.transcriptLines.length} trechos; pode ter erros de palavra):`,
      ...song.transcriptLines.map((line) => `  [${formatMs(line.startMs)}]  ${line.text}`),
    );
  }

  if (song.candidates !== null) {
    if (song.candidates.length === 0) {
      out.push("", "Letras dos sites: nenhuma foi encontrada para esta música.");
    } else {
      for (const candidate of song.candidates) {
        out.push("", `Letra do site ${sourceLabel(candidate.source)} (${candidate.lines.length} versos; foi recusada ou é a própria letra em uso):`, ...candidate.lines.map((text) => `  ${lineText(text)}`));
      }
    }
  }

  out.push(
    "",
    "Para corrigir: monte a lista COMPLETA de versos (um item por verso, na ordem; verso instrumental = texto vazio) e chame check_lyrics_fix.",
    "Corrija só o que a transcrição, as letras dos sites e o contexto sustentam; não escreva a letra de memória.",
  );
  return out.join("\n");
}

const CHANGE_MARK: Record<string, string> = { same: " ", edited: "~", added: "+" };

export function formatCheck(check: ReviewCheck): string {
  const { summary } = check;
  const out: string[] = [
    `Conferência no áudio: ${summary.edited} editado(s), ${summary.added} novo(s), ${summary.removed} removido(s) · score médio ${formatScore(summary.meanScoreBefore)} → ${formatScore(summary.meanScoreAfter)} (0..1: quanto o verso bate com a voz; abaixo de 0.40 a API não confia no encaixe).`,
    "",
    "Versos propostos (marca · índice · entrada · score · texto; ~ editado, + novo):",
  ];

  for (const line of check.lines) {
    out.push(`  ${CHANGE_MARK[line.change] ?? " "} ${String(line.index).padStart(3)}  [${formatMs(line.startMs)}]  ${formatScore(line.score)}  ${lineText(line.text)}`);
    if (line.change === "edited" && line.before) {
      out.push(`        antes: ${formatScore(line.before.score)}  ${lineText(line.before.text)}`);
    }
  }

  if (check.removed.length > 0) {
    out.push("", "Versos removidos (score que tinham):", ...check.removed.map((line) => `  - ${formatScore(line.score)}  ${lineText(line.text)}`));
  }

  out.push(
    "",
    `checkId: ${check.checkId} (vale até ${formatDate(check.expiresAt)}).`,
    "Nada foi gravado. Mostre este antes/depois ao usuário e só chame apply_lyrics_fix depois que ele aprovar. Um verso editado cujo score caiu merece uma segunda olhada.",
  );
  return out.join("\n");
}

export function formatApplied(song: AppliedSong): string {
  const alignment = song.lyricsAlignment;
  const alignmentText =
    alignment === null
      ? "sem alinhamento"
      : alignment.aligned
        ? `alinhada ao áudio (${formatPercent(alignment.matchedRatio)} dos versos encaixados)`
        : `alinhamento recusado (${formatPercent(alignment.matchedRatio)} encaixados): a tela usa os tempos de dica`;
  return [
    `Letra gravada: ${song.artist} — ${song.title} (${song.lyrics.length} versos, ${alignmentText}).`,
    song.lyricsSelection?.reviewedAt ? `Marcada como revisada em ${formatDate(song.lyricsSelection.reviewedAt)}; a origem continua ${sourceLabel(song.lyricsSelection.source)}.` : "",
    "As próximas cantorias já usam a letra nova; notas e ranking já gravados não mudam.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const ERROR_HINT: Record<string, string> = {
  UNAUTHORIZED: "O LYRICS_REVIEW_SECRET do .env da raiz não é o mesmo que a API está usando (reinicie a API depois de mudar o .env).",
  REVIEW_DISABLED: "A API está sem LYRICS_REVIEW_SECRET: adicione ao .env da raiz (≥ 32 caracteres) e reinicie a API.",
  REVIEW_CHECK_EXPIRED: "A conferência expirou (30 min) ou a API reiniciou: chame check_lyrics_fix de novo.",
  LYRICS_CHANGED: "A letra mudou desde a conferência (refazer ou outra revisão): leia de novo com get_song_lyrics e confira de novo.",
  REVIEW_NEEDS_VIDEO: "A referência veio de um arquivo enviado e o áudio não é guardado: não dá para conferir a proposta.",
  REFERENCE_NOT_READY: "A música não está com a referência pronta (READY).",
  ALIGN_FAILED: "O worker não conseguiu alinhar (fora do ar, download do YouTube falhou ou passou do tempo). Veja se o worker está de pé e tente de novo.",
  UNREACHABLE: "A API não está de pé em NEXT_PUBLIC_API_URL. Suba com `pnpm dev` e tente de novo.",
  TIMEOUT: "A API demorou demais. A conferência pode levar até 3 min; tente de novo.",
};

export function formatError(error: ReviewApiError): string {
  const where = error.status === 0 ? "Falha de rede" : `A API respondeu ${error.status}`;
  const code = error.code ? ` ${error.code}` : "";
  const hint = error.code ? ERROR_HINT[error.code] : undefined;
  return [`${where}${code}: ${error.message}`, hint].filter((part): part is string => part !== undefined).join("\n");
}
