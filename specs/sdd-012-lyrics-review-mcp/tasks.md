# Task: Revisar a letra das músicas pelo Claude Code, via MCP

- **Slug:** lyrics-review-mcp
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** api 2.1.0 · worker 0.4.0 · web 0.5.1 · mcp 0.1.0 (novo; tudo aditivo)
- **App afetado:** api + worker + web (aviso) + `apps/mcp` (novo)
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (campos novos no `Song`, rotas novas em `/api/review/*` protegidas por token, rota nova e campo novo no worker, variável de ambiente nova; nada removido)

## 1. Contexto e Motivação
- Na Etapa 0 da sdd-011, quando nenhum site tem a letra, ela vira a transcrição do Whisper, com
  erros de palavra (Christina Perri 12 %, Papercut 37 % e versos colados no rap). Revisão
  automática por LLM pago e scraping do Vagalume foram descartados pelo usuário (custo por API;
  "o problema do scraping é a manutenção").
- Pedido do usuário (2026-09-26), `specs/tasks.txt` item 12: "tem como fazer um MCP entre você
  e o sistema? pra você corrigir detalhes da letra". Quem revisa é o Claude no Claude Code, sob
  demanda, com o usuário aprovando cada gravação.
- Hoje não dá: o worker descarta a transcrição e as candidatas depois de escolher
  (`apps/worker/app/main.py`, `_select_lyrics`); a API não guarda a confiança por verso do
  alinhamento (só `alignedLyrics` + diagnóstico, `song.service.ts`, `toAlignmentData`); não há
  rota de edição da letra; e realinhar exige refazer a referência inteira (`redo`, sdd-010).
- Limite combinado: o Claude **não escreve letra inteira de memória** (direitos autorais);
  corrige pontos com base na transcrição, nas letras dos sites e no score do áudio.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §routes/§controllers: recurso novo em
    `routes → controllers → services → repositories`, sem DI; proteção por token num
    `onRequest` do plugin de rotas (a API não tem autenticação nessas rotas hoje).
  - `apps/api/docs/arquitetura.md` §clients: a chamada nova ao worker entra por
    `worker.client.ts`, validada com Zod.
  - `apps/api/docs/arquitetura.md` §repositories: `claimForProcessing` é o modelo de escrita
    atômica condicional; `applyLyricsReview` segue o mesmo padrão (`updateMany` com versão).
  - `AGENTS.md` §11: variável nova segue a convenção (`LYRICS_REVIEW_SECRET`, `_SECRET` ≥ 32,
    gerada pelo `pnpm env:init`).
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`): o aviso de letra usa o `.ct-alert`
    que já existe (sdd-011); nenhum componente novo.

## 2. Escopo
- **Inclui**
  - **Worker**
    - `ExtractResponse.transcript` (com `lyricsCandidates`): as palavras do Whisper com tempo e
      probabilidade, para a API guardar como evidência.
    - `POST /youtube/align` (novo): `{ videoId, current: LyricsLine[], proposed: LyricsLine[] }`
      → baixa, isola a voz (Demucs) e alinha **as duas** versões com o MMS_FA sobre as mesmas
      emissões (uma passada do wav2vec2); sem crepe nem Whisper. Dentro do semáforo.
  - **API**
    - Prisma: `lyricsEvidence` (transcrição + candidatas, fora do `SongDto`) e
      `lyricsRevision` (versão da letra, para a gravação atômica). Migration.
    - `runReference` (sdd-011) grava a evidência junto com a letra escolhida e incrementa a versão.
    - Recurso novo `review` em `/api/review/*`, protegido por `Authorization: Bearer
      <LYRICS_REVIEW_SECRET>`: listar músicas para revisar, ler a letra com a evidência,
      conferir uma proposta no áudio e aplicar a proposta conferida.
    - `workerClient.alignFromYoutube`; `LYRICS_REVIEW_SECRET` em `config/env.ts`,
      `.env.example` e `AGENTS.md` §11.
  - **MCP** (`apps/mcp`, workspace pnpm novo, TypeScript, `@modelcontextprotocol/sdk`, stdio):
    ferramentas `list_songs_to_review`, `get_song_lyrics`, `check_lyrics_fix`,
    `apply_lyrics_fix`; lê `NEXT_PUBLIC_API_URL` e `LYRICS_REVIEW_SECRET` do `.env` da raiz;
    registrado no `.mcp.json` da raiz. Instruções de uso no `README.md` do app.
  - **Web**: o aviso da letra automática diz quando ela foi revisada (`lyricsSelection.reviewedAt`).
  - Testes (pytest, Vitest da API, do MCP e do web), lint, docs (`arquitetura.md`, README do
    worker, `AGENTS.md` §1/§2/§4/§11, `CHANGELOG.md`).
- **Exclui**
  - Tela de edição de letra no web (a revisão é pelo Claude Code).
  - Revisão automática sem pedido (nada roda sozinho; é sempre o usuário pedindo no Claude Code).
  - Tempo por palavra na tela; recalcular notas e ranking já gravados (regra 9).
  - Evidência para as músicas já cadastradas: só existe para referências feitas depois desta
    sdd (as antigas podem ser revisadas, mas sem transcrição; `redo` gera a evidência).
  - Música cuja referência veio de upload (sem `youtubeVideoId`): a conferência precisa do áudio,
    que não é guardado → 409 (regra 6).
  - Autenticação de usuário na API (fica o token de serviço só para `/api/review`).

## 3. Impacto Arquitetural

Arquivos novos:
- `apps/api/src/routes/review.routes.ts`, `controllers/review.controller.ts`,
  `services/lyrics-review.service.ts`, `utils/review-auth.ts` (hook `onRequest`)
- `apps/api/src/tests/review/*.spec.ts`
- `apps/worker/tests/test_align_route.py` (ou casos em `test_api.py`)
- `apps/mcp/` — `package.json`, `tsconfig.json`, `src/server.ts` (registro das ferramentas),
  `src/api-client.ts` (HTTP para `/api/review`), `src/env.ts` (lê o `.env` da raiz, Zod),
  `src/format.ts` (texto das respostas, puro), `tests/*.spec.ts`, `README.md`
- `.mcp.json` na raiz
- migration `apps/api/prisma/migrations/<ts>_lyrics_review/`

Sem DI em nenhum app: módulos importados diretamente (`arquitetura.md`, topo).

Fluxo (uma revisão):

```
usuário no Claude Code: "revisa a letra da Christina Perri"
  Claude ─ list_songs_to_review ─► MCP ─ GET /api/review/songs ─► lista (whisper primeiro)
  Claude ─ get_song_lyrics(id) ──► MCP ─ GET /api/review/songs/:id
                                        └─ versos (texto, tempo, score) + transcrição + candidatas
  Claude monta a proposta (lista completa de versos) e mostra ao usuário
  Claude ─ check_lyrics_fix(id, lines) ► MCP ─ POST /api/review/songs/:id/check   (~1–2 min)
                                        └─ lyricsReviewService.check
                                             ├─ workerClient.alignFromYoutube(videoId, current, proposed)
                                             │    worker: download → Demucs → MMS_FA ×2 (mesmas emissões)
                                             ├─ diff verso a verso + score antes/depois
                                             └─ guarda o resultado em memória (checkId, 30 min)
  Claude mostra antes/depois; usuário aprova
  Claude ─ apply_lyrics_fix(id, checkId) ► MCP ─ POST /api/review/songs/:id/apply
                                        └─ alignmentService.align(proposed, track, alinhamento conferido)
                                           songRepository.applyLyricsReview (updateMany where lyricsRevision = N)
```

## 4. Contratos e Interfaces

### Prisma (`Song`) — migration nova
```prisma
/// LyricsEvidence (sdd-012): a transcrição do Whisper e as letras candidatas da última
/// referência de uma música nova, para a revisão pelo MCP. Nunca vai para o SongDto.
lyricsEvidence  Json?
/// Versão da letra (sdd-012): incrementa a cada READY e a cada revisão aplicada. A revisão só
/// grava se a versão não mudou desde a conferência (sem sobrescrever um redo no meio).
lyricsRevision  Int      @default(0)
```

### Zod / tipos (`utils/validators.ts`)
```ts
export const transcriptWordSchema = z.object({ text: z.string(), startMs: int≥0, endMs: int≥0, probability: z.number().min(0).max(1) });
export const lyricsEvidenceSchema = z.object({
  transcript: z.array(transcriptWordSchema).max(20_000),
  candidates: z.array(z.object({ source: z.enum(["lrclib", "ytmusic"]), lines: z.array(z.object({ text: z.string(), startMs: int≥0 | null })) })),
});
/** lyricsSelection ganha `reviewedAt` opcional (ISO) — aditivo. */
export const lyricsSelectionSchema = …extend({ reviewedAt: z.iso.datetime().optional() });

export const reviewListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
export const reviewCheckBodySchema = z.object({ lines: z.array(z.string().trim().max(300)).min(1).max(500) });
export const reviewApplyBodySchema = z.object({ checkId: z.uuid() });
```

### Rotas (prefixo `/api/review`, todas com `Authorization: Bearer <LYRICS_REVIEW_SECRET>`)
| Rota | Resposta |
|---|---|
| `GET /songs?limit=` | `ReviewSongSummary[]` = `{ id, artist, title, lyricsSource, matchedRatio, lines, reviewedAt }`, só `READY`, ordem: `whisper` primeiro, depois menor `matchedRatio` |
| `GET /songs/:id` | `ReviewSongDetail` = `{ id, artist, title, youtubeVideoId, lyricsRevision, selection, lines: [{ index, text, startMs }], transcriptLines: [{ text, startMs }] \| null, candidates: [{ source, lines: string[] }] \| null }` |
| `POST /songs/:id/check` `{ lines }` | `ReviewCheck` = `{ checkId, expiresAt, lines: [{ index, text, startMs, score, change: "same" \| "edited" \| "added", before?: { text, score } }], removed: [{ text, score }], summary: { edited, added, removed, meanScoreBefore, meanScoreAfter } }` (síncrona, até ~3 min) |
| `POST /songs/:id/apply` `{ checkId }` | `SongDto` atualizado |

Erros: sem token/token errado → 401 (`UNAUTHORIZED`); `LYRICS_REVIEW_SECRET` ausente no
servidor → `/api/review/*` responde 503 (`REVIEW_DISABLED`), o resto da API segue normal;
música não `READY` → 409 `REFERENCE_NOT_READY`; sem `youtubeVideoId` → 409
`REVIEW_NEEDS_VIDEO`; `checkId` desconhecido/expirado → 410 `REVIEW_CHECK_EXPIRED`; letra
mudou desde a conferência → 409 `LYRICS_CHANGED`; worker fora → 502 `ALIGN_FAILED`.

`transcriptLines` é a transcrição em versos (mesma quebra por pausa da sdd-011), montada pela
API a partir das palavras guardadas, para o Claude ler sem 2 000 palavras soltas.

### Env (`config/env.ts`, `.env.example`, `AGENTS.md` §11)
`LYRICS_REVIEW_SECRET` — opcional (sem ela a revisão fica desligada), segredo ≥ 32 caracteres,
lida pela API e pelo MCP. `pnpm env:init` gera (já gera todo `*_SECRET` vazio).

### Worker
```python
class ExtractResponse(PitchTrack):  # + transcript: list[TranscriptWord] | None = None  (só com lyricsCandidates)
class TranscriptWord(BaseModel): text: str; startMs: int; endMs: int; probability: float
class AlignRequest(BaseModel): videoId: str; current: list[LyricsLine]; proposed: list[LyricsLine]
class AlignResponse(BaseModel): durationMs: int; current: Alignment | None; proposed: Alignment | None
```
`POST /youtube/align` — mesmos erros de download do `/youtube/extract`; `current`/`proposed`
malformados → 400 `invalid_lyrics`.

### Cliente e serviço (API)
```ts
workerClient.alignFromYoutube(videoId: string, current: LyricLine[], proposed: LyricLine[]): Promise<{ durationMs: number; current: ForcedAlignment | null; proposed: ForcedAlignment | null }>;

export const REVIEW_CONFIG = { checkTtlMs: 30 * 60_000, maxChecks: 50, lineHintStepMs: 1_000 } as const;
/** Puro: diff por verso (LCS por texto normalizado) entre a letra atual e a proposta. */
export function diffLines(current: string[], proposed: string[]): LineDiff[];
/** Puro: dica de `startMs` das linhas propostas (a do verso casado; nova = vizinha + passo). */
export function proposedHints(current: LyricLine[], diff: LineDiff[]): LyricLine[];
export const lyricsReviewService = {
  list(limit: number): Promise<ReviewSongSummary[]>;
  detail(id: string): Promise<ReviewSongDetail>;
  check(id: string, lines: string[]): Promise<ReviewCheck>;   // guarda { songId, revision, proposed, track, alignment } em memória
  apply(id: string, checkId: string): Promise<SongDto>;
};
songRepository.findForReview(limit): Promise<ReviewRow[]>;   // 1 query, sem referenceTrack
songRepository.applyLyricsReview(id, revision, data): Promise<boolean>; // updateMany where { id, lyricsRevision: revision, referenceStatus: "READY" }
```

### MCP (`apps/mcp`)
| Ferramenta | Entrada | O que devolve (texto para o Claude) |
|---|---|---|
| `list_songs_to_review` | `{ limit? }` | músicas com fonte da letra, % de versos encaixados, revisada ou não |
| `get_song_lyrics` | `{ songId }` | versos numerados com tempo e score, transcrição em versos e candidatas |
| `check_lyrics_fix` | `{ songId, lines: string[] }` | antes/depois por verso com score, resumo, `checkId` |
| `apply_lyrics_fix` | `{ songId, checkId }` | confirmação e resumo do que foi gravado |

A descrição de `apply_lyrics_fix` diz explicitamente para só chamar depois de o usuário aprovar
o resultado do `check_lyrics_fix`. O Claude Code também pede permissão por ferramenta MCP.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Transcrição e candidatas são descartadas | Guardadas em `lyricsEvidence` na mesma escrita do `READY` de música nova; claim e FAILED zeram | Pedido do usuário |
| 2 | — | `/api/review/*` só com o token de serviço; sem `LYRICS_REVIEW_SECRET` configurada, desligada (503) | A API não tem login (`arquitetura.md`) |
| 3 | — | Lista: só `READY`; `whisper` primeiro, depois menor `matchedRatio`, depois mais antigas | Pedido do usuário |
| 4 | — | A proposta é a lista completa de versos (texto); linha vazia é instrumental e é mantida; a API calcula o diff (igual/editado/novo/removido) | Simplicidade para o Claude |
| 5 | — | Conferência: o worker alinha a letra atual e a proposta sobre a mesma voz; score por verso antes/depois. Nada é gravado | Pedido do usuário |
| 6 | — | Sem `youtubeVideoId` (referência por upload) → 409: a conferência precisa do áudio | Worker stateless (sdd-001) |
| 7 | — | Aplicar só com um `checkId` válido (30 min, em memória; reiniciar a API invalida) e se `lyricsRevision` não mudou; grava `lyrics` = proposta com a dica de tempo, `alignedLyrics`/`lyricsAlignment` pelo `alignmentService` com o alinhamento conferido, `lyricsSelection.reviewedAt`, e incrementa `lyricsRevision` | Concorrência (modelo do `claimForProcessing`) |
| 8 | — | A revisão não muda `lyricsSelection.source` (a origem continua sendo a original; `reviewedAt` diz que houve revisão) | Rastreabilidade |
| 9 | — | Performances e ranking já gravados não são recalculados; as novas usam a letra revisada | Escopo (nota é calculada no envio, `performance.service.ts`) |
| 10 | — | O web mostra "Letra gerada automaticamente e revisada" quando `source = whisper` e há `reviewedAt` | Aviso da sdd-011 |

## 6. Critérios de Aceitação
- **Segurança**: toda rota `/api/review/*` responde 401 sem o header certo (comparação em
  tempo constante, `crypto.timingSafeEqual`); o segredo nunca aparece em log nem em resposta;
  as rotas públicas continuam sem autenticação e sem mudança de comportamento.
- **Concorrência**: `apply` é um `updateMany` condicionado a `lyricsRevision` + `READY`; um
  `redo` entre a conferência e a aplicação faz o `apply` responder 409, sem gravar.
- **Performance**: `list` em 1 query com `select` sem `referenceTrack` nem `lyricsEvidence`;
  `detail` em 1 query com `lyricsEvidence`; `check` faz 1 chamada ao worker (download + Demucs
  + 2 alinhamentos sobre as mesmas emissões, ≤ 3 min em CPU); `apply` não chama o worker.
- **Tamanho**: `lyricsEvidence` de uma música de 5 min fica abaixo de 60 KB; nunca selecionado
  fora de `detail`.
- **MCP**: sobe com `node`/`tsx` pelo `.mcp.json`, lista as 4 ferramentas; falha da API vira
  mensagem de erro legível para o Claude (status + código), nunca um stack trace.
- **Compatibilidade**: tudo aditivo; testes existentes passam; api 2.1.0, worker 0.4.0,
  web 0.5.1, mcp 0.1.0; `CHANGELOG.md` atualizado.

## 7. Plano de Testes
- **Worker (pytest, sem modelo)**: `/youtube/align` com alinhador falso (as duas letras
  alinhadas sobre as mesmas emissões: `emissions` chamado 1 vez), letras malformadas → 400,
  vídeo inválido → 400; `transcript` presente com `lyricsCandidates` e ausente sem.
- **API (Vitest)**
  - `review-auth`: sem header, token errado, token certo; secret ausente → 503.
  - `lyrics-review.service`: `diffLines` (igual, editado, inserido, removido, verso dividido,
    versos juntados), `proposedHints`; `list` (ordem, só READY); `detail` (com e sem evidência,
    `transcriptLines` quebradas por pausa); `check` (worker mockado; upload → 409; não READY →
    409; resposta com antes/depois); `apply` (grava e incrementa versão; `checkId` expirado →
    410; redo no meio → 409; `reviewedAt` gravado).
  - `runReference` grava `lyricsEvidence` e `lyricsRevision`; claim e FAILED zeram a evidência.
- **MCP (Vitest)**: `format.ts` (texto das 4 respostas), `api-client` com `fetch` falso (header
  de autorização, erro da API vira mensagem), `env` (falta de variável → erro claro).
- **Web**: `lyricsSourceNotice` com `reviewedAt`.
- **Manual/Smoke**: `pnpm dev`; no Claude Code, `/mcp` mostra o servidor `cantor`; "revisa a
  letra da <música whisper>" → `get_song_lyrics` → `check_lyrics_fix` → aprovar →
  `apply_lyrics_fix` → a tela de cantar mostra a letra nova.
- **Lint/testes**: `pnpm --filter api test`, `pnpm --filter web lint && test`, `pnpm --filter
  mcp test`, `uv run pytest`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Conferência lenta (Demucs de novo a cada `check`) | certa | ~1–2 min por conferência | Uma conferência por rodada de correções (a proposta é a letra inteira); `apply` reaproveita o resultado |
| R2. `checkId` em memória some ao reiniciar a API (`tsx watch`) | média | refazer a conferência | Mensagem clara (410); TTL de 30 min |
| R3. Rota de escrita exposta sem login | média | alguém muda letras | Token de serviço obrigatório; desligada sem a variável; nunca no bundle do web |
| R4. O Claude reescrever demais (letra de memória) | baixa | direitos autorais / letra errada | Limite no README do MCP e na descrição das ferramentas; o score do áudio mostra verso que não bate; o usuário aprova |
| R5. Verso dividido/juntado perde a dica de tempo | média | alinhamento pior no verso | `proposedHints` usa a vizinha; o `alignmentService` recusa verso de score baixo e reposiciona pela vizinha (sdd-010) |
| R6. Nova dependência `@modelcontextprotocol/sdk` | certa | — | Versão atual via skill `latest-deps` (1.30.1 em 2026-09-26); só no `apps/mcp` |

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma — fluxo, limite de memória e aprovação definidos pelo usuário em 2026-09-26, §1)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou o código.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Mudança em schema Prisma aditiva, com migration planejada; contratos públicos aditivos.
- [x] Perguntas em aberto foram exauridas.
