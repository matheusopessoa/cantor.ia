# Task: Alinhar a letra ao áudio pelo texto (alinhamento forçado com IA)

- **Slug:** lyrics-forced-alignment
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** worker 0.2.0 · api 1.3.0 · web 0.3.1 (tudo aditivo)
- **App afetado:** ambos + worker (o alinhador roda no worker; a regra de aceite fica na API; o web só consome e ganha "Refazer")
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (campo opcional `alignment` na resposta do worker; campo opcional `lyrics` na entrada; `LyricsAlignment.method`; flag opcional `redo` nas rotas de referência; nenhum campo removido; sem migration)

## 1. Contexto e Motivação
- A sdd-007 alinhou a letra casando início de linha com **pausa** da voz. Nos dados reais isso
  não existe: medição em 2026-09-26 sobre 5 referências gravadas no banco de dev (Pitty, Infiel,
  Eduardo e Mônica, Tempo Perdido, Borboletas) mostra trechos contínuos com voz de mediana
  2–5 s e p90 de 6–12 s, e só 12–30 inícios de frase para 30–70 linhas de letra. A maior parte
  das linhas do LRC começa **no meio de um trecho cantado**. Resultado: de 11 músicas
  processadas com a sdd-007, 1 alinhou (`matchedRatio` 0,56); as outras ficaram entre 0,18 e
  0,40 e caíram na letra original. Em várias, a varredura global até acertou (Pitty: −9 980 ms
  vs. os +10 000 ms que a jogadora precisou pôr no slider; Infiel: +6 880 vs. −6 600), mas sem
  pausas para encaixar não há como validar nem corrigir linha a linha.
- Pedido do usuário (2026-09-26): "não deu certo. pense em outras estratégias. pode até usar AI
  pra isso. melhorou mas ainda tenho que ajustar manualmente o tempo antes de ficar bom".
- O que falta ao método atual é o **texto**: sabemos exatamente o que é cantado em cada linha.
  Alinhamento forçado (CTC) da letra conhecida sobre a voz isolada dá o instante de cada palavra
  independentemente de pausas, intro, deriva de andamento e linhas coladas. O `torchaudio`
  2.11 já instalado no worker traz `torchaudio.pipelines.MMS_FA` (wav2vec2 treinado para
  alinhamento forçado multilíngue, alfabeto romanizado que cobre o português) e
  `torchaudio.functional.forced_align` (verificado no `.venv` em 2026-09-26). Sem dependência
  nova; só o checkpoint (1,26 GB, `dl.fbaipublicfiles.com/mms/torchaudio/ctc_alignment_mling_uroman/model.pt`),
  baixado uma vez como os pesos do Demucs.
- Alternativa avaliada e **não** escolhida como principal: transcrever com Whisper e casar o
  texto transcrito com o LRC. Exige dependência nova (`faster-whisper`) e outro modelo, o ASR
  erra bastante em voz cantada e os timestamps por palavra do Whisper são menos precisos
  (~200 ms) que os do CTC (20 ms). Fica como plano B (§8, R1) se o spike falhar.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §clients: `worker.client.ts` valida toda resposta com Zod e
    o `song.service.ts` traduz códigos; o novo campo entra por esse caminho.
  - `apps/api/docs/arquitetura.md` §services: `alignment.service.ts` é função pura sem
    repositório; continua sendo, agora recebendo também o resultado do worker.
  - `apps/worker/app/main.py:68-73` (`_extract_sync`): a voz isolada (`separation.vocals`) já
    está em memória quando o crepe roda; o alinhador entra ali, sem segunda separação.
  - `apps/worker/README.md:74-75`: extração hoje leva ~72 s (Demucs ~51 s); o orçamento novo
    está no §6.
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`, "Telas → componentes", linha "Preparar
    música, pronta"): o aviso de alinhamento já existe (`.ct-alert--success/--warning`); o
    botão "Refazer" usa `.ct-btn--ghost` (só um `--primary` por tela).

## 2. Escopo
- **Inclui**
  - **Worker** — módulo `app/alignment.py`: `load()` (pesos do `MMS_FA` no lifespan, como
    `separation.load`/`pitch.load`), `normalize_line(text) -> list[str]` (romanização simples:
    NFKD sem marcas combinantes, minúsculas, só `[a-z']`; o resto some), `emissions(mono_44k)`
    (reamostra para 16 kHz, roda o wav2vec2 em janelas de 20 s sem sobreposição e concatena os
    log-probs; frame de 20 ms), `align_lines(log_probs, lines) -> list[LineAlignment]`
    (`forced_align` + `merge_tokens`, um resultado por linha, com `*` entre linhas cujo
    intervalo no LRC passa de `STAR_GAP_MS`). `POST /extract` e `POST /youtube/extract` aceitam
    `lyrics` opcional e devolvem `alignment` opcional junto do `PitchTrack`. `GET /health`
    ganha `models.mms_fa`. Dockerfile baixa os pesos no build.
  - **API** — `workerClient.extract/extractFromYoutube` recebem a letra e devolvem
    `{ track, alignment }`; `alignment.service.ts` ganha o caminho "forçado" (aceita linha a
    linha por pontuação, preenche as recusadas pelo deslocamento da vizinha, garante ordem) e
    mantém o caminho por pausas como fallback quando o worker não devolve alinhamento;
    `LyricsAlignment.method` (`"forced" | "onset"`); flag `redo` nas rotas de referência para
    reprocessar uma música `READY` (é o único jeito de alinhar as 16 músicas já cadastradas:
    o alinhamento precisa do áudio, que não é guardado).
  - **Web** — `lib/types.ts` espelha `method`; a tela de preparação diz como alinhou e, em
    música `READY` vinda do YouTube, oferece "Refazer melodia e letra" (reenvia o mesmo
    `youtubeVideoId` com `redo`); em música de upload, "Refazer" abre o envio do arquivo.
  - **Etapa 0 (spike, go/no-go)** antes do resto: script em `apps/worker/scripts/align_spike.py`
    que roda Demucs + MMS_FA em 3 músicas reais (Pitty, Infiel, Tempo Perdido) e imprime o
    início de cada linha, a pontuação e a diferença para `original − offsetMs` usado pelas
    jogadoras (Pitty +10 000, Infiel −6 600). Critério de go no §6. Resultado registrado no
    README do worker.
  - Testes: pytest do worker (sem modelo real), Vitest da API (função pura com fixtures do
    worker + rotas), Vitest do web (`effectiveLyrics` continua) e lint.
- **Exclui**
  - Whisper/ASR (plano B, sdd futura se o spike falhar).
  - Tempo por palavra na tela (o worker devolve `startMs`/`endMs` por linha; guardar palavra a
    palavra fica para depois).
  - Mudar a nota (sdd-002) além de continuar usando `alignedLyrics ?? lyrics`.
  - Editor manual linha a linha; remover o slider (continua como ajuste fino).
  - Melhorar o método por pausas (os dados mostram que não é questão de limiar).
  - Realinhar em lote: cada música é refeita pelo usuário com "Refazer".
  - GPU/MPS (o worker segue em CPU, como Demucs e crepe).

## 3. Impacto Arquitetural
- Worker: novo `app/alignment.py`; `main.py` (rotas, `_extract_sync`, health), `schemas.py`
  (`LyricsLine`, `LineAlignment`, `Alignment`, `ExtractResponse`), `errors.py`
  (`invalid_lyrics`), `Dockerfile`, `README.md`, testes.
- API: `clients/worker.client.ts`, `services/alignment.service.ts`, `services/song.service.ts`
  (`runReference` passa a letra; `claim` aceita `redo`), `repositories/song.repository.ts`
  (`claimForProcessing(id, videoId, { redo })`), `controllers/song.controller.ts` (lê `redo`),
  `utils/validators.ts` (`forcedAlignmentSchema`, `method`). Sem rota nova, sem migration
  (`lyricsAlignment` é `Json`). Sem DI: imports diretos.
- Web: `lib/types.ts`, `lib/api.ts` (`redo`), `components/song-prep.tsx`.
- Fluxo:
  ```
  POST /:id/reference[/youtube] { ..., redo? } ──202──► runReference(song)
      workerClient.extract*(…, song.lyrics)
        worker: ffmpeg → Demucs(vocals) ─┬─► crepe ─────────────► PitchTrack
                                         └─► 16 kHz → wav2vec2 (MMS_FA) → forced_align → Alignment
        ◄── { ...PitchTrack, alignment: Alignment | null }
      alignmentService.align(song.lyrics, track, alignment)   ← forçado; fallback por pausas
      songRepository.markReady({ referenceTrack, alignedLyrics, lyricsAlignment: { …, method } })
  web /songs/[id] READY ──"Refazer melodia e letra"──► POST /:id/reference/youtube { url, redo: true }
  ```
- Algoritmo do worker (`align_lines`), pseudocódigo:
  ```
  ALIGN_CONFIG = { chunkS: 20, frameMs: 20, starGapMs: 4000, minTokens: 2 }
  tokens = []; spans_por_linha = []
  para cada linha i (na ordem do LRC):
      chars = normalize_line(text)           # [] para instrumental ou só símbolos
      se i > 0 e (start_i − start_{i−1}) > starGapMs: tokens += ['*']   # trecho não transcrito (adlib, refrão a mais)
      se len(chars) < minTokens: spans_por_linha[i] = None; continue
      ini = len(tokens); tokens += chars; spans_por_linha[i] = (ini, len(tokens))
  se len(tokens) < minTokens ou len(tokens) > T (frames): devolve None para todas as linhas
  path, scores = forced_align(log_probs[None], targets[None], blank=0)
  spans = merge_tokens(path[0], scores[0])                       # um TokenSpan por token não-blank
  para cada linha com (ini, fim): s = spans[ini..fim)
      startMs = s[0].start * frameMs; endMs = s[-1].end * frameMs; score = média(s.score)
  ```
- Algoritmo da API (`alignmentService.align(lines, reference, forced)`):
  ```
  FORCED_CONFIG = { minLineScore: 0.4, minMatchedRatio: 0.5, minLineGapMs: 200, maxLineDurationMs: 20_000 }
  se forced == null → caminho atual por pausas (method "onset")
  aceitas = linhas com texto cujo forced[i].startMs != null e score ≥ minLineScore
            e (endMs − startMs) ≤ maxLineDurationMs
  matchedRatio = aceitas / linhas com texto; se < minMatchedRatio → { aligned: false, method: "forced" }
  para cada linha (ordem original):
      aceita → t = forced.startMs
      recusada/instrumental → t = original + delta da linha aceita anterior (ou da próxima, no início)
      t = max(t, t_anterior + minLineGapMs); clamp em [0, durationMs]
  shiftMs = mediana(t_aceita − original) arredondada (só diagnóstico e copy da tela)
  ```
  Os limiares de `FORCED_CONFIG`/`ALIGN_CONFIG` são pontos de partida: a etapa 0 calibra com as
  3 músicas reais e registra os valores finais no README do worker.

## 4. Contratos e Interfaces
- **Worker** (aditivo ao contrato da sdd-001 §4):
  - `POST /extract` — multipart: `file`, `separate?`, **`lyrics?`** (string JSON de
    `LyricsLine[]`). `POST /youtube/extract` — JSON `{ videoId, separate?, lyrics?: LyricsLine[] }`.
  - `200` → `ExtractResponse = PitchTrack & { alignment: Alignment | null }` (`null` quando
    não veio `lyrics`, quando nenhuma linha tem texto alinhável ou quando o alinhador falha
    de forma controlada, ex.: mais tokens que frames).
  - Novo erro `400 invalid_lyrics` (JSON de `lyrics` malformado; a API traduz para `INTERNAL`,
    porque é bug e não erro do usuário).
  - `GET /health` → `{ status, models: { demucs, crepe, mms_fa } }`.
  - Pydantic:
    ```python
    class LyricsLine(BaseModel):
        text: str
    class LineAlignment(BaseModel):
        index: int                 # posição em `lyrics`
        startMs: int | None
        endMs: int | None
        score: float | None        # média das probabilidades dos tokens da linha, 0..1
    class Alignment(BaseModel):
        version: Literal[1] = 1
        model: Literal["mms_fa"] = "mms_fa"
        frameMs: Literal[20] = 20
        lines: list[LineAlignment]  # exatamente len(lyrics) itens, na mesma ordem
    class ExtractResponse(PitchTrack):
        alignment: Alignment | None = None
    ```
- **API** `utils/validators.ts`:
  ```ts
  export const lineAlignmentSchema = z.object({ index: z.number().int().nonnegative(), startMs: z.number().int().nonnegative().nullable(), endMs: z.number().int().nonnegative().nullable(), score: z.number().min(0).max(1).nullable() });
  export const forcedAlignmentSchema = z.object({ version: z.literal(1), model: z.literal("mms_fa"), frameMs: z.literal(20), lines: z.array(lineAlignmentSchema) });
  export type ForcedAlignment = z.infer<typeof forcedAlignmentSchema>;
  export const lyricsAlignmentSchema = z.object({ aligned, shiftMs, matchedRatio, method: z.enum(["forced", "onset"]).optional() });   // `optional`: linhas gravadas pela sdd-007 não têm o campo
  ```
- `clients/worker.client.ts`:
  ```ts
  export interface WorkerExtraction { track: PitchTrack; alignment: ForcedAlignment | null }
  extract(audio: Buffer, filename: string, lyrics: LyricLine[]): Promise<WorkerExtraction>
  extractFromYoutube(videoId: string, lyrics: LyricLine[]): Promise<WorkerExtraction>
  // resposta validada com pitchTrackSchema.extend({ alignment: forcedAlignmentSchema.nullable().default(null) });
  // `alignment` inválido → WorkerClientError("invalid_response")
  ```
- `services/alignment.service.ts`:
  ```ts
  export const FORCED_CONFIG = { minLineScore: 0.4, minMatchedRatio: 0.5, minLineGapMs: 200, maxLineDurationMs: 20_000 } as const;
  align(lines: LyricLine[], reference: PitchTrack, forced?: ForcedAlignment | null): AlignmentResult   // AlignmentResult ganha `method`
  ```
- `repositories/song.repository.ts`: `claimForProcessing(id, youtubeVideoId, options: { redo: boolean }, now?)`
  — com `redo`, o `where` aceita também `referenceStatus: "READY"`.
- Rotas existentes (aditivo): `POST /:id/reference/youtube` body `{ url, redo?: boolean }`;
  `POST /:id/reference` campo multipart `redo?` (`"true"`). `youtubeReferenceBodySchema` e um
  `referenceRedoSchema` para o campo do multipart. Sem `redo`, `READY` continua 409 (regra da
  sdd-003).
- `SongDto.lyricsAlignment` passa a incluir `method?: "forced" | "onset"`; `apps/web/lib/types.ts`
  espelha. `lib/api.ts`: `setReferenceFromYoutube(id, url, { redo })`, `uploadReference(id, file, { redo })`.
- Consumidores impactados: `apps/web` (só aditivo). Nada removido ou renomeado.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Letra alinhada casando início de linha com pausa da voz (sdd-007) | O worker alinha o **texto** de cada linha sobre a voz isolada (CTC); a API aceita linha a linha por pontuação. Sem pausa não é mais problema | Medição de 2026-09-26 (§1) |
| 2 | — | Sem `lyrics` no pedido, o worker se comporta exatamente como hoje (`alignment: null`); a API só manda a letra em `runReference` | Compatibilidade com o contrato da sdd-001 |
| 3 | — | Linha instrumental ou sem caractere alinhável nunca é enviada ao aligner (`startMs: null`) e recebe o deslocamento da vizinha aceita | Mesma exceção de `scoreTiming` |
| 4 | `aligned` exige metade das linhas encaixadas em pausa | `aligned` exige metade das linhas com texto **aceitas** (`score ≥ minLineScore`, duração ≤ 20 s); abaixo disso, `alignedLyrics = null` e tudo cai na letra original | Deslocamento errado é pior que nenhum (sdd-007 regra 5) |
| 5 | A velocidade da letra nunca muda | Continua: cada linha aceita vai para onde é cantada de fato; as recusadas só recebem o deslocamento da vizinha. Nenhuma escala é aplicada | Decisão do usuário (sdd-007) |
| 6 | Referência `READY` nunca é reprocessada (409) | Com `redo: true` explícito, `READY` volta a `PROCESSING` e tudo é refeito (melodia + alinhamento). Se falhar, a música fica `FAILED` e o usuário refaz. `PROCESSING` recente continua 409 mesmo com `redo` | Necessário para as 16 músicas já cadastradas; pedido do usuário |
| 7 | Fallback: — | Se o worker devolve `alignment: null` (modelo indisponível, letra sem texto), a API usa o método por pausas e grava `method: "onset"` | Degradação controlada |
| 8 | `shiftMs` = deslocamento global da varredura | Com `method: "forced"`, `shiftMs` = mediana de (alinhado − original) das linhas aceitas; só para o diagnóstico e o texto da tela | Copy "Letra alinhada ao áudio (+9,9 s)" |
| 9 | — | Trecho do LRC com intervalo > 4 s entre linhas ganha um `*` no alvo do CTC, para o áudio não transcrito ali (adlib, refrão a mais, solo) não puxar a linha seguinte | Tutorial de alinhamento forçado do torchaudio (token `<star>`) |
| 10 | Uma extração por vez (semáforo) | O alinhador roda dentro do mesmo semáforo, depois do crepe; janelas de 20 s limitam a memória da atenção do wav2vec2 | `main.py:27-29` |

## 6. Critérios de Aceitação
- **Go/no-go da etapa 0** (registrar no README do worker): nas 3 músicas reais, ≥ 80 % das
  linhas com texto aceitas (`score ≥ minLineScore`) e o início da primeira linha cantada a
  ≤ 300 ms de `original − offsetMs` usado pelas jogadoras (Pitty: +10 000; Infiel: −6 600).
  Se falhar depois de calibrar os limiares, **parar** e planejar o plano B (Whisper) em vez de
  implementar o resto.
- **Worker**: sinal sintético não serve para o CTC de fala, então os testes unitários usam
  log-probs **fabricados** (picos dos tokens em frames conhecidos) e checam que `align_lines`
  devolve exatamente esses instantes, um `*` por intervalo grande, `None` para linha sem texto
  e `None` geral quando há mais tokens que frames (sem exceção). `normalize_line("Não, 'tava
  ali!")` → `naotavaali` (sem espaços nem pontuação; acentos e ç removidos). `/extract` com
  `lyrics` devolve `alignment.lines` com `len(lyrics)` itens na ordem; sem `lyrics` devolve
  `alignment: null` e o corpo idêntico ao de hoje; `lyrics` malformado → `400 invalid_lyrics`.
  `/health` inclui `mms_fa`.
- **Desempenho**: música de 4 min pelo `/youtube/extract` em **≤ 4 min** de ponta a ponta no
  Mac de dev (hoje 72 s; o wav2vec2-large em CPU deve ficar entre 60 e 120 s). Pico de RAM do
  worker ≤ 6 GB (medir com o spike). Os timeouts da API (10/12 min) continuam valendo.
- **API**: `alignmentService.align(lines, track, forced)` com fixture: aceita as linhas com
  `score ≥ 0,4`, recusa abaixo, interpola as recusadas pelo delta da vizinha, mantém ordem com
  ≥ 200 ms, `method: "forced"`, `shiftMs` = mediana; `matchedRatio < 0,5` → `aligned: false`;
  `forced = null` → caminho por pausas com `method: "onset"` e os testes da sdd-007 continuam
  verdes. `runReference` envia `song.lyrics` ao worker (spy) e grava `method`. `redo`: `READY`
  + `redo` → 202 e `PROCESSING` com alinhamento zerado; `READY` sem `redo` → 409; `PROCESSING`
  recente + `redo` → 409. Worker devolvendo `alignment` com formato inválido →
  `invalid_response` → `FAILED INTERNAL`. `GET /:id` não muda além do `method`.
- **Contrato**: `songs.search`, `GET /:id/reference` e `POST /:id/performances` não mudam.
- **Web**: preparação mostra "Letra alinhada ao áudio (+9,9 s)" também para `method: "forced"`
  e o botão "Refazer melodia e letra" em `READY` (ghost); ao clicar, a tela entra em
  `PROCESSING` com o polling existente. Copy em pt-BR, sem código cru.
- **Qualidade**: `uv run pytest` (worker), `pnpm --filter api test`, `pnpm --filter web test`,
  `pnpm --filter web lint`, `pnpm --filter web build` verdes. `apps/worker/README.md`,
  `apps/api/docs/arquitetura.md`, `CHANGELOG.md` (worker 0.2.0, api 1.3.0, web 0.3.1),
  `AGENTS.md` §2/§11 (linha do `torchaudio` passa a citar o `MMS_FA`) e o readme do design
  system atualizados.
- **Critério de "pronto" (manual)**: refazer Pitty "Na Sua Estante" e Marília "Infiel" pelo
  botão; a primeira linha aparece junto com a voz com o slider em 0 e a nota de tempo de uma
  cantoria no tempo fica ≥ 8 sem ajuste manual.

## 7. Plano de Testes
- **Worker (pytest, sem rede e sem modelo)**: `tests/test_alignment.py` — `normalize_line`
  (acentos, ç, apóstrofo, dígitos, vazio), `align_lines` com log-probs fabricados (instantes
  exatos, `*` só em intervalo > 4 s, linha sem texto → `None`, mais tokens que frames → `None`
  geral, ordem dos índices preservada), `emissions` fatiando em 20 s (mock do modelo devolvendo
  tensores de forma conhecida → concatenação com `T = round(dur/20 ms)` ±1). `tests/test_api.py`
  — `/extract` e `/youtube/extract` com e sem `lyrics` (monkeypatch em `app.alignment.emissions`
  e `app.alignment.is_loaded`), `invalid_lyrics`, `/health`. Marcador `slow` para o pipeline
  real com um trecho de 10 s.
- **API (Vitest)**: `tests/alignment/alignment.service.spec.ts` — casos do §6 com fixtures
  `ForcedAlignment` construídas a partir de `melody.lines` (`helpers/tracks.ts` ganha
  `forcedFrom(lines, { score, drop, jitter })`); os testes atuais por pausas continuam.
  `tests/songs/songs.reference*.spec.ts` — worker falso devolve `{ track, alignment }`; letra
  enviada ao worker; `method` gravado; `alignment: null` → `"onset"`; `alignment` inválido →
  `FAILED INTERNAL`; `redo` (3 cenários do §6). `tests/songs/songs.get.spec.ts` — `method`
  no DTO; linha antiga sem `method` continua válida.
- **Web (Vitest)**: `tests/lyrics.spec.ts` inalterado; `tests/format.spec.ts` inalterado.
  Smoke manual do "Refazer".
- **Manual/Smoke**: etapa 0 (spike) e o critério de pronto do §6.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. O wav2vec2 de fala alinha mal voz cantada (vibrato, notas longas, reverb do stem) | média | alto | Etapa 0 com go/no-go antes de implementar o resto; limiares calibrados; plano B: Whisper + casamento de texto (sdd futura) |
| R2. Checkpoint de 1,26 GB: download no primeiro start e imagem Docker maior | alta | baixo | Mesmo tratamento dos pesos do Demucs (`Dockerfile` baixa no build; `TORCH_HOME=/models/torch`); documentar no README |
| R3. RAM: wav2vec2-large em CPU + Demucs na mesma requisição | média | médio | Rodam em sequência dentro do semáforo; janelas de 20 s; medir pico no spike (≤ 6 GB) |
| R4. Tempo por música sobe (hoje 72 s) | alta | baixo | Orçamento ≤ 4 min (§6); timeouts da API já são 10/12 min; a tela já mostra tempo decorrido |
| R5. `*` entre linhas "rouba" o começo da linha seguinte (início atrasado) | média | médio | `*` só em intervalo > 4 s; calibrar `starGapMs` no spike; comparar com e sem `*` |
| R6. Áudio com estrutura diferente do LRC (refrão a mais, versão ao vivo) | média | médio | `*` absorve o excesso; linhas com `score` baixo são recusadas e interpoladas; `matchedRatio < 0,5` recusa tudo (comportamento atual) |
| R7. `redo` numa música `READY` que falha deixa a música `FAILED` | baixa | médio | Só com flag explícita e clique do usuário; a tela já trata `FAILED` com "tentar de novo" |
| R8. Letras em inglês/outros idiomas latinos | baixa | baixo | O `MMS_FA` é multilíngue com alfabeto romanizado; a normalização é a mesma |
| R9. Mudança do retorno de `workerClient.extract*` quebra os mocks dos testes | alta | baixo | Atualizar `vi.mocked(...)` para `{ track, alignment }` nos 3 specs de referência |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ Decisões assumidas (revisar no review, não bloqueiam): alinhador no worker e
gate na API (mantém `alignment.service.ts` puro e testável); `redo` como flag nas rotas
existentes em vez de rota nova; limiares iniciais de `FORCED_CONFIG`/`ALIGN_CONFIG` calibrados
na etapa 0; `MMS_FA` do torchaudio em vez de `ctc-forced-aligner`/`whisperx` (zero dependência
nova).

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou `arquivo:linha`.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva, com go/no-go.
- [x] Mudanças de contrato são aditivas (`additive`); sem migration (campo `Json`); changelog e
      bump previstos (worker 0.2.0, api 1.3.0, web 0.3.1).
- [x] Perguntas em aberto foram exauridas.
- **Depende de:** sdd-001 (worker), sdd-003 (rotas e `Song`), sdd-007 (`alignedLyrics`,
  `alignment.service.ts`, tela). Todas implementadas.
