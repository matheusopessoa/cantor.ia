# Arquitetura

Arquitetura em camadas simples. O fluxo de uma requisição é sempre o mesmo e em uma
única direção:

```
routes → controllers → services → repositories → banco de dados
                            │ ↑
                            │ utils
                            └────→ clients → HTTP externo (LRCLIB, worker)
```

Cada camada só conhece a camada imediatamente abaixo. Não há injeção de dependência
via construtor, factories ou interfaces de "portas": os módulos são importados
diretamente, o que mantém o código curto e fácil de navegar.

## `src/routes/`

- **Função**: Mapear método + URL para um controller (`app.post("/users", registerUser)`).
- **Regra**: Apenas declaração de caminhos. Nenhuma lógica. Configuração por rota (ex.:
  `bodyLimit`) é aceitável quando faz parte do contrato.
- Rotas registradas em [`app.ts`](../src/app.ts): `/api/health`, `/api/auth/*` e
  `/api/songs/*` ([`song.routes.ts`](../src/routes/song.routes.ts), que agrupa também as
  performances sob `/api/songs/:id/performances`).

## `src/controllers/`

- **Função**: Fronteira HTTP. Validar a entrada com Zod, chamar o service e devolver a resposta.
- **Regra**: É o único lugar que conhece `FastifyRequest`/`FastifyReply`. Não contém regra de
  negócio. Erros são lançados e tratados pelo error handler global em
  [`utils/error-handler.ts`](../src/utils/error-handler.ts) (`ZodError` → 400,
  `AppError` → seu `statusCode`), que o [`app.ts`](../src/app.ts) apenas registra.
- [`song.controller.ts`](../src/controllers/song.controller.ts) tem duas particularidades:
  o upload da referência lê o arquivo do multipart para um `Buffer` (limite de 20 MB
  configurado no `app.ts`; excesso → 413) e `GET /:id/audio` repassa o stream do worker com
  `Readable.fromWeb`, sem carregar o arquivo inteiro em memória.

## `src/services/`

- **Função**: Regra de negócio. Orquestra hashing, geração de id, validações de negócio e
  chamadas ao repositório e aos clients.
- **Regra**: Não conhece HTTP nem SQL. Recebe dados simples e retorna DTOs simples (ex:
  `PublicUser`, sem `password`). Lança `AppError` (ou subclasses) para falhas de negócio.
- Nem todo service fala com um repositório. [`scoring.service.ts`](../src/services/scoring.service.ts)
  é uma função pura: recebe dois `PitchTrack` (referência e voz cantada) e as linhas da letra e
  devolve a nota de 0 a 10 (`ScoreResult`: nota final, afinação, tempo, transposição detectada,
  cobertura e resultado por linha). As constantes de calibração ficam em `SCORING_CONFIG`.
  Algoritmo e critérios em [`specs/sdd-002-scoring/tasks.md`](../../../specs/sdd-002-scoring/tasks.md).
- [`alignment.service.ts`](../src/services/alignment.service.ts) — também função pura, sem
  repositório: `align(lines, reference)` encaixa a letra do LRCLIB (cronometrada em outra
  gravação) no áudio da referência. Acha os inícios de frase da referência (`voicedSegments`
  + silêncio ≥ 350 ms), procura um deslocamento global em ±12 s e encaixa cada linha com
  texto no início de frase livre a até 350 ms; as demais recebem só o deslocamento. **Nunca
  muda a velocidade da letra.** Menos da metade das linhas encaixadas → `aligned: false` e
  `lines: null` (o consumidor usa a letra original). Constantes em `ALIGNMENT_CONFIG`;
  algoritmo em [`specs/sdd-007-lyrics-alignment/tasks.md`](../../../specs/sdd-007-lyrics-alignment/tasks.md).
- [`song.service.ts`](../src/services/song.service.ts) — busca no LRCLIB (só faixas com letra
  sincronizada, máx. 20, com o estado local anexado em 1 query), cadastro idempotente por
  `lrclibId`, `SongDto` (nunca inclui `referenceTrack`) e o ciclo da referência: o claim
  atômico para `PROCESSING`, o processamento **em background** (a rota responde 202 e o
  service chama o worker sem `await`), a checagem de duração (±10 s → `DURATION_MISMATCH`)
  e a tradução dos códigos do worker para `ReferenceErrorCode` (`toReferenceErrorCode`).
  Ao ficar `READY`, alinha a letra à curva recém-extraída (`alignmentService`, sem query
  extra) e grava `alignedLyrics` + `lyricsAlignment` junto com a referência; `GET /:id`
  faz o backfill de músicas `READY` anteriores à sdd-007 (sem `lyricsAlignment`) na
  primeira leitura, uma vez por música. Também serve o áudio para tocar (`getAudio`),
  repassando o stream do worker.
- [`performance.service.ts`](../src/services/performance.service.ts) — nota via
  `scoringService` sobre `alignedLyrics ?? lyrics` (o `offsetMs` do jogador é ajuste fino
  sobre a letra alinhada; `lines[].startMs` do resultado é o da linha avaliada),
  persistência e posição no ranking (`rank` = nº de performances com nota maior + 1), além
  do ranking top N. Sem login: o jogador informa só um nome.
- Plano e regras de negócio: [`specs/sdd-003-api-songs/tasks.md`](../../../specs/sdd-003-api-songs/tasks.md).

## `src/repositories/`

- **Função**: Acesso a dados. Fala diretamente com o Prisma Client.
- **Regra**: Só consultas ao banco. Retorna os models do Prisma; qualquer transformação para
  DTO acontece no service.
- [`song.repository.ts`](../src/repositories/song.repository.ts) — consultas de `Song` com
  `select` explícito **sem** `referenceTrack` (pode passar de 400 KB); só
  `findWithReference` carrega o campo. O `select` inclui `alignedLyrics` e
  `lyricsAlignment` (sdd-007): `markReady` grava os dois junto com a curva,
  `saveAlignment` faz o backfill, e `claimForProcessing`/`markFailed` zeram ambos (o
  alinhamento vale só para a referência atual). `claimForProcessing` é um `updateMany`
  condicional (status `NONE`/`FAILED`, ou `PROCESSING` há mais de `PROCESSING_STALE_MS` =
  15 min): é o que garante um único processamento por música mesmo com requisições
  simultâneas.
- [`performance.repository.ts`](../src/repositories/performance.repository.ts) — cria a
  performance, conta as melhores (`countBetter`) e lista o ranking (nota desc, empate por
  `createdAt` asc), usando o índice `(songId, score desc)`.

## `src/clients/`

- **Função**: Integrações HTTP **externas**, no mesmo nível de `repositories/`: os services
  chamam, e os clients não conhecem a requisição de entrada. Fica separado de `repositories/`
  (só banco) e de `utils/` (sem estado de negócio nem I/O).
- **Regra**: Validar toda resposta com Zod antes de devolver; nunca repassar corpo cru.
  Timeouts explícitos em cada chamada.
- [`lrclib.client.ts`](../src/clients/lrclib.client.ts) — `search(q)` e `getById(id)` no
  LRCLIB (`LRCLIB_BASE_URL`), com `User-Agent` identificando o projeto e timeout de 5 s.
  Rede fora, 5xx ou corpo inesperado → `LyricsProviderUnavailableError` (502).
- [`worker.client.ts`](../src/clients/worker.client.ts) — `extract(buffer)`,
  `extractFromYoutube(videoId)` e `fetchYoutubeAudio(videoId)` no worker (`WORKER_URL`,
  contrato em `specs/sdd-001-worker-pitch/tasks.md` §4). Toda falha vira
  `WorkerClientError` com um código (os do worker mais `timeout`, `unreachable` e
  `invalid_response`); quem traduz para o usuário é o `song.service.ts`.

## `src/utils/`

Peças compartilhadas, sem estado de negócio:

- [`prisma.ts`](../src/utils/prisma.ts) — instância única do Prisma Client.
- [`hash.ts`](../src/utils/hash.ts) — `hash`/`compare` com bcrypt.
- [`bindex.ts`](../src/utils/bindex.ts) — blind index determinístico (HMAC-SHA256)
  para busca de e-mail. Depende da variável de ambiente `EMAIL_BINDEX_SECRET`.
- [`validators.ts`](../src/utils/validators.ts) — schemas Zod dos contratos: corpos das rotas
  de auth, os formatos compartilhados `pitchTrackSchema` (curva de pitch do worker, contrato
  em `specs/sdd-001-worker-pitch/tasks.md` §4), `lyricLineSchema` (linha do LRC) e
  `lyricsAlignmentSchema` (diagnóstico do alinhamento, sdd-007), com os tipos `PitchTrack`,
  `LyricLine` e `LyricsAlignment` inferidos, e os schemas das rotas de músicas
  (`songSearchQuerySchema`, `createSongBodySchema`, `songParamsSchema`,
  `youtubeReferenceBodySchema`, `performanceBodySchema` com `playerNameSchema`,
  `rankingQuerySchema`).
- [`pitch.ts`](../src/utils/pitch.ts) — matemática pura sobre curvas de pitch: `fold12`
  (diferença em semitons módulo oitava, em [-6, 6)), `median`, `findOnset` (primeiro início
  de voz numa janela de frames) e `voicedSegments` (trechos contínuos com voz, em ms, unindo
  buracos curtos e descartando ruído). Usados por `scoring.service.ts` e
  `alignment.service.ts`.
- [`lrc.ts`](../src/utils/lrc.ts) — `parseLrc`: letra sincronizada (LRC) → `LyricLine[]`.
  Aceita `[mm:ss.xx]`/`[mm:ss.xxx]`, várias tags por linha, ignora metadados, preserva
  linhas vazias (instrumentais) e ordena por `startMs`.
- [`youtube.ts`](../src/utils/youtube.ts) — `parseYoutubeVideoId`: extrai o `videoId` de um
  link do YouTube (hosts exatos, só `http`/`https`). Só o id vai para o worker; a URL colada
  nunca é guardada.
- [`errors.ts`](../src/utils/errors.ts) — `AppError` (`statusCode` e `code` opcional) e erros
  de negócio: `UserAlreadyExistsError`, `InvalidReferenceError` (422: referência sem nenhum
  frame com voz) e os de músicas — `SongNotFoundError` (404),
  `SongWithoutSyncedLyricsError` (422), `ReferenceAlreadyProcessingError` /
  `ReferenceAlreadyReadyError` / `ReferenceNotReadyError` (409),
  `LyricsProviderUnavailableError` (502), `InvalidYoutubeUrlError` (400,
  `code: "INVALID_YOUTUBE_URL"`), `SongAudioUnavailableError` (404),
  `AudioProviderUnavailableError` (502, `code: "DOWNLOAD_FAILED"`) e
  `MissingUploadFileError` (400).
- [`error-handler.ts`](../src/utils/error-handler.ts) — handler global do Fastify que traduz
  cada tipo de erro em status code + mensagem. `AppError` com `code` responde
  `{ message, code }` (o web escolhe o texto pelo `code`, nunca pelo `message`); sem `code`,
  só `{ message }` — o contrato de `/api/auth` não muda. Erros do próprio Fastify com status
  4xx (corpo acima do `bodyLimit` ou do limite do multipart → 413, JSON inválido → 400) são
  repassados com o status original; o resto vira 500. Registrado em [`app.ts`](../src/app.ts).

## `src/config/`

- [`env.ts`](../src/config/env.ts) — variáveis de ambiente validadas com Zod. Além das de
  banco e segredos: `WORKER_URL` (padrão `http://localhost:8000`) e `LRCLIB_BASE_URL`
  (padrão `https://lrclib.net`). Catálogo em `AGENTS.md` §11.
- [`cors.ts`](../src/config/cors.ts) — opções do CORS por ambiente.

## Recursos

| Recurso | Rotas | Camadas |
|---|---|---|
| Health | `GET /api/health` | `health.*` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login` | `auth.*`, `user.repository` |
| Songs | `GET /api/songs/search`, `POST /api/songs`, `GET /api/songs/:id`, `POST /api/songs/:id/reference/youtube`, `POST\|GET /api/songs/:id/reference`, `GET /api/songs/:id/audio` | `song.*`, `lrclib.client`, `worker.client` |
| Performances | `POST\|GET /api/songs/:id/performances` | `performance.*`, `song.repository`, `scoring.service` |

Contratos completos (entradas, saídas e códigos de erro) em
[`specs/sdd-003-api-songs/tasks.md`](../../../specs/sdd-003-api-songs/tasks.md) §4.

## Como adicionar um recurso novo

1. `repositories/<recurso>.repository.ts` — as consultas ao banco.
2. `clients/<servico>.client.ts` — se o recurso fala com uma API externa.
3. `services/<recurso>.service.ts` — a regra de negócio.
4. `controllers/<recurso>.controller.ts` — validação Zod + resposta HTTP.
5. `routes/<recurso>.routes.ts` — as rotas, registradas em [`app.ts`](../src/app.ts).
