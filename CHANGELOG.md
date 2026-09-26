# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Cada app tem a
própria versão (`apps/api`, `apps/web`, `apps/worker`).

## api 1.2.0 — 2026-09-25

Plano: [`specs/sdd-007-lyrics-alignment/tasks.md`](specs/sdd-007-lyrics-alignment/tasks.md).

### Adicionado
- Alinhamento automático da letra ao áudio da referência (`services/alignment.service.ts`,
  função pura): ao ficar `READY`, a API acha os inícios de frase na curva de pitch, procura
  um deslocamento global em ±12 s e encaixa cada linha no início de frase mais próximo (até
  350 ms). Nunca muda a velocidade da letra. Menos da metade das linhas encaixadas → não
  alinha e tudo segue como antes.
- Campos `Song.alignedLyrics` e `Song.lyricsAlignment` (migration
  `20260926022604_add_lyrics_alignment`), zerados a cada novo processamento e em `FAILED`.
- `SongDto` ganha `alignedLyrics` (`LyricLine[] | null`) e `lyricsAlignment`
  (`{ aligned, shiftMs, matchedRatio } | null`). Mudança aditiva; `GET /:id/reference` e a
  busca não mudam.
- Backfill preguiçoso: música `READY` anterior a esta versão é alinhada e gravada na primeira
  chamada a `GET /api/songs/:id`.
- `voicedSegments` em `utils/pitch.ts` e `lyricsAlignmentSchema` em `utils/validators.ts`.

### Alterado
- A nota (`POST /:id/performances`) avalia `alignedLyrics ?? lyrics`; o `offsetMs` do jogador
  vira ajuste fino sobre a letra alinhada. `lines[].startMs` do resultado passa a ser o da
  linha avaliada (a alinhada, quando existe).

## web 0.3.0 — 2026-09-25

Plano: [`specs/sdd-007-lyrics-alignment/tasks.md`](specs/sdd-007-lyrics-alignment/tasks.md).

### Adicionado
- Karaokê, canvas e nota usam a letra alinhada pela API quando ela existe
  (`effectiveLyrics` em `lib/lyrics.ts`); `lib/types.ts` espelha `alignedLyrics` e
  `lyricsAlignment`.
- Tela de preparação mostra "Letra alinhada ao áudio (+3,2 s)" ou o aviso "Não conseguimos
  alinhar a letra" quando a referência fica pronta.

### Alterado
- O slider de offset passa a ser "Ajuste fino da letra", aplicado sobre a letra já alinhada.

## web 0.2.0 — 2026-09-25

Plano: [`specs/sdd-004-web-karaoke/tasks.md`](specs/sdd-004-web-karaoke/tasks.md).

### Adicionado
- Telas do MVP: busca de músicas (`/`), preparação (`/songs/[id]`: referência por link do
  YouTube ou upload, polling a cada 3 s, nome do jogador, ranking) e karaokê
  (`/songs/[id]/sing`: música no fone, letra sincronizada, curvas de pitch ao vivo, ajuste
  de offset, resultado com nota, conceito, subnotas e ranking).
- Cliente tipado da API (`lib/api.ts`, `lib/api.server.ts`) e espelho dos DTOs (`lib/types.ts`).
- Cache do áudio da música no IndexedDB (`lib/audio-store.ts`): baixa via `GET /audio` uma
  vez, com progresso, e toca do cache nas próximas sessões; sem YouTube, pede o arquivo.
- Captura do microfone com `AudioWorklet` (`public/worklets/capture.worklet.js`) e detecção
  de pitch com `pitchy` (`lib/recorder.ts`), gerando um `PitchTrack` de 10 ms compatível com
  a API, com compensação automática de latência.
- Vitest (`pnpm --filter web test`) para as funções puras de `lib/`.
- Páginas `error.tsx` e `not-found.tsx`.
- Ajuste manual da letra de −10 s a +10 s (passos de 100 ms). Só desloca a letra, nunca muda a
  velocidade: letra acabando antes ou depois da música é esperado, não erro.

### Alterado
- `globals.css` importa o cantor.ia Design System (`styles.css` + `tailwind-theme.css`);
  `layout.tsx` sai do boilerplate (`lang="pt-BR"`, metadata, sem `next/font`).
- `next.config.ts` libera as miniaturas `https://i.ytimg.com/vi/**` em `images.remotePatterns`.
- Design system: `styles.css` usa `@import './x.css'` (forma que o Tailwind 4 resolve) e não
  importa mais `tokens/fonts.css` (o `@import` remoto quebrava o bundle); as webfonts entram
  por `<link>` no `layout.tsx` e na vitrine.

## api 1.1.0 — 2026-09-25

Plano: [`specs/sdd-003-api-songs/tasks.md`](specs/sdd-003-api-songs/tasks.md).

### Adicionado
- Models `Song` e `Performance` e enums `ReferenceStatus`/`ReferenceErrorCode`
  (migration `20260926005842_songs_performances`).
- Rotas sob `/api/songs`: busca no LRCLIB (`GET /search`), cadastro idempotente (`POST /`),
  `GET /:id`, referência de pitch por link do YouTube (`POST /:id/reference/youtube`) ou
  upload de arquivo (`POST /:id/reference`, 20 MB), leitura da referência
  (`GET /:id/reference`), áudio para tocar em streaming (`GET /:id/audio`), envio de
  performance com nota e posição no ranking (`POST /:id/performances`) e ranking top N
  (`GET /:id/performances`). Sem login: o jogador informa só um nome.
- Camada `src/clients/` para integrações HTTP externas: `lrclib.client.ts` e
  `worker.client.ts`.
- Utilitários `parseLrc` (`utils/lrc.ts`) e `parseYoutubeVideoId` (`utils/youtube.ts`).
- Variáveis de ambiente opcionais `WORKER_URL` e `LRCLIB_BASE_URL`.
- Dependência `@fastify/multipart`.
- `offsetMs` da performance aceita de −10 000 a +10 000 (`LYRICS_OFFSET_LIMIT_MS`), o mesmo
  limite da tolerância de duração da referência.

### Alterado
- `AppError` aceita um `code` opcional; o error handler responde `{ message, code }` quando
  ele existe (as respostas de `/api/auth` continuam `{ message }`). Erros do próprio Fastify
  com status 4xx (corpo acima do limite → 413, JSON inválido → 400) passam a ser repassados
  com o status original em vez de virarem 500.
