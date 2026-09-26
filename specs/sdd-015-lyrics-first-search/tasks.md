# Task: Buscar pela letra (LRCLIB) de novo, com a busca pelo vídeo como alternativa

- **Slug:** lyrics-first-search
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** api minor sobre a vigente (hoje 2.2.0 → 2.3.0) · web minor (hoje 0.6.0 → 0.7.0). Worker e MCP sem mudança.
- **App afetado:** ambos
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (rota nova de busca, corpo alternativo no cadastro, `code` num erro que não tinha; nenhum campo Prisma, nada removido)

## 1. Contexto e Motivação
- A sdd-011 trocou a busca do LRCLIB pela do YouTube Music: escolher o vídeo cadastra e já
  prepara, e a letra vem de um site ou da transcrição da voz. Ficou mais lento (Whisper: 21–89 s
  por música, ponta a ponta ~3–4 min contra ~1,5 min antes; `apps/worker/README.md`,
  "Resultado do go/no-go da sdd-011" e "Desempenho") e a letra menos confiável quando nenhum site
  a tem (transcrição com erros de palavra, o que motivou a sdd-012).
- Pedido do usuário (2026-09-26): "era melhor antes. era mais rápido" → "isso, faça isso,
  planeje", sobre a proposta **híbrida**: a busca volta a ser pelo LRCLIB como caminho principal
  (letra sincronizada, sem Whisper; o vídeo vem depois, pela sugestão da sdd-008) e, quando o
  LRCLIB não tiver a música, a tela oferece "procurar pelo vídeo" (o fluxo atual da sdd-011).
- O caminho antigo continua vivo **depois** do cadastro: música com `sourceVideoId` nulo manda a
  letra conhecida ao worker, sem Whisper (`apps/api/src/services/song.service.ts:161`,
  `lyricsInput`), a sugestão de vídeo segue em `GET /:id/youtube-candidates`
  (`apps/api/src/routes/song.routes.ts:28`) e a preparação mostra as abas de fonte quando
  `sourceVideoId === null` (`apps/web/components/song-prep.tsx:125,130,335`). A sdd-011 tirou só a
  **entrada**: `lrclibClient.search`/`getById`, o cadastro por `lrclibId` e a busca do web por
  LRCLIB. O código antigo está no commit `4c79d91` (`git show 4c79d91:<caminho>`) e é a base da
  volta.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §services (`song.service.ts`: busca, cadastro e ciclo da
    referência) e §clients (`lrclib.client.ts`: validar toda resposta com Zod, timeout
    explícito): a busca e o cadastro pelo LRCLIB voltam para essas camadas, sem DI.
  - `apps/api/docs/arquitetura.md` §repositories: `findByLrclibIds` (1 query para anexar o
    estado aos resultados) e `upsertByLrclibId` (cadastro idempotente) voltam do commit
    `4c79d91`.
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`, "Telas → componentes", "Home / busca"):
    `.ct-search`, `.ct-song-row` com capa pela miniatura quando houver `youtubeVideoId` (senão a
    inicial) e `.ct-tabs` (já usadas na preparação) para escolher o modo da busca. Nenhum
    componente novo.

## 2. Escopo
- **Inclui**
  - **API**
    - `lrclibClient.search(q)` e `getById(id)` de volta (versões do commit `4c79d91`), passando
      pelas novas tentativas que o cliente já tem hoje (`request()`, `LRCLIB_CONFIG`).
    - `GET /api/songs/search/lyrics?q=` (nova): busca no LRCLIB, **só com letra sincronizada**,
      até `SEARCH_LIMIT`, com o estado local anexado em 1 query.
    - `POST /api/songs` aceita também `{ lrclibId }` (além de `{ videoId }`): cadastro
      idempotente pelo `lrclibId` com a letra sincronizada parseada, status `NONE` (a referência
      começa quando o usuário escolhe o vídeo, como antes da sdd-011).
    - `SongWithoutSyncedLyricsError` (422, `code: "NO_SYNCED_LYRICS"`) de volta;
      `LyricsProviderUnavailableError` ganha `code: "LYRICS_UNAVAILABLE"` (aditivo).
    - `GET /api/songs/search` (YouTube Music) e o cadastro por `{ videoId }` **inalterados**.
  - **Web**
    - Busca com `.ct-tabs` "Pela letra | Pelo vídeo", padrão "Pela letra" (LRCLIB). Resultados
      vazios, erro do LRCLIB ou "não achei" oferecem passar para "Pelo vídeo" com o mesmo texto.
    - Escolher um resultado "pela letra" cadastra por `lrclibId` e abre a preparação, que já
      mostra a sugestão de vídeo (sdd-008) para música com `sourceVideoId` nulo.
    - `lib/api.ts`: `searchLyrics(q)`, `createSongFromLyrics(lrclibId)`; `lib/types.ts`:
      `LyricsSearchItem`; `lib/song-search.ts` (novo, puro): textos e decisões da busca.
  - Testes (Vitest da API e do web), lint, docs (`arquitetura.md`, readme do design system,
    `apps/web/README.md`, `AGENTS.md` §2/§4 se preciso, `CHANGELOG.md`).
- **Exclui**
  - Remover a busca pelo vídeo, o Whisper ou a revisão da letra (sdd-011/012/014 continuam
    valendo no caminho "Pelo vídeo").
  - Escolher o vídeo automaticamente depois do cadastro pela letra (continua a escolha do
    usuário na sugestão da sdd-008, como antes).
  - Juntar numa música só um cadastro pela letra e outro pelo vídeo da mesma canção (podem
    coexistir, como já coexistem hoje as antigas e as novas; ver R3).
  - Mudança no worker, no MCP ou no schema Prisma.

## 3. Impacto Arquitetural

Camadas: `clients/lrclib.client.ts` → `services/song.service.ts` → `controllers/song.controller.ts`
→ `routes/song.routes.ts`, e `repositories/song.repository.ts`; no web, `components/song-search.tsx`
e `lib/`. Sem DI: módulos importados diretamente (`arquitetura.md`, topo). Nenhum arquivo novo na
API; no web, `lib/song-search.ts` e `tests/song-search.spec.ts`.

```
web /  (SongSearch, aba "Pela letra" — padrão)
  └─ GET /api/songs/search/lyrics?q=      ─► songService.searchLyrics(q)
        ├─ lrclibClient.search(q)          (LRCLIB /api/search?q=, com novas tentativas)
        ├─ filtra syncedLyrics ≠ null, corta em SEARCH_LIMIT
        └─ songRepository.findByLrclibIds(ids)   (1 query)  ─► LyricsSearchItem[]
  └─ escolhe ─► POST /api/songs { lrclibId }  ─► songService.createFromLyrics(lrclibId)
        ├─ findByLrclibId → existe? 200
        ├─ lrclibClient.getById → 404? SongNotFoundError · sem synced? 422 NO_SYNCED_LYRICS
        └─ upsertByLrclibId (idempotente, corrida resolvida pelo índice único) → 201, NONE
  └─ /songs/:id (preparação): sourceVideoId nulo → sugestão de vídeo (sdd-008, inalterada)
        └─ POST /:id/reference/youtube → worker com a letra conhecida (sem Whisper, ~1,5 min)

web /  (aba "Pelo vídeo" — alternativa, inalterada desde a sdd-011)
  └─ GET /api/songs/search ─► YouTube Music ─► POST /api/songs { videoId } ─► já PROCESSING
```

## 4. Contratos e Interfaces

### Rotas (prefixo `/api/songs`)
| Rota | Entrada | Saída | Erros |
|---|---|---|---|
| `GET /search/lyrics` (nova) | `?q=` (`songSearchQuerySchema`, 2..100) | `LyricsSearchItem[]` (≤ `SEARCH_LIMIT`) | 400 query inválida; 502 `LYRICS_UNAVAILABLE` (LRCLIB fora depois das novas tentativas) |
| `POST /` | `{ videoId }` **ou** `{ lrclibId }` (aditivo) | `SongDto`: 201 criada, 200 já existia | com `lrclibId`: 404 id desconhecido no LRCLIB; 422 `NO_SYNCED_LYRICS`; 502 `LYRICS_UNAVAILABLE`; corpo com os dois campos ou nenhum → 400 |
| `GET /search` | inalterada (YouTube Music) | `SongSearchItem[]` | — |

`/search/lyrics` é estática e não conflita com `/:id` (um segmento) nem com `/:id/...`.

### Tipos e schemas (API)
```ts
// services/song.service.ts
/** Um resultado da busca pela letra (LRCLIB): só faixas com letra sincronizada. */
export interface LyricsSearchItem {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** Preenchidos quando a música já foi cadastrada por este `lrclibId`. */
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
  /** Vídeo da referência, para a miniatura; nulo sem referência pelo YouTube. */
  youtubeVideoId: string | null;
}
songService.searchLyrics(q: string): Promise<LyricsSearchItem[]>;
songService.createFromLyrics(lrclibId: number): Promise<CreateSongResult>;

// utils/validators.ts — aditivo: continua aceitando { videoId }
export const createSongBodySchema = z.union([
  z.strictObject({ videoId: youtubeVideoIdSchema }),
  z.strictObject({ lrclibId: z.number().int().positive() }),
]);

// clients/lrclib.client.ts (de volta, do commit 4c79d91, sobre o request() com novas tentativas)
lrclibClient.search(q: string): Promise<LrclibTrack[]>;          // GET /api/search?q=
lrclibClient.getById(id: number): Promise<LrclibTrack | null>;    // GET /api/get/{id}; 404 → null

// repositories/song.repository.ts (de volta)
songRepository.findByLrclibId(lrclibId: number): Promise<SongSummary | null>;
songRepository.findByLrclibIds(lrclibIds: number[]): Promise<LyricsLookup[]>; // id, lrclibId, referenceStatus, youtubeVideoId
songRepository.upsertByLrclibId(data: CreateSongFromLyricsData): Promise<SongSummary>;

// utils/errors.ts
SongWithoutSyncedLyricsError (422, "NO_SYNCED_LYRICS")          // de volta, agora com code
LyricsProviderUnavailableError (502, "LYRICS_UNAVAILABLE")       // ganha code (aditivo)
```
O `lrclib.client.ts` hoje só não repete 4xx; o `getById` precisa receber o 404 como resposta
(não como falha): o `request()` atual já devolve respostas não passageiras, então o 404 chega ao
`getById`, que devolve `null`.

### Web (`lib/`)
```ts
// lib/types.ts — espelho de LyricsSearchItem (acima)
// lib/api.ts
api.searchLyrics(q: string): Promise<LyricsSearchItem[]>;           // GET /search/lyrics?q=
api.createSongFromLyrics(lrclibId: number): Promise<SongDto>;       // POST / { lrclibId }
// lib/song-search.ts (puro, testado)
export type SearchMode = "lyrics" | "video";
export const SEARCH_MODES: Record<SearchMode, { tab: string; hint: string }>;
/** Texto do erro ao buscar/cadastrar, pelo modo e pelo `code` da API. */
export function searchErrorCopy(mode: SearchMode, code: string | null): ErrorCopy;
/** Oferecer "Procurar pelo vídeo"? Na aba da letra: sempre abaixo dos resultados; em destaque sem resultado ou com erro. */
export function videoFallback(mode: SearchMode, state: "empty" | "error" | "results"): "prominent" | "subtle" | null;
```

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | A busca é só no YouTube Music (sdd-011) | Duas buscas: "Pela letra" (LRCLIB, padrão) e "Pelo vídeo" (YouTube Music, alternativa). O modo não é lembrado: a tela sempre abre em "Pela letra" | Pedido do usuário (híbrido) |
| 2 | — | "Pela letra" só lista faixas com `syncedLyrics` (como antes da sdd-011); faixa só com texto não aparece e vai pelo vídeo | sdd-003 regra 1; "letra sincronizada" do pedido |
| 3 | Cadastro só por `videoId`, já começa a referência | Por `lrclibId`: idempotente pelo índice único, grava a letra parseada (`parseLrc`), status `NONE`; a referência começa quando o usuário escolhe o vídeo na sugestão (sdd-008). Por `videoId`: inalterado | `4c79d91` (`songService.create`); sdd-011 regra 2/3 |
| 4 | — | Letra sincronizada que não gera nenhuma linha (`parseLrc` vazio) → 422 `NO_SYNCED_LYRICS`, nada cadastrado | `4c79d91` |
| 5 | Música com `sourceVideoId` nulo vai ao worker com a letra conhecida (sem Whisper) | Inalterado: é o que torna o caminho "pela letra" mais rápido | `song.service.ts:161` |
| 6 | — | LRCLIB fora (depois das novas tentativas do cliente): a aba "Pela letra" mostra o aviso e oferece "Procurar pelo vídeo" em destaque | R1 |
| 7 | — | Resultado "pela letra" já cadastrado abre a música existente (link), como na busca pelo vídeo | `song-search.tsx` atual |

## 6. Critérios de Aceitação
- **Velocidade**: uma música nova "pela letra" fica `READY` sem passar pelo Whisper (a extração
  vai ao worker com `{ kind: "known" }`); medir no smoke o tempo do clique em "Usar este vídeo"
  até `READY` e anotar no CHANGELOG (esperado ~1,5 min, contra ~3–4 min pelo vídeo com o
  Whisper local).
- **Performance**: `searchLyrics` faz 1 chamada ao LRCLIB e 1 query (`findByLrclibIds`, `select`
  sem `referenceTrack` nem `lyricsEvidence`); o cadastro faz no máximo 1 leitura, 1 chamada ao
  LRCLIB e 1 `upsert`.
- **Concorrência**: dois `POST { lrclibId }` iguais ao mesmo tempo criam 1 música (upsert no
  índice único de `lrclibId`); nenhum dispara referência.
- **Compatibilidade**: tudo aditivo; `GET /search` e `POST { videoId }` respondem igual; os
  testes existentes passam, exceto o caso "corpo `{ lrclibId: 77 }` → 400" de
  `songs.create.spec.ts`, que passa a ser um cadastro válido (atualizar o teste, não o
  contrato). api 2.3.0, web 0.7.0, `CHANGELOG.md`.
- **UI**: um único `.ct-btn--primary` por tela (a busca não tem nenhum); abas com
  `role="tablist"` como as da preparação; `pnpm --filter web lint` limpo.

## 7. Plano de Testes
- **API (Vitest)**
  - `clients/lrclib.client.spec.ts`: `search` monta `?q=` e descarta itens fora do formato;
    `getById` devolve a faixa, `null` no 404, e passa pelas novas tentativas em 503.
  - `songs/songs.search-lyrics.spec.ts` (base: `git show 4c79d91:apps/api/src/tests/songs/songs.search.spec.ts`):
    só sincronizadas, limite, estado local anexado em 1 query (música já cadastrada traz
    `songId`, `referenceStatus`, `youtubeVideoId`), query inválida → 400, LRCLIB fora → 502
    `LYRICS_UNAVAILABLE`.
  - `songs/songs.create.spec.ts`: novo bloco `{ lrclibId }` (base: os casos do commit
    `4c79d91`): 201 com a letra parseada e `NONE` sem chamar o worker; 200 na segunda chamada
    sem consultar o LRCLIB; 404; 422 `NO_SYNCED_LYRICS` (sem synced e synced sem tags); corpo
    inválido (`{}`, `{ lrclibId: "77" }`, `0`, `1.5`, os dois campos juntos) → 400; chamadas
    simultâneas → 1 música. O bloco `{ videoId }` continua passando.
  - `errors/error-handler.spec.ts`: `LyricsProviderUnavailableError` responde com `code`.
- **Web (Vitest, `lib/`)**: `song-search.spec.ts` — textos por modo, `searchErrorCopy` por
  código (`LYRICS_UNAVAILABLE`, `NO_SYNCED_LYRICS`, `SEARCH_FAILED`, `VIDEO_UNAVAILABLE`,
  desconhecido), `videoFallback` nos três estados e nos dois modos.
- **Manual/Smoke** (`pnpm dev`): buscar "Tiago Iorc Tempo Perdido" → resultado pela letra →
  preparação com a sugestão de vídeo → "Usar este vídeo" → `READY` sem Whisper (log do worker
  sem transcrição; medir o tempo); buscar "Tim Bernardes Olha" (sem letra sincronizada no
  LRCLIB) → nada pela letra → "Procurar pelo vídeo" → fluxo da sdd-011.
- **Lint/testes**: `pnpm --filter api test`, `pnpm --filter web lint && pnpm --filter web test`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. LRCLIB instável (503 em 4 de 11 consultas na Etapa 0 da sdd-011) | alta | busca pela letra falha | O cliente já tenta de novo até 2 vezes (`LRCLIB_CONFIG`); com falha, a aba oferece "Procurar pelo vídeo" em destaque (regra 6) |
| R2. Música com letra só em texto no LRCLIB some da busca pela letra | média | usuário não acha pela letra | Dica da aba e oferta do vídeo; o caminho pelo vídeo aceita letra em texto (sdd-011) |
| R3. A mesma canção cadastrada duas vezes (uma pela letra, outra pelo vídeo) | média | dois rankings para a mesma música | Aceito (já acontece hoje entre antigas e novas); a busca de cada aba mostra o que ela cadastrou. Unificação fica fora do escopo |
| R4. Árvore de trabalho com as sdd-008 a 014 sem commit (87 arquivos) | certa | difícil isolar o diff desta sdd no PR | Commitar o estado atual antes de implementar (fora do código; recomendação ao usuário) |
| R5. Um passo a mais no caminho pela letra (escolher o vídeo) | certa | um clique a mais | A sugestão da sdd-008 já destaca o áudio oficial com "Usar este vídeo"; escolher sozinho fica fora do escopo |

Dependências: nenhuma nova. Código de referência no commit `4c79d91`.

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma — o híbrido, o LRCLIB como padrão e a busca pelo vídeo como alternativa foram
confirmados pelo usuário em 2026-09-26, §1; a escolha manual do vídeo segue como antes)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou o código
      (`song.service.ts:161`, `song.routes.ts:28`, `song-prep.tsx:125,130,335`, commit `4c79d91`).
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Sem mudança em schema Prisma; contratos públicos só aditivos (rota nova, corpo
      alternativo, `code` novo), sem migration.
- [x] Perguntas em aberto foram exauridas.
