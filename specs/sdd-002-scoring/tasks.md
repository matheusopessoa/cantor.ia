# Task: Implementar a função de nota (afinação + entrada no tempo)

- **Slug:** scoring
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** sem bump (código interno, sem rota). O bump acontece em sdd-003
- **App afetado:** api
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** none (tipos exportados internos, consumidos em sdd-003)

## 1. Contexto e Motivação
- O núcleo do produto é transformar "referência vs. voz cantada" numa nota de 0 a 10 que pareça
  justa. É o maior risco de produto, por isso vem isolado e testável **antes** de rotas e UI.
- Entradas: dois `PitchTrack` (formato definido em `specs/sdd-001-worker-pitch/tasks.md` §4) e
  as linhas do LRC. Saída: nota final, subnotas e detalhes por linha.
- Pedido original: `specs/tasks.txt`, item 2.
- Rastreabilidade:
  - Regra de negócio pertence a `services/` (`apps/api/docs/arquitetura.md`, seção
    `src/services/`: "não conhece HTTP nem SQL").
  - Helpers matemáticos sem estado de negócio vão para `utils/` (mesmo doc, seção `src/utils/`).
  - Schemas Zod de contrato ficam em `utils/validators.ts` (`AGENTS.md` §5 "Validação").

## 2. Escopo
- **Inclui**
  - `services/scoring.service.ts` com `scoringService.score(...)`.
  - `utils/pitch.ts` com helpers puros (dobra de oitava, mediana, detecção de onset).
  - Schemas Zod `pitchTrackSchema` e `lyricLineSchema` em `utils/validators.ts`, e os tipos
    inferidos exportados.
  - Constantes de calibração exportadas em `SCORING_CONFIG`.
  - Testes unitários com curvas sintéticas.
- **Exclui**
  - Rotas, banco, chamadas HTTP (sdd-003).
  - Parser de LRC (sdd-003, porque depende do formato do LRCLIB).
  - Nota de letra por ASR (fora do MVP).
  - DTW: substituído por busca em janela local, mais simples e O(n·w). DTW fica como evolução.

## 3. Impacto Arquitetural
- Camadas: `services` (regra) + `utils` (matemática pura). Nenhuma mudança em routes,
  controllers ou repositories.
- Novos arquivos:
  ```
  apps/api/src/services/scoring.service.ts
  apps/api/src/utils/pitch.ts
  apps/api/src/tests/scoring/scoring.service.spec.ts
  apps/api/src/tests/scoring/pitch.spec.ts
  apps/api/src/tests/helpers/tracks.ts      # geradores de PitchTrack sintético
  ```
- Alterado: `apps/api/src/utils/validators.ts` (novos schemas).
- Fluxo interno:
  ```
  score(reference, sung, lines, { offsetMs })
    │
    ├─ 1. alinhar: desloca `sung` por offsetMs (frames), corta/estende para o tamanho da referência
    ├─ 2. keyOffset = mediana de fold12(sung[i] - ref[i]) nos frames com voz nos dois lados
    ├─ 3. para cada frame i com voz na referência:
    │       melhor erro em cents buscando sung[j], |j-i| ≤ 15 frames (±150 ms)
    │       erro = |fold12(sung[j] - ref[i] - keyOffset)| * 100
    │       frameScore = 1 se erro ≤ 50; linear até 0 em 100; 0 se não houver voz na janela
    ├─ 4. accuracy = média de frameScore nos frames cobertos
    │     coverage = cobertos / frames com voz na referência
    │     pitch = accuracy × min(1, coverage / 0.6)
    ├─ 5. para cada linha do LRC com texto e voz na referência:
    │       onset = primeiro trecho ≥ 50 ms contínuo de voz cantada em [t - 800, t + 800] ms
    │       onsetScore = 1 se |Δ| ≤ 400 ms; linear até 0 em 800 ms; 0 se não houver onset
    │       presença = fração de frames com voz cantada dentro da linha
    │       lineScore = presença ≥ 0.25 ? onsetScore : 0
    │     timing = média de lineScore
    └─ 6. score = round1(10 × (0.7 × pitch + 0.3 × timing))
  ```
- `fold12(x)`: reduz uma diferença em semitons para o intervalo [-6, 6). É isso que faz cantar
  uma oitava abaixo ou acima valer o mesmo.
- Sem DI: `scoringService` é um objeto literal importado diretamente pelo futuro
  `performance.service.ts` (`AGENTS.md` §5 "Services/repositories").

## 4. Contratos e Interfaces
- `utils/validators.ts` (novo):
  ```ts
  export const pitchTrackSchema = z.object({
    version: z.literal(1),
    hopMs: z.literal(10),
    durationMs: z.number().int().positive().max(600_000),
    midi: z.array(z.number().min(20).max(110).nullable()).min(1).max(60_000),
  });
  export type PitchTrack = z.infer<typeof pitchTrackSchema>;

  export const lyricLineSchema = z.object({
    startMs: z.number().int().nonnegative(),
    text: z.string(),
  });
  export type LyricLine = z.infer<typeof lyricLineSchema>;
  ```
- `services/scoring.service.ts`:
  ```ts
  export const SCORING_CONFIG = {
    weights: { pitch: 0.7, timing: 0.3 },
    pitch: { fullCreditCents: 50, zeroCreditCents: 100, searchWindowFrames: 15,
             minCoverageForFullCredit: 0.6, allowTransposition: true },
    timing: { fullCreditMs: 400, zeroCreditMs: 800, minOnsetFrames: 5,
              minLinePresence: 0.25, lastLineDurationMs: 5_000 },
  } as const;

  export interface LineResult {
    index: number;
    startMs: number;
    onsetDeltaMs: number | null;  // + = atrasado, - = adiantado, null = não cantou
    score: number;                // 0..1
  }

  export interface ScoreResult {
    score: number;                // 0..10, 1 casa decimal
    pitchScore: number;           // 0..10, 1 casa decimal
    timingScore: number;          // 0..10, 1 casa decimal
    keyOffsetSemitones: number;   // transposição detectada, ex.: -2.0
    coverage: number;             // 0..1
    lines: LineResult[];
  }

  export interface ScoreOptions { offsetMs?: number }  // desloca a letra (ajuste manual do LRC)

  export const scoringService = {
    score(reference: PitchTrack, sung: PitchTrack, lines: LyricLine[], options?: ScoreOptions): ScoreResult;
  };
  ```
- `utils/pitch.ts`:
  ```ts
  export function fold12(semitones: number): number;
  export function median(values: number[]): number;
  export function findOnset(track: (number | null)[], fromFrame: number, toFrame: number, minRun: number): number | null;
  ```
- Erros: `referenceTrack` sem nenhum frame com voz → `InvalidReferenceError` (AppError 422)
  em `utils/errors.ts`. `sung` sem voz não é erro: a nota é 0.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Não existe nota | `nota = 10 × (0.7·afinação + 0.3·tempo)`, 1 casa decimal | MVP acordado com o usuário |
| 2 | — | Oitava é ignorada (comparação módulo 12 semitons) | MVP: "ignore a oitava" |
| 3 | — | Tom é compensado pela mediana da diferença; cantar afinado em outro tom não penaliza | MVP: "compense o tom" |
| 4 | — | Até 50 cents = acerto; crédito parcial até 100 cents | MVP |
| 5 | — | Tolerância de ±150 ms por frame na afinação | Absorve vibrato e pequenos atrasos (substitui DTW) |
| 6 | — | Cantar menos de 60% dos trechos com voz reduz a afinação proporcionalmente | Evita nota alta para quem canta 2 notas certas e fica em silêncio |
| 7 | — | Entrada da linha: ±400 ms = cheio; até 800 ms parcial | MVP |
| 8 | — | Linhas sem texto ou sem voz na referência (instrumentais) não contam | Evita punir silêncio correto |
| 9 | — | Silêncio total → nota 0 | Critério de "pronto" do MVP |

## 6. Critérios de Aceitação
- Função pura e determinística: mesma entrada → mesma saída; nenhum I/O.
- Complexidade O(n × 31) para n frames. Uma música de 10 min (60 mil frames) pontua em < 50 ms
  (teste de performance simples com `performance.now()`).
- Casos com curvas sintéticas:
  | Caso | Esperado |
  |---|---|
  | `sung` idêntico à referência | `score` = 10.0 |
  | `sung` = referência − 12 semitons (oitava abaixo) | `score` ≥ 9.8 |
  | `sung` = referência + 3 semitons (outro tom) | `score` ≥ 9.8, `keyOffsetSemitones` ≈ 3 |
  | `sung` = referência + ruído gaussiano de σ = 30 cents | `pitchScore` ≥ 9 |
  | `sung` = referência + 0.75 semitom constante em metade dos frames | `pitchScore` entre 4 e 7 |
  | `sung` = referência atrasada 100 ms | `score` ≥ 9.5 |
  | `sung` = referência atrasada 1 s | `timingScore` ≤ 2 |
  | `sung` todo `null` | `score` = 0 |
  | `sung` = MIDI aleatório uniforme entre 45 e 75 | `score` ≤ 3 |
  | `sung` com só os primeiros 30% da música | `score` ≤ 5 |
  | nota constante (monótona) sobre uma melodia variada | `pitchScore` ≤ 3 |
- `offsetMs = +500` com o LRC deslocado 500 ms devolve o mesmo `timingScore` do caso sem deslocamento.
- Nenhum valor `NaN`; todas as subnotas ficam em [0, 10].

## 7. Plano de Testes
- **Vitest** (`apps/api/src/tests/scoring/`):
  - `pitch.spec.ts`: `fold12` (0, 12, -12, 6, -6, 13.5), `median` (par/ímpar/vazio),
    `findOnset` (sem voz, voz curta demais, onset exato).
  - `scoring.service.spec.ts`: todos os casos da tabela da seção 6, `InvalidReferenceError`,
    performance com 60 mil frames.
  - `helpers/tracks.ts`: `makeMelody(seed, durationMs)`, `transpose`, `delay`, `addNoise` com
    PRNG seedado (determinístico).
  - Observação: esses testes não tocam o banco, mas o `setup.ts` global faz TRUNCATE mesmo
    assim. Aceitável (overhead pequeno), e não mexemos na config do Vitest.
- **Calibração manual (registrar resultado no PR):** extrair com o worker (`separate=false`) 3
  gravações reais de voz (boa, mediana e ruim/falada) sobre uma música conhecida e conferir o
  critério do MVP: boa ≥ 7, ruim ≤ 4. Ajustar `SCORING_CONFIG` se necessário.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Nota "parece injusta" com vozes reais apesar de passar nos sintéticos | média | alto | Calibração manual obrigatória. Constantes centralizadas em `SCORING_CONFIG` |
| Mediana de `fold12` instável perto de ±6 semitons (trítono) | baixa | médio | Média circular (ângulo em 12 semitons) se o teste de transposição +6 falhar |
| Falar em vez de cantar pontuar bem | baixa | médio | Fala tem pitch instável → erro alto. Coberto pelo caso "MIDI aleatório" |
| Busca em janela ±150 ms "perdoar" demais | baixa | baixo | Janela configurável. DTW como evolução |

Sem novas dependências npm.

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, `AGENTS.md` ou o MVP acordado.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Sem mudança em schema Prisma nem em rota pública.
- [x] Perguntas em aberto foram exauridas.
