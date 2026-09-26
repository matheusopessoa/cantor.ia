# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Cada app tem a
própria versão (`apps/api`, `apps/web`, `apps/worker`, `apps/mcp`).

## worker 0.6.1 — 2026-09-26

### Corrigido
- Whisper transcrevendo na língua errada (ex.: "I Miss You", do Blink-182, saiu em alemão e virou
  a letra, porque nenhuma letra de site combinou com a transcrição). A língua não era informada, e
  o Whisper adivinhava pelo começo do áudio. Agora `lyrics_selection.guess_language` tira a
  língua (`pt`, `es` ou `en`) das palavras típicas da letra das candidatas e ela vai como
  `language` para a OpenAI e para o Whisper local. Sem candidatas, ou com letra curta ou
  bilíngue, ele continua detectando sozinho.

## api 2.3.0 — 2026-09-26

Plano: [`specs/sdd-015-lyrics-first-search/tasks.md`](specs/sdd-015-lyrics-first-search/tasks.md).
A busca pela letra (LRCLIB) volta como caminho principal: letra sincronizada, sem transcrição,
preparação mais rápida. A busca pelo vídeo (sdd-011) fica como alternativa. Tudo aditivo.

### Adicionado
- `GET /api/songs/search/lyrics?q=`: busca no LRCLIB, só faixas com letra sincronizada (até
  20), com `songId`, `referenceStatus` e `youtubeVideoId` das já cadastradas (1 query).
- `POST /api/songs` aceita também `{ lrclibId }`: cadastro idempotente com a letra parseada, em
  `NONE` (a referência começa quando o vídeo é escolhido na preparação, sem Whisper). Faixa
  desconhecida → 404; sem letra sincronizada → 422 `NO_SYNCED_LYRICS`. Os dois campos juntos,
  ou campo a mais → 400.
- `lrclibClient.search(q)` e `getById(id)` de volta, com as novas tentativas do cliente.

### Mudado
- `LyricsProviderUnavailableError` (502) passa a responder com `code: "LYRICS_UNAVAILABLE"`.

## web 0.7.0 — 2026-09-26

Plano: [`specs/sdd-015-lyrics-first-search/tasks.md`](specs/sdd-015-lyrics-first-search/tasks.md).

### Mudado
- A busca abre na aba "Pela letra" (LRCLIB): escolher cadastra e abre a preparação, que sugere
  o vídeo. A aba "Pelo vídeo" é a busca da sdd-011. Sem resultado pela letra (ou com o LRCLIB
  fora), a tela oferece "Procurar pelo vídeo" com o mesmo texto (`lib/song-search.ts`).

## worker 0.6.0 — 2026-09-26

Plano: [`specs/sdd-014-transcription-openai/tasks.md`](specs/sdd-014-transcription-openai/tasks.md).
Transcrever a voz pela API da OpenAI, com o Whisper local de reserva. Contrato com a API igual.

### Adicionado
- `OPENAI_API_KEY` (opcional, segredo), a primeira variável de ambiente do worker:
  `app/config.py` (`pydantic-settings`, `SecretStr`; vazia conta como ausente) lê do ambiente e,
  fora do Docker, do `.env` da raiz. `.env.example` e `docker-compose.yml`
  (`${OPENAI_API_KEY:-}`) atualizados.
- `app/transcription.py` com dois provedores atrás da mesma `transcribe(mono, prompt)`:
  **`openai`** (com a chave) codifica a voz isolada em MP3 mono 16 kHz 64 kbps
  (`audio.encode_mp3`, no tmp da requisição, apagado ao fim) e chama
  `POST /v1/audio/transcriptions` com `whisper-1`, `verbose_json` e tempo por palavra e por
  segmento (`httpx`, timeout 120 s, 1 nova tentativa em rede/timeout/429/5xx); **`local`**
  (sem a chave) é o `faster-whisper` de antes.
- Filtro de invenção sem VAD: palavras de segmento com `no_speech_prob > 0,6` e
  `avg_logprob < -1,0`, ou `compression_ratio > 2,4`, saem. `Word.probability` =
  `exp(avg_logprob)` do segmento (a OpenAI não dá por palavra; é o que a sdd-012 guarda).
- `GET /health` ganha `transcription: "openai" | "local"` (provedor principal); `models.whisper`
  continua dizendo se o Whisper local está carregado.
- `scripts/transcribe_spike.py --provider openai|local`, com minutos enviados e custo estimado.
  Etapa 0 (11 músicas): WER mediano 8 % (igual ao local), letra de site escolhida em 8 de 8,
  transcrição em 7–27 s por música (local: 21–89 s), cerca de US$ 0,024 por música. Go. O pico
  de RAM medido não caiu (3,96 GB, dominado pelo Demucs e pelo MMS_FA); ver o README do worker.

### Mudado
- Com a chave, o Whisper local não carrega no boot (sem ~1,6 GB de RAM): só na primeira vez
  que a reserva é usada. Os pesos continuam na imagem Docker.
- Falha da OpenAI (rede, timeout, 5xx depois da nova tentativa, 401, resposta malformada) cai no
  Whisper local em vez de seguir sem transcrição; os dois falhando, vale a política da sdd-011
  (primeira candidata, `wer: null`). A chave nunca aparece em log: só o status e o `error.type`.
- `httpx` passa de dependência de desenvolvimento para de produção; `pydantic-settings` nova.

### Corrigido
- "O YouTube não deixou baixar" (`download_failed`) aparecia em falhas passageiras que passam
  na tentativa seguinte (403 no link do áudio, "confirm you're not a bot", conexão caída). O
  download (`youtube.download_audio`, usado pela referência, pelo áudio para tocar e pela
  conferência da sdd-012) agora tenta até 3 vezes, com 2 s e 5 s de espera, apagando o que a
  tentativa anterior deixou; cada falha vai para o log com a mensagem do `yt-dlp`. Vídeo
  indisponível, longo ou grande demais não é tentado de novo, e o cancelamento por tempo (2 min
  no total) corta a espera. Fora do plano da sdd-014, pedido do usuário em 2026-09-26.

## api 2.2.0 — 2026-09-26

Plano: [`specs/sdd-013-singer-volume/tasks.md`](specs/sdd-013-singer-volume/tasks.md).
Voz do cantor com volume próprio no karaokê. Tudo aditivo.

### Adicionado
- `POST /api/songs/:id/stems` (multipart `file`, o áudio que o browser já tem, até 20 MB):
  repassa em streaming o `multipart/form-data` do worker com os arquivos `vocals` e
  `instrumental` (AAC `.m4a`), com o `content-type` (`boundary`) e o `content-length` dele. A
  música só precisa existir (o áudio não precisa ser o da referência). Sem arquivo → 400;
  música inexistente → 404; worker fora/timeout/resposta inesperada → 502 `STEMS_UNAVAILABLE`;
  áudio recusado pelo worker → 413 `TOO_LARGE`, 415 `INVALID_AUDIO` ou 422 `TOO_LONG`. O
  servidor continua sem guardar áudio (regra 13 da sdd-003): o cache das trilhas é do aparelho.
- `workerClient.separateStems(audio, filename)` → `WorkerStems = { stream, contentType,
  contentLength }` (só aceita `multipart/form-data` com `boundary`; timeout 5 min),
  `songService.separateStems`, erros `StemsUnavailableError` e `StemsAudioRejectedError`.

## web 0.6.0 — 2026-09-26

Plano: [`specs/sdd-013-singer-volume/tasks.md`](specs/sdd-013-singer-volume/tasks.md).

### Adicionado
- Slider **"Voz do cantor"** (0–100 %, passo 5, padrão 50 %, memorizado no aparelho;
  `lib/singer-volume.ts`, `useSingerVolume`) antes e durante a cantoria. Muda o volume na hora,
  sem estalo (`setTargetAtTime`); 100 % soa como o original e 0 % deixa só o instrumental.
- Assim que o áudio da música está pronto na tela de cantar, as trilhas (voz e instrumental)
  são pedidas em segundo plano a `POST /api/songs/:id/stems` (o próprio áudio vai no pedido) e
  guardadas no IndexedDB (`lib/stems-store.ts`, store `song-stems`; o banco `cantor-ia` vai
  para a versão 2 e a abertura fica em `lib/indexed-db.ts`, compartilhada com o
  `audio-store`). Uma vez por música por aparelho; trilhas de outro áudio (`sourceSize`
  diferente) são geradas de novo. Enquanto separa, `.ct-loading` "Preparando a voz do cantor"
  no campo, com o slider desabilitado e a explicação; em falha, sem IndexedDB ou com trilhas
  fora da duração do original (±100 ms), a música toca como o original.
- Com as trilhas, a rodada toca voz e instrumental em duas `AudioBufferSourceNode` com o mesmo
  `start`, a voz por um `GainNode`; fone e segunda saída recebem a mesma mistura ajustada. O
  retorno do microfone continua só no fone. Trilhas que ficam prontas no meio de uma rodada
  valem na próxima. `api.separateStems(id, audio, signal)` lê a resposta com `formData()`.

## worker 0.5.0 — 2026-09-26

Plano: [`specs/sdd-013-singer-volume/tasks.md`](specs/sdd-013-singer-volume/tasks.md).

### Adicionado
- `POST /stems` (multipart `file`, mesmos limites do `/extract`): separa a música em voz e
  instrumental com o Demucs (`separation.stems`; `instrumental = mix − voz`, para voz +
  instrumental reconstruir o original) e responde `multipart/form-data` com os arquivos
  `vocals` e `instrumental` em AAC `.m4a` a 112 kbps (`audio.encode_aac`), em streaming, com
  `Content-Length`; o tmp é limpo depois do último byte. Dentro do semáforo de extração. Sem
  `no_voice`: música instrumental devolve voz silenciosa. Formato escolhido na Etapa 0 (ffmpeg
  e CoreAudio decodificam as duas trilhas com atraso 0 e o mesmo número de amostras; ver README).

## api 2.1.0 — 2026-09-26

Plano: [`specs/sdd-012-lyrics-review-mcp/tasks.md`](specs/sdd-012-lyrics-review-mcp/tasks.md).
Revisar a letra das músicas pelo Claude Code, via MCP. Tudo aditivo.

### Adicionado
- `Song.lyricsEvidence` (a transcrição do Whisper e as letras candidatas da última referência de
  uma música nova; nunca sai no `SongDto`) e `Song.lyricsRevision` (versão da letra: sobe a cada
  `READY` e a cada revisão aplicada), migration `20260926195515_lyrics_review`. Claim, `FAILED` e
  o boot (`INTERRUPTED`) zeram a evidência.
- `runReference` grava a evidência junto com a letra escolhida (`workerClient.extract*` passa a
  devolver `transcript`, validado por `transcriptWordSchema`).
- Recurso novo `/api/review/*`, protegido por `Authorization: Bearer <LYRICS_REVIEW_SECRET>`
  (`utils/review-auth.ts`, comparação em tempo constante; sem a variável no servidor → 503
  `REVIEW_DISABLED`, o resto da API segue): `GET /songs?limit=` (só `READY`; letra `whisper`
  primeiro, depois menor `matchedRatio`, depois mais antigas), `GET /songs/:id` (letra em uso,
  transcrição em versos e candidatas), `POST /songs/:id/check` `{ lines }` (a letra inteira
  proposta: diff verso a verso, dica de tempo por verso e conferência no áudio pelo worker,
  com o score de cada verso antes e depois; nada gravado, `checkId` válido por 30 min em
  memória) e `POST /songs/:id/apply` `{ checkId }` (grava a letra, realinha com o resultado da
  conferência, marca `lyricsSelection.reviewedAt`, incrementa a versão; só se a versão não
  mudou). `services/lyrics-review.service.ts` (`diffLines`, `proposedHints`,
  `transcriptToLines`, `sortForReview` puros; `REVIEW_CONFIG`).
- `workerClient.alignFromYoutube(videoId, current, proposed)` (timeout 6 min).
- `lyricsSelection.reviewedAt` (ISO, opcional) no `SongDto`.
- Erros `ReviewUnauthorizedError` (401 `UNAUTHORIZED`), `ReviewDisabledError` (503
  `REVIEW_DISABLED`), `ReviewNeedsVideoError` (409 `REVIEW_NEEDS_VIDEO`: referência por upload
  não tem áudio para conferir), `ReviewCheckExpiredError` (410 `REVIEW_CHECK_EXPIRED`),
  `LyricsChangedError` (409 `LYRICS_CHANGED`) e `AlignmentUnavailableError` (502
  `ALIGN_FAILED`). `ReferenceNotReadyError` passa a responder `code: "REFERENCE_NOT_READY"`.
- `LYRICS_REVIEW_SECRET` (opcional, ≥ 32 caracteres; vazia conta como ausente) em
  `config/env.ts`, `.env.example`, `apps/api/.env.test` e nos compose de dev e prod.
- `toSongDto` exportado de `song.service.ts`.

## mcp 0.1.0 — 2026-09-26

Plano: [`specs/sdd-012-lyrics-review-mcp/tasks.md`](specs/sdd-012-lyrics-review-mcp/tasks.md).

### Adicionado
- Workspace novo `apps/mcp` (TypeScript, `@modelcontextprotocol/sdk` 1.30, stdio): servidor
  `cantor` com as ferramentas `list_songs_to_review`, `get_song_lyrics`, `check_lyrics_fix` e
  `apply_lyrics_fix` (esta só depois de o usuário aprovar o antes/depois). Lê
  `NEXT_PUBLIC_API_URL` e `LYRICS_REVIEW_SECRET` do `.env` da raiz (`src/env.ts`), fala só com
  `/api/review/*` (`src/api-client.ts`; falha da API vira mensagem com status + código + o que
  fazer, nunca stack trace) e formata as respostas em texto (`src/format.ts`, puro).
  Registrado no `.mcp.json` da raiz. Limite documentado: o Claude não escreve letra de memória.
- `pnpm --filter mcp test` (Vitest, sem subir a API).

## web 0.5.1 — 2026-09-26

Plano: [`specs/sdd-012-lyrics-review-mcp/tasks.md`](specs/sdd-012-lyrics-review-mcp/tasks.md).

### Adicionado
- O aviso da letra automática diz quando ela foi revisada: "Letra gerada automaticamente e
  revisada" quando `lyricsSelection.source = "whisper"` e há `reviewedAt`
  (`lib/lyrics-source.ts`, `REVIEWED_LYRICS_COPY`). `LyricsSelection.reviewedAt?` em
  `lib/types.ts`.

## worker 0.4.0 — 2026-09-26

Plano: [`specs/sdd-012-lyrics-review-mcp/tasks.md`](specs/sdd-012-lyrics-review-mcp/tasks.md).

### Adicionado
- `ExtractResponse.transcript` (`TranscriptWord[] = [{ text, startMs, endMs, probability }]`):
  as palavras do Whisper, só com `lyricsCandidates` (lista vazia quando o Whisper falhou;
  `null` com `lyrics` conhecida).
- `POST /youtube/align` `{ videoId, separate?, current, proposed }` →
  `{ durationMs, current: Alignment | null, proposed: Alignment | null }`: baixa, isola a voz e
  alinha as duas letras com **uma** passada do wav2vec2 (`alignment.align_many`); sem crepe nem
  Whisper; dentro do semáforo; nada gravado. `current`/`proposed` malformados → 400
  `invalid_lyrics`; erros de download iguais aos do `/youtube/extract`.

## api 2.0.0 — 2026-09-26

Plano: [`specs/sdd-011-lyrics-from-video/tasks.md`](specs/sdd-011-lyrics-from-video/tasks.md).
Escolher só o vídeo: a letra vem sozinha.

### Mudado (**BREAKING**)
- `GET /api/songs/search` busca no **YouTube Music** (pelo worker), não mais no LRCLIB.
  `SongSearchItem` passa a ser `{ videoId, artist, title, album, durationMs | null, songId,
  referenceStatus }` (sai `lrclibId` e `youtubeVideoId`). Worker fora → 502 `SEARCH_FAILED`.
- `POST /api/songs` recebe `{ videoId }` (era `{ lrclibId }`): metadados pelo YouTube Music,
  idempotente por vídeo e **já começa a referência** (201 com `PROCESSING`; 200 sem
  reprocessar quando já existe). Vídeo desconhecido → 502 `VIDEO_UNAVAILABLE`.
- `SongDto.lrclibId` vira `number | null`.
- Sai `SongWithoutSyncedLyricsError` (422): letra só em texto passa a valer.

### Adicionado
- `Song.sourceVideoId` (único) e `Song.lyricsSelection` (migration `song_source_video`;
  `lrclibId` vira opcional). No `SongDto`: `sourceVideoId` e `lyricsSelection`
  (`{ source: "lrclib" | "ytmusic" | "whisper", wer, candidates }`).
- `lyrics-source.service.ts`: candidatas do YouTube Music e do LRCLIB (±10 s da música,
  sincronizada antes da só em texto, até 2), em paralelo; fonte fora do ar só não entra.
- Música nova: o worker recebe as candidatas, transcreve a voz, escolhe a letra e alinha; a API
  grava `lyrics` + `lyricsSelection` junto com a referência. Redo refaz a escolha.
- `lrclibClient.find({ artist, title })`, com até 2 novas tentativas em falha passageira (rede,
  timeout, 429, 5xx; o LRCLIB deu 503 em 4 de 11 músicas na Etapa 0); `workerClient.searchYtmusic` e `getYtmusicSong`;
  `WorkerLyricsInput` (`known` | `candidates`) nas extrações.

### Removido
- `lrclibClient.search` e `getById` (a busca e o cadastro não usam mais o LRCLIB).

### Corrigido
- Referência presa em `PROCESSING` para sempre quando a API reinicia no meio (o processamento
  vive no processo dela; em dev o `tsx watch` reinicia a cada arquivo salvo). No boot,
  `songRepository.failOrphanedProcessing()` marca essas músicas como `FAILED` com o código novo
  **`INTERRUPTED`** no enum `ReferenceErrorCode` (migration `reference_interrupted`), mantendo o
  `youtubeVideoId`.
- `SongDto.referenceUpdatedAt` (ISO 8601 ou `null`, aditivo).

Músicas já cadastradas (com `lrclibId`) continuam iguais: letra do LRCLIB, sugestão de vídeo
(sdd-008), refazer e ranking.

## web 0.5.0 — 2026-09-26

Plano: [`specs/sdd-011-lyrics-from-video/tasks.md`](specs/sdd-011-lyrics-from-video/tasks.md).

### Mudado
- Busca com os resultados do YouTube Music (miniatura do vídeo em cada linha); escolher abre a
  preparação já em "Preparando" (melodia e letra). Dica da busca: "A letra vem sozinha".
- Preparação de música nova: sem abas de fonte nem sugestão de vídeo; em falha, "Tentar de
  novo" com o vídeo da busca ou envio de arquivo. "Refazer" busca a letra de novo.
- Dev na porta **5173** (era 3000, que conflita com outros projetos; a 5000 é do AirPlay do
  macOS): `pnpm dev`, `pnpm --filter web dev`, `.claude/launch.json` e o `docker-compose.yml`
  (host 5173 → 3000 no container).

### Adicionado
- `PROCESSING` parado há mais de 15 min (pelo `referenceUpdatedAt` da API, `lib/reference-status.ts`):
  aviso "A preparação parece ter travado" e "Tentar de novo" (música nova: o vídeo da busca;
  antiga: as abas de fonte). Mensagem do erro `INTERRUPTED`: "A preparação foi interrompida".
- Aviso "Letra gerada automaticamente" quando a letra veio da transcrição da voz
  (`lib/lyrics-source.ts`).
- O aviso "Letra alinhada ao áudio" da preparação não mostra mais o deslocamento (`+0,3 s`): ele
  já está embutido na letra e era confundido com o ajuste fino da tela de cantar, que começa em
  0. Sai `formatAlignmentShift`.

## worker 0.3.0 — 2026-09-26

Plano: [`specs/sdd-011-lyrics-from-video/tasks.md`](specs/sdd-011-lyrics-from-video/tasks.md).

### Adicionado
- Transcrição da voz isolada com Whisper (`app/transcription.py`, `faster-whisper`
  `large-v3-turbo` int8 em CPU, tempo por palavra; pesos baixados no build da imagem).
- Escolha da letra (`app/lyrics_selection.py`): `POST /extract` e `/youtube/extract` aceitam
  `lyricsCandidates` + `lyricsPrompt` e devolvem `lyrics` (a candidata de menor WER contra a
  transcrição, até 0,35; empate prefere o YouTube Music; nenhuma → a transcrição em versos),
  com o `alignment` sobre ela. `lyrics` + `lyricsCandidates` juntos → 400 `invalid_lyrics`.
- `POST /ytmusic/song` (metadados e letra de um vídeo); `withLyrics` no `/ytmusic/search`;
  `models.whisper` no `/health`.
- `scripts/transcribe_spike.py`: go/no-go da Etapa 0 (Whisper + escolha com as fontes reais).

### Corrigido
- Corpo inválido no `/ytmusic/search` respondia 415 `invalid_audio`; agora 400 `invalid_query`
  (e `invalid_video_id` no `/ytmusic/song`).

## worker 0.2.0 — 2026-09-26

Planos: [`specs/sdd-008-youtube-suggestion/tasks.md`](specs/sdd-008-youtube-suggestion/tasks.md)
e [`specs/sdd-010-lyrics-forced-alignment/tasks.md`](specs/sdd-010-lyrics-forced-alignment/tasks.md).

### Adicionado
- (sdd-010) Alinhamento forçado da letra sobre a voz isolada (`app/alignment.py`):
  `torchaudio.pipelines.MMS_FA` (wav2vec2 multilíngue, alfabeto romanizado) + `forced_align`
  (CTC), na mesma passada do Demucs, em janelas de 20 s, frame de 20 ms. Sem dependência nova;
  o checkpoint de 1,2 GB é baixado uma vez (no build da imagem Docker).
- (sdd-010) `POST /extract` (campo multipart `lyrics`, JSON) e `POST /youtube/extract` (`lyrics`
  no corpo) aceitam a letra (`[{ text, startMs? }]`) e devolvem `alignment: { version: 1,
  model: "mms_fa", frameMs: 20, lines: [{ index, startMs, endMs, score }] }` (um item por linha,
  na ordem) ou `null`. Sem `lyrics` a resposta é a de antes mais `alignment: null`.
- (sdd-010) Erro `400 invalid_lyrics` (JSON de `lyrics` malformado). `GET /health` inclui
  `models.mms_fa`. `scripts/align_spike.py` mede o alinhador em músicas reais (resultado do
  go/no-go no README).
- (sdd-010) O `*` (áudio não transcrito) entra antes de linha que vem depois de um intervalo
  > 4 s no LRC e no fim da letra, com log-prob fixa −2 em vez do 0 do torchaudio (que engolia o
  começo da linha seguinte). Falha do alinhador devolve `alignment: null` em vez de 500: a curva
  de pitch continua valendo e a API cai no método por pausas.
- `POST /youtube/search` `{ query }` → `{ candidates: YoutubeCandidate[] }`: até 15 resultados
  do `ytsearch` do yt-dlp (`extract_flat`, sem download, nada em disco) com `videoId`,
  `title`, `channel`, `durationS`, `viewCount` e `isLive`. Roda fora do semáforo de extração,
  com 20 s de timeout.
- Códigos de erro `invalid_query` (400) e `search_failed` (502).

## api 1.3.0 — 2026-09-26

Planos: [`specs/sdd-009-difficulty-levels/tasks.md`](specs/sdd-009-difficulty-levels/tasks.md),
[`specs/sdd-008-youtube-suggestion/tasks.md`](specs/sdd-008-youtube-suggestion/tasks.md)
e [`specs/sdd-010-lyrics-forced-alignment/tasks.md`](specs/sdd-010-lyrics-forced-alignment/tasks.md).

### Adicionado
- (sdd-008) `GET /api/songs/:id/youtube-candidates` → `YoutubeSuggestion`
  `{ query, confidence, candidates[≤5] }`: a API monta a consulta a partir de artista e título
  do LRCLIB, busca no worker, descarta candidatos fora de ±10 s da duração da letra, ao vivo e
  sem duração, e ranqueia em duas camadas (marcas de oficial primeiro; sem oficial, o mais
  visto com a duração certa, com ao vivo/cover/karaokê por último). Cada candidato traz
  `score`, `tier` e `reasons` (`TOPIC_CHANNEL`, `OFFICIAL_AUDIO`, `ARTIST_CHANNEL`,
  `LYRIC_VIDEO`, `OFFICIAL`, `MOST_VIEWED`, `EXACT_DURATION`). Não muda o status da música;
  o resultado fica em cache em memória por 10 min por música. 404 música inexistente; 502
  `{ code: "SEARCH_FAILED" }` quando o worker falha.
- (sdd-008) `workerClient.searchYoutube(query)` (timeout 25 s), `YoutubeSearchUnavailableError`
  e `services/youtube-suggestion.service.ts` (`buildQuery`, `rank` puro, `SUGGESTION_CONFIG`).
- Três níveis de nota (`Difficulty`: `EASY`, `MEDIUM`, `HARD`) em `scoringService.score(…,
  { offsetMs, difficulty })`, com limiares de afinação e pesos por nível em
  `SCORING_CONFIG.levels`: difícil 50/100 cents e 0,5 afinação + 0,5 tempo; médio 100/200
  cents e 0,5 afinação + 0,25 tempo + 0,25 ritmo; fácil sem afinação, 0,5 tempo + 0,5 ritmo.
- `rhythmScore` (0..10): F1 entre a presença de voz cantada e a da referência com folga de
  ±150 ms, calculado em todos os níveis. `ScoreResult` ganha `rhythmScore` e `difficulty`.
- `Performance.difficulty` (enum, padrão `HARD`) e `Performance.rhythmScore` (padrão 0);
  índice `(songId, difficulty, score desc)` no lugar de `(songId, score desc)` (migration
  `20260926044912_add_performance_difficulty`).
- `POST /api/songs/:id/performances` aceita `difficulty` (padrão `HARD`) e devolve
  `difficulty` e `rhythmScore`; `GET /api/songs/:id/performances` aceita `?difficulty=`
  (padrão `HARD`). Rankings e `rank` passam a ser por música **e** nível. Mudança aditiva:
  clientes antigos continuam no difícil.
- `difficultySchema` em `utils/validators.ts`.
- (sdd-010) Alinhamento da letra pelo texto: `workerClient.extract*` envia `song.lyrics` ao
  worker e devolve `{ track, alignment }`; `alignmentService.align(lines, track, forced)` aceita
  cada linha com texto pela confiança do worker (`score ≥ 0,4`) e pela duração (≤ 20 s), leva as
  aceitas para onde são cantadas e dá às recusadas e instrumentais o deslocamento da vizinha
  aceita, sem mudar a velocidade da letra. Menos da metade aceita → `aligned: false`. Sem
  `alignment` do worker, o método por pausas da sdd-007 continua como fallback.
  `FORCED_CONFIG`, `forcedAlignmentSchema`, `lineAlignmentSchema` e `lyricsAlignmentMethodSchema`.
- (sdd-010) `lyricsAlignment.method` (`"forced" | "onset"`) no `SongDto`; ausente nos registros
  anteriores. Com `forced`, `shiftMs` é a mediana de (alinhado − original), só para diagnóstico.
- (sdd-010) Flag `redo` para refazer uma referência `READY` (melodia e letra): `POST
  /:id/reference/youtube` aceita `{ url, redo?: boolean }` e `POST /:id/reference` o campo
  multipart `redo` (`"true"`, antes do arquivo). Sem a flag, `READY` continua 409; `PROCESSING`
  recente continua 409 mesmo com ela. O claim zera `referenceTrack` junto com o alinhamento.
- (sdd-010) Código `invalid_lyrics` do worker (traduzido para `INTERNAL`: é bug, não erro do
  usuário).

### Alterado
- **Os pesos do difícil (nível padrão) mudaram de 0,7 afinação + 0,3 tempo para 0,5/0,5.**
  Notas novas e antigas do difícil não são comparáveis; as performances gravadas antes desta
  versão recebem `HARD` e `rhythmScore = 0` e mantêm a nota original (não há recálculo; o
  `sungTrack` guardado permite um recálculo em lote no futuro).

### Corrigido
- Nota de tempo: a entrada de cada verso passa a ser o onset **mais próximo** do instante da
  linha dentro da janela de ±800 ms, não o primeiro. O fim do verso anterior costuma chegar à
  janela com falhas curtas de detecção, e cada "reinício" desses era tomado como a entrada,
  com delta de −500 a −800 ms (numa gravação real, o tempo subiu de 7,7 para 8,6 com o mesmo
  áudio). `findOnset(track, from, to, minRun, nearFrame?)` em `utils/pitch.ts` ganha o alvo
  opcional; sem ele, continua devolvendo o primeiro.

## web 0.4.0 — 2026-09-26

Planos: [`specs/sdd-009-difficulty-levels/tasks.md`](specs/sdd-009-difficulty-levels/tasks.md)
e [`specs/sdd-010-lyrics-forced-alignment/tasks.md`](specs/sdd-010-lyrics-forced-alignment/tasks.md).

### Adicionado
- Retorno do microfone no fone durante a sessão de karaokê: a voz volta somada à música por um
  `GainNode` (fora do worklet, não afeta a detecção de pitch). Slider "Sua voz no fone" (0–100 %,
  0 desliga) antes e durante a cantoria, memorizado no dispositivo (`cantor.ia:monitor-volume`,
  padrão 70 %).
- Segunda saída da música: campo "Tocar a música também em" (antes de cantar) toca só a música,
  ao mesmo tempo, em outro aparelho (caixa de som, TV) via `MediaStreamAudioDestinationNode` +
  `<audio>.setSinkId`; o retorno da voz continua só na saída padrão (o fone). Memorizado no
  dispositivo (`cantor.ia:second-output`); some nos browsers sem `setSinkId` (Safari).
- Escolha "Fácil | Médio | Difícil" na preparação da música (`.ct-tabs`), memorizada no
  dispositivo (`cantor.ia:difficulty`, padrão Médio) e enviada em cada performance; o
  ranking mostrado é o do nível escolhido, com o nível no título.
- Feedback ao vivo com os limiares do nível (PERFECT ≤ 50 / GOOD ≤ 100 cents no difícil;
  100 / 200 no médio). No fácil o HUD mostra "Ritmo", o feedback vira ON TIME / MISS e o
  highway mostra presença de voz em barras, não curvas de afinação.
- Resultado com os medidores do nível (fácil: Tempo e Ritmo; médio e difícil: Afinação e
  Tempo) e o nível no rótulo da nota. `PerformanceResult` espelha `rhythmScore` e
  `difficulty`.
- Design system: `.ct-meter--rhythm`, `.ct-hit--ontime` e a copy dos níveis no readme e na
  vitrine.
- `lib/difficulty.ts`, `useDifficulty` em `lib/use-prefs.ts`, `DIFFICULTY_THRESHOLDS`,
  `presenceHit` e `hitForCents(cents, thresholds)` em `lib/pitch.ts`.
- (sdd-010) Botão "Refazer melodia e letra" na música pronta: por YouTube reenvia o mesmo vídeo
  com `redo`; por arquivo reabre o envio. O aviso "Letra alinhada ao áudio" diz se o alinhamento
  foi verso a verso (`method: "forced"`) ou pelas entradas da voz. `lib/types.ts` espelha
  `LyricsAlignment.method`; `lib/api.ts` aceita `{ redo }` em `setReferenceFromYoutube` e
  `uploadReference`.
- (sdd-008, plano em [`specs/sdd-008-youtube-suggestion/tasks.md`](specs/sdd-008-youtube-suggestion/tasks.md))
  A preparação com referência `NONE`/`FAILED` busca os candidatos do YouTube ao montar, sem
  bloquear a página ("Procurando o áudio oficial…"). Com confiança alta/média, o melhor
  candidato aparece numa TV com selos e "Usar este vídeo"; até 4 alternativas com "Usar"; o
  link colado e o upload viram "Outro vídeo ou arquivo". Com confiança baixa, o campo manual
  vem primeiro e os candidatos viram "Talvez seja um destes". Nunca processa sem clique:
  escolher um candidato chama a rota atual de referência por YouTube. Se a busca falhar
  (`SEARCH_FAILED`), aviso "Não achamos o vídeo sozinhos" e o campo manual.
- `components/youtube-candidates.tsx` (`useYoutubeSuggestion`, `YoutubeCandidates`),
  `api.getYoutubeCandidates`, `YoutubeSuggestion`/`YoutubeCandidateDto` em `lib/types.ts`,
  `candidateBadges`, `formatViews` e `youtubeWatchUrl` em `lib/youtube.ts`, copy do
  `SEARCH_FAILED` em `lib/reference-errors.ts`.

### Corrigido
- O ajuste fino da letra é guardado por música **e por versão da letra**
  (`cantor.ia:offset:<id>` para a original, `cantor.ia:offset:<id>:aligned` para a alinhada):
  um ajuste feito sobre o LRC original deixava de fazer sentido quando a música ganhava
  alinhamento, mas continuava sendo aplicado à letra e à nota de tempo (um +0,8 s esquecido
  derrubou o tempo de 7,7 para 2,0). Com a letra alinhada, o slider agora volta a 0.
- O campo do ajuste ganha o botão "Zerar" quando está fora de 0 e a dica avisa que a nota de
  tempo cobra a entrada dos versos já deslocados. `useLyricsOffset(songId, aligned)`,
  `loadOffsetMs`/`saveOffsetMs` com `aligned` e `offsetStorageKey` em `lib/lyrics-offset.ts`.

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
