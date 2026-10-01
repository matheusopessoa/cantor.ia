# Task: Alinhar automaticamente a letra ao áudio que toca

- **Slug:** lyrics-alignment
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** api 1.2.0 (minor, contrato aditivo) · web 0.3.0
- **App afetado:** ambos (regra e persistência na API; o web só consome)
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (2 campos novos em `Song` e no `SongDto`; nenhuma rota nova; nada removido)

## 1. Contexto e Motivação
- A letra sincronizada vem do LRCLIB, cronometrada em cima de outra gravação. O áudio que toca
  (YouTube ou arquivo) pode ter intro diferente, andamento diferente e linhas fora do lugar.
  A API aceita até 10 s de diferença de duração (`DURATION_TOLERANCE_MS`,
  `apps/api/src/services/song.service.ts:23`), então o desvio pode passar dos ±2 s do ajuste
  manual (`performanceBodySchema.offsetMs`, `apps/api/src/utils/validators.ts:52`).
- Um deslocamento global não corrige deriva de andamento (o erro cresce ao longo da música) nem
  linhas individuais. Pedido original: `specs/tasks.txt`, item 7 ("está impossível reconciliar
  manualmente").
- Já existe o sinal certo para alinhar: a referência de pitch é extraída do **mesmo** áudio que
  toca (`runReference`, `song.service.ts:129`), e os frames com voz dizem onde cada frase
  começa. Alinhar a letra é casar os inícios de linha do LRC com os inícios de frase da
  referência.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §services: `scoring.service.ts` é função pura sem
    repositório; o alinhamento segue o mesmo modelo (`alignment.service.ts`).
  - `apps/api/docs/arquitetura.md` §repositories: `songSummarySelect` sem `referenceTrack`;
    `findWithReference` é o único ponto que o carrega. O alinhamento acontece quando a
    referência já está em memória (`runReference`), sem query extra.
  - A nota já avalia cada linha em `startMs - offsetMs` (`scoreTiming`,
    `scoring.service.ts:205`); com a letra alinhada, o `offsetMs` do jogador vira ajuste fino.
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`, "Telas → componentes"): o aviso de
    "não alinhada" usa `.ct-alert--warning`; o ajuste continua no `.ct-range`.

## 2. Escopo
- **Inclui**
  - `alignLyrics(lines, reference)` pura em `apps/api/src/services/alignment.service.ts`:
    segmentos com voz → onsets de frase → deslocamento global por varredura → encaixe linha a
    linha nos onsets → ordem crescente. **Nunca muda a velocidade da letra** (sem escala de
    andamento): decisão do usuário em 2026-09-25 ("precisa ser na mesma velocidade; se a letra
    acabar antes do áudio ou vice-versa, ossos do ofício"). Linha sem onset por perto recebe só
    o deslocamento global.
  - Helper matemático puro em `apps/api/src/utils/pitch.ts` (`voicedSegments`).
  - Persistência: `Song.alignedLyrics` (`LyricLine[]`, nulo quando não alinhou) e
    `Song.lyricsAlignment` (diagnóstico: `shiftMs`, `matchedRatio`, `aligned`),
    gravados no `markReady` e zerados no claim e no `markFailed` (valem só para a referência
    atual). Migration Prisma.
  - `SongDto` ganha `alignedLyrics` e `lyricsAlignment`. `GET /:id/reference` não muda.
  - A nota (`performance.service.ts`) passa a usar `alignedLyrics ?? lyrics`.
  - Backfill preguiçoso: música `READY` sem `alignedLyrics` (processada antes desta versão)
    é alinhada e gravada na primeira leitura (`songService.getById`).
  - Web: karaokê e `LyricsView` usam `alignedLyrics ?? lyrics`; a tela de preparação mostra
    "Letra alinhada ao áudio" (com o deslocamento) ou um aviso quando não alinhou; o slider
    passa a ser "ajuste fino" e o `lib/types.ts` espelha o DTO.
  - Testes Vitest na API (função pura com melodias sintéticas + rotas) e no web (helper puro).
- **Exclui**
  - Alinhamento por transcrição (Whisper/ASR na voz isolada) para versões com estrutura
    diferente (refrão a mais, ao vivo). Fica como sdd futura; reaproveita `alignedLyrics`.
  - Tempo por palavra. Mudar o algoritmo da nota (sdd-002) além da troca das linhas.
  - Corrigir deriva de andamento (esticar ou encolher a letra): a velocidade da letra é sempre
    a original. Se a versão do áudio for mais rápida ou mais lenta, as linhas sem onset por
    perto ficam com o deslocamento global e a diferença no fim da música é aceita.
  - Editor manual linha a linha no web.
  - Reprocessar em lote as músicas já existentes (o backfill preguiçoso cobre uma a uma).

## 3. Impacto Arquitetural
- Camadas: `services` (`alignment.service.ts` novo, `song.service.ts`,
  `performance.service.ts`), `repositories` (`song.repository.ts`), `utils/pitch.ts`,
  `utils/validators.ts` (schema do diagnóstico), `prisma/schema.prisma`. Sem rota nova, sem
  controller novo. Sem DI: `song.service.ts` importa `alignmentService` diretamente.
- Web: `lib/types.ts`, `lib/lyrics.ts` (helper `effectiveLyrics`), `components/karaoke-session.tsx`,
  `components/song-prep.tsx`.
- Fluxo:
  ```
  POST /:id/reference[/youtube] ──202──► runReference (background)
       worker → PitchTrack ─► checa duração (±10 s)
                            ─► alignmentService.align(song.lyrics, track)   ← novo
                            ─► songRepository.markReady({ referenceTrack, referenceAudioMs,
                                                          alignedLyrics, lyricsAlignment })
  GET /:id ────────────────► songService.getById
                              READY && alignedLyrics == null → findWithReference → align → save (backfill)
                              → SongDto { …, alignedLyrics, lyricsAlignment }
  POST /:id/performances ──► performanceService.submit
                              scoringService.score(ref, sung, song.alignedLyrics ?? song.lyrics, { offsetMs })
  web /songs/[id]/sing ────► lines = effectiveLyrics(song)  (letra + canvas + nota usam as mesmas linhas)
  ```
- Algoritmo (`alignmentService.align`), todo em ms sobre a grade de 10 ms:
  ```
  ALIGNMENT_CONFIG = {
    segment: { mergeGapMs: 250, minSegmentMs: 80, minSilenceBeforeOnsetMs: 350 },
    shift:   { searchRangeMs: 12_000, stepMs: 10, toleranceMs: 400, minMatchedRatio: 0.5, minLines: 3 },
    snap:    { toleranceMs: 350, minLineGapMs: 200 },
  }

  1. segments = voicedSegments(track.midi, hopMs, mergeGapMs, minSegmentMs)
       // runs de frames != null; buracos ≤ mergeGapMs são unidos; runs < minSegmentMs descartados
  2. onsets = segments cujo silêncio anterior ≥ minSilenceBeforeOnsetMs (o 1º segmento conta)
     → number[] ordenado (startMs de cada um)
  3. textLines = lines com text.trim() != "" ; se textLines < minLines ou onsets < minLines
     → { aligned: false } (devolve alignedLyrics = null)
  4. deslocamento global:
       para d de -searchRangeMs a +searchRangeMs, passo stepMs:
         score(d) = Σ_l credit(|nearest(onsets, start_l + d) − (start_l + d)|)   // credit = max(0, 1 − dist/toleranceMs)
       d* = argmax; empate → menor |d|.   (nearest por busca binária; 2 401 × N × log M)
  5. por linha (na ordem original, que já é crescente pelo parseLrc):
       t = start_l + d*                      // só deslocamento: a velocidade da letra nunca muda
       se a linha tem texto e existe onset livre com |onset − t| ≤ snap.toleranceMs → t = onset (marca o onset como usado)
       t = max(t, t_anterior + minLineGapMs); t = clamp(t, 0, track.durationMs)
  6. matchedRatio = linhas com texto encaixadas / textLines
     aligned = matchedRatio ≥ minMatchedRatio
     resultado = { aligned, shiftMs: d*, matchedRatio: round(., 3), lines: aligned ? alignedLines : null }
  ```
  A convenção de sinal do diagnóstico é `alinhado = original + shiftMs` (o `offsetMs` do
  jogador continua com a semântica da nota: positivo = letra atrasada, avaliada em
  `startMs − offsetMs`, agora com limite de ±10 s). Os dois conceitos não se misturam: o
  jogador ajusta **sobre** a letra alinhada. Sem escala de andamento, por decisão do usuário:
  se o áudio for mais rápido ou mais lento que a gravação do LRC, a diferença acumulada fica
  nas linhas sem onset por perto e no fim da música.

## 4. Contratos e Interfaces
- `prisma/schema.prisma` (model `Song`), com comentários no schema e migration
  `add_lyrics_alignment`:
  ```prisma
  /// LyricLine[] alinhada ao áudio da referência atual (sdd-007). Nulo até READY ou quando
  /// o alinhamento não bateu (matchedRatio < 0.5): consumidores usam `lyrics`.
  alignedLyrics   Json?
  /// { aligned, shiftMs, matchedRatio } — diagnóstico do alinhamento (sdd-007).
  lyricsAlignment Json?
  ```
- `utils/validators.ts`:
  ```ts
  export const lyricsAlignmentSchema = z.object({
    aligned: z.boolean(),
    shiftMs: z.number().int(),
    matchedRatio: z.number().min(0).max(1),
  });
  export type LyricsAlignment = z.infer<typeof lyricsAlignmentSchema>;
  ```
- `services/alignment.service.ts`:
  ```ts
  export const ALIGNMENT_CONFIG: { segment: …; shift: …; snap: … };
  export interface AlignmentResult extends LyricsAlignment { lines: LyricLine[] | null; }
  export const alignmentService = {
    align(lines: LyricLine[], reference: PitchTrack): AlignmentResult;
  };
  ```
- `utils/pitch.ts`:
  ```ts
  export interface VoicedSegment { startMs: number; endMs: number }
  export function voicedSegments(track: readonly (number | null)[], hopMs: number, mergeGapMs: number, minSegmentMs: number): VoicedSegment[];
  ```
- `repositories/song.repository.ts`:
  ```ts
  interface MarkReadyData { referenceTrack; referenceAudioMs; alignedLyrics: Prisma.InputJsonValue | typeof Prisma.DbNull; lyricsAlignment: Prisma.InputJsonValue }
  saveAlignment(id: string, data: { alignedLyrics; lyricsAlignment }): Promise<void>   // backfill
  // songSummarySelect += alignedLyrics, lyricsAlignment; claimForProcessing e markFailed zeram os dois
  ```
- `services/song.service.ts` (`SongDto`, aditivo):
  ```ts
  alignedLyrics: LyricLine[] | null;
  lyricsAlignment: LyricsAlignment | null;   // null enquanto não READY
  ```
- `services/performance.service.ts`: `scoringService.score(ref, track, song.alignedLyrics ?? song.lyrics, { offsetMs })`.
  `LineResult.startMs` passa a ser o `startMs` da linha alinhada (é o que a nota avaliou).
- Web `lib/types.ts`: espelha os dois campos. `lib/lyrics.ts`:
  ```ts
  export function effectiveLyrics(song: Pick<SongDto, "lyrics" | "alignedLyrics">): LyricLine[];
  ```
- Consumidores impactados: `apps/web` (usa `SongDto`). Nenhum campo removido ou renomeado.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | A letra usada na tela e na nota é a do LRCLIB, sem alteração | Ao ficar `READY`, a API alinha a letra à referência e grava `alignedLyrics`; tela e nota usam `alignedLyrics ?? lyrics` | `specs/tasks.txt` item 7 |
| 2 | — | O alinhamento só vale para a referência atual: claim e `FAILED` zeram os campos; nova referência gera novo alinhamento | Coerência com regra 12 da sdd-003 |
| 3 | — | Deslocamento global procurado em ±12 s (cobre os 10 s de tolerância de duração mais folga) | `DURATION_TOLERANCE_MS` (`song.service.ts:23`) |
| 4 | — | A velocidade da letra nunca muda (sem escala de andamento). Cada linha recebe o deslocamento global e, se houver onset a até 350 ms, encaixa nele; a diferença que sobrar no fim da música é aceita | Decisão do usuário (2026-09-25): "precisa ser na mesma velocidade" |
| 5 | — | Menos da metade das linhas com texto casando com um onset → `aligned: false`, `alignedLyrics = null`, tudo cai no comportamento atual | Deslocamento errado é pior que nenhum |
| 6 | O `offsetMs` do jogador (±10 s) é o único ajuste | Continua existindo, aplicado **sobre** a letra alinhada, como ajuste fino. O web memoriza por música como hoje | Regra 6 da sdd-004 (faixa ampliada em 2026-09-25) |
| 7 | — | Linhas sem texto (instrumentais) são transformadas (deslocamento e deriva) mas nunca encaixadas em onset | Mesma exceção de `scoreTiming` |
| 8 | — | Cada onset encaixa no máximo uma linha; a ordem das linhas é preservada com ≥ 200 ms entre elas | Evita duas linhas no mesmo instante |
| 9 | Música `READY` antiga não tem alinhamento | `GET /:id` alinha e grava na primeira leitura (uma query extra com `referenceTrack`, uma vez por música) | Backfill sem script |
| 10 | — | O algoritmo é determinístico e puro: mesma letra + mesma referência → mesmo resultado | Testabilidade |

## 6. Critérios de Aceitação
- **Correção (sintético, `makeMelody`)**: letra deslocada em +3 s, −1,5 s e +9 s volta ao lugar
  com erro ≤ 30 ms por linha; jitter por linha de ±150 ms é corrigido para ≤ 10 ms; com áudio
  1,5 % mais lento (linhas escaladas), as linhas com onset a até 350 ms encaixam e as demais
  ficam só com o deslocamento global, sem nenhuma escala aplicada (`shiftMs` inteiro, linhas
  restantes = original + shiftMs).
- **Recusa**: referência sem relação com a letra (`randomNotes`) ou deslocada além de 12 s →
  `aligned: false` e `alignedLyrics: null`. Referência só com silêncio → `aligned: false`
  (sem lançar).
- **Nota**: música com letra deslocada 3 s e alinhamento gravado, cantada exatamente na
  referência, dá `timingScore ≥ 8`; a mesma cantoria com `alignedLyrics = null` dá `timingScore`
  baixo (comprova que a nota usa a letra alinhada).
- **Performance**: `align` de uma música de 10 min (60 000 frames, 150 linhas) roda em < 200 ms
  (varredura 2 401 offsets × 150 linhas × busca binária). Nenhuma query além das já feitas em
  `runReference`; o backfill faz 1 leitura + 1 escrita, só uma vez por música. Sem N+1.
- **Contrato**: `GET /:id` devolve os dois campos; `songs.search` e `GET /:id/reference` não
  mudam. `songSummarySelect` continua sem `referenceTrack`.
- **Web**: karaokê, canvas e nota usam as mesmas linhas (`effectiveLyrics`). Preparação mostra
  "Letra alinhada ao áudio (+3,2 s)" ou o aviso "Não conseguimos alinhar a letra: use o ajuste
  fino". Copy em pt-BR, sem código cru (DS "Voz e texto").
- **Qualidade**: `pnpm --filter api test`, `pnpm --filter web test`, `pnpm --filter web lint` e
  `pnpm --filter web build` verdes. `apps/api/docs/arquitetura.md`, `CHANGELOG.md` (api 1.2.0 e
  web 0.3.0) e `apps/web/lib/types.ts` atualizados.
- **Critério de "pronto" (manual)**: na música já cadastrada (Tiago Iorc, "official audio"),
  a primeira linha aparece junto com a voz sem mexer no slider, e o diagnóstico mostra
  `matchedRatio ≥ 0,7`.

## 7. Plano de Testes
- **Unit (Vitest, API)**:
  - `tests/alignment/alignment.service.spec.ts` (só função pura, sem banco): casos da seção 6
    usando `helpers/tracks.ts` (`makeMelody`, `shiftLines`, `randomNotes`, `silence`) e
    helpers novos `scaleLines(lines, factor)` (áudio mais lento/rápido) e
    `jitterLines(lines, seed, ms)`;
    linhas vazias preservadas; ordem crescente garantida; onset usado por uma linha só;
    determinismo (duas chamadas iguais → `toEqual`).
  - `tests/scoring/pitch.spec.ts`: `voicedSegments` (une buracos ≤ 250 ms, descarta < 80 ms,
    bordas).
  - `tests/songs/songs.reference.spec.ts` e `songs.reference-youtube.spec.ts`: ao chegar em
    `READY`, `alignedLyrics` e `lyricsAlignment` gravados (worker falso devolvendo a
    `melody.track` e letra deslocada no seed); `FAILED` e novo claim zeram os campos.
  - `tests/songs/songs.get.spec.ts` (novo ou dentro do existente): backfill em `GET /:id` para
    música `READY` sem alinhamento; segunda leitura não regrava (spy no repositório).
  - `tests/performances/*.spec.ts`: nota usa `alignedLyrics` (cenário da seção 6).
- **Unit (Vitest, web)**: `tests/lyrics.spec.ts` ganha `effectiveLyrics` (com e sem
  `alignedLyrics`).
- **Manual/Smoke**: reprocessar/abrir a música do Tiago Iorc; conferir a primeira linha e o
  diagnóstico; cantar com fone e ver a nota de tempo subir em relação a antes.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Backing vocals e coros ficam na faixa "vocals" do Demucs e criam onsets espúrios | média | baixo | Encaixe só dentro de 350 ms; onset usado uma vez; `minMatchedRatio` |
| R2. LRC com linhas que começam no meio da frase (sem silêncio antes) | alta | baixo | Sem onset, a linha só recebe deslocamento e deriva (nunca piora em relação a hoje) |
| R3. Versão com estrutura diferente (refrão a mais/menos): varredura casa metade errada | baixa (busca sugere "official audio") | médio | `aligned: false` cai no comportamento atual; solução de verdade é ASR (fora do escopo) |
| R4. Áudio com andamento diferente do LRC: as linhas sem onset por perto acumulam diferença | média | médio | Aceito pelo usuário; o encaixe por onset corrige as linhas que têm respiração antes; o ajuste manual de ±10 s cobre o início |
| R5. Backfill em `GET /:id` carrega `referenceTrack` (400 KB) | baixa | baixo | Acontece uma vez por música; grava e não repete |
| R6. `LineResult.startMs` muda de significado para o web (linha alinhada) | baixa | baixo | O web só conta linhas fora do tempo; documentar no `PerformanceResult` |
| R7. Migration em banco com músicas `READY` existentes | baixa | baixo | Campos opcionais; backfill preguiçoso |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ Decisões assumidas (revisar no review, não bloqueiam): campos aditivos em vez de
substituir `lyrics`; `alignedLyrics = null` quando não alinha; backfill preguiçoso em `GET /:id`
em vez de script.

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou `arquivo:linha`.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Mudança em schema Prisma e `SongDto` é aditiva (`additive`), com migration planejada,
      changelog e bump (api 1.2.0, web 0.3.0) previstos.
- [x] Perguntas em aberto foram exauridas.
- **Depende de:** sdd-002 (nota), sdd-003 (rotas e `Song`), sdd-004 (telas). Todas implementadas.
