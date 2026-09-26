# Task: Criar as rotas de músicas, referência, performances e ranking na API

- **Slug:** api-songs
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** api 1.1.0 (minor: novas rotas e models, sem breaking)
- **App afetado:** api
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (models `Song`/`Performance`, rotas `/api/songs/*`)

## 1. Contexto e Motivação
- Liga as peças: letra sincronizada do LRCLIB, referência de pitch do worker (sdd-001) e
  função de nota (sdd-002). Expõe tudo para o web (sdd-004).
- Modelo "fliperama": sem login. Quem canta informa um nome, e a performance fica registrada
  com esse nome no ranking da música.
- Pedido original: `specs/tasks.txt`, item 3, com as decisões do usuário: "põe o nome quando
  for cantar… não precisa de login… tipo fliperama antigo" e "descartar o MP3".
- Fonte do áudio (decisão do usuário em 2026-09-25, projeto pessoal e não comercial): o
  principal é **colar o link do YouTube**. O worker baixa o áudio com `yt-dlp` (sdd-001). O
  upload de arquivo continua como alternativa para quando o YouTube falhar.
- Rastreabilidade: fluxo `routes → controllers → services → repositories`
  (`apps/api/docs/arquitetura.md`), passo a passo em "Como adicionar um recurso novo".

## 2. Escopo
- **Inclui**
  - Busca de músicas no LRCLIB (só as que têm `syncedLyrics`).
  - Cadastro idempotente de música a partir do id do LRCLIB, com a letra parseada.
  - Referência a partir de **link do YouTube** (principal) ou **upload de arquivo**
    (alternativa) → processamento **assíncrono em processo** (responde 202 e chama o worker em
    background) → status `NONE | PROCESSING | READY | FAILED`.
  - Parser de link do YouTube (`utils/youtube.ts`): só o `videoId` segue para o worker.
  - Áudio para tocar: `GET /:id/audio` repassa em streaming o `/youtube/audio` do worker.
    Nada é gravado no servidor; o web guarda em cache.
  - Leitura da referência (PitchTrack) quando `READY`.
  - Envio de performance (nome + PitchTrack cantado + offset) → nota via `scoringService` →
    persiste → devolve nota + posição no ranking.
  - Ranking top N por música.
  - Parser de LRC (`utils/lrc.ts`).
  - Nova camada `clients/` para integrações HTTP externas (LRCLIB e worker).
  - Env `WORKER_URL`, `LRCLIB_BASE_URL`.
  - `CHANGELOG.md` (criar), bump para 1.1.0, atualização de `arquitetura.md` e `AGENTS.md` §4/§11.
- **Exclui**
  - Login ou vínculo com `User` (as rotas são públicas).
  - Fila persistente (BullMQ/Redis). Reprocessamento após restart é manual (ver regra 6).
  - Rate limiting (registrado como risco, entra antes de ir a público).
  - Filtro de palavrões no nome.
  - Guardar o áudio no servidor: `GET /:id/audio` baixa do YouTube de novo a cada chamada.
  - Busca de vídeos no YouTube pela API (o web só abre a busca do YouTube numa aba nova).

## 3. Impacto Arquitetural
- **Nova camada `src/clients/`** — integrações HTTP externas, no mesmo nível de
  `repositories/` (services chamam, não conhecem HTTP da requisição de entrada). Justificativa:
  `repositories/` é "só consultas ao banco" (`arquitetura.md`) e `utils/` é "sem estado de
  negócio". Um cliente de API externa não cabe bem em nenhum dos dois. Documentar em
  `arquitetura.md`:
  ```
  routes → controllers → services → repositories → banco de dados
                              │
                              └────→ clients → HTTP externo (LRCLIB, worker)
  ```
- Novos arquivos:
  ```
  src/clients/lrclib.client.ts
  src/clients/worker.client.ts
  src/repositories/song.repository.ts
  src/repositories/performance.repository.ts
  src/services/song.service.ts          # busca, cadastro, upload/processamento da referência
  src/services/performance.service.ts   # nota + persistência + ranking
  src/controllers/song.controller.ts
  src/controllers/performance.controller.ts
  src/routes/song.routes.ts             # registra também as rotas de performance sob /songs/:id
  src/utils/lrc.ts
  src/utils/youtube.ts                  # parseYoutubeVideoId
  src/tests/songs/*.spec.ts
  src/tests/performances/*.spec.ts
  src/tests/lrc/lrc.spec.ts
  src/tests/youtube/youtube.spec.ts
  ```
- Alterados: `app.ts` (registrar `@fastify/multipart` e `songRoutes` com prefixo `/api/songs`),
  `config/env.ts`, `utils/validators.ts`, `utils/errors.ts` (`AppError.code`),
  `utils/error-handler.ts` (resposta `{ message, code }`), `prisma/schema.prisma` + migration.
- Fluxo do upload:
  ```
  POST /api/songs/:id/reference (multipart)
    controller: lê o arquivo em Buffer (limite 20 MB) → songService.startReference(id, buffer, filename)
      service:
        1. repo.claimForProcessing(id)      -- UPDATE ... WHERE id=? AND status IN (NONE, FAILED)
                                            --   OR (status=PROCESSING AND referenceUpdatedAt < now-15min)
           count = 0 → ReferenceAlreadyProcessingError (409) ou ReferenceAlreadyReadyError (409)
        2. void processReference(id, buffer)   (sem await; erros capturados internamente)
        3. return { status: "PROCESSING" }  → 202
    processReference:
        track = await workerClient.extract(buffer, filename)     (timeout 10 min)
        grava referenceAudioMs = track.durationMs
        |track.durationMs - song.durationMs| > 10 s → FAILED + DURATION_MISMATCH
        senão → READY + referenceTrack
        catch → FAILED + código traduzido do worker (claim do upload zera youtubeVideoId)
        (o buffer sai de escopo: nada é gravado em disco)
  ```
- Fluxo da referência pelo YouTube:
  ```
  POST /api/songs/:id/reference/youtube  { url }
    controller: youtubeReferenceBodySchema.parse → parseYoutubeVideoId(url)
                null → InvalidYoutubeUrlError (400), sem chamar o worker
                → songService.startReferenceFromYoutube(id, videoId)
      service:
        1. repo.claimForProcessing(id, { youtubeVideoId: videoId })
                                            -- o mesmo claim atômico do upload; grava o videoId
                                            --   já no PROCESSING para o web mostrar a miniatura
        2. void processYoutubeReference(id, videoId)
        3. return { status: "PROCESSING", youtubeVideoId: videoId }  → 202
    processYoutubeReference:
        track = await workerClient.extractFromYoutube(videoId)   (timeout 12 min: download + extração)
        mesma checagem de duração (regra 7)
        READY → grava referenceTrack (o youtubeVideoId já foi gravado no claim)
        catch → FAILED + referenceError (código traduzido do worker) + youtubeVideoId = null
  ```
- Fluxo do áudio para tocar:
  ```
  GET /api/songs/:id/audio
    service: song = repo.findById(id); status ≠ READY ou sem youtubeVideoId → SongAudioUnavailableError (404)
             { stream, contentType, contentLength } = await workerClient.fetchYoutubeAudio(videoId)
    controller: reply.type(contentType).header("content-length", ...).send(Readable.fromWeb(stream))
                (streaming: a API não guarda o arquivo inteiro em memória; o Fastify precisa
                 de um Readable do Node, daí o Readable.fromWeb)
    falha do worker → AudioProviderUnavailableError (502)
  ```
- Fluxo da performance:
  ```
  POST /api/songs/:id/performances
    controller: performanceBodySchema.parse → performanceService.submit(id, body)
      service: song = repo.findWithReference(id); status ≠ READY → 409
               result = scoringService.score(song.referenceTrack, body.track, song.lyrics, { offsetMs })
               perf   = repo.create({...})
               rank   = repo.countBetter(songId, result.score) + 1
               return { id, playerName, ...result, rank }
  ```
- Sem DI: services importam `songRepository`, `lrclibClient` etc. diretamente (`AGENTS.md` §2).

## 4. Contratos e Interfaces
- **Prisma** (`prisma/schema.prisma`, com comentários em cada model):
  ```prisma
  enum ReferenceStatus { NONE PROCESSING READY FAILED }

  /// Motivo de falha da referência. O web traduz cada código em mensagem
  /// (tabela "Erros da referência" no readme do design system).
  enum ReferenceErrorCode { VIDEO_UNAVAILABLE TOO_LONG DURATION_MISMATCH NO_VOICE DOWNLOAD_FAILED INVALID_AUDIO INTERNAL }

  /// Música cadastrada a partir do LRCLIB. A referência de pitch é extraída uma única vez
  /// do áudio (link do YouTube ou arquivo enviado); o áudio nunca é armazenado.
  model Song {
    id                 String          @id @default(uuid(7))
    lrclibId           Int             @unique
    artist             String
    title              String
    album              String?
    durationMs         Int
    lyrics             Json            // LyricLine[]
    referenceStatus    ReferenceStatus @default(NONE)
    referenceTrack     Json?           // PitchTrack (sdd-001)
    youtubeVideoId     String?         // vídeo da tentativa atual ou da referência pronta; permite mostrar a miniatura e baixar o áudio para tocar. Nulo se veio de upload ou se a tentativa pelo YouTube falhou
    referenceError       ReferenceErrorCode?
    referenceAudioMs     Int?          // duração do áudio da última tentativa (preenche a mensagem de DURATION_MISMATCH)
    referenceUpdatedAt DateTime?
    createdAt          DateTime        @default(now())
    performances       Performance[]
  }

  /// Uma cantoria. Sem login: o jogador informa só o nome (estilo fliperama).
  model Performance {
    id          String   @id @default(uuid(7))
    songId      String
    song        Song     @relation(fields: [songId], references: [id], onDelete: Cascade)
    playerName  String
    score       Float
    pitchScore  Float
    timingScore Float
    offsetMs    Int      @default(0)
    details     Json     // { keyOffsetSemitones, coverage, lines }
    sungTrack   Json     // PitchTrack cantado (só pitch, não é áudio): usado para recalibrar a nota
    createdAt   DateTime @default(now())

    @@index([songId, score(sort: Desc)])
  }
  ```
- **Rotas** (prefixo `/api/songs`):
  | Método | Rota | Entrada | Saída |
  |---|---|---|---|
  | GET | `/search?q=` | `q` 2–100 chars | `200 SongSearchItem[]` (máx. 20) |
  | POST | `/` | `{ lrclibId: number }` | `201` (novo) ou `200` (existente) `SongDto` |
  | GET | `/:id` | — | `200 SongDto` · `404` |
  | POST | `/:id/reference/youtube` | `{ url: string }` | `202 { status, youtubeVideoId }` · `400 INVALID_YOUTUBE_URL` · `404` · `409` |
  | POST | `/:id/reference` | multipart `file` (alternativa ao YouTube) | `202 { status }` · `404` · `409` · `413` |
  | GET | `/:id/reference` | — | `200 PitchTrack` · `404` · `409` (não `READY`) |
  | GET | `/:id/audio` | — | `200` stream `audio/mp4` ou `audio/mpeg` · `404` (música inexistente ou sem `youtubeVideoId`) · `502` |
  | POST | `/:id/performances` | `PerformanceBody` (bodyLimit 2 MB) | `201 PerformanceResult` · `404` · `409` · `422` |
  | GET | `/:id/performances?limit=10` | `limit` 1–50 | `200 RankingItem[]` |
- **DTOs** (em `services/`):
  ```ts
  interface SongSearchItem { lrclibId: number; artist: string; title: string; album: string | null;
                             durationMs: number; songId: string | null; referenceStatus: ReferenceStatus | null;
                             youtubeVideoId: string | null }             // miniatura na lista (vem na mesma query)
  interface SongDto { id: string; lrclibId: number; artist: string; title: string; album: string | null;
                      durationMs: number; lyrics: LyricLine[]; referenceStatus: ReferenceStatus;
                      referenceError: ReferenceErrorCode | null;
                      referenceAudioMs: number | null;
                      youtubeVideoId: string | null }             // nunca inclui referenceTrack
  interface PerformanceResult extends ScoreResult { id: string; playerName: string; rank: number; createdAt: Date }
  interface RankingItem { id: string; playerName: string; score: number; createdAt: Date }
  ```
- **Zod** (`utils/validators.ts`):
  ```ts
  export const songSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
  export const createSongBodySchema = z.object({ lrclibId: z.number().int().positive() });
  export const songParamsSchema = z.object({ id: z.uuid() });
  export const playerNameSchema = z.string().trim().min(1).max(20)
    .regex(/^[\p{L}\p{N} ._-]+$/u);
  export const performanceBodySchema = z.object({
    playerName: playerNameSchema,
    offsetMs: z.number().int().min(-10_000).max(10_000).default(0),   // ±2 s no plano original; ±10 s desde 2026-09-25 (pedido do usuário)
    track: pitchTrackSchema,
  });
  export const rankingQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
  export const youtubeReferenceBodySchema = z.object({ url: z.string().trim().min(1).max(300) });
  ```
- **YouTube** (`utils/youtube.ts`):
  ```ts
  export function parseYoutubeVideoId(input: string): string | null;
  ```
  Usa `new URL()` e aceita: `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>`,
  `youtube.com/embed/<id>`, com os hosts **exatos** `youtube.com`, `www.youtube.com`,
  `m.youtube.com`, `music.youtube.com` e `youtu.be` (nada de `endsWith`: `youtube.com.evil.com`
  é recusado). Só `http`/`https`. Ignora os outros parâmetros (`t`, `list`, `si`). O id tem que
  casar com `^[A-Za-z0-9_-]{11}$`. Qualquer outra coisa → `null`.
- **Clients**:
  ```ts
  export const lrclibClient = {
    search(q: string): Promise<LrclibTrack[]>;       // GET {base}/api/search?q=
    getById(id: number): Promise<LrclibTrack | null>; // GET {base}/api/get/{id}
  };
  // Header obrigatório: User-Agent "cantor.ia/<versão> (github.com/matheusopessoa/cantor.ia)"
  // Timeout 5 s. Falha de rede ou 5xx → LyricsProviderUnavailableError (502)

  export const workerClient = {
    extract(audio: Buffer, filename: string): Promise<PitchTrack>;  // POST {WORKER_URL}/extract
    extractFromYoutube(videoId: string): Promise<PitchTrack>;       // POST {WORKER_URL}/youtube/extract
    fetchYoutubeAudio(videoId: string): Promise<{                   // POST {WORKER_URL}/youtube/audio
      stream: ReadableStream<Uint8Array>; contentType: string; contentLength: number | null;
    }>;
  };
  // extract: timeout 10 min. extractFromYoutube: 12 min. fetchYoutubeAudio: 2 min.
  // PitchTrack validado com pitchTrackSchema. contentType aceito só se for audio/mp4 ou audio/mpeg.
  ```
- **LRC** (`utils/lrc.ts`): `parseLrc(synced: string): LyricLine[]`. Aceita `[mm:ss.xx]` e
  `[mm:ss.xxx]`, várias tags na mesma linha, ignora tags de metadado (`[ar:]`, `[offset:]`…),
  ordena por `startMs`.
- **Código de erro na resposta**: `AppError` ganha um terceiro parâmetro opcional
  `code?: string`, e `utils/error-handler.ts` passa a responder `{ message, code }` quando há
  código (additive: as respostas atuais de `/api/auth` não mudam). O web usa o `code`, nunca
  o `message`, para escolher o texto.
- **Tradução worker → API** (em `song.service.ts`): `video_unavailable` → `VIDEO_UNAVAILABLE` ·
  `too_long` → `TOO_LONG` · `no_voice` → `NO_VOICE` · `download_failed` e timeout →
  `DOWNLOAD_FAILED` · `invalid_audio`/`too_large` → `INVALID_AUDIO` · resto → `INTERNAL`.
  Divergência de duração vira `DURATION_MISMATCH` na própria API.
- **Erros** (`utils/errors.ts`): `SongNotFoundError` (404), `SongWithoutSyncedLyricsError` (422),
  `ReferenceAlreadyProcessingError` (409), `ReferenceAlreadyReadyError` (409),
  `ReferenceNotReadyError` (409), `LyricsProviderUnavailableError` (502),
  `InvalidYoutubeUrlError` (400, `code: "INVALID_YOUTUBE_URL"`), `SongAudioUnavailableError`
  (404: música não `READY` ou sem `youtubeVideoId`), `AudioProviderUnavailableError` (502,
  `code: "DOWNLOAD_FAILED"`).
- **Env** (`config/env.ts`, seguindo o padrão de `specs/sdd-006-env-config/tasks.md`):
  `WORKER_URL` (`z.url()`, padrão `http://localhost:8000`) e `LRCLIB_BASE_URL` (`z.url()`,
  padrão `https://lrclib.net`). Adicionar os dois ao `.env.example` (seção API) e, no compose,
  `WORKER_URL: http://worker:8000` no `environment:` da `api` em dev e prod (URL entre
  containers fica no compose, sdd-006 regra 7).
- Dependência nova: `@fastify/multipart` (versão via skill `latest-deps`).

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | — | Só entram músicas com letra sincronizada (`syncedLyrics` não nulo) | MVP |
| 2 | — | Cadastro idempotente por `lrclibId` (upsert). Duas chamadas → a mesma `Song` | Evita duplicatas |
| 3 | — | O áudio (arquivo enviado ou baixado do YouTube) nunca vai para disco nem banco na API | Decisão do usuário ("Descartar") |
| 4 | — | Um único processamento por música: transição de status atômica via `updateMany` condicional | Concorrência (dois uploads simultâneos) |
| 5 | — | Referência `READY` não é reprocessada (409). `FAILED` permite novo upload | Referência é gerada uma vez por música |
| 6 | — | `PROCESSING` há mais de 15 min é tratado como abandonado e aceita novo upload | Restart da API no meio do processamento |
| 7 | — | Duração extraída diferente da duração do LRCLIB em mais de 10 s → `FAILED` | Pega arquivo errado ou versão diferente |
| 8 | Login obrigatório não existe para essas rotas | Sem login. O jogador informa um nome (1–20 chars). Nomes **não são únicos**: duas pessoas podem usar "ANA" | Decisão do usuário ("tipo fliperama") |
| 9 | — | Ranking: `score` desc e, no empate, `createdAt` asc (quem fez primeiro fica na frente) | Convenção de fliperama |
| 10 | — | `rank` devolvido = nº de performances com score maior + 1 | Mostrar "você ficou em 3º" |
| 11 | — | Referência por link: a API extrai só o `videoId` e envia ao worker. A URL original não é guardada nem repassada | Segurança (SSRF no `yt-dlp`) |
| 12 | — | `youtubeVideoId` é gravado no claim (`PROCESSING`) para o web mostrar a miniatura, zerado se a tentativa falhar ou se a referência vier de upload. `GET /audio` só serve música `READY` | O áudio servido para tocar é o mesmo que gerou a referência |
| 14 | — | Falha da referência é sempre um `ReferenceErrorCode`, nunca texto livre. `referenceAudioMs` guarda a duração do áudio para a mensagem de `DURATION_MISMATCH` | Design system: mensagens por código (readme, "Erros da referência") |
| 13 | — | `GET /:id/audio` baixa do YouTube a cada chamada e repassa em streaming, sem gravar | "Descartar" + projeto pessoal (decisão do usuário, 2026-09-25) |

## 6. Critérios de Aceitação
- **Performance**
  - `GET /search` faz **1** chamada ao LRCLIB e **1** query (`findMany where lrclibId in [...]`)
    para anexar `songId`/`referenceStatus`. Sem N+1.
  - Consultas de `Song` para DTO e listas usam `select` explícito **sem** `referenceTrack`
    (pode ter ~400 KB). Só `GET /:id/reference` e o fluxo de performance carregam o campo.
  - Ranking usa o índice `(songId, score desc)`; `rank` é um `count` indexado.
  - `POST /:id/reference` e `POST /:id/reference/youtube` respondem 202 em < 200 ms (não
    esperam o worker).
  - `GET /:id/audio` faz streaming: a API não carrega o arquivo inteiro em memória.
- **Concorrência**: dois `POST /:id/reference` simultâneos → exatamente um 202 e um 409
  (teste com `Promise.all`).
- **Segurança**
  - Upload limitado a 20 MB e 1 arquivo (config do multipart). Excesso → 413.
  - `playerName` validado por regex (sem HTML/controle). O web renderiza como texto.
  - Nenhuma rota devolve `sungTrack` ou `referenceError` com stack trace.
  - Link inválido ou de outro host → 400 **sem** chamar o worker. O worker só recebe `videoId`.
- **Compatibilidade**: rotas `/api/auth/*` e `/api/health` intactas; suíte existente continua verde.
- **Docs**: `arquitetura.md` com a camada `clients/` e os novos recursos; `AGENTS.md` §4 e §11
  (novas envs e dependência); `CHANGELOG.md` criado com a entrada 1.1.0.

## 7. Plano de Testes
- **Vitest + `app.inject`** (padrão de `src/tests/auth/auth.routes.spec.ts`), banco de teste
  via `helpers/database.ts`. `lrclibClient` e `workerClient` mockados com `vi.mock` do módulo.
  - `lrc.spec.ts`: formatos de timestamp, várias tags por linha, metadados ignorados, linhas
    vazias preservadas (viram instrumentais), ordenação.
  - `songs.search.spec.ts`: filtra sem `syncedLyrics`; anexa `songId` de música já cadastrada;
    `q` curto → 400; LRCLIB fora → 502.
  - `songs.create.spec.ts`: 201 novo; 200 repetido (mesmo id); id inexistente no LRCLIB → 404;
    sem letra sincronizada → 422.
  - `songs.reference.spec.ts`: 202 + status `PROCESSING`; worker ok → `READY` (aguardar a
    promise com `vi.waitFor`); worker falha → `FAILED` com mensagem; duração divergente →
    `FAILED`; `READY` → 409; concorrência → um 202 e um 409; `PROCESSING` velho → aceita;
    arquivo > 20 MB → 413; `GET /reference` antes de `READY` → 409.
  - `youtube.spec.ts`: formatos aceitos (`watch?v=`, `youtu.be`, `shorts`, `embed`,
    `music.`/`m.`, com `&t=`, `&list=`, `?si=`); recusados (`youtube.com.evil.com`,
    `ftp://`, id com 10 ou 12 chars, texto solto, `javascript:`).
  - `songs.reference-youtube.spec.ts`: 202 + `PROCESSING` + `youtubeVideoId` na resposta e já
    gravado; worker ok → `READY` mantendo o `youtubeVideoId`; worker falha → `FAILED`,
    `youtubeVideoId` nulo e o `referenceError` traduzido (um caso por código do worker); duração
    divergente → `FAILED`; link inválido → 400 e worker não chamado; concorrência com o upload
    → um 202 e um 409.
  - `songs.audio.spec.ts`: `READY` com `youtubeVideoId` → 200, `content-type` e bytes repassados;
    `PROCESSING` → 404; sem `youtubeVideoId` → 404; worker falha → 502; música inexistente → 404.
  - `performances.spec.ts`: 201 com nota e `rank`; música não `READY` → 409; `playerName`
    vazio / com `<script>` / > 20 chars → 400; track com `hopMs` ≠ 10 → 400; persistência
    dos campos; `sungTrack` não aparece na resposta.
  - `error-handler.spec.ts`: `AppError` com `code` → `{ message, code }`; sem `code` → `{ message }`
    (contrato atual do `/api/auth` preservado).
  - `ranking.spec.ts`: ordem por score desc e empate por data; `limit`; música sem
    performances → `[]`.
- **Smoke manual**: com worker e API rodando, buscar → cadastrar → colar link do YouTube →
  polling até `READY` → `GET /audio` baixa e toca → `POST performance` com `sungTrack` = a
  própria referência → nota 10. Repetir o cadastro de referência com upload de arquivo.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Restart da API durante o processamento deixa `PROCESSING` órfão | média | baixo | Regra 6 (expira em 15 min). Fila fica para depois do MVP |
| Upload anônimo usado para abusar da CPU do worker | média (se público) | alto | Worker processa 1 por vez (sdd-001). Adicionar `@fastify/rate-limit` antes de expor publicamente (follow-up) |
| LRCLIB indisponível ou com rate limit | baixa | médio | Timeout 5 s + 502 claro. A letra fica salva na `Song` depois do cadastro |
| Letra do LRCLIB de uma versão diferente do áudio (clipe com introdução, versão ao vivo) | média | médio | Regra 7 + `offsetMs` ajustável no web. O web recomenda vídeos "official audio" ou "lyric video" |
| `yt-dlp` quebra ou o YouTube bloqueia o download | alta | médio | `referenceError` e 502 com mensagem clara. Upload de arquivo como alternativa. Atualizar o `yt-dlp` no worker (sdd-001 R6) |
| Termos do YouTube (download não permitido) | alta | médio (projeto pessoal) | Uso pessoal e não comercial (decisão do usuário, 2026-09-25). Rever antes de abrir ao público |
| Tocar em um dispositivo novo depende do YouTube estar acessível na hora | média | baixo | O web guarda o áudio em cache (IndexedDB) e cai no seletor de arquivo se o download falhar |
| `referenceTrack` grande em JSONB degradando queries | baixa | médio | `select` explícito (critério da seção 6) |
| Nome ofensivo no ranking | média | baixo | Aceito no MVP. Filtro/moderação como follow-up |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ (Login, destino do MP3 e uso do link do YouTube foram decididos pelo usuário em
2026-09-25.)

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, `AGENTS.md` ou decisão do usuário.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Mudança de schema Prisma é `additive`, com migration planejada (`pnpm --filter api db:migrate`),
      `CHANGELOG.md` e bump para 1.1.0 (`AGENTS.md` §6).
- [x] Perguntas em aberto foram exauridas.
- **Depende de:** sdd-001 (contratos `/extract`, `/youtube/extract`, `/youtube/audio`) e sdd-002
  (`scoringService`, `pitchTrackSchema`).
