# Task: Escolher só o vídeo e a letra vir sozinha (várias fontes + Whisper)

- **Slug:** lyrics-from-video
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** api 2.0.0 (major: busca e cadastro mudam de contrato) · web 0.5.0 · worker 0.3.0
- **App afetado:** ambos + worker
- **Tipo de mudança:** breaking-change
- **Impacto público (schema/API/UI contract):** breaking (`GET /api/songs/search` e `POST /api/songs` mudam de forma; `Song.lrclibId` vira opcional; campos novos no `Song`, no `SongDto` e no contrato do worker)

## 1. Contexto e Motivação
- Hoje a pessoa escolhe a música **duas vezes**: a letra na busca do LRCLIB
  (`song.service.ts:209-218`, só letra sincronizada) e depois o vídeo na preparação (sdd-008).
  Música sem letra **sincronizada** no LRCLIB nem entra: `create` lança
  `SongWithoutSyncedLyricsError` (`song.service.ts:232-233`), mesmo quando o LRCLIB tem a letra
  em texto (ex.: Tim Bernardes, "Meus 26", "Olha", "Talvez": só `plainLyrics`, consulta de
  2026-09-26). Essa regra vem de antes da sdd-010; desde então o tempo de cada verso vem do
  alinhamento forçado (MMS_FA) sobre a voz, não do LRC.
- Pedido do usuário (2026-09-26), `specs/tasks.txt` item 11: "acho que dá pra simplificar isso"
  e "pegar músicas novas BR como de Tim Bernardes que o LRCLIB não tem".
- Spike de 2026-09-26 (`apps/worker/scripts/transcribe_spike.py`, 8 músicas do banco de dev,
  Mac ARM, `whisper-large-v3-turbo` via `mlx-whisper`): WER mediano **8 %** (7–9 % em pt e en
  com voz limpa, inclusive ao vivo), 19 % no rap-rock (Papercut: versos colados num trecho só),
  72 % na voz embolada (Smells Like Teen Spirit, que nem o MMS_FA alinha com a letra certa);
  9–42 s de Whisper por música. No Tempo Perdido o LRC do LRCLIB é de outra gravação e a
  transcrição acertou o que é cantado. LLM para gerar/corrigir letra foi **descartado** na
  conversa: letra de memória esbarra em direitos autorais, versão errada e invenção.
- Decisões do usuário (2026-09-26): (1) a busca passa a ser **só YouTube Music**; o LRCLIB vira
  fonte de letra nos bastidores; (2) escolher o resultado **já começa o processamento**;
  (3) sem letra de site que combine, a letra do Whisper é usada **para cantar e no ranking,
  com aviso** na tela.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §clients: toda integração HTTP passa por `clients/` com Zod
    (`lrclib.client.ts`, `worker.client.ts`); a coleta de letras entra por esses clientes.
  - `apps/api/docs/arquitetura.md` §services: regra pura sem repositório (modelo do
    `scoring.service.ts` e do `alignment.service.ts`); a escolha da letra roda no worker
    (tem a transcrição) e a API só orquestra e grava.
  - `apps/worker/app/main.py:98-106` (`_extract_sync`): a voz isolada já está em memória para o
    crepe e o MMS_FA; o Whisper entra no mesmo ponto, sem segunda separação.
  - `apps/worker/app/ytmusic.py` + `POST /ytmusic/search` (`main.py:252-257`): busca no YouTube
    Music com letra licenciada (LyricFind/Musixmatch) já existe como experimento; vira contrato.
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`, "Telas → componentes"): lista da busca
    em `.ct-song-row` (já com miniatura), avisos em `.ct-alert--warning`/`--info`, um único
    `ct-btn--primary` por tela.

## 2. Escopo
- **Inclui**
  - **Etapa 0 (go/no-go) antes do resto**: portar o spike para `faster-whisper` (o backend de
    produção, §3) e medir nas 8 músicas do spike + 3 do Tim Bernardes: WER, escolha da letra
    (§5 regra 6) com as fontes reais, tempo do Whisper em CPU e pico de RAM do worker com os
    quatro modelos carregados. Critério no §6. Resultado no `apps/worker/README.md`.
  - **Worker**
    - `app/transcription.py`: `load()` e `transcribe(mono_44k, prompt) -> Transcript`
      (`faster-whisper`, modelo `large-v3-turbo` int8 em CPU, `word_timestamps`,
      `condition_on_previous_text=False`, `vad_filter`).
    - `app/lyrics_selection.py` (funções puras): normalização por palavra, WER com backtrace,
      escolha entre candidatas, dica de `startMs` por linha a partir da transcrição e quebra
      da transcrição em versos.
    - `POST /extract` e `POST /youtube/extract` aceitam `lyricsCandidates` (alternativo a
      `lyrics`) e devolvem `lyrics` (a letra escolhida) + `alignment` sobre ela.
    - `POST /ytmusic/search` ganha `withLyrics` (padrão `true`; a busca da API manda `false`).
    - `POST /ytmusic/song` (novo): metadados + letra de um `videoId`.
    - `GET /health` ganha `models.whisper`; Dockerfile baixa os pesos no build; dependência
      `faster-whisper` (via skill `latest-deps`).
  - **API**
    - Busca (`GET /api/songs/search`) pelo YouTube Music (worker), sem letra na resposta,
      anexando o estado local por vídeo em 1 query.
    - Cadastro (`POST /api/songs { videoId }`): metadados pelo worker, idempotente por
      `sourceVideoId`, e **começa o processamento na mesma chamada** (regra 3).
    - Processamento de música nova: coleta as candidatas (LRCLIB por artista/título/duração,
      aceitando texto sem tempo; YouTube Music pelo `videoId`), manda ao worker, grava a letra
      escolhida em `lyrics` + diagnóstico em `lyricsSelection` e alinha como hoje.
    - Prisma: `lrclibId` opcional, `sourceVideoId` único, `lyricsSelection` (migration).
  - **Web**
    - Busca com os resultados do YouTube Music (miniatura do vídeo); escolher cadastra e abre a
      preparação já em "Preparando".
    - Preparação de música nova: sem abas de fonte nem sugestão de vídeo; em `FAILED`,
      "Tentar de novo" (mesmo vídeo) e envio de arquivo; aviso de letra automática quando
      `lyricsSelection.source === "whisper"`.
  - Testes (pytest, Vitest da API e do web), lint, docs (`arquitetura.md`, README do worker,
    `AGENTS.md` §2/§11, `CHANGELOG.md`).
- **Exclui**
  - Migrar as músicas já cadastradas pelo LRCLIB: continuam com a letra delas, a sugestão de
    vídeo (sdd-008) e o fluxo atual. "Refazer melodia e letra" nelas segue mandando `lyrics`.
  - Remover a rota `GET /:id/youtube-candidates` e o `youtube-suggestion.service` (só as
    músicas antigas usam; limpeza numa sdd futura).
  - Fallback de busca pelo `yt-dlp` quando o YouTube Music falha (§8, R3).
  - LLM (gerar, corrigir ou quebrar letra em versos).
  - Editar a letra na tela; tempo por palavra na tela; Vagalume/Letras.mus.br.
  - GPU/MLX em produção: o worker roda em CPU (Docker Linux e Mac, mesmo código).

## 3. Impacto Arquitetural

Camadas afetadas: worker (`app/`), API (`routes`, `controllers`, `services`, `repositories`,
`clients`, `utils/validators.ts`, `prisma/schema.prisma`), web (`components/`, `lib/`). Sem DI:
módulos importados diretamente, como hoje (`arquitetura.md`, topo).

Arquivos novos:
- `apps/worker/app/transcription.py`, `apps/worker/app/lyrics_selection.py`
- `apps/worker/tests/test_lyrics_selection.py`, `apps/worker/tests/test_transcription.py` (sem modelo)
- `apps/api/src/services/lyrics-source.service.ts` (coleta das candidatas; `collect` + funções puras)
- `apps/api/src/tests/songs/songs.search.spec.ts` (reescrito), `songs.create-video.spec.ts`,
  `apps/api/src/tests/lyrics/lyrics-source.service.spec.ts`
- `apps/web/lib/lyrics-source.ts` + `apps/web/tests/lyrics-source.spec.ts`
- migration `apps/api/prisma/migrations/<ts>_song_source_video/`

Backend do Whisper: **`faster-whisper`** (CTranslate2, int8) em Mac e Linux. O spike usou
`mlx-whisper`, que só existe no Mac ARM; dois backends dobrariam o código e os testes. A
Etapa 0 mede se o CPU aguenta (§6); se não, o modelo cai para `small` antes de pensar em outro
backend. `mlx-whisper` sai do grupo `spike` ao fim da Etapa 0.

Fluxo (música nova):

```
web: busca "tim bernardes tanto faz"
  └─ GET /api/songs/search?q=…
       song.controller → songService.search
         ├─ workerClient.searchYtmusic(q, { withLyrics:false }) ─► worker POST /ytmusic/search
         └─ songRepository.findByVideoIds(ids)  (1 query: sourceVideoId OU youtubeVideoId)
web: clica num resultado
  └─ POST /api/songs { videoId }
       songService.createFromVideo
         ├─ songRepository.findBySourceVideoId ── existe? devolve (200) e não reprocessa
         ├─ workerClient.getYtmusicSong(videoId) ─► worker POST /ytmusic/song (metadados)
         ├─ songRepository.createFromVideo  (lyrics: [], lrclibId: null)
         └─ startReferenceFromYoutube(id, videoId)  → 201 { SongDto PROCESSING }
                └─ runReference (background)
                     ├─ lyricsSourceService.collect(song)            (em paralelo, falhas ignoradas)
                     │    ├─ lrclibClient.find(artist, title, duração) → synced ou plain
                     │    └─ workerClient.getYtmusicSong(videoId).lyrics
                     └─ workerClient.extractFromYoutube(videoId, { candidates })
                          worker: download → Demucs → crepe
                                  → Whisper(voz, prompt "artista - título")
                                  → lyrics_selection.choose(candidatas, transcrição)
                                  → MMS_FA(letra escolhida)
                          ◄─ { PitchTrack, lyrics: SelectedLyrics, alignment }
                     ├─ alignmentService.align(lyrics.lines, track, alignment)   (como hoje)
                     └─ songRepository.markReady({ …, lyrics, lyricsSelection })
web: polling de GET /api/songs/:id até READY (como hoje)
```

## 4. Contratos e Interfaces

### Prisma (`apps/api/prisma/schema.prisma`, model `Song`) — migration nova
```prisma
/// Id da faixa no LRCLIB. Só nas músicas cadastradas pela busca do LRCLIB (antes da sdd-011).
lrclibId        Int?     @unique
/// Vídeo escolhido na busca (sdd-011): identidade das músicas novas, cadastro idempotente por ele.
/// Nulo nas músicas antigas. Não muda depois do cadastro (o `youtubeVideoId` é o da tentativa).
sourceVideoId   String?  @unique
/// LyricLine[]. Música antiga: a letra do LRCLIB. Música nova: vazia até READY; depois, a letra
/// escolhida pelo worker, com `startMs` de dica (LRC, YouTube Music ou transcrição).
lyrics          Json
/// LyricsSelection (sdd-011): de onde veio a letra e o quanto ela combina com o que é cantado.
/// Nulo nas músicas antigas e até a primeira referência READY de uma música nova.
lyricsSelection Json?
```
Sem backfill: `lyricsSelection` nulo = letra do LRCLIB escolhida pela pessoa (fluxo antigo).

### Zod / tipos (`apps/api/src/utils/validators.ts`)
```ts
export const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const createSongBodySchema = z.object({ videoId: youtubeVideoIdSchema }); // BREAKING: era { lrclibId }

export const lyricsSourceSchema = z.enum(["lrclib", "ytmusic", "whisper"]);
export type LyricsSource = z.infer<typeof lyricsSourceSchema>;

/** Uma candidata avaliada pelo worker; `wer` nulo se a transcrição veio vazia. */
export const lyricsCandidateScoreSchema = z.object({ source: lyricsSourceSchema.exclude(["whisper"]), wer: z.number().min(0).nullable() });

export const lyricsSelectionSchema = z.object({
  source: lyricsSourceSchema,
  /** WER da escolhida contra a transcrição (0 = igual); nulo quando `source` é "whisper". */
  wer: z.number().min(0).nullable(),
  candidates: z.array(lyricsCandidateScoreSchema),
});
export type LyricsSelection = z.infer<typeof lyricsSelectionSchema>;

/** Resposta do worker (sdd-011): a letra escolhida, linha a linha, com `startMs` de dica. */
export const selectedLyricsSchema = lyricsSelectionSchema.extend({
  lines: z.array(z.object({ text: z.string(), startMs: z.number().int().nonnegative() })).max(500),
});
```

### DTOs (`song.service.ts`)
```ts
/** BREAKING: era por lrclibId. Um resultado do YouTube Music. */
export interface SongSearchItem {
  videoId: string;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number | null;
  songId: string | null;              // música já cadastrada (por sourceVideoId ou youtubeVideoId)
  referenceStatus: ReferenceStatus | null;
}

export interface SongDto {
  // …campos atuais…
  lrclibId: number | null;            // BREAKING: era number
  sourceVideoId: string | null;       // novo
  lyricsSelection: LyricsSelection | null; // novo
}
```
Consumidor impactado: `apps/web` (`lib/types.ts`, `lib/api.ts`, `components/song-search.tsx`,
`components/song-prep.tsx`). Nenhum outro cliente da API existe.

### Rotas da API
| Rota | Antes | Depois |
|---|---|---|
| `GET /api/songs/search?q=` | LRCLIB, `SongSearchItem` por `lrclibId` | YouTube Music, `SongSearchItem` por `videoId`; 502 `YoutubeSearchUnavailableError` se o worker falhar |
| `POST /api/songs` | `{ lrclibId }` → 201/200 | `{ videoId }` → 201 (criada, já `PROCESSING`) / 200 (existia, sem reprocessar); 502 se o YouTube Music não achar o vídeo (`VideoMetadataUnavailableError`, nova) |
| demais | — | inalteradas; `POST /:id/reference{,/youtube}` numa música nova usam candidatas em vez de `lyrics` |

### Clientes (`apps/api/src/clients/`)
```ts
// lrclib.client.ts — schema ganha plainLyrics
lrclibClient.find(query: { artist: string; title: string }): Promise<LrclibTrack[]>; // GET /api/search?artist_name=&track_name=

// worker.client.ts
type WorkerLyricsInput =
  | { kind: "known"; lines: LyricLine[] }                    // música antiga (como hoje: campo `lyrics`)
  | { kind: "candidates"; candidates: WorkerLyricsCandidate[] };// música nova (campo `lyricsCandidates`)
interface WorkerLyricsCandidate { source: "lrclib" | "ytmusic"; lines: { text: string; startMs: number | null }[] }
interface WorkerExtraction { track: PitchTrack; alignment: ForcedAlignment | null; lyrics: SelectedLyrics | null }
workerClient.extract(audio, filename, lyrics: WorkerLyricsInput): Promise<WorkerExtraction>;
workerClient.extractFromYoutube(videoId, lyrics: WorkerLyricsInput): Promise<WorkerExtraction>;
workerClient.searchYtmusic(query: string): Promise<WorkerYtmusicSong[]>;   // withLyrics: false
workerClient.getYtmusicSong(videoId: string): Promise<WorkerYtmusicSong>;  // metadados + letra
```

### Serviço novo (`services/lyrics-source.service.ts`)
```ts
export const LYRICS_SOURCE_CONFIG = { lrclibMaxCandidates: 2, durationToleranceMs: DURATION_TOLERANCE_MS } as const;
/** Puro: faixas do LRCLIB → candidatas (synced via parseLrc; plain por linha, startMs null). */
export function lrclibCandidates(tracks: LrclibTrack[], song: { durationMs: number }): WorkerLyricsCandidate[];
/** Puro: letra do YouTube Music → candidata (null em status none/error ou sem linhas). */
export function ytmusicCandidate(lyrics: WorkerYtmusicLyrics): WorkerLyricsCandidate | null;
export const lyricsSourceService = {
  /** LRCLIB e YouTube Music em paralelo (Promise.allSettled): fonte que falha só não entra. */
  collect(song: Pick<SongSummary, "artist" | "title" | "durationMs" | "sourceVideoId">): Promise<WorkerLyricsCandidate[]>;
};
```

### Worker (`apps/worker/app/schemas.py`)
```python
class LyricsCandidate(BaseModel):
    source: Literal["lrclib", "ytmusic"]
    lines: list[LyricsLine]                     # startMs opcional (letra só em texto)

class SelectedLyrics(BaseModel):
    source: Literal["lrclib", "ytmusic", "whisper"]
    wer: float | None
    candidates: list[CandidateScore]            # { source, wer }
    lines: list[LyricsLine]                     # startMs sempre preenchido (dica)

class YoutubeRequest(BaseModel):  # + lyricsCandidates: list[LyricsCandidate] | None = None
class ExtractResponse(PitchTrack):  # + lyrics: SelectedLyrics | None = None
class YtmusicSearchRequest(BaseModel):  # + withLyrics: bool = True
class YtmusicSongRequest(BaseModel): videoId: str
```
- `lyrics` e `lyricsCandidates` juntos → 400 `invalid_lyrics`. No multipart do `/extract`,
  `lyricsCandidates` é um campo de texto JSON, como `lyrics` hoje.
- Com `lyricsCandidates` (inclusive lista vazia) a resposta sempre traz `lyrics`; `alignment`
  é sobre `lyrics.lines` (mesmo tamanho).
- `POST /ytmusic/song`: `YtmusicSong`; vídeo sem correspondente no YouTube Music → 422
  `video_unavailable`; falha da `ytmusicapi` → 502 `search_failed`.
- `GET /health`: `models.whisper`.

### Funções puras do worker (`app/lyrics_selection.py`)
```python
def words(text: str) -> list[str]                                   # NFKD, minúsculas, [a-z0-9], por palavra
def wer(ref: list[str], hyp: list[str]) -> float                    # (sub + del + ins) / len(ref)
def choose(candidates: list[LyricsCandidate], transcript: Transcript) -> SelectedLyrics
def hint_starts(lines: list[LyricsLine], transcript: Transcript) -> list[int]   # startMs por linha
def transcript_lines(transcript: Transcript) -> list[LyricsLine]    # quebra em versos
```

### Web (`apps/web/lib/`)
- `types.ts`: espelha `SongSearchItem`, `SongDto` (`lrclibId | null`, `sourceVideoId`,
  `lyricsSelection`), `LyricsSelection`.
- `api.ts`: `createSong(videoId: string)`.
- `lyrics-source.ts`: `lyricsSourceNotice(selection: LyricsSelection | null): Notice | null`
  (puro; `whisper` → aviso; site → nada).

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Busca no LRCLIB, só letra sincronizada (`song.service.ts:209-218`) | Busca no YouTube Music (filtro "songs"), até 8 resultados, sem letra; resultado já cadastrado mostra o estado | Usuário, decisão 1 |
| 2 | Cadastro idempotente por `lrclibId` | Idempotente por `sourceVideoId` (upsert); música antiga com `youtubeVideoId` igual ao resultado aparece como já cadastrada e o clique abre ela | Usuário, "escolher uma vez" |
| 3 | Referência só com clique na preparação (sdd-008) | Cadastro novo já faz o claim e começa (`202` interno → `201` com `PROCESSING`); se já existia, não reprocessa | Usuário, decisão 2 |
| 4 | Letra obrigatoriamente sincronizada (`song.service.ts:232`) | Música nova aceita letra só em texto de qualquer fonte; o tempo sempre vem do MMS_FA | sdd-010 + usuário |
| 5 | — | Candidatas: até 2 do LRCLIB (duração a ≤ 10 s da música; synced antes de plain) + a do YouTube Music (se `synced`/`plain`). Fonte que falha ou demora é ignorada; o LRCLIB é tentado de novo até 2 vezes em falha passageira (rede, 429, 5xx: 503 em 4 de 11 músicas na Etapa 0) | Spike + `DURATION_TOLERANCE_MS` |
| 6 | — | Escolha no worker: menor WER contra a transcrição; aceita se `wer ≤ MAX_WER` (0,35, calibrado na Etapa 0); empate (±0,02) → `ytmusic` antes de `lrclib`. Nenhuma aceita (ou nenhuma candidata) → a transcrição vira a letra (`source: "whisper"`) | Spike (Tempo Perdido) |
| 7 | — | Transcrição vazia (sem palavras) e nenhuma candidata → `lyrics.lines` vazio; a referência fica `READY` e a tela mostra "sem letra" (a nota de afinação continua) | Consequência da regra 6 |
| 8 | — | Letra `whisper` canta e entra no ranking normalmente, com aviso na preparação | Usuário, decisão 3 |
| 9 | `startMs` da letra = LRC | `startMs` da letra escolhida = LRC/YouTube Music quando a candidata tem tempo; senão, o início da 1ª palavra da linha casada na transcrição; linha sem casamento herda a vizinha + 1 s. Serve de dica para o `*` do MMS_FA e para o `alignForced` preencher as recusadas | `alignment.service.ts` (`alignForced`) |
| 10 | — | Versos da transcrição: quebra por pausa ≥ 600 ms entre palavras ou a cada 10 palavras (calibrar na Etapa 0) | Spike (Papercut) |
| 11 | `DURATION_MISMATCH` compara com a duração do LRCLIB | Música nova compara com a duração do YouTube Music (mesmo vídeo → só falha por vídeo trocado/cortado) | `song.service.ts:177` |
| 12 | Redo (sdd-010) reenvia a letra | Música nova: redo coleta as candidatas de novo (a letra pode mudar); música antiga: como hoje | sdd-010 |
| 13 | Upload de arquivo como referência | Continua; numa música nova o `/extract` recebe as candidatas, como o YouTube | sdd-003 |
| 14 | `PROCESSING` só sai por `READY`/`FAILED` do próprio processamento; reinício da API no meio deixa a música presa (a tela não oferece ação em `PROCESSING`) | **Achado durante a implementação (2026-09-26, "Chão de Giz" preso após o `tsx watch` reiniciar).** No boot da API (`server.ts`, depois do `listen`, nunca no `app.ts`), `songRepository.failOrphanedProcessing(bootedAt)` marca todo `PROCESSING` anterior à subida como `FAILED` com o código novo `INTERRUPTED` (migration), mantendo `youtubeVideoId` e `sourceVideoId` para refazer. Rede de segurança na tela: `PROCESSING` com `referenceUpdatedAt` (novo no `SongDto`, aditivo) há mais de 15 min (`PROCESSING_STALE_MS`, o mesmo do claim) mostra "A preparação parece ter travado" + "Tentar de novo" (nova: o vídeo da busca; antiga: as abas de fonte). Pressupõe uma instância da API por banco | Bug do processamento em background (`song.service.ts`, `runReference`) |

## 6. Critérios de Aceitação
- **Etapa 0 (go/no-go), antes do resto**: com `faster-whisper` `large-v3-turbo` int8 em CPU no
  Mac, nas 8 músicas do spike + 3 do Tim Bernardes:
  - WER mediano ≤ 12 % nas músicas com voz limpa (spike com MLX: 8 %);
  - a regra 6 escolhe uma letra de site em ≥ 90 % das músicas que têm letra em alguma fonte, e
    nunca escolhe a letra de outra música;
  - Whisper ≤ 90 s por música de 3–4 min; pico de RAM do worker (Demucs + crepe + MMS_FA +
    Whisper carregados) ≤ 7 GB; ponta a ponta ≤ 6 min.
  - Se o tempo ou a RAM estourarem: repetir com `small`/`medium`. Se o WER passar de 20 % com o
    modelo que cabe: **no-go**, parar e voltar ao usuário.
- **Busca** responde em ≤ 3 s (sem letra por resultado) e faz 1 query no banco para anexar
  o estado (`findMany` com `OR` em `sourceVideoId`/`youtubeVideoId`), sem N+1.
- **Cadastro** concorrente do mesmo vídeo (duplo clique, duas abas) cria 1 música e 1
  processamento: upsert por `sourceVideoId` + `claimForProcessing` atômico que já existe.
- `markReady` grava `lyrics`, `lyricsSelection`, `alignedLyrics`, `lyricsAlignment` e a curva
  numa escrita só (como hoje); `claimForProcessing` zera `lyricsSelection` junto do alinhamento.
- `SongDto` nunca carrega `referenceTrack`; `lyrics` de música nova é `[]` até `READY`.
- Músicas antigas (`lrclibId` preenchido) continuam idênticas: busca por link direto, sugestão
  de vídeo, refazer, cantar e ranking (testes existentes passam sem mudança de expectativa,
  salvo a forma de `SongDto`).
- Worker: `lyrics` + `lyricsCandidates` juntos → 400 `invalid_lyrics`; candidatas malformadas
  → 400 `invalid_lyrics`; falha do Whisper → `lyrics` com a primeira candidata (sem transcrição
  não há como comparar) e `wer: null`, nunca 500 (mesma política do alinhador na sdd-010).
- Segurança: só o `videoId` validado (regex de 11 caracteres) chega à API e ao worker; a
  consulta ao LRCLIB usa artista/título vindos do YouTube Music, não texto livre; nada de
  letra ou áudio fica em disco no worker.
- Compatibilidade: api 2.0.0 (major), web 0.5.0, worker 0.3.0; `CHANGELOG.md` com a entrada
  **BREAKING** da busca e do cadastro.

## 7. Plano de Testes
- **Worker (pytest, sem rede e sem modelo)**
  - `lyrics_selection`: `words` (acentos, pontuação, apóstrofo); `wer` (igual = 0, inserção,
    remoção, vazio); `choose` com transcrição sintética: candidata certa ganha, letra de outra
    versão com mesmo texto ganha, letra de outra música perde para `whisper`, empate prefere
    `ytmusic`, sem candidatas → `whisper`, transcrição vazia → primeira candidata com
    `wer: null`; `hint_starts` (com e sem tempo, linha sem casamento); `transcript_lines`
    (pausa, limite de palavras).
  - `main`: `/youtube/extract` e `/extract` com `lyricsCandidates` (transcrição e alinhador
    falsos via `monkeypatch`), com `lyrics` + `lyricsCandidates` → 400, candidatas inválidas
    → 400; `/ytmusic/search` com `withLyrics=false` não chama `lyrics()`; `/ytmusic/song`
    (ok, não achado, falha); `/health` com `whisper`.
  - `-m slow`: Whisper real numa voz curta sintética (só carrega e não quebra).
- **API (Vitest, `apps/api/src/tests/`, banco de teste com `helpers/database.ts`)**
  - `lyrics-source.service.spec.ts`: `lrclibCandidates` (duração fora da tolerância, synced
    antes de plain, máximo 2, plain vira linhas com `startMs` null), `ytmusicCandidate`
    (none/error → null), `collect` com LRCLIB fora do ar e YouTube Music fora do ar (a outra
    entra).
  - `songs.search.spec.ts`: worker mockado; estado anexado por `sourceVideoId` e por
    `youtubeVideoId` de música antiga; worker fora → 502; `q` inválido → 400.
  - `songs.create-video.spec.ts`: 201 + `PROCESSING` + worker chamado com `lyricsCandidates`;
    segundo POST → 200 sem novo processamento; `videoId` inválido → 400; YouTube Music sem o
    vídeo → 502; ao terminar, `lyrics`/`lyricsSelection` gravados e `alignedLyrics` calculado;
    `source: "whisper"` gravado quando o worker devolve a transcrição.
  - Regressão: `songs.reference*.spec.ts`, `songs.get.spec.ts` e performances com música antiga
    (`lrclibId`) continuam passando; `worker.client` com e sem `lyrics` na resposta.
  - Regra 14 (achado na implementação), `songs.interrupted.spec.ts`: `failOrphanedProcessing`
    marca só `PROCESSING` (NONE, READY e FAILED intocados), com `INTERRUPTED`, mantém o
    `youtubeVideoId` e devolve a contagem; depois dele `POST /:id/reference/youtube` aceita a
    música; `SongDto.referenceUpdatedAt` em ISO (nulo sem referência).
- **Web (Vitest em `apps/web/tests/`)**: `lyrics-source.spec.ts` (`whisper` → aviso; `lrclib`,
  `ytmusic` e `null` → nada); `reference-status.spec.ts` (`isProcessingStale`: dentro e fora dos
  15 min, sem data, data ilegível); copy do `INTERRUPTED` em `reference-errors.spec.ts`.
- **Manual/Smoke**: `pnpm dev`; buscar "Tim Bernardes Tanto Faz" → clicar → preparação abre em
  "Preparando" → `READY` com letra do YouTube Music → cantar; buscar uma música antiga já
  cadastrada → abre a existente; uma música sem letra em site (ou forçar sem candidatas) →
  aviso de letra automática.
- **Lint/testes**: `pnpm --filter web lint`, `pnpm --filter web test`, `pnpm --filter api test`,
  `pnpm --filter api build`, `uv run pytest` no worker.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Whisper em CPU (Docker Linux) lento demais | média | processamento passa de 6 min | Etapa 0 mede; `large-v3-turbo` int8 → `small`; timeout do `youtubeExtract` (12 min) já cobre |
| R2. RAM com 4 modelos residentes | média | worker morto por OOM | Etapa 0 mede; se passar de 7 GB, carregar o Whisper sob demanda e liberar depois de cada extração (mais lento, mas cabe) |
| R3. `ytmusicapi` é API não oficial e quebra sem aviso | média | **a busca inteira para** (é a única) | Erro vira 502 com mensagem clara; atualizar a lib resolve na maioria das vezes; fallback pelo `yt-dlp` (`/youtube/search`) fica como sdd futura se acontecer |
| R4. Resultado do YouTube Music sem a música (independentes, versões ao vivo) | baixa | música não encontrada | Mensagem "tente outro nome"; música antiga continua acessível pelo link; fallback do R3 |
| R5. Escolha errada da letra (WER baixo por acaso, letras parecidas) | baixa | letra de outra música | Limiar calibrado na Etapa 0; `lyricsSelection.candidates` guarda os WERs para depurar; redo refaz |
| R6. Transcrição inventa texto em trecho sem voz | média | versos fantasmas na letra automática | `vad_filter`, `condition_on_previous_text=False`; versos com probabilidade média < 0,4 descartados (calibrar) |
| R7. Letra de site com anotações ("[Refrão]", "(2x)") | média | WER maior e verso "cantado" que não existe | `words` ignora trechos entre colchetes; linha só de anotação vira instrumental (sem texto alinhável) |
| R8. Direitos das letras | — | — | Projeto pessoal e não comercial (memória do projeto); letras não são redistribuídas: ficam no banco local |
| R9. Dependência nova `faster-whisper` + pesos (~1,6 GB) na imagem | certa | imagem maior | Baixar no build (como o MMS_FA); versão atual via skill `latest-deps` |

Dependências: `faster-whisper` (worker, 1.2.1 em 2026-09-26; instalar com `uv add`);
`ytmusicapi` já instalado; nenhuma dependência nova na API nem no web.

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma — as três decisões de produto foram respondidas pelo usuário em 2026-09-26, §1)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou o código (`caminho:linha`).
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva, com go/no-go da Etapa 0.
- [x] Mudança em schema Prisma e contratos públicos marcada como **breaking**, com migration, bump major da API e CHANGELOG planejados.
- [x] Perguntas em aberto foram exauridas.
