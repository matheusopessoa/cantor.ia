# Task: Criar três dificuldades (fácil sem afinação, médio tolerante, difícil rigoroso)

- **Slug:** difficulty-levels
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** api 1.4.0 · web 0.5.0 (minors; contratos aditivos com padrão)
- **App afetado:** ambos (nota, persistência e ranking na API; escolha, HUD e resultado no web)
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (campos novos com padrão em `Performance`, parâmetro opcional nas rotas de performance, campos novos no `ScoreResult`). Atenção: os pesos do difícil mudam a nota padrão (0,7/0,3 → 0,5/0,5), então notas novas e antigas não são comparáveis; as antigas não são recalculadas.
- **Ordem:** implementar depois da sdd-007 (letra alinhada) e da sdd-008.

## 1. Contexto e Motivação
- A nota atual é 70 % afinação + 30 % entrada no tempo, com crédito cheio até 50 cents e zero
  a partir de 100 (`SCORING_CONFIG`, `apps/api/src/services/scoring.service.ts:10`). É o
  único nível, e quem não canta bem só vê MISS: desanima e não mede o que a pessoa acertou.
  Pedido original: `specs/tasks.txt`, item 9.
- Três níveis: **Fácil** não mede afinação (letra no tempo + ritmo), **Médio** mede afinação
  com tolerância dobrada e já conta ritmo, **Difícil** mantém os limiares de hoje mas com
  afinação e tempo em pesos iguais. Pesos decididos pelo usuário em 2026-09-25.
- O algoritmo já tem quase tudo: entrada por verso (`scoreTiming`, `scoring.service.ts:205`),
  afinação com limiares parametrizados (`scorePitch`, `ramp(bestCents, fullCreditCents,
  zeroCreditCents)`) e cobertura da voz com folga de ±150 ms (`coverage`). Falta a precisão
  do ritmo, os limiares por nível e o peso por nível.
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §services: `scoringService` é pura; o nível entra como
    opção. `performance.service.ts` persiste e calcula o `rank` com `countBetter`;
    §repositories: o índice `(songId, score desc)` precisa incluir a dificuldade.
  - `specs/sdd-002-scoring/tasks.md`: calibração centralizada em `SCORING_CONFIG` (vira uma
    tabela por nível).
  - Design system (`readme.md`): `.ct-tabs` para escolha segmentada; `.ct-hud__value` e
    `.ct-hit` para feedback; `.ct-meter--pitch/--timing` existem, `--rhythm` entra primeiro no
    DS (readme + vitrine). O web já lê os limiares de PERFECT/GOOD de constantes
    (`apps/web/lib/pitch.ts`, `PERFECT_CENTS`/`GOOD_CENTS`): passam a vir do nível.

## 2. Escopo
- **Inclui**
  - `scoringService.score(ref, sung, lines, { offsetMs, difficulty })` com `Difficulty =
    "EASY" | "MEDIUM" | "HARD"` (padrão `HARD` = comportamento atual). `rhythmScore` novo,
    calculado sempre. Tabela por nível:

    | Nível | Afinação (crédito cheio / zero, cents) | Pesos afinação / tempo / ritmo |
    |---|---|---|
    | `HARD` | 50 / 100 (limiares de hoje) | 0,5 / 0,5 / 0 (hoje é 0,7 / 0,3 / 0) |
    | `MEDIUM` | 100 / 200 | 0,5 / 0,25 / 0,25 |
    | `EASY` | não conta (calculada com 100 / 200, informativa) | 0 / 0,5 / 0,5 |

  - `Performance.difficulty` (enum `Difficulty { EASY, MEDIUM, HARD }`, padrão `HARD`) e
    `Performance.rhythmScore`; ranking e `rank` por música **e** dificuldade; índice
    `(songId, difficulty, score desc)`. Migration.
  - `POST /:id/performances` aceita `difficulty` (padrão `HARD`); `GET /:id/performances`
    aceita `?difficulty=` (padrão `HARD`). `PerformanceResult` ganha `difficulty` e
    `rhythmScore`.
  - Web: escolha "Fácil | Médio | Difícil" na preparação (memorizada no dispositivo; padrão
    para quem nunca escolheu: **Médio**), enviada na performance e usada nos rankings; os
    limiares do feedback PERFECT/GOOD/MISS e do HUD seguem o nível; no fácil o HUD mostra
    "Ritmo", o feedback vira ON TIME / MISS e o highway mostra presença de voz (barras) em vez
    de curvas; o resultado mostra os medidores do nível (fácil: Tempo e Ritmo; médio e difícil:
    Afinação e Tempo). Ranking com o nível no título.
  - Testes na API (nota pura por nível + rotas + ranking por nível) e no web (helpers puros).
    DS: `.ct-meter--rhythm` e `.ct-hit--ontime` no readme e na vitrine.
- **Exclui**
  - Mudar os limiares de afinação do difícil (só os pesos mudam). Tempo por palavra. Ranking
    global entre músicas.
  - Recalcular performances antigas: recebem `HARD` e `rhythmScore = 0` pelo padrão da
    migration e mantêm a nota com que foram gravadas (0,7/0,3). Como o `sungTrack` fica
    guardado, um recálculo em lote é possível depois, fora deste escopo.

## 3. Impacto Arquitetural
- API: `services/scoring.service.ts` (ritmo, limiares e pesos por nível),
  `services/performance.service.ts`, `repositories/performance.repository.ts`,
  `controllers/performance.controller.ts`, `utils/validators.ts`, `prisma/schema.prisma`.
  Sem rota nova. Sem DI.
- Web: `lib/types.ts`, `lib/api.ts` (parâmetros), `lib/use-prefs.ts` (`useDifficulty`),
  `lib/pitch.ts` (`hitForCents(cents, thresholds)`, `presenceHit`, `DIFFICULTY_THRESHOLDS`),
  `components/song-prep.tsx`, `components/karaoke-session.tsx`, `components/pitch-canvas.tsx`
  (modo `activity`), `components/score-result.tsx`, `components/ranking-list.tsx` (título com
  o nível), `DESIGN_SYSTEM/components/game.css` (`.ct-meter--rhythm`, `.ct-hit--ontime`),
  readme e vitrine do DS.
- Fluxo:
  ```
  web prep ─ tabs Fácil|Médio|Difícil (use-prefs) ─► GET /:id/performances?difficulty=MEDIUM (ranking da aba)
  web sing ─ HUD/feedback com os limiares do nível ─► POST /:id/performances { playerName, offsetMs, difficulty, track }
                                                        └► performanceService.submit
                                                             ├ scoringService.score(ref, sung, alignedLyrics ?? lyrics, { offsetMs, difficulty })
                                                             ├ performanceRepository.create({ …, difficulty, rhythmScore })
                                                             └ countBetter(songId, difficulty, score) → rank
  ```
- Configuração por nível:
  ```
  SCORING_CONFIG.levels = {
    HARD:   { pitch: { fullCreditCents: 50,  zeroCreditCents: 100 }, weights: { pitch: 0.5, timing: 0.5,  rhythm: 0 } },
    MEDIUM: { pitch: { fullCreditCents: 100, zeroCreditCents: 200 }, weights: { pitch: 0.5, timing: 0.25, rhythm: 0.25 } },
    EASY:   { pitch: { fullCreditCents: 100, zeroCreditCents: 200 }, weights: { pitch: 0,   timing: 0.5,  rhythm: 0.5 } },
  }
  // searchWindowFrames, minCoverageForFullCredit, allowTransposition e toda a seção `timing` continuam iguais nos três.
  total = w.pitch·pitch + w.timing·timing + w.rhythm·rhythm
  ```
- Ritmo (`scoreRhythm`, puro; usa a mesma folga `searchWindowFrames` = ±150 ms da afinação):
  ```
  recall    = frames da referência com voz que têm voz cantada na janela ±150 ms / frames da referência com voz
              (é o `coverage` que scorePitch já calcula: reaproveitar, não recalcular)
  precision = frames cantados com voz que têm voz na referência na janela ±150 ms / frames cantados com voz
  rhythm    = 0 se recall = 0 ou precision = 0; senão 2·recall·precision / (recall + precision)   (F1)
  ```
  Cantar a música inteira sem parar: recall 1, precision ≈ fração de voz da referência (≈ 0,6),
  F1 ≈ 0,75, e o tempo dá 0 (não há onset por verso) → nota fácil ≈ 3,8. Ficar calado: 0.
  Cantar tudo no tom errado mas no lugar: tempo 10 e ritmo 10 → nota fácil 10.
- Feedback ao vivo no web (`karaoke-session.tsx`): `hitForCents` recebe os limiares do nível
  (`DIFFICULTY_THRESHOLDS[difficulty]`, iguais aos da API: 50/100 no difícil, 100/200 no
  médio); no fácil o feedback é `presenceHit` (ON TIME / MISS) e o HUD mostra a fração de
  janelas ON TIME como "Ritmo".

## 4. Contratos e Interfaces
- `prisma/schema.prisma`, migration `add_performance_difficulty`:
  ```prisma
  /// Nível da nota (sdd-009). Rankings são por música e nível. Performances anteriores à
  /// migration recebem HARD (limiares de afinação iguais), mas foram avaliadas com os pesos
  /// antigos (0,7/0,3) e não são recalculadas.
  enum Difficulty { EASY MEDIUM HARD }
  model Performance {
    …
    difficulty  Difficulty @default(HARD)
    /// 0..10: cantou quando a referência tem voz e calou quando não tem (sdd-009). Conta no EASY e no MEDIUM.
    rhythmScore Float      @default(0)
    @@index([songId, difficulty, score(sort: Desc)])   // substitui o índice (songId, score)
  }
  ```
- `utils/validators.ts`:
  ```ts
  export const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
  export type Difficulty = z.infer<typeof difficultySchema>;
  // performanceBodySchema += difficulty: difficultySchema.default("HARD")
  // rankingQuerySchema   += difficulty: difficultySchema.default("HARD")
  ```
- `services/scoring.service.ts`:
  ```ts
  export interface ScoreOptions { offsetMs?: number; difficulty?: Difficulty }   // padrão HARD
  export interface ScoreResult { …atual; rhythmScore: number; difficulty: Difficulty }
  // SCORING_CONFIG ganha `levels` (seção 3); as constantes compartilhadas ficam onde estão
  ```
- `services/performance.service.ts`: `PerformanceResult` herda `rhythmScore` e `difficulty`;
  `ranking(songId, difficulty, limit)`. `RankingItem` não muda (o nível é o da consulta).
- `repositories/performance.repository.ts`: `CreatePerformanceData += difficulty, rhythmScore`;
  `countBetter(songId, difficulty, score)`; `findTopBySong(songId, difficulty, limit)`.
- Rotas (aditivo, com padrão = comportamento atual):
  - `POST /api/songs/:id/performances` body `+ difficulty?: "EASY" | "MEDIUM" | "HARD"`; resposta
    `+ rhythmScore, difficulty`.
  - `GET /api/songs/:id/performances?limit=&difficulty=` (padrão `HARD`).
- **Web** `lib/types.ts`: `Difficulty`, `PerformanceResult += rhythmScore, difficulty`,
  `PerformanceBody += difficulty`. `lib/api.ts`: `getRanking(id, limit, difficulty)`.
  `lib/use-prefs.ts`: `useDifficulty(): [Difficulty, set]` (chave `cantor.ia:difficulty`,
  padrão `MEDIUM`). `lib/pitch.ts`:
  ```ts
  export const DIFFICULTY_THRESHOLDS: Record<Difficulty, { perfectCents: number; goodCents: number }>;  // HARD 50/100, MEDIUM e EASY 100/200
  export function hitForCents(cents: number, thresholds: { perfectCents: number; goodCents: number }): Hit;
  /** Feedback de ritmo do fácil numa janela de frames: "ontime" quando a presença cantada e a da referência coincidem (F1 ≥ 0,7), "miss" senão; null se nenhuma das duas tem voz. */
  export function presenceHit(reference: Frames, voice: Frames, from: number, to: number): "ontime" | "miss" | null;
  ```
  `components/pitch-canvas.tsx`: prop `mode: "pitch" | "activity"`; em `activity` a referência
  vira barras horizontais (segmentos com voz) numa faixa central em `--pitch-reference` e a
  voz cantada, barras em `--pitch-voice` numa faixa ao lado.
- DS (`game.css`, readme, vitrine): `.ct-meter--rhythm .ct-meter__bar { --meter-color: var(--fret-green) }`,
  `.ct-hit--ontime { color: var(--hit-perfect) }` (rótulo "On time", termo de HUD em inglês
  como PERFECT/MISS). Mapeamento novo documentado na tabela "Mapeamentos de jogo". Copy dos
  níveis (readme, "Voz e texto"): "Fácil: só letra no tempo e ritmo, sem afinação" ·
  "Médio: afinação com folga de um semitom" · "Difícil: afinação de meio semitom".
- Consumidores impactados: `apps/web` (envia `difficulty`, lê `rhythmScore`). Clientes antigos
  continuam funcionando pelo padrão `HARD`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Nota = 0,7·afinação + 0,3·tempo, afinação 50/100 cents | `HARD` = 0,5·afinação + 0,5·tempo (limiares 50/100); `MEDIUM` = 0,5·afinação + 0,25·tempo + 0,25·ritmo (limiares 100/200); `EASY` = 0,5·tempo + 0,5·ritmo, sem afinação | `specs/tasks.txt` item 9; pesos decididos pelo usuário em 2026-09-25 |
| 2 | — | `rhythmScore` = F1 entre a presença de voz cantada e a da referência com folga de ±150 ms; sempre calculado e devolvido | Seção 3 |
| 3 | Ranking e `rank` por música | Por música **e** nível: uma nota fácil nunca aparece na tabela do médio ou do difícil, e vice-versa | Justiça entre níveis |
| 4 | — | `difficulty` é gravada na performance e não muda depois | Auditabilidade |
| 5 | — | Sem `difficulty` no corpo ou na query, vale `HARD` (compatibilidade com clientes antigos e com as performances já gravadas, que ficam nesse ranking) | Contrato aditivo |
| 6 | — | No fácil, cantar em qualquer tom ou oitava dá a mesma nota; no médio e no difícil a transposição continua compensada (`allowTransposition`) | Pedido do usuário |
| 7 | O `offsetMs` do jogador ajusta a letra | Vale igual nos três níveis (é o mesmo `scoreTiming`) | sdd-004 regra 6 |
| 8 | Feedback ao vivo PERFECT ≤ 50 / GOOD ≤ 100 cents | Segue os limiares do nível, iguais aos da nota (médio: 100 / 200). O feedback nunca é mais rigoroso que a nota | Coerência entre tela e nota |
| 9 | — | O nível escolhido é memorizado no dispositivo (padrão Médio); preparação e resultado mostram o ranking do nível escolhido, com o nome do nível no título | UX |
| 10 | Highway mostra curvas de pitch | No fácil mostra presença de voz (barras): o jogo não pode sugerir que a afinação conta. Médio e difícil mantêm as curvas | DS: honestidade do feedback |

## 6. Critérios de Aceitação
- **Nota (sintético, `makeMelody`)**:
  - `HARD`: os limiares de afinação não mudam (os testes de afinação e de tempo de
    `scoring.service.spec.ts` passam como estão); só as expectativas de nota final mudam para
    0,5/0,5 (documentar cada expectativa alterada no PR).
  - `MEDIUM`: referência desafinada 75 cents (`addNoise` com sigma pequeno ou `transpose(0.75)`
    sem compensação de tom) tira afinação 10 (no difícil, entre 5 e 6); desafinada 150 cents
    tira afinação ≈ 5; 250 cents tira 0 em afinação nos dois. Cantar a própria referência
    = 10 (afinação 10, tempo 10, ritmo 10); `constant(track, 40)` (ritmo certo, nota errada)
    = 0,5·0 + 0,25·10 + 0,25·10 = 5,0.
  - `EASY`: cantar a própria referência = 10; transposta 5 semitons = 10; `constant(track, 40)`
    (mesmo ritmo, nota fixa errada) = 10 no fácil e < 6 no difícil; `randomNotes` contínuo →
    `timingScore` 0 e `rhythmScore` entre 6 e 8, nota fácil < 4; `silence` → 0; `truncate(0.5)`
    → ritmo ≈ F1 de recall 0,5 (≈ 6,7) e tempo ≈ 5.
  - `difficulty` omitida → resultado idêntico a `HARD`.
- **Rotas**: `POST` sem `difficulty` grava `HARD`; com `EASY`/`MEDIUM` grava e devolve
  `difficulty` e `rhythmScore`; `rank` conta só o mesmo nível; `GET` sem query devolve o
  ranking do difícil; `?difficulty=EASY` só o fácil; valor inválido → 400.
- **Performance**: `countBetter` e `findTopBySong` usam o índice
  `(songId, difficulty, score desc)` (conferir com `EXPLAIN` no smoke); ritmo em O(n) sobre os
  frames, reaproveitando o `coverage` (sem segunda varredura da referência).
- **Web**: escolha visível na preparação e persistida (padrão Médio); feedback com os
  limiares do nível; HUD "Ritmo" e ON TIME / MISS no fácil; resultado com os medidores do
  nível; ranking com o nível no título e a linha `is-you`; um `ct-btn--primary` por tela.
- **Qualidade**: `pnpm --filter api test`, `pnpm --filter web test`, `pnpm --filter web lint`,
  `pnpm --filter web build` verdes; `apps/api/docs/arquitetura.md`, readme do DS, `CHANGELOG.md`
  (api 1.4.0, web 0.5.0) e `apps/web/lib/types.ts` atualizados.
- **Critério de "pronto" (manual)**: uma pessoa que canta "mais ou menos" (erra por menos de
  um semitom) tira ≥ 7 no médio e ≤ 5 no difícil; falando a letra no ritmo sem cantar tira
  ≥ 7 no fácil e ≤ 4 no médio; falar por cima da música inteira tira ≤ 4 no fácil.

## 7. Plano de Testes
- **Unit (Vitest, API)**:
  - `tests/scoring/scoring.service.spec.ts`: `describe` por nível com os casos da seção 6,
    usando `helpers/tracks.ts` (`constant`, `transpose`, `addNoise`, `randomNotes`, `silence`,
    `truncate`); padrão `HARD` quando omitido.
  - `tests/performances/performances.spec.ts`: gravação de `difficulty` e `rhythmScore`, `rank`
    por nível, validação 400.
  - `tests/performances/ranking.spec.ts`: rankings separados por nível, padrão `HARD`, `limit`
    continua funcionando.
- **Unit (Vitest, web)**: `tests/pitch.spec.ts` ganha `hitForCents` com limiares do médio e
  `presenceHit` (coincide, falta voz, sobra voz, janela sem voz).
- **Manual/Smoke**: escolher cada nível, cantar/falar a letra, ver o feedback e o resultado;
  conferir que o ranking do difícil não muda; `prefers-reduced-motion` com os novos elementos.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Ritmo generoso demais para quem fala sem parar (F1 ≈ 0,75) | média | baixo | O tempo por verso zera sem onsets; nota fácil fica < 4; calibrar os pesos do fácil se preciso (critério manual) |
| R2. Médio ainda rigoroso ou frouxo demais | média | baixo | Limiares e pesos só em `SCORING_CONFIG.levels`; ajustar com as gravações do critério manual |
| R2b. Difícil muda de 0,7/0,3 para 0,5/0,5: rankings existentes misturam notas de duas fórmulas | baixa (poucas performances hoje) | baixo | Documentar no changelog; recálculo em lote a partir do `sungTrack` fica como follow-up se incomodar |
| R3. Letra desalinhada derruba o tempo nos três níveis | alta sem sdd-007 | alto | Implementar depois da sdd-007 |
| R4. Trocar o índice de ranking em banco com dados | baixa | baixo | Migration cria o novo índice e remove o antigo; volume pequeno |
| R5. Notas antigas no ranking do difícil foram calculadas com 0,7/0,3 | baixa | baixo | Ver R2b |
| R6. Highway em modo atividade é visual novo | média | baixo | Reaproveita o mesmo canvas e paleta; barras em vez de linhas |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ Pesos definidos pelo usuário (2026-09-25): difícil 0,5/0,5/0, médio
0,5/0,25/0,25, fácil 0/0,5/0,5. Decisões assumidas (revisar no review): padrão da API `HARD`
(compatibilidade) e padrão do web `MEDIUM` (novos jogadores); `rhythmScore` calculado em
todos os níveis; performances antigas recebem `HARD` e `rhythmScore = 0` sem recálculo.

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system, a sdd-002 ou `arquivo:linha`.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Mudança em schema Prisma e contratos é aditiva com padrão; migration, changelog e bump (api 1.4.0, web 0.5.0) previstos.
- [x] Perguntas em aberto foram exauridas.
- **Depende de:** sdd-002 (nota), sdd-003 (performances), sdd-004 (telas), sdd-007 (letra alinhada). A 007 ainda não foi implementada.
