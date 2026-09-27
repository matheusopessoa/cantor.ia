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
- Rotas registradas em [`app.ts`](../src/app.ts): `/api/health`, `/api/auth/*`,
  `/api/songs/*` ([`song.routes.ts`](../src/routes/song.routes.ts), que agrupa também as
  performances sob `/api/songs/:id/performances`) e `/api/review/*`
  ([`review.routes.ts`](../src/routes/review.routes.ts), sdd-012: a revisão da letra pelo
  MCP). Esse plugin registra um `onRequest` ([`utils/review-auth.ts`](../src/utils/review-auth.ts))
  que exige `Authorization: Bearer <LYRICS_REVIEW_SECRET>` em todas as rotas dele: a API não
  tem login, então é um token de serviço; sem a variável no servidor, as rotas respondem 503.

## `src/controllers/`

- **Função**: Fronteira HTTP. Validar a entrada com Zod, chamar o service e devolver a resposta.
- **Regra**: É o único lugar que conhece `FastifyRequest`/`FastifyReply`. Não contém regra de
  negócio. Erros são lançados e tratados pelo error handler global em
  [`utils/error-handler.ts`](../src/utils/error-handler.ts) (`ZodError` → 400,
  `AppError` → seu `statusCode`), que o [`app.ts`](../src/app.ts) apenas registra.
- [`song.controller.ts`](../src/controllers/song.controller.ts) tem duas particularidades:
  o upload da referência lê o arquivo do multipart para um `Buffer` (limite de 20 MB
  configurado no `app.ts`; excesso → 413) e `GET /:id/audio` repassa o stream do worker com
  `Readable.fromWeb`, sem carregar o arquivo inteiro em memória. `POST /:id/stems` (sdd-013)
  junta os dois: lê o áudio do multipart para um `Buffer` e repassa em streaming o
  `multipart/form-data` do worker (voz e instrumental), com o `content-type` e o `boundary`
  dele. `GET /:id/stems/:stem` (sdd-016) serve uma trilha guardada como arquivo `audio/mp4`
  em streaming do disco, com `Content-Length`; `stem` passa pelo enum `STEM_NAMES` do
  `validators.ts` antes de virar nome de arquivo.

## `src/services/`

- **Função**: Regra de negócio. Orquestra hashing, geração de id, validações de negócio e
  chamadas ao repositório e aos clients.
- **Regra**: Não conhece HTTP nem SQL. Recebe dados simples e retorna DTOs simples (ex:
  `PublicUser`, sem `password`). Lança `AppError` (ou subclasses) para falhas de negócio.
- Nem todo service fala com um repositório. [`scoring.service.ts`](../src/services/scoring.service.ts)
  é uma função pura: recebe dois `PitchTrack` (referência e voz cantada), as linhas da letra e
  as opções `{ offsetMs, difficulty }`, e devolve a nota de 0 a 10 (`ScoreResult`: nota final,
  afinação, tempo, ritmo, nível, transposição detectada, cobertura e resultado por linha).
  O nível (`Difficulty`, padrão `HARD`) escolhe os limiares de afinação e os pesos em
  `SCORING_CONFIG.levels` (sdd-009): `HARD` 50/100 cents e 0,5 afinação + 0,5 tempo;
  `MEDIUM` 100/200 cents e 0,5 afinação + 0,25 tempo + 0,25 ritmo; `EASY` sem afinação,
  0,5 tempo + 0,5 ritmo. O ritmo é o F1 entre a presença de voz cantada e a da referência
  com folga de ±150 ms (o recall é a própria `coverage`); é calculado nos três níveis. As
  demais constantes de calibração ficam nas seções compartilhadas de `SCORING_CONFIG`.
  Algoritmo e critérios em [`specs/sdd-002-scoring/tasks.md`](../../../specs/sdd-002-scoring/tasks.md)
  e [`specs/sdd-009-difficulty-levels/tasks.md`](../../../specs/sdd-009-difficulty-levels/tasks.md).
- [`alignment.service.ts`](../src/services/alignment.service.ts) — também função pura, sem
  repositório: `align(lines, reference, forced?)` encaixa a letra do LRCLIB (cronometrada em
  outra gravação) no áudio da referência, por dois caminhos, e devolve `method` junto com o
  diagnóstico. **`forced`** (sdd-010): o worker alinhou o texto de cada linha sobre a voz
  isolada (`ForcedAlignment`, um item por linha); cada linha com texto é aceita pela confiança
  (`score ≥ 0,4`) e pela duração (≤ 20 s), as aceitas vão para onde são cantadas e as
  recusadas/instrumentais recebem o deslocamento da vizinha aceita, sem passar por cima das
  aceitas; `shiftMs` é a mediana de (alinhado − original). **`onset`** (sdd-007, quando
  `forced` é nulo ou tem tamanho diferente da letra): acha os inícios de frase da referência
  (`voicedSegments` + silêncio ≥ 350 ms), procura um deslocamento global em ±12 s e encaixa
  cada linha com texto no início de frase livre a até 350 ms; as demais recebem só o
  deslocamento. **Nunca muda a velocidade da letra.** Menos da metade das linhas
  aceitas/encaixadas → `aligned: false` e `lines: null` (o consumidor usa a letra original).
  Constantes em `FORCED_CONFIG` e `ALIGNMENT_CONFIG`; algoritmos em
  [`specs/sdd-010-lyrics-forced-alignment/tasks.md`](../../../specs/sdd-010-lyrics-forced-alignment/tasks.md) §3
  e [`specs/sdd-007-lyrics-alignment/tasks.md`](../../../specs/sdd-007-lyrics-alignment/tasks.md).
- [`song.service.ts`](../src/services/song.service.ts) — duas buscas e dois cadastros
  (sdd-015). **Pela letra**, o caminho principal: `searchLyrics` no LRCLIB (só letra
  sincronizada, até `SEARCH_LIMIT`, estado local anexado em 1 query por `lrclibId`) e
  `createFromLyrics` (idempotente por `lrclibId`, com a letra parseada por `parseLrc` e a
  referência em `NONE`; faixa desconhecida → 404, sem letra sincronizada utilizável → 422
  `NO_SYNCED_LYRICS`; corrida → `P2002` relê a vencedora). A referência começa quando a
  pessoa escolhe o vídeo na sugestão (sdd-008) e vai ao worker com a letra conhecida, sem
  Whisper. **Pelo vídeo**, a alternativa: busca no **YouTube Music** pelo worker
  (sdd-011; sem letra, até 8 resultados do worker, com o estado local anexado em 1 query: pelo `sourceVideoId` das
  músicas novas ou pelo `youtubeVideoId` das antigas, a nova vence), cadastro pelo vídeo
  (`createFromVideo`: metadados em `workerClient.getYtmusicSong`, idempotente por
  `sourceVideoId`, e **já começa a referência** pelo mesmo vídeo; corrida de cadastro → `P2002`
  relê a vencedora, corrida de claim → ignora o 409), `SongDto` (nunca inclui
  `referenceTrack`; `lrclibId` nulo nas músicas novas; `referenceUpdatedAt` em ISO, para a tela
  oferecer "Tentar de novo" num `PROCESSING` travado) e o ciclo da referência: o claim
  atômico para `PROCESSING`, o processamento **em background** (a rota responde 202 e o
  service chama o worker sem `await`), a checagem de duração (±10 s → `DURATION_MISMATCH`)
  e a tradução dos códigos do worker para `ReferenceErrorCode` (`toReferenceErrorCode`).
  Música antiga: a letra do LRCLIB vai para o worker junto com o áudio (`{ kind: "known" }`,
  sdd-010). Música nova: as candidatas de `lyricsSourceService.collect` (coletadas no
  background, depois do 202) vão como `{ kind: "candidates", prompt }`, o worker devolve a
  letra escolhida e ela é gravada em `lyrics` + `lyricsSelection` na mesma escrita do `READY`
  (sdd-011). Nos dois casos a letra, ao ficar `READY`, é alinhada à curva recém-extraída (`alignmentService` com o alinhamento
  forçado do worker, ou pelas pausas quando ele não veio; sem query extra), gravando
  `alignedLyrics` + `lyricsAlignment` (com `method`) junto com a referência; `GET /:id`
  faz o backfill de músicas `READY` anteriores à sdd-007 (sem `lyricsAlignment`) na
  primeira leitura, uma vez por música (sempre pelo método por pausas: o áudio não é
  guardado). `startReference*` aceitam `{ redo }` (sdd-010): com a flag, uma referência
  `READY` volta a `PROCESSING` e melodia e letra são refeitas; sem ela, `READY` → 409. Também serve o áudio para tocar (`getAudio`),
  repassando o stream do worker. Desde a sdd-016 as extrações pedem `{ stems: true }`: o
  worker devolve, da mesma passada do Demucs, as trilhas de voz e instrumental, e
  `runReference` as grava na pasta local (`stemsRepository.save`, chave nova por referência)
  **antes** do `markReady`, que grava a `stemsKey` na mesma escrita da curva; gravar que
  falha (disco) deixa a referência `READY` sem `stemsKey` e nunca a derruba. O `claim` apaga a
  pasta da referência anterior (a chave foi zerada no mesmo `updateMany`). `getStem(id, stem)`
  abre uma trilha guardada em streaming: só `READY` com `stemsKey`; ausente ou arquivo sumido →
  `StemsNotStoredError` (404 `STEMS_NOT_STORED`), e o web cai no fluxo da sdd-013
  (`separateStems`, que continua igual).
- [`lyrics-source.service.ts`](../src/services/lyrics-source.service.ts) — coleta as letras
  candidatas de uma música nova (sdd-011): `collect(song)` consulta YouTube Music
  (`workerClient.getYtmusicSong`) e LRCLIB (`lrclibClient.find`) em paralelo
  (`Promise.allSettled`: fonte que falha só não entra; lista vazia é válida, o worker usa a
  transcrição). `lrclibCandidates` (pura) fica com as faixas a ±10 s da música, sincronizada
  antes da só em texto, no máximo 2; texto vira uma linha por linha não vazia com `startMs`
  nulo. `ytmusicCandidate` (pura) aceita `synced`/`plain`. Quem escolhe é o worker (tem a
  transcrição); constantes em `LYRICS_SOURCE_CONFIG`.
- [`youtube-suggestion.service.ts`](../src/services/youtube-suggestion.service.ts) — sugere o
  vídeo do YouTube para a referência das **músicas antigas** (sdd-008; as novas já chegam com
  o vídeo da busca). `buildQuery(song)` monta `"<artista> <título>"`
  sem parênteses, colchetes e "feat."; `rank(song, candidates)` é função pura: descarta ao
  vivo, sem duração e fora de ±10 s da letra (`DURATION_TOLERANCE_MS`), pontua marcas de
  oficial (canal "- Topic", "official audio", canal do artista/VEVO, "official", "lyric",
  duração a até 2 s) e penaliza palavras "ruins" (ao vivo, cover, karaokê, remix…) que não
  estejam no título/álbum da própria letra. Duas camadas: a 1 (pontuação ≥ 2 **e** alguma marca
  de oficial) ordenada por pontuação; a 2 pelo mais visto, com penalizados por último e, na
  mesma ordem de grandeza de visualizações, a duração exata na frente. Devolve até 5 com
  `confidence` (`none`/`low`/`medium`/`high`). `forSong(id)` orquestra repositório, worker e um
  cache em memória por música (10 min, máx. 500 entradas; falha não fica em cache); erro do
  worker → `YoutubeSearchUnavailableError`. Nunca processa nada: quem escolhe é o usuário, na
  rota de referência por YouTube. Constantes em `SUGGESTION_CONFIG`; plano em
  [`specs/sdd-008-youtube-suggestion/tasks.md`](../../../specs/sdd-008-youtube-suggestion/tasks.md).
- [`performance.service.ts`](../src/services/performance.service.ts) — nota via
  `scoringService` sobre `alignedLyrics ?? lyrics` (o `offsetMs` do jogador é ajuste fino
  sobre a letra alinhada; `lines[].startMs` do resultado é o da linha avaliada) no nível
  pedido (`difficulty`, padrão `HARD`), persistência (com `difficulty` e `rhythmScore`) e
  posição no ranking **do nível** (`rank` = nº de performances da música no mesmo nível com
  nota maior + 1), além do ranking top N por nível (`ranking(songId, difficulty, limit)`).
  Sem login: o jogador informa só um nome.
- [`lyrics-review.service.ts`](../src/services/lyrics-review.service.ts) — revisão da letra
  pelo Claude Code via MCP (sdd-012, `apps/mcp`). `list(limit)` lista as músicas `READY` em 1
  query sem curva nem evidência, ordenadas no service (`sortForReview`, puro): letra `whisper`
  primeiro, depois menor `matchedRatio`, depois mais antigas. `detail(id)` devolve a letra em
  uso (`alignedLyrics ?? lyrics`) com a `lyricsEvidence` (única leitura que a carrega):
  a transcrição do Whisper quebrada em versos (`transcriptToLines`, puro: pausa ≥ 600 ms ou
  10 palavras, como o worker) e as candidatas dos sites. `check(id, lines)` recebe a letra
  **inteira** proposta, calcula o diff verso a verso (`diffLines`, puro: LCS pelo texto
  normalizado; entre âncoras, os sem par são emparelhados na ordem como `edited`, o que sobra
  é `added`/`removed`), dá a cada verso proposto a dica de tempo do verso que ele substitui
  (`proposedHints`, puro; verso novo = vizinha ± 1 s), chama `workerClient.alignFromYoutube`
  (a atual e a proposta sobre a mesma voz) e devolve o antes/depois com o `score` por verso;
  **nada é gravado**: o resultado (`revision`, proposta, curva e alinhamento) fica em memória
  por 30 min (`REVIEW_CONFIG`, no máximo 50) sob um `checkId`. `apply(id, checkId)` realinha a
  proposta com o `alignmentService` (sem chamar o worker), acrescenta `reviewedAt` ao
  `lyricsSelection` (a `source` não muda; música antiga sem seleção ganha `lrclib`) e grava
  por `songRepository.applyLyricsReview`, condicionado à `lyricsRevision` da conferência:
  redo ou outra revisão no meio → 409 `LYRICS_CHANGED`. Sem `youtubeVideoId` (upload) → 409
  `REVIEW_NEEDS_VIDEO` (o áudio não é guardado); `checkId` desconhecido/expirado → 410;
  worker fora → 502 `ALIGN_FAILED`. Devolve o `SongDto` (`toSongDto`, exportado do
  `song.service.ts`). Plano em [`specs/sdd-012-lyrics-review-mcp/tasks.md`](../../../specs/sdd-012-lyrics-review-mcp/tasks.md).
- Plano e regras de negócio: [`specs/sdd-003-api-songs/tasks.md`](../../../specs/sdd-003-api-songs/tasks.md).

## `src/repositories/`

- **Função**: Acesso a dados: o Prisma Client ou, para as trilhas (sdd-016), a pasta local.
- **Regra**: Só consultas ao banco ou ao disco. Retorna os models do Prisma; qualquer
  transformação para DTO acontece no service. Nenhum outro módulo da API toca o sistema de
  arquivos.
- [`stems.repository.ts`](../src/repositories/stems.repository.ts) — a pasta local de trilhas
  (sdd-016): `<SONG_STEMS_DIR>/<songId>/<stemsKey>/{vocals,instrumental}.m4a`. `save` grava as
  duas com `.part` + `rename` (nenhum leitor vê arquivo pela metade) e lança se o disco
  recusar; `open(songId, key, stem)` devolve `{ stream, size, contentType }` ou `null`;
  `prune(songId, keep)` apaga as outras chaves da música (`null` = a pasta inteira) e
  `sweep(current)` apaga, no boot (`server.ts`, depois do `failOrphanedProcessing`), pastas de
  músicas sem chave e chaves que não são a atual. Apagar é sempre melhor esforço. Caminhos só
  com `songId` (uuid validado), `stemsKey` (uuid gerado pela API) e o enum `STEM_NAMES`.
- [`song.repository.ts`](../src/repositories/song.repository.ts) — consultas de `Song` com
  `select` explícito **sem** `referenceTrack` (pode passar de 400 KB); só
  `findWithReference` carrega o campo. O `select` inclui `alignedLyrics` e
  `lyricsAlignment` (sdd-007): `markReady` grava os dois junto com a curva (e, numa música
  nova, `lyrics` + `lyricsSelection`, sdd-011), `saveAlignment` faz o backfill, e
  `claimForProcessing`/`markFailed` zeram ambos e a curva (o alinhamento vale só para a
  referência atual; o claim zera também `lyricsSelection`). `findByLrclibId`, `findByLrclibIds` (busca pela letra, 1 query, sdd-015) e
  `upsertByLrclibId` (cadastro pela letra, idempotente) servem as músicas pela letra.
  `findByVideoIds` (busca pelo vídeo, 1 query
  com `OR` em `sourceVideoId`/`youtubeVideoId`), `findBySourceVideoId` e
  `createFromVideo` (cadastro com `lyrics: []`; vídeo repetido → `P2002`, que o service trata
  como "já existia") servem as músicas novas. `claimForProcessing(id, videoId, { redo })` é
  um `updateMany` condicional (status `NONE`/`FAILED`, ou `PROCESSING` há mais de
  `PROCESSING_STALE_MS` = 15 min; com `redo`, também `READY`, sdd-010): é o que garante um
  único processamento por música mesmo com requisições simultâneas.
  `failOrphanedProcessing(bootedAt)` roda no boot, em `server.ts`, **depois** do `listen` (porta
  ocupada = outra API viva → sai sem tocar no banco) e só no que começou antes de `bootedAt`;
  nunca no `app.ts`, que os testes importam. Como o processamento vive no processo da API, todo `PROCESSING` encontrado ao
  subir é órfão de um reinício ou queda e vira `FAILED` com `INTERRUPTED` (achado da sdd-011).
  Zera o mesmo que o `markFailed` e também `lyricsSelection`, mas **mantém** o
  `youtubeVideoId` (o vídeo da tentativa; só `READY` serve áudio). Pressupõe uma única
  instância da API por banco. Para a revisão da letra (sdd-012): `Song.lyricsEvidence`
  (transcrição + candidatas, até ~60 KB) só é carregada por `findForReviewDetail`; `markReady`
  a grava numa música nova e **sempre** incrementa `Song.lyricsRevision` (toda `READY` é uma
  letra nova); claim, `markFailed` e `failOrphanedProcessing` zeram a evidência;
  `findForReview()` lista as `READY` sem curva nem evidência; `applyLyricsReview(id, revision,
  data)` é um `updateMany` condicionado a `lyricsRevision = revision` e `READY`, no modelo do
  `claimForProcessing`, e incrementa a versão. Para as trilhas guardadas (sdd-016):
  `Song.stemsKey` entra no `select` e no `SongDto`; `markReady` a grava junto com a curva;
  claim, `markFailed` e `failOrphanedProcessing` a zeram; `findStemsKeys()` lista, em 1 query,
  as músicas com chave para a varredura do boot.
- [`performance.repository.ts`](../src/repositories/performance.repository.ts) — cria a
  performance, conta as melhores do mesmo nível (`countBetter(songId, difficulty, score)`) e
  lista o ranking de um nível (`findTopBySong(songId, difficulty, limit)`: nota desc, empate
  por `createdAt` asc), usando o índice `(songId, difficulty, score desc)` (sdd-009; substituiu
  `(songId, score desc)`).

## `src/clients/`

- **Função**: Integrações HTTP **externas**, no mesmo nível de `repositories/`: os services
  chamam, e os clients não conhecem a requisição de entrada. Fica separado de `repositories/`
  (só banco) e de `utils/` (sem estado de negócio nem I/O).
- **Regra**: Validar toda resposta com Zod antes de devolver; nunca repassar corpo cru.
  Timeouts explícitos em cada chamada.
- [`lrclib.client.ts`](../src/clients/lrclib.client.ts) — `search(q)` (`/api/search?q=`, a
  busca pela letra, sdd-015), `getById(id)` (`/api/get/{id}`, o cadastro pela letra; 404 →
  `null`, sem nova tentativa) e `find({ artist, title })` (`/api/search?artist_name=&track_name=`,
  as candidatas da busca pelo vídeo, sdd-011) no LRCLIB (`LRCLIB_BASE_URL`), com `User-Agent` identificando o projeto e timeout de 5 s,
  trazendo `syncedLyrics` e `plainLyrics`. Falha passageira (rede, timeout, 429, 5xx) é tentada
  de novo até 2 vezes, com 1 s e 3 s de espera (`LRCLIB_CONFIG`; o LRCLIB responde 503 com
  frequência). Esgotadas as tentativas, 4xx ou corpo inesperado →
  `LyricsProviderUnavailableError` (502, `LYRICS_UNAVAILABLE`; o `lyrics-source.service` trata
  como fonte vazia).
- [`worker.client.ts`](../src/clients/worker.client.ts) — `extract(buffer, filename, lyrics)`,
  `extractFromYoutube(videoId, lyrics)`, `alignFromYoutube(videoId, current, proposed)`
  (conferência de uma revisão da letra, sdd-012), `fetchYoutubeAudio(videoId)`,
  `separateStems(buffer, filename)` (sdd-013: `POST /stems`, devolve `WorkerStems = { stream,
  contentType, contentLength }`, só `multipart/form-data` com `boundary`; timeout 5 min),
  `searchYoutube(query)`, `searchYtmusic(query)` (sem letra) e `getYtmusicSong(videoId)`
  (metadados + letra, sdd-011)
  no worker (`WORKER_URL`, contrato em `specs/sdd-001-worker-pitch/tasks.md` §4, para o
  alinhamento da letra `specs/sdd-010-lyrics-forced-alignment/tasks.md` §4 e, para a busca,
  `specs/sdd-008-youtube-suggestion/tasks.md` §4; YouTube Music e escolha da letra em
  `specs/sdd-011-lyrics-from-video/tasks.md` §4; conferência em
  `specs/sdd-012-lyrics-review-mcp/tasks.md` §4). As extrações recebem `WorkerLyricsInput`:
  `{ kind: "known", lines }` manda `lyrics`; `{ kind: "candidates", candidates, prompt }` manda
  `lyricsCandidates` + `lyricsPrompt` (JSON; no multipart, antes do arquivo). Com
  `{ stems: true }` (sdd-016) pedem também as trilhas: o worker responde `multipart/form-data`
  com `result` (o JSON de sempre), `vocals` e `instrumental`, lido com `response.formData()`
  (as duas trilhas, ~3 MB cada, ficam em memória só nesta chamada) e devolvido em
  `WorkerExtraction.stems: WorkerStemFiles | null` (`null` na resposta JSON; parte ausente ou
  vazia → `invalid_response`). Devolvem
  `WorkerExtraction = { track, alignment, lyrics, transcript, stems }`, com o `alignment` validado por
  `forcedAlignmentSchema`, a letra escolhida por `selectedLyricsSchema` e as palavras do
  Whisper por `transcriptWordSchema` (inválidos → `invalid_response`; ausentes → `null`).
  `alignFromYoutube` devolve `WorkerAlignment = { durationMs, current, proposed }` (os dois
  alinhamentos, ou `null`), com timeout de 6 min. Toda falha vira `WorkerClientError` com um
  código (os do worker mais `timeout`, `unreachable` e `invalid_response`); quem traduz para o
  usuário é o `song.service.ts` (referência) ou o `youtube-suggestion.service.ts` (busca). O
  schema Zod da busca é tolerante de propósito: `channel`, `durationS` e `viewCount` podem
  faltar (R1 da sdd-008); só o `videoId` é estrito.

## `src/utils/`

Peças compartilhadas, sem estado de negócio:

- [`prisma.ts`](../src/utils/prisma.ts) — instância única do Prisma Client.
- [`hash.ts`](../src/utils/hash.ts) — `hash`/`compare` com bcrypt.
- [`bindex.ts`](../src/utils/bindex.ts) — blind index determinístico (HMAC-SHA256)
  para busca de e-mail. Depende da variável de ambiente `EMAIL_BINDEX_SECRET`.
- [`validators.ts`](../src/utils/validators.ts) — schemas Zod dos contratos: corpos das rotas
  de auth, os formatos compartilhados `pitchTrackSchema` (curva de pitch do worker, contrato
  em `specs/sdd-001-worker-pitch/tasks.md` §4), `lyricLineSchema` (linha do LRC),
  `lyricsAlignmentSchema` (diagnóstico do alinhamento, sdd-007; `method` opcional
  `"forced" | "onset"`, sdd-010) e `forcedAlignmentSchema`/`lineAlignmentSchema` (o
  alinhamento devolvido pelo worker, sdd-010), com os tipos `PitchTrack`, `LyricLine`,
  `LyricsAlignment` e `ForcedAlignment` inferidos, e os schemas das rotas de músicas
  (`songSearchQuerySchema`, `createSongBodySchema`, `songParamsSchema`,
  `youtubeReferenceBodySchema` com `redo` opcional, `referenceRedoSchema` para o campo
  `redo` do multipart, `performanceBodySchema` com `playerNameSchema`,
  `rankingQuerySchema`) e `difficultySchema` (`Difficulty = "EASY" | "MEDIUM" | "HARD"`,
  sdd-009; `performanceBodySchema.difficulty` e `rankingQuerySchema.difficulty` têm padrão
  `HARD`). Para a revisão da letra (sdd-012): `lyricsSelectionSchema.reviewedAt` (opcional,
  ISO), `transcriptWordSchema`/`lyricsEvidenceSchema` (`Song.lyricsEvidence`),
  `reviewListQuerySchema` (`limit` 1..50, padrão 20), `reviewCheckBodySchema` (`lines`, 1..500
  versos de até 300 caracteres) e `reviewApplyBodySchema` (`checkId` UUID).
- [`review-auth.ts`](../src/utils/review-auth.ts) — `reviewAuth(secret)` devolve o hook
  `onRequest` das rotas `/api/review/*` (sdd-012): `secret` ausente → 503 `REVIEW_DISABLED`;
  header `Authorization: Bearer` ausente ou diferente → 401 `UNAUTHORIZED`. A comparação é em
  tempo constante (`timingSafeEqual` sobre os SHA-256, para não vazar nem o tamanho); o
  segredo nunca vai para log nem para a resposta.
- [`pitch.ts`](../src/utils/pitch.ts) — matemática pura sobre curvas de pitch: `fold12`
  (diferença em semitons módulo oitava, em [-6, 6)), `median`, `findOnset` (início de voz
  numa janela de frames: o primeiro ou, com `nearFrame`, o mais próximo do alvo) e `voicedSegments` (trechos contínuos com voz, em ms, unindo
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
  `AudioProviderUnavailableError` (502, `code: "DOWNLOAD_FAILED"`),
  `MissingUploadFileError` (400) e `YoutubeSearchUnavailableError` (502,
  `code: "SEARCH_FAILED"`, sdd-008). `ReferenceNotReadyError` responde com
  `code: "REFERENCE_NOT_READY"` desde a sdd-012 (aditivo). Os da revisão da letra (sdd-012):
  `ReviewUnauthorizedError` (401, `UNAUTHORIZED`), `ReviewDisabledError` (503,
  `REVIEW_DISABLED`), `ReviewNeedsVideoError` (409, `REVIEW_NEEDS_VIDEO`),
  `ReviewCheckExpiredError` (410, `REVIEW_CHECK_EXPIRED`), `LyricsChangedError` (409,
  `LYRICS_CHANGED`) e `AlignmentUnavailableError` (502, `ALIGN_FAILED`).
- [`error-handler.ts`](../src/utils/error-handler.ts) — handler global do Fastify que traduz
  cada tipo de erro em status code + mensagem. `AppError` com `code` responde
  `{ message, code }` (o web escolhe o texto pelo `code`, nunca pelo `message`); sem `code`,
  só `{ message }` — o contrato de `/api/auth` não muda. Erros do próprio Fastify com status
  4xx (corpo acima do `bodyLimit` ou do limite do multipart → 413, JSON inválido → 400) são
  repassados com o status original; o resto vira 500. Registrado em [`app.ts`](../src/app.ts).

## `src/config/`

- [`env.ts`](../src/config/env.ts) — variáveis de ambiente validadas com Zod. Além das de
  banco e segredos: `WORKER_URL` (padrão `http://localhost:8000`), `LRCLIB_BASE_URL`
  (padrão `https://lrclib.net`) e `LYRICS_REVIEW_SECRET` (opcional, ≥ 32 caracteres; vazia
  conta como ausente, que é o que o compose passa quando não está no `.env`; sem ela a
  revisão da letra fica desligada, sdd-012) e `SONG_STEMS_DIR` (pasta das trilhas guardadas,
  sdd-016; padrão `.data/stems` na raiz do repo, relativa é resolvida contra a raiz e sai
  sempre absoluta; no compose é o volume `/data/stems`). Catálogo em `AGENTS.md` §11.
- [`cors.ts`](../src/config/cors.ts) — opções do CORS por ambiente.

## Recursos

| Recurso | Rotas | Camadas |
|---|---|---|
| Health | `GET /api/health` | `health.*` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login` | `auth.*`, `user.repository` |
| Songs | `GET /api/songs/search/lyrics` (LRCLIB, só letra sincronizada, sdd-015), `GET /api/songs/search` (YouTube Music), `POST /api/songs` (`{ lrclibId }`: fica em `NONE`, sdd-015; ou `{ videoId }`: já começa a referência), `GET /api/songs/:id`, `POST /api/songs/:id/reference/youtube`, `POST\|GET /api/songs/:id/reference`, `GET /api/songs/:id/audio`, `POST /api/songs/:id/stems` (voz e instrumental do áudio enviado, sdd-013), `GET /api/songs/:id/stems/:stem` (`vocals` \| `instrumental` guardados na preparação, sdd-016), `GET /api/songs/:id/youtube-candidates` | `song.*`, `stems.repository`, `lyrics-source.service`, `youtube-suggestion.service`, `lrclib.client`, `worker.client` |
| Performances | `POST /api/songs/:id/performances` (body `+ difficulty?`), `GET /api/songs/:id/performances?limit=&difficulty=` | `performance.*`, `song.repository`, `scoring.service` |
| Review (token de serviço, sdd-012) | `GET /api/review/songs?limit=`, `GET /api/review/songs/:id`, `POST /api/review/songs/:id/check` (`{ lines }`), `POST /api/review/songs/:id/apply` (`{ checkId }`) | `review.*`, `lyrics-review.service`, `alignment.service`, `song.repository`, `worker.client`, `utils/review-auth` |

Contratos completos (entradas, saídas e códigos de erro) em
[`specs/sdd-003-api-songs/tasks.md`](../../../specs/sdd-003-api-songs/tasks.md) §4; o nível
(`difficulty`, `rhythmScore`) em [`specs/sdd-009-difficulty-levels/tasks.md`](../../../specs/sdd-009-difficulty-levels/tasks.md) §4;
os candidatos do YouTube (`YoutubeSuggestion`) em [`specs/sdd-008-youtube-suggestion/tasks.md`](../../../specs/sdd-008-youtube-suggestion/tasks.md) §4;
a busca, o cadastro pelo vídeo e a escolha da letra (`SongSearchItem`, `lyricsSelection`) em
[`specs/sdd-011-lyrics-from-video/tasks.md`](../../../specs/sdd-011-lyrics-from-video/tasks.md) §4;
a revisão da letra (`ReviewSongSummary`, `ReviewSongDetail`, `ReviewCheck`) em
[`specs/sdd-012-lyrics-review-mcp/tasks.md`](../../../specs/sdd-012-lyrics-review-mcp/tasks.md) §4;
as trilhas separadas (`POST /:id/stems`) em
[`specs/sdd-013-singer-volume/tasks.md`](../../../specs/sdd-013-singer-volume/tasks.md) §4;
as trilhas guardadas (`stemsKey`, `GET /:id/stems/:stem`) em
[`specs/sdd-016-stems-once/tasks.md`](../../../specs/sdd-016-stems-once/tasks.md) §4.

## Como adicionar um recurso novo

1. `repositories/<recurso>.repository.ts` — as consultas ao banco.
2. `clients/<servico>.client.ts` — se o recurso fala com uma API externa.
3. `services/<recurso>.service.ts` — a regra de negócio.
4. `controllers/<recurso>.controller.ts` — validação Zod + resposta HTTP.
5. `routes/<recurso>.routes.ts` — as rotas, registradas em [`app.ts`](../src/app.ts).
