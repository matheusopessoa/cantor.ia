# Task: Preparação e karaokê mais rápidos: Demucs uma vez só (trilhas guardadas numa pasta local) e worker na GPU do Mac

- **Slug:** stems-once
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** minor em cada app sobre a vigente (hoje api 2.3.0 → 2.4.0 · web 0.7.0 → 0.8.0 · worker 0.6.1 → 0.7.0). MCP sem mudança.
- **App afetado:** ambos + worker
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (campo novo no `Song` e no `SongDto`, rotas novas `GET /api/songs/:id/stems/vocals` e `GET /api/songs/:id/stems/instrumental`, campo opt-in `stems` no worker, campo `device` no `/health` do worker, variáveis de ambiente novas `SONG_STEMS_DIR` e `WORKER_DEVICE`; nada removido)
- **Revisão (2026-09-26):** as trilhas guardadas saem por dois GETs de arquivo (não por um multipart montado pela API); §1 ganhou a conta de onde o tempo vai; R6 (árvore sem commit) saiu, a branch está commitada; a GPU do Mac (MPS) **entrou nesta sdd** como Etapa B, para o Demucs e o MMS_FA (medições em §8; o crepe fica em CPU porque não ganha nada). O usuário pediu um plano só para toda a otimização.

Duas etapas independentes, no mesmo plano porque têm o mesmo objetivo (tempo) e o mesmo
arquivo central do worker (`main.py`); podem ser commitadas separadas (B primeiro, é a menor):
- **Etapa A — Demucs uma vez só**: a preparação devolve as trilhas, a API guarda, o karaokê toca
  delas. Acelera o "Cantar" (de 1–2 min para segundos) e tira o segundo Demucs da fila.
- **Etapa B — worker na GPU do Mac**: Demucs e MMS_FA rodam em `mps` quando disponível.
  Acelera a preparação (de ~85 s para ~45 s numa música de 3:33, estimativa das medições).

## 1. Contexto e Motivação
- Hoje cada música passa **duas vezes** pelo Demucs e pelo download do YouTube: na preparação
  (`/youtube/extract` ou `/extract`: download + `separation.vocals`, 54–94 s), depois na tela de
  karaokê o áudio é baixado de novo (`GET /api/songs/:id/audio` → worker `/youtube/audio`) e
  mandado de volta para separar (`POST /api/songs/:id/stems` → worker `/stems` →
  `separation.stems`, outro Demucs). O segundo Demucs usa a mesma fila única do worker
  (`apps/worker/app/main.py`, `_extraction_lock`) e atrasa a preparação de outra música que
  entre na fila (observado em 2026-09-26: "A Balada de Tim Bernardes" levou 2 min 50 s).
- Onde o tempo vai hoje (medido no `apps/worker/README.md`, Mac ARM em CPU, música de 3:33):
  preparação 72 s + ~10 s do alinhador (download ~2 s, Demucs ~51 s, crepe 20–33 s, MMS_FA
  ~10 s). Ao clicar em "Cantar" pela primeira vez num aparelho: download de novo (~2 s, até
  2 min quando o YouTube recusa) + upload do áudio à API + Demucs (50–95 s) + ~2 s de AAC, e
  tudo isso na fila única do worker. **Esta sdd zera essa segunda parte** (vira dois GETs locais
  de ~3 MB cada) e tira o segundo Demucs da fila. **A Etapa A sozinha não encurta a
  preparação**: o Demucs continua rodando uma vez, e o custo extra é ~2 s de AAC. Quem encurta
  a preparação é a **Etapa B**: neste Mac (M5, torch 2.14) o Demucs em `mps` é 3,7× mais rápido
  que em CPU e o MMS_FA, 2,2× (medições em §8); o crepe `tiny` não ganha nada em `mps` (5,9 s
  vs 5,5 s em 60 s de áudio) e fica em CPU. Estimativa para a música de 3:33 do README: Demucs
  51 → ~14 s, MMS_FA 10 → ~5 s, crepe igual (20–33 s), AAC +2 s → ~45 s em vez de ~85 s.
- Pedido do usuário (2026-09-26): "e não daria pra o Demucs rodar só uma vez?" → entre as
  opções apresentadas, escolheu **o servidor guardar as trilhas**: "pode salvar os áudios numa
  pasta local, esse negócio só vai rodar no meu PC mesmo".
- Isso **derruba** a regra 13 da `specs/sdd-003-api-songs/tasks.md` (o servidor não guarda
  áudio) e a decisão "separar na hora" da `specs/sdd-013-singer-volume/tasks.md` §1, que pedia a
  confirmação do usuário, agora dada. O projeto roda numa máquina só (memória do projeto).
- Rastreabilidade:
  - `apps/worker/app/separation.py`: `stems(wav)` já devolve voz e `instrumental = mix − voz` em
    estéreo numa passada; a voz mono do crepe é a média do mesmo stem `vocals` que `vocals(wav)`
    calcula. Uma passada serve às duas coisas.
  - `apps/worker/README.md` (Etapa 0 da sdd-013): formato das trilhas já decidido, AAC `.m4a`
    estéreo 44,1 kHz 112 kbps, mesmo número de amostras; `audio.encode_aac` existe.
  - `apps/api/docs/arquitetura.md` §services (`runReference`: todo desfecho gravado, `markReady`
    numa escrita só), §repositories (acesso a dados isolado), §controllers (repasse em streaming,
    `getSongAudio`/`separateStems` são o modelo).
  - `apps/web/components/karaoke-session.tsx` (`loadAudio`, `acceptAudio`, `prepareStems`,
    `begin`) e `lib/stems-store.ts` (cache das trilhas no IndexedDB por `songId`).

## 2. Escopo
- **Inclui**
  - **Worker**
    - `/extract` e `/youtube/extract` aceitam `stems: bool = false` (opt-in; campo de
      formulário no multipart, campo JSON no `/youtube/extract`). Com `stems=true` e
      `separate=true`: **uma** passada do Demucs (`separation.stems`) dá a voz mono do crepe, do
      MMS_FA e do Whisper e as duas trilhas; a resposta vira `multipart/form-data` com as partes
      `result` (JSON, o `ExtractResponse` de hoje), `vocals` e `instrumental` (AAC `.m4a`, o
      formato do `/stems`). Sem `stems` (ou com `separate=false`): JSON como hoje.
    - O worker continua sem guardar nada: as trilhas só existem no tmp da requisição (limpo
      depois do último byte, como no `/stems`).
    - `/stems` continua igual (fallback das músicas antigas).
    - **Etapa B — device.** `WORKER_DEVICE` em `app/config.py` (`auto` | `cpu` | `mps`, padrão
      `auto`: `mps` se `torch.backends.mps.is_available()`, senão `cpu`), resolvido uma vez em
      `app/device.py` (`resolve() -> str`, com log de qual foi escolhido no boot). Usado em:
      `separation.load` (`Separator(device=...)`; o `separate_tensor` já devolve tensores que o
      código passa por `.numpy()`, então acrescentar `.cpu()`), e `alignment.load`/`emissions`
      (`_model.to(device)`, `piece[None].to(device)`, `emission[0].cpu()`; o `forced_align` e o
      Viterbi da letra continuam em CPU sobre os log-probs). O crepe (`pitch.py`) e o Whisper
      local (`faster-whisper`/ctranslate2, sem MPS) ficam em CPU e não mudam. `/health` ganha
      `device`. Um `mps` pedido à mão sem estar disponível → erro claro no boot (não cai em CPU
      calado); `auto` cai em CPU com log.
  - **API**
    - Prisma: `Song.stemsKey String?` (migration). Nulo = sem trilhas guardadas.
    - `SONG_STEMS_DIR` em `config/env.ts` (padrão: `<raiz do repo>/.data/stems`), `.env.example`,
      compose (volume) e `AGENTS.md` §11; `.data/` no `.gitignore`.
    - `repositories/stems.repository.ts` (novo): a pasta local de trilhas
      (`<SONG_STEMS_DIR>/<songId>/<stemsKey>/{vocals,instrumental}.m4a`): gravar, abrir para
      leitura em streaming, apagar e varrer órfãos. Único módulo que toca o sistema de arquivos.
    - `workerClient.extract`/`extractFromYoutube` pedem `stems: true` quando a extração separa
      a voz e leem a resposta multipart (`response.formData()`), devolvendo
      `WorkerExtraction.stems: { vocals: Buffer; instrumental: Buffer } | null`.
    - `runReference`: com trilhas, grava na pasta com uma chave nova **antes** do `markReady`,
      que grava `stemsKey` na mesma escrita do `READY`. Falha ao gravar as trilhas não derruba a
      referência (fica `READY` sem trilhas).
    - `claimForProcessing`, `markFailed` e `failOrphanedProcessing` zeram `stemsKey`; a pasta da
      chave anterior é apagada depois (melhor esforço).
    - `GET /api/songs/:id/stems/vocals` e `GET /api/songs/:id/stems/instrumental` (novas): cada
      trilha como um arquivo `audio/mp4` lido da pasta em streaming, com `Content-Length`. Duas
      rotas de arquivo em vez de um multipart montado pela API: a API não precisa escrever
      multipart (hoje ela só repassa o do worker), o web baixa as duas em paralelo com a barra
      de progresso que já existe (`downloadSongAudio` lê o corpo em chunks; `formData()` não dá
      progresso) e o browser pode cachear cada arquivo.
    - No boot (`server.ts`, depois do `listen` e do `failOrphanedProcessing`): varre a pasta e
      apaga o que não é a `stemsKey` atual de nenhuma música.
    - `SongDto.stemsKey: string | null`.
  - **Web**
    - `lib/types.ts` (`stemsKey`), `lib/api.ts` (`downloadStems(id, onProgress?, signal?)`: os
      dois GETs em paralelo, progresso somado), `lib/stems-store.ts` (registro com `stemsKey`
      opcional para validar o cache).
    - Sessão de karaokê: música com `stemsKey` usa **só** as trilhas: do cache do aparelho
      (mesma `stemsKey`) ou dos dois GETs (com o progresso de download de hoje). Não baixa o
      original nem chama `POST /:id/stems`. O slider "Voz do cantor" já nasce habilitado. Sem
      `stemsKey`, ou se um dos GETs falhar: o fluxo de hoje, sem mudança.
  - Testes (pytest, Vitest da API e do web), lint, docs (`arquitetura.md`, README do worker
    incluindo a seção "Desempenho" remedida, `AGENTS.md` §2/§11, `apps/web/README.md`,
    `.env.example`, compose do worker, `CHANGELOG.md`).
- **Exclui**
  - Gerar trilhas guardadas para as músicas já prontas sem refazê-las: elas continuam no fluxo
    da sdd-013 até "Refazer melodia e letra", que passa a guardar as trilhas.
  - Fazer o `POST /:id/stems` (fallback) também guardar o resultado.
  - Guardar o áudio original (as trilhas somadas reconstroem o original: `instrumental = mix −
    voz`, sdd-013 regra 5; o slider a 100 % toca a mistura original).
  - Rota para apagar música, limite de espaço em disco, backup da pasta.
  - Mudança no MCP, na busca, na escolha da letra ou na nota.
  - crepe em `mps` (medido: sem ganho, e mudaria a curva à toa) e Whisper local em `mps`
    (ctranslate2 não suporta). Mexer em `batch_size`/`segment`/`shifts` do crepe ou do Demucs.
  - Reaproveitar a voz guardada na conferência da revisão da letra (`/youtube/align`, sdd-012),
    que hoje baixa e separa de novo a cada `check_lyrics_fix`. Candidato natural depois desta
    sdd (mandar `vocals.m4a` com `separate=false`).

## 3. Impacto Arquitetural

Camadas: worker (`app/main.py`, `app/schemas.py`; Etapa B: `app/config.py`, **novo**
`app/device.py`, `app/separation.py`, `app/alignment.py`); API (`clients/worker.client.ts`,
`services/song.service.ts`, `repositories/song.repository.ts`, **novo**
`repositories/stems.repository.ts`, `controllers/song.controller.ts`, `routes/song.routes.ts`,
`config/env.ts`, `server.ts`, `prisma/schema.prisma`); web (`components/karaoke-session.tsx`,
`lib/`). Sem DI: módulos importados diretamente (`arquitetura.md`, topo).

A pasta de trilhas é **acesso a dados**: fica em `repositories/`, ao lado dos repositórios do
Prisma, e o `arquitetura.md` §repositories passa a dizer "Prisma ou a pasta local de trilhas".
Os services não conhecem caminhos nem `fs`. O worker continua sem estado: quem guarda é a API.

```
preparação (uma vez por música)
  POST /:id/reference/youtube  →  songService.startReferenceFromYoutube → claim (stemsKey = null; apaga a pasta antiga depois)
    └─ runReference (background)
         └─ workerClient.extractFromYoutube(videoId, lyrics, { stems: true })
              worker: download → Demucs.stems (UMA passada, mps) → voz mono → crepe (cpu) → [Whisper] → MMS_FA (mps)
                                                └─ encode_aac(voz), encode_aac(instrumental)
              ◄─ multipart: result (JSON) + vocals.m4a + instrumental.m4a
         ├─ checagem de duração (como hoje)
         ├─ stemsRepository.save(songId, key, stems)      ← falhou? segue sem trilhas (log)
         └─ songRepository.markReady({ …, stemsKey: key }) ← uma escrita

karaokê
  GET /:id  →  SongDto.stemsKey
  web: stemsKey? ─ sim ─► cache do aparelho com a mesma chave? ─ não ─► GET /:id/stems/vocals ∥ GET /:id/stems/instrumental (progresso) ─► cache
                 │                                          └─ sim ─► toca voz + instrumental (sem original)
                 └─ não (ou GET falhou) ─► fluxo da sdd-013 (GET /audio + POST /stems), inalterado

boot da API
  listen → failOrphanedProcessing (zera stemsKey) → stemsRepository.sweep(chaves atuais)   (1 query)
```

## 4. Contratos e Interfaces

### Prisma (`Song`) — migration nova
```prisma
/// Trilhas (voz e instrumental) da referência atual, guardadas na pasta local
/// `SONG_STEMS_DIR/<id>/<stemsKey>/` (sdd-016). Nulo sem trilhas: músicas antigas, em
/// `PROCESSING`/`FAILED`, ou se gravar falhou. Muda a cada referência nova.
stemsKey String?
```

### Worker (`app/schemas.py`, `app/main.py`)
```python
class YoutubeRequest(BaseModel):   # + stems: bool = False
# /extract (multipart): + stems: bool = Form(False)

# stems=True e separate=True → 200 multipart/form-data; boundary aleatório; Content-Length:
#   part "result":       application/json  → ExtractResponse (o mesmo de hoje)
#   part "vocals":       audio/mp4 (vocals.m4a)
#   part "instrumental": audio/mp4 (instrumental.m4a)
# senão → 200 application/json ExtractResponse (inalterado)
def _extract_sync(path, separate, lyrics, stems: bool) -> tuple[ExtractResponse, tuple[Path, Path] | None]
```
Erros inalterados (a resposta de erro é sempre JSON `{ error, message }`).

```python
# app/config.py (Etapa B)
class Settings(BaseSettings):
    WORKER_DEVICE: Literal["auto", "cpu", "mps"] = "auto"   # vazio conta como "auto" (mesmo validador da chave)

# app/device.py (novo, Etapa B)
def resolve() -> str: ...        # "auto" → "mps" se torch.backends.mps.is_available() senão "cpu"; "mps" forçado sem MPS → RuntimeError no boot
def current() -> str: ...        # o que o boot resolveu (para o /health)

# GET /health: + "device": "cpu" | "mps"
```

### API
```ts
// config/env.ts
SONG_STEMS_DIR: z.string().min(1).default(<raiz>/.data/stems)   // caminho absoluto após resolve()

// clients/worker.client.ts
export interface WorkerStemFiles { vocals: Buffer; instrumental: Buffer }
export interface WorkerExtraction { track; alignment; lyrics; transcript; stems: WorkerStemFiles | null }
workerClient.extract(audio, filename, lyrics, { stems?: boolean }): Promise<WorkerExtraction>;
workerClient.extractFromYoutube(videoId, lyrics, { stems?: boolean }): Promise<WorkerExtraction>;
// resposta multipart: `result` validado com o mesmo Zod de hoje; partes de áudio não vazias,
// senão `invalid_response`.

// repositories/stems.repository.ts (novo; único que usa node:fs)
export const stemsRepository = {
  /** Grava as duas trilhas em <dir>/<songId>/<key>/ (arquivo .part + rename). */
  save(songId: string, key: string, stems: WorkerStemFiles): Promise<void>;
  /** Stream e tamanho de UMA trilha; null se a pasta ou o arquivo não existe. */
  open(songId: string, key: string, stem: StemName): Promise<StoredStem | null>;
  /** Apaga as chaves da música diferentes de `keep` (nulo = todas). Melhor esforço. */
  prune(songId: string, keep: string | null): Promise<void>;
  /** Boot: apaga pastas de músicas/chaves que não estão em `current`. Devolve quantas. */
  sweep(current: Map<string, string>): Promise<number>;
};
export type StemName = "vocals" | "instrumental";
export interface StoredStem { stream: Readable; size: number; contentType: "audio/mp4" }

// repositories/song.repository.ts
MarkReadyData.stemsKey?: string | null
songRepository.findStemsKeys(): Promise<{ id: string; stemsKey: string }[]>   // 1 query, só stemsKey não nulo

// services/song.service.ts
SongDto.stemsKey: string | null
songService.getStem(id: string, stem: StemName): Promise<StoredStem>   // 404 SongNotFound; 404 STEMS_NOT_STORED
// controller: `stem` vem do path e passa por z.enum(["vocals", "instrumental"]) antes de virar nome de arquivo

// utils/errors.ts
StemsNotStoredError (404, "STEMS_NOT_STORED")
```

### Rotas
| Rota | Saída | Erros |
|---|---|---|
| `GET /api/songs/:id/stems/vocals` e `GET /api/songs/:id/stems/instrumental` (novas) | 200 `audio/mp4`, `Content-Length`, streaming do disco | 400 id ou trilha inválidos; 404 música; 404 `STEMS_NOT_STORED` (sem `stemsKey` ou arquivo sumiu) |
| demais | inalteradas; `SongDto` ganha `stemsKey` | — |

### Web
```ts
// lib/types.ts: SongDto.stemsKey: string | null
// lib/api.ts
// Os dois GETs em paralelo com o leitor em chunks do `downloadSongAudio` (extraído para uma
// função interna `downloadBlob(url, onProgress, signal)`); `onProgress` recebe a soma dos dois
// (total só quando os dois mandaram Content-Length).
api.downloadStems(id: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<{ vocals: Blob; instrumental: Blob }>;
// lib/stems-store.ts: SongStems ganha `stemsKey?: string` (trilhas do servidor) ao lado do
// `sourceSize` (trilhas do fallback); função pura `storedStemsValid(cached, stemsKey)`.
```

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | O servidor não guarda áudio (sdd-003 regra 13) | A API guarda as **trilhas** da referência atual na pasta `SONG_STEMS_DIR`; o original continua não guardado | Usuário, 2026-09-26 |
| 2 | Demucs na preparação só para a voz; outro Demucs no karaokê (sdd-013) | Uma passada na preparação dá a voz do pitch/letra e as trilhas | Usuário ("rodar só uma vez") |
| 3 | — | Uma `stemsKey` por referência: `claim` zera; `markReady` grava a nova junto com a curva; a pasta da chave velha é apagada (melhor esforço; o `claim()` do service já lê a música antes do `updateMany`, a chave velha vem dali). Nunca há trilha de uma referência com a curva de outra | `arquitetura.md` §repositories (`markReady` numa escrita) |
| 4 | — | Gravar as trilhas falhou (disco cheio, permissão): a referência fica `READY` sem `stemsKey` e o karaokê usa o fallback. Nunca `FAILED` por isso | sdd-013 regra 3 (trilhas nunca travam a cantoria) |
| 5 | Karaokê baixa o original e separa por aparelho | Com `stemsKey`: só as trilhas (cache do aparelho com a mesma chave, senão os dois GETs de trilha). Sem `stemsKey` ou com falha em um GET: fluxo da sdd-013 inalterado | Usuário + sdd-013 |
| 6 | — | Duração nas rodadas só com trilhas: a do instrumental decodificado contra `song.durationMs` (mesma tolerância de hoje, `durationMatches`) | `karaoke-session.tsx` (`begin`) |
| 7 | — | Boot: pastas órfãs (sem música ou com chave antiga) são apagadas; 1 query | Máquina única (memória do projeto) |
| 8 | Referência por arquivo enviado não serve áudio (`getAudio` exige `youtubeVideoId`) | Com trilhas guardadas, a música de arquivo enviado também toca pelas trilhas (não depende do YouTube) | Consequência da regra 1 |
| 9 | Todos os modelos em CPU (`separation.py`, `alignment.py`, `pitch.py`) | Demucs e MMS_FA no device de `WORKER_DEVICE` (`auto` → `mps` no Mac, `cpu` no Docker/Linux); crepe e Whisper local sempre em CPU. Os resultados saem dos modelos já em CPU (`.cpu()`), o resto do pipeline não sabe do device | Medições em §8 |
| 10 | — | O semáforo único do worker continua com `mps`: a GPU do Mac usa a mesma RAM (16 GB) e dois Demucs em paralelo estouram do mesmo jeito | `main.py` `_extraction_lock` |

## 6. Critérios de Aceitação
- **Um Demucs por música**: na preparação com `stems`, `separation.stems` roda uma vez e
  `separation.vocals` não roda (teste com contagem); cantar uma música com `stemsKey` não chama
  `/youtube/audio` nem `/stems` (smoke: log do worker vazio durante o karaokê).
- **Tempo** (o objetivo desta sdd): "clique em Cantar → pronto para começar" na primeira vez num
  aparelho cai de download + upload + Demucs (1–2 min, mais a espera na fila do worker) para os
  dois GETs locais (~6 MB no total; esperado < 3 s). Medir e anotar o antes/depois no CHANGELOG.
  Na preparação (Etapa B), a música de 3:33 do README (hoje 72 s + ~10 s do alinhador) precisa
  ficar em **≤ 55 s** de ponta a ponta com `mps`, já incluindo os ~2 s de AAC da Etapa A;
  registrar no README do worker ("Desempenho") o tempo por etapa em `cpu` e em `mps`.
- **Qualidade com `mps`** (Etapa B, medir numa música real, a mesma em `cpu` e em `mps` via
  `WORKER_DEVICE`): a curva de pitch (`midi`) com ≥ 99 % dos frames iguais em voz/sem voz e,
  nos frames com voz, ≥ 99 % dentro de 50 cents da curva em CPU; o alinhamento com o mesmo
  `matchedRatio` (±0,02) e cada linha com início dentro de ±40 ms (2 frames do MMS_FA). Fora
  disso, o `auto` passa a escolher `cpu` e fica registrado no CHANGELOG por quê.
  **Achado da implementação (2026-09-26):** o critério pressupunha uma CPU determinística, e o
  Demucs não é (`shifts=1` no `Separator`: um deslocamento aleatório por rodada). Medido em
  "Tempo Perdido" (20 866 frames, 30 linhas): `cpu` vs `mps` deu voz/sem-voz igual em 96,9 %,
  afinação dentro de 50 cents em 99,96 %, 28/30 linhas dentro de ±40 ms (máx. 140 ms); a linha
  de base `cpu` vs `cpu` deu 97,0 %, 99,98 %, 28/30 e 140 ms. O critério válido passa a ser
  "`mps` não pior que o ruído entre duas rodadas em `cpu`", que foi atendido: `auto` fica em
  `mps`. Números e reprodução no README do worker ("Desempenho").
- **Fallback do device**: sem MPS (Docker, Linux, Mac Intel) `auto` resolve `cpu` e nada muda;
  `WORKER_DEVICE=mps` forçado sem MPS falha no boot com mensagem clara; `/health` diz o device.
- **Consistência**: `markReady` grava curva, letra alinhada e `stemsKey` numa escrita; `claim`,
  `markFailed` e `failOrphanedProcessing` zeram `stemsKey` na mesma escrita do status. Arquivos
  gravados com `.part` + `rename` (nenhum leitor vê trilha pela metade).
- **Performance**: os GETs de trilha em streaming do disco (`fs.createReadStream`, sem ler o
  arquivo inteiro em memória), 1 query cada; varredura do boot com 1 query; `SongDto` sem campo
  pesado novo.
- **Segurança**: caminho montado só com `songId` (uuid validado pelo Zod) e `stemsKey`
  (uuid gerado pela API), nunca com entrada do usuário; a pasta fica fora do `public/` e do Git
  (`.data/` no `.gitignore`).
- **Compatibilidade**: tudo aditivo; o worker só muda a resposta com `stems=true`; músicas sem
  `stemsKey` se comportam como hoje. api 2.4.0, web 0.8.0, worker 0.7.0, `CHANGELOG.md`
  registrando que a regra 13 da sdd-003 caiu e que o worker passou a usar a GPU do Mac.

## 7. Plano de Testes
- **Worker (pytest, sem rede, Demucs falso)**
  - `/youtube/extract` e `/extract` com `stems=true`: resposta multipart com `result` (mesmo JSON
    de sem `stems`), `vocals` e `instrumental` não vazios, `Content-Length` certo; o Demucs
    falso é chamado uma vez (`stems`) e o `vocals` nenhuma; tmp limpo depois.
  - Sem `stems`, ou com `separate=false`: JSON como hoje (testes atuais passam).
  - Erro (`no_voice`, `too_long`) com `stems=true`: JSON de erro, tmp limpo.
  - Etapa B (`test_config.py`, novo `test_device.py`): `WORKER_DEVICE` ausente/vazio → `auto`;
    valor fora do enum → erro de validação; `resolve()` com `torch.backends.mps.is_available`
    monkeypatched (`True` → `mps`, `False` → `cpu`; `mps` forçado sem MPS → `RuntimeError`).
    `separation.load` passa o device ao `Separator` (fake que grava o argumento);
    `alignment.emissions` move o modelo e a entrada para o device e devolve log-probs em CPU
    (fake `nn.Module` que registra `.to()` e o device da entrada). `/health` inclui `device`. A
    suíte inteira roda com `WORKER_DEVICE=cpu` forçado no `conftest.py` (como já força a chave
    da OpenAI ausente), para o resultado não depender da máquina.
  - Etapa B, manual e uma vez (`-m slow` não cobre): a mesma música de 3:33 do README com
    `WORKER_DEVICE=cpu` e `=mps`, comparando `midi` e `alignment` pelos critérios de §6
    (script em `scripts/`, ao lado do `plot_track.py`, que chama o `/youtube/extract` duas vezes
    e imprime os números).
- **API (Vitest)**
  - `clients/worker.client.spec.ts`: resposta multipart → `stems` preenchido; JSON → `stems: null`;
    multipart sem `result` ou com parte vazia → `invalid_response`; o corpo pede `stems: true`.
  - `songs/songs.stems-stored.spec.ts` (novo; `SONG_STEMS_DIR` num diretório temporário do
    teste): referência com trilhas grava os arquivos e `stemsKey`; cada GET de trilha devolve o
    arquivo com `audio/mp4` e `Content-Length` (trilha fora do enum → 400); sem trilhas → 404
    `STEMS_NOT_STORED`; arquivo apagado à mão → 404; redo zera a
    chave e apaga a pasta velha ao terminar com a nova; falha ao gravar (pasta sem permissão) →
    `READY` sem `stemsKey`; `FAILED` e `failOrphanedProcessing` zeram a chave.
  - `repositories/stems.repository` (no mesmo spec ou em `stems/`): `save` + `open`, `prune`,
    `sweep` apaga órfãos e mantém as atuais.
  - Regressão: `songs.reference*.spec.ts`, `songs.interrupted.spec.ts`, `songs.stems.spec.ts` (o
    `POST /:id/stems`) e o `SongDto` com `stemsKey`.
- **Web (Vitest, `lib/`)**: `stems-store.spec.ts` (ou o spec existente): `storedStemsValid` com
  chave igual, diferente, ausente e com registro do fallback (`sourceSize`).
- **Manual/Smoke** (`pnpm dev`): cadastrar pela letra, escolher o vídeo, `READY`; abrir "Cantar":
  "Voz do cantor" já habilitado, sem download do YouTube nem `/stems` no log do worker (só os
  dois GETs de trilha no log da API); cantar;
  "Refazer melodia e letra" → chave nova, pasta velha some; música antiga (sem `stemsKey`) segue o
  fluxo da sdd-013.
- **Lint/testes**: `uv run pytest`, `pnpm --filter api test`, `pnpm --filter api build`,
  `pnpm --filter web lint`, `pnpm --filter web test`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Disco: ~5–8 MB por música (duas trilhas AAC 112 kbps) | certa | cresce com o catálogo (1 GB ≈ 150 músicas) | Aceito pelo usuário (máquina única); chave velha apagada no redo; varredura de órfãos no boot |
| R2. Resposta do worker maior (JSON + ~6 MB) na rede local | certa | alguns segundos a mais | Só entre processos locais; timeouts atuais (10–12 min) cobrem |
| R3. Docker: a pasta precisa sobreviver ao container | média | trilhas somem a cada `up` | Volume `./.data/stems:/data/stems` no compose da API e `SONG_STEMS_DIR=/data/stems` |
| R4. Cache do aparelho com trilhas de outra referência | baixa | toca trilha errada | Registro guarda a `stemsKey`; chave diferente → baixa de novo |
| R5. Música pronta antes desta sdd não ganha trilhas | certa | continua com o segundo Demucs | Refazer a música; migrar em massa fica fora (§2) |
| R6. `response.formData()` do `fetch` do Node (20 no Docker, 22 no dev) carrega as duas trilhas em memória na API | certa | ~6 MB por extração, uma por vez | Aceito: só na chamada ao worker, nunca em rota do browser (as rotas de trilha leem do disco em streaming) |
| R7. Demucs em `mps` dá uma voz ligeiramente diferente da de CPU (numérica da GPU), e a curva do crepe muda junto | média | curva de pitch ou alinhamento diferentes do que era | Critério de qualidade em §6 medido numa música real antes de fechar; `WORKER_DEVICE=cpu` volta ao comportamento de hoje sem código |
| R8. Op do htdemucs ou do wav2vec2 sem kernel MPS numa versão futura do torch | baixa | erro ou lentidão | Medido hoje sem fallback nenhum (torch 2.14); `PYTORCH_ENABLE_MPS_FALLBACK` **não** entra no código: se um op faltar, o boot falha alto e o `WORKER_DEVICE=cpu` resolve |
| R9. Docker/Linux e Mac Intel não têm MPS | certa | nenhum: `auto` → `cpu` | O compose passa `WORKER_DEVICE=${WORKER_DEVICE:-auto}`; no container resolve `cpu` |

Dependências: nenhuma nova (o `fs` do Node, o `response.formData()` do `fetch` do Node e o
`encode_aac` do worker já existem). A branch `feat/karaoke-mvp` está commitada (8 commits sobre
`main`; só `specs/` mudado): o diff desta sdd sai limpo.

### Medições da Etapa B (2026-09-26, este Mac: M5, 16 GB, torch 2.14, MPS disponível)

Áudio sintético (seno + ruído), uma passada de aquecimento fora da conta, `PYTORCH_ENABLE_MPS_FALLBACK=1`
ligado só para detectar fallback (nenhum op caiu para a CPU, nenhum warning):

| modelo | áudio | `cpu` (hoje) | `mps` | ganho | saída `cpu` vs `mps` |
|---|---|---|---|---|---|
| Demucs `htdemucs` (`separate_tensor`) | 90 s | 19,0 s | 5,2 s | 3,7× | não medida em voz real (o sinal sintético não tem voz); é o critério de §6 |
| MMS_FA (`get_model(with_star=True)`, janelas de 20 s) | 60 s | 2,6 s | 1,2 s | 2,2× | argmax igual em 100 % dos frames; log-prob difere ≤ 1,3e-4 |
| crepe `tiny` (`torchcrepe.predict`, lote 256) | 60 s | 5,9 s | 5,5 s | nenhum | mediana 1 Hz, máx. 4,4 Hz num seno de 220 Hz |

Leitura: o Demucs é a etapa que vale (51 → ~14 s na música de 3:33); o MMS_FA é seguro e
barato de mover (10 → ~5 s); o crepe não ganha (o modelo `tiny` é pequeno demais para a GPU
compensar a cópia por lote) e mudaria a curva à toa, então fica em CPU. O Whisper local não tem
MPS. Scripts das medições: `Separator(device=...)`, `torchcrepe.predict(device=...)` e
`MMS_FA.get_model().to(device)` sobre o mesmo tensor, tempo com `perf_counter`.

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma — guardar as trilhas numa pasta local foi decidido pelo usuário em 2026-09-26, §1;
formato das trilhas já decidido na Etapa 0 da sdd-013)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o código ou a sdd de origem
      (`separation.py`, `main.py` `_extraction_lock`, `karaoke-session.tsx`, sdd-003/013).
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 preenchida de forma substantiva.
- [x] Campo Prisma novo com migration planejada; contratos só aditivos; regra 13 da sdd-003
      revogada de forma explícita.
- [x] Variáveis novas (`SONG_STEMS_DIR`, `WORKER_DEVICE`) seguem a convenção de `AGENTS.md`
      §11: schema do app + `.env.example` + compose + tabela, no mesmo commit.
- [x] Perguntas em aberto foram exauridas.
