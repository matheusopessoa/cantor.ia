# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Cada app tem a
própria versão (`apps/api`, `apps/web`, `apps/worker`).

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

### Alterado
- `AppError` aceita um `code` opcional; o error handler responde `{ message, code }` quando
  ele existe (as respostas de `/api/auth` continuam `{ message }`). Erros do próprio Fastify
  com status 4xx (corpo acima do limite → 413, JSON inválido → 400) passam a ser repassados
  com o status original em vez de virarem 500.
