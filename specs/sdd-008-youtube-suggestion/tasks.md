# Task: Sugerir o vídeo oficial do YouTube na preparação da música

- **Slug:** youtube-suggestion
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** worker 0.2.0 · api 1.3.0 · web 0.4.0 (minors; contratos aditivos)
- **App afetado:** worker, api e web
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (1 rota nova no worker, 1 rota nova na API, 1 código de erro novo; nada muda no schema Prisma)
- **Ordem:** independente da sdd-007; implementar antes da sdd-009.

## 1. Contexto e Motivação
- Hoje quem prepara a música precisa abrir o YouTube, escolher um vídeo e colar o link
  (`song-prep.tsx`, aba "Link do YouTube"). Escolher errado custa 2 a 3 minutos de
  processamento e, muitas vezes, um `DURATION_MISMATCH` ou uma letra fora do lugar (risco R7 da
  sdd-004).
- O worker já usa o `yt-dlp` como biblioteca (`apps/worker/app/youtube.py`), e o `yt-dlp` faz
  busca (`ytsearchN:<consulta>`) devolvendo id, título, canal e duração sem baixar nada e sem
  chave de API. A API já sabe artista, título e duração da letra (`Song`), que é exatamente o
  filtro que elimina a maior causa de erro (`DURATION_TOLERANCE_MS`, `song.service.ts:23`).
- Pedido original: `specs/tasks.txt`, item 8. Decisões do usuário: sempre pedir o clique em
  "Usar este vídeo", nunca processar sozinho (uma referência `READY` não pode ser trocada,
  regra 5 da sdd-003); e, como nem sempre existe áudio oficial, quando não há um candidato
  oficial vence o vídeo **mais visto** entre os que têm a duração da letra.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §clients: o worker é chamado só por `worker.client.ts`, que
    valida a resposta com Zod e converte falhas em `WorkerClientError`.
  - `apps/api/docs/arquitetura.md` §services: ranking é regra de negócio pura, sem HTTP nem SQL
    (`youtube-suggestion.service.ts`, no modelo do `scoring.service.ts`).
  - `apps/worker/README.md` §Contrato e `specs/sdd-001-worker-pitch/tasks.md` §4: toda rota
    devolve `{ error, message }` em falha; downloads ficam fora do semáforo de extração
    (`main.py`, `_extraction_lock`). A busca também fica fora.
  - Design system (`readme.md`, "Telas → componentes"): candidato principal numa `.ct-tv`
    (miniatura `hqdefault.jpg`), alternativas como `.ct-song-row` (miniatura `default.jpg`),
    um único `ct-btn--primary` por tela.
  - Mesma ressalva do download (`specs/tasks.txt`, visão): projeto pessoal e não comercial.

## 2. Escopo
- **Inclui**
  - Worker: `POST /youtube/search` `{ query }` → candidatos (flat, sem download), com timeout
    e código de erro `search_failed`.
  - API: `workerClient.searchYoutube(query)`; `GET /api/songs/:id/youtube-candidates` que monta
    a consulta, filtra pela duração da letra, ranqueia em duas camadas (oficial; senão, mais
    visto) e devolve até 5 candidatos com uma confiança; cache em memória por música (10 min)
    para não repetir a busca a cada recarga.
  - Web: na preparação com status `NONE`/`FAILED`, busca os candidatos ao montar; mostra o
    melhor em `.ct-tv` com "Usar este vídeo" (ação principal), até 4 alternativas com "Usar"
    e a aba de colar link / enviar arquivo como "Outro vídeo ou arquivo". Usar um candidato
    chama a rota existente `POST /:id/reference/youtube` com `https://youtu.be/<id>`.
  - Testes: pytest do worker (yt-dlp falso), Vitest da API (ranking puro + rota com dublê do
    worker), Vitest do web (helper puro dos selos), smoke manual.
- **Exclui**
  - Processar automaticamente sem clique. Trocar uma referência `READY`.
  - YouTube Data API oficial (precisa de chave e cota; fica como alternativa documentada se o
    `ytsearch` quebrar).
  - Buscar por outros provedores (SoundCloud etc.). Persistir candidatos no banco.

## 3. Impacto Arquitetural
- Worker: `app/youtube.py` (`search`), `app/main.py` (rota), `app/schemas.py`
  (`YoutubeSearchRequest`, `YoutubeSearchResponse`, `YoutubeCandidate`), `app/errors.py`
  (`search_failed`, 502).
- API: `clients/worker.client.ts` (método + schema Zod + timeout), `services/youtube-suggestion.service.ts`
  (novo, puro + orquestração), `controllers/song.controller.ts` (`getYoutubeCandidates`),
  `routes/song.routes.ts` (`GET /:id/youtube-candidates`), `utils/errors.ts`
  (`YoutubeSearchUnavailableError`, 502, `code: "SEARCH_FAILED"`), `utils/validators.ts`
  (schema da resposta do worker fica no client, como hoje). Sem repositório novo, sem
  migration. Sem DI.
- Web: `lib/api.ts` (`getYoutubeCandidates`), `lib/types.ts`, `lib/youtube.ts`
  (`candidateBadges`, puro), `components/song-prep.tsx`, novo `components/youtube-candidates.tsx`.
- Fluxo:
  ```
  web /songs/[id] (NONE|FAILED) ─GET /:id/youtube-candidates─► songController.getYoutubeCandidates
        │                                                         └► youtubeSuggestionService.forSong(id)
        │                                                              ├ cache (songId → { at, result }) ─hit─► resposta
        │                                                              ├ songRepository.findById
        │                                                              ├ workerClient.searchYoutube("<artist> <title>")
        │                                                              │      └► worker POST /youtube/search ─► yt-dlp ytsearch10 (extract_flat)
        │                                                              └ rank(song, candidates) → { candidates[≤5], confidence }
        ▼
  "Usar este vídeo" ─POST /:id/reference/youtube { url: "https://youtu.be/<id>" }─► fluxo atual da sdd-003
  ```
- Ranking (`youtubeSuggestionService.rank`, puro), pseudocódigo:
  ```
  SUGGESTION_CONFIG = {
    query: { results: 15 },
    durationToleranceMs: DURATION_TOLERANCE_MS (10 000),
    exactDurationMs: 2 000,                    // "exata quantidade de tempo": ≤ 2 s ganha bônus
    weights: { topicChannel: 3, officialAudio: 3, official: 1, lyric: 1, artistChannel: 2, vevo: 2, titleMatch: 1,
               exactDuration: 1, badToken: -5 },
    badTokens: ["live", "ao vivo", "acustic", "acústic", "cover", "karaok", "remix", "instrumental", "playback",
                "sped up", "slowed", "reaction", "reação", "8d", "nightcore"],
    officialMin: 2,                            // score ≥ 2 = "tem marca de oficial" (camada 1)
    confidence: { high: { gap: 2 }, medium: { views: 100_000 } },
    maxCandidates: 5,
  }

  norm(s) = minúsculas, sem acentos (NFD + remover \p{M}), sem pontuação, espaços únicos
  exempt = badTokens presentes em norm(song.title + " " + (song.album ?? ""))   // a própria letra é "ao vivo"

  para cada c (com durationMs != null, não ao vivo):
    se |c.durationMs − song.durationMs| > durationToleranceMs → descarta
    t = norm(c.title); ch = norm(c.channel)
    score = 0
    ch termina com "topic"                          → +3   (áudio oficial gerado pelo YouTube: versão de estúdio)
    t contém "official audio" | "audio oficial"     → +3
    senão t contém "official" | "oficial"           → +1
    t contém "lyric"                                → +1
    ch contém norm(song.artist) ou "vevo"           → +2
    t contém norm(song.artist) e norm(song.title)   → +1
    |durationMs − song.durationMs| ≤ exactDurationMs → +1
    para cada badToken ∉ exempt contido em t        → −5
    tier = score ≥ officialMin ? 1 : 2              // camada 1 = oficial; camada 2 = o resto
  ordena por (tier asc, score desc dentro da camada 1, viewCount desc, |Δduração| asc, ordem da busca)
    // camada 2 é ordenada só por visualizações e duração: sem oficial, vence o mais visto
    // com a duração certa (decisão do usuário). viewCount null conta como 0.
  candidates = primeiros 5, cada um com { …, viewCount, score, tier, reasons[] }
  confidence = "none" se vazio
             | "high"   se top.tier = 1 e (só um na camada 1 ou top.score − 2º.score ≥ gap)
             | "medium" se top.tier = 1, ou top.tier = 2 com viewCount ≥ 100 000
             | "low"    caso contrário
  ```
- **Decisões de implementação (2026-09-26, `code-implementer`)**, onde o código difere do
  pseudocódigo acima, sempre a favor dos critérios das seções 5 e 6:
  1. Candidato com palavra "ruim" (fora das isentas) vai para o **fim da camada 2**, mesmo
     que seja o mais visto: ordenar a camada 2 só por visualizações deixaria "karaokê" ou
     "ao vivo" muito vistos na frente de um áudio comum, contra a regra 4 e o critério
     "'ao vivo' com duração igual perde para um áudio comum".
  2. Camada 1 exige, além de `score ≥ officialMin`, **alguma marca de oficial** (`TOPIC_CHANNEL`,
     `OFFICIAL_AUDIO`, `ARTIST_CHANNEL`, `OFFICIAL`, `LYRIC_VIDEO`): título certo + duração
     exata somam 2 pontos mas não são "marca de oficial" (regra 4).
  3. Desempate da camada 2 (pedido na seção 6): mesma **ordem de grandeza** de visualizações
     (mesmo número de dígitos) → vence a duração exata (≤ 2 s); uma ordem de grandeza a mais →
     vence o mais visto.
  4. O canal "- Topic" contém o nome do artista, então soma `TOPIC_CHANNEL` **e**
     `ARTIST_CHANNEL` (3 + 2), como o pseudocódigo permite.
  5. `query.results` não existe em `SUGGESTION_CONFIG`: a contagem (15) é fixa no worker
     (`SEARCH_RESULTS`), que é quem faz a busca. `buildQuery` mantém os acentos (o YouTube
     lida bem com eles e a grafia do LRCLIB é a canônica) e remove só parênteses, colchetes
     e "feat.".
- Consulta enviada ao worker: `"${artist} ${title}"` com espaços normalizados, máx. 200
  caracteres. Uma busca só (15 resultados): o canal "- Topic" e o "official audio" aparecem
  nos primeiros resultados quando existem, e 15 dá amostra suficiente para a camada 2.

## 4. Contratos e Interfaces
- **Worker** `POST /youtube/search` — JSON `{ "query": string }` (1 a 200 caracteres).
  - `200` → `{ "candidates": YoutubeCandidate[] }` com
    `YoutubeCandidate = { videoId: string, title: string, channel: string | null, durationS: number | null, viewCount: number | null, isLive: boolean }`
    (até 15, na ordem do YouTube). Lista vazia é resposta válida. `viewCount` vem do campo
    `view_count` do resultado flat (nulo quando o YouTube não informa).
  - `400 invalid_query` (vazio ou > 200) · `502 search_failed` (yt-dlp falhou ou 20 s de
    timeout) · `500 internal`.
  - `yt-dlp`: `extract_info(f"ytsearch15:{query}", download=False)` com `extract_flat: True`,
    `noplaylist`, `socket_timeout: 15`, `quiet`. Roda em thread, **fora** do semáforo. Nada é
    gravado em disco.
  - Pydantic:
    ```python
    class YoutubeSearchRequest(BaseModel):
        query: str
    class YoutubeCandidate(BaseModel):
        videoId: str; title: str; channel: str | None; durationS: float | None; viewCount: int | None; isLive: bool = False
    class YoutubeSearchResponse(BaseModel):
        candidates: list[YoutubeCandidate]
    ```
  - `WorkerErrorCode` += `"invalid_query"` (400), `"search_failed"` (502).
- **API** `clients/worker.client.ts`:
  ```ts
  export interface WorkerYoutubeCandidate { videoId: string; title: string; channel: string | null; durationS: number | null; viewCount: number | null; isLive: boolean }
  searchYoutube(query: string): Promise<WorkerYoutubeCandidate[]>;   // WORKER_TIMEOUTS_MS.youtubeSearch = 25_000
  // WORKER_ERROR_CODES += "invalid_query", "search_failed"; resposta validada com Zod (videoId /^[A-Za-z0-9_-]{11}$/)
  ```
- **API** `GET /api/songs/:id/youtube-candidates`
  - `200` → `YoutubeSuggestion`:
    ```ts
    export interface YoutubeCandidateDto {
      videoId: string; title: string; channel: string | null; durationMs: number;
      viewCount: number | null;
      score: number;
      /** 1 = tem marca de oficial; 2 = escolhido pelas visualizações. */
      tier: 1 | 2;
      /** Motivos legíveis pelo web, como códigos: "TOPIC_CHANNEL" | "OFFICIAL_AUDIO" | "ARTIST_CHANNEL" | "LYRIC_VIDEO" | "OFFICIAL" | "MOST_VIEWED" | "EXACT_DURATION" */
      reasons: YoutubeCandidateReason[];
    }
    export interface YoutubeSuggestion {
      query: string;
      confidence: "none" | "low" | "medium" | "high";
      candidates: YoutubeCandidateDto[];   // ≤ 5, já ordenados
    }
    ```
  - `404` música inexistente · `502 { code: "SEARCH_FAILED" }` quando o worker falha ou não
    responde (o web mostra o campo manual com aviso).
  - Sem corpo, sem query params. Não muda o status da música.
- `services/youtube-suggestion.service.ts`:
  ```ts
  export const SUGGESTION_CONFIG: …;
  export function buildQuery(song: Pick<SongDto, "artist" | "title">): string;
  export function rank(song: Pick<SongDto, "artist" | "title" | "album" | "durationMs">, candidates: WorkerYoutubeCandidate[]): YoutubeSuggestion;   // pura
  export const youtubeSuggestionService = { forSong(id: string): Promise<YoutubeSuggestion> };  // cache 10 min por songId
  ```
- `utils/errors.ts`: `YoutubeSearchUnavailableError` → `AppError("YouTube search is unavailable", 502, "SEARCH_FAILED")`.
- **Web** `lib/api.ts`: `getYoutubeCandidates(id: string, signal?: AbortSignal): Promise<YoutubeSuggestion>`.
  `lib/types.ts` espelha `YoutubeSuggestion`. `lib/youtube.ts`:
  `candidateBadges(reasons): { label: string }[]` (pt-BR: "Áudio oficial", "Canal do artista",
  "Lyric video", "Oficial", "Mais visto", "Duração exata") e `formatViews(n)` ("1,2 mi",
  "830 mil"); a linha do candidato mostra as visualizações ao lado da duração. Tabela de copy do `SEARCH_FAILED` entra no readme do DS
  ("Erros da referência"): tone `warning`, "Não achamos o vídeo sozinhos", "Cole o link do
  YouTube ou envie o arquivo de áudio."
- Consumidores impactados: só `apps/web` (novo consumo). Nada removido.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | O usuário procura e cola o link | Com status `NONE`/`FAILED`, a tela já mostra candidatos ranqueados; o link colado continua disponível | `specs/tasks.txt` item 8 |
| 2 | — | Nunca processa sem clique: "Usar este vídeo" chama a rota atual de referência por YouTube | Decisão do usuário (2026-09-25) |
| 3 | Duração ±10 s só é checada depois de processar | Candidatos fora de ±10 s da duração da letra nem aparecem; ao vivo e estreias também não | `DURATION_TOLERANCE_MS`, `check_metadata` (`youtube.py`) |
| 4 | — | Ranking determinístico em duas camadas: candidatos com marca de oficial (canal "- Topic", "official audio", canal do artista) vêm primeiro, ordenados pela pontuação; sem oficial, vence o mais visto com a duração certa. Palavras "ruins" presentes no título/álbum da própria letra não penalizam (a letra pode ser da versão ao vivo) | Decisão do usuário ("nem sempre tem o oficial") |
| 4b | — | Duração a até 2 s da letra ganha bônus e é o desempate final: entre dois vídeos parecidos, fica o de duração exata | "exata quantidade de tempo" |
| 5 | — | Confiança `high`/`medium`/`low`/`none` é só apresentação: em `high`/`medium` o candidato principal vem em destaque e o campo manual vai para baixo; em `low`/`none` o campo manual vem primeiro e os candidatos viram "Talvez seja um destes" | DS: um foco por tela |
| 6 | — | Resultado da busca fica em cache em memória por música por 10 min (recarregar a página não repete a busca); reinício da API zera o cache | Custo do `ytsearch` (1–2 s) |
| 7 | — | Falha do worker na busca → `502 SEARCH_FAILED`; a preparação segue funcionando com o campo manual | Robustez (sdd-004 §6) |
| 8 | Só o `videoId` vai para o worker (regra 11 da sdd-003) | Continua: a busca recebe texto de artista/título vindos do LRCLIB, nunca entrada livre do usuário | Segurança |

## 6. Critérios de Aceitação
- **Ranking (puro)**: com candidatos sintéticos, "Artista - Topic" com duração igual vence
  "official video" de um canal qualquer e vence um upload comum com 10× mais visualizações;
  sem nenhum candidato oficial, o mais visto com a duração certa vence, e um com 3 s a mais
  perde para um com 0,5 s a mais e menos visualizações só quando a diferença de
  visualizações é menor que a ordem de grandeza (documentar o desempate escolhido);
  "ao vivo" com duração igual perde para um áudio comum; candidato 15 s mais longo é
  descartado; título da letra "…(Ao Vivo)" não penaliza "ao vivo"; `viewCount` nulo conta
  como 0; nunca devolve mais de 5; `confidence` segue os limiares (tier 2 muito visto =
  `medium`, tier 2 pouco visto = `low`).
- **Rota**: `GET /:id/youtube-candidates` devolve 200 com a estrutura acima; 404 para id
  desconhecido; 502 `SEARCH_FAILED` quando o dublê do worker lança; segunda chamada dentro
  de 10 min não chama o worker (spy); após o TTL chama de novo.
- **Worker**: `POST /youtube/search` devolve os campos mapeados do `yt-dlp` (`id`, `title`,
  `channel`/`uploader`, `duration`, `view_count`, `live_status`) com o `FakeYoutubeDL`; consulta vazia →
  400 `invalid_query`; exceção do `yt-dlp` → 502 `search_failed`; timeout de 20 s →
  502 `search_failed`; nenhum arquivo é criado no tmp; roda com uma extração em andamento
  (fora do semáforo).
- **Performance**: 1 chamada ao worker por música a cada 10 min; ranking em O(n) com n ≤ 10;
  a página de preparação não bloqueia enquanto busca (Server Component não espera a busca; o
  Client Component mostra "Procurando o áudio oficial…").
- **Web**: um único `ct-btn--primary` visível ("Usar este vídeo" quando há candidato em
  destaque; senão "Usar vídeo" do campo); clicar num candidato leva ao mesmo estado
  `PROCESSING` de hoje (TV + relógio); falha da busca mostra o aviso e o campo manual; sem
  candidatos, a tela é a atual. Copy em pt-BR, sem código cru, sem emoji.
- **Qualidade**: `uv run pytest`, `pnpm --filter api test`, `pnpm --filter web test`,
  `pnpm --filter web lint`, `pnpm --filter web build` verdes. `apps/worker/README.md`
  (contrato), `apps/api/docs/arquitetura.md` (rota, service, client, erro), readme do DS
  (copy do `SEARCH_FAILED`), `CHANGELOG.md` (worker 0.2.0, api 1.3.0, web 0.4.0) e
  `specs/sdd-001-worker-pitch/tasks.md` §4 (nota apontando para esta spec) atualizados.
- **Critério de "pronto" (manual)**: para 5 músicas conhecidas em português e inglês (pelo
  menos uma sem áudio oficial no YouTube), o primeiro candidato é a versão de estúdio correta
  em pelo menos 4, e nenhuma sugere versão ao vivo/cover quando existe estúdio.

## 7. Plano de Testes
- **Worker (pytest)**: `tests/test_youtube.py` (+ `FakeYoutubeDL.search_entries` no
  `conftest.py`): mapeamento dos campos, entradas sem duração (`durationS: null`), ao vivo
  (`isLive`), consulta inválida, falha e timeout, sem escrita em disco (`tmp_root` vazio).
- **API (Vitest)**:
  - `tests/songs/youtube-suggestion.service.spec.ts`: casos da seção 6 sobre `rank` (camadas,
    visualizações, duração exata, `viewCount` nulo) e `buildQuery` (normalização de acentos e
    pontuação).
  - `tests/songs/songs.youtube-candidates.spec.ts`: rota 200/404/502, cache por TTL com
    `vi.useFakeTimers`, dublê `workerClient.searchYoutube` (mesmo `vi.mock` de
    `songs.reference-youtube.spec.ts:12`).
  - `tests/errors/`: `YoutubeSearchUnavailableError` responde `{ message, code: "SEARCH_FAILED" }`.
- **Web (Vitest)**: `tests/youtube.spec.ts` ganha `candidateBadges` (ordem e rótulos) e
  `formatViews`.
- **Manual/Smoke**: 5 músicas (critério de pronto); clicar "Usar este vídeo" e chegar a
  `READY`; derrubar o worker e ver o aviso com o campo manual; recarregar e não ver nova busca
  na aba de rede.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. `ytsearch` do `yt-dlp` quebra ou muda campos (YouTube muda o HTML) | média | médio | Schema Zod tolerante (`channel`/`durationS` opcionais); falha vira `SEARCH_FAILED` e o campo manual continua; alternativa documentada: YouTube Data API |
| R2. Título do LRCLIB com sufixos ("- Remastered 2011", "feat.") piora a consulta | média | baixo | `buildQuery` remove parênteses/colchetes e "feat."; o filtro de duração corrige o resto |
| R3. Resultado flat sem duração para alguns vídeos | baixa | baixo | Sem duração o candidato é descartado (a duração é o filtro mais importante) |
| R3b. Resultado flat sem `view_count` | baixa | baixo | Conta como 0 e cai para o fim da camada 2; se for frequente, buscar metadados dos 5 primeiros com `extract_info` individual (mais lento, fica como ajuste) |
| R4. Artistas homônimos ou músicas com mesmo título | baixa | médio | Canal do artista e "- Topic" pesam; o usuário sempre confirma (regra 2) |
| R5. Cache em memória cresce | baixa | baixo | `Map` com TTL e limpeza ao inserir (máx. 500 entradas) |
| R6. Busca lenta (2 s) na primeira abertura da preparação | média | baixo | Client Component com estado "Procurando…", sem bloquear o Server Component |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ Decisões tomadas pelo usuário: sempre pedir o clique; sem oficial, o mais visto com a duração certa.

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system, o contrato do worker ou `arquivo:linha`.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Contratos novos são aditivos (rota nova no worker e na API, código de erro novo); sem mudança no schema Prisma; changelog e bump previstos.
- [x] Perguntas em aberto foram exauridas.
- **Depende de:** sdd-001 (worker), sdd-003 (rotas), sdd-004 (tela de preparação). Todas implementadas.
