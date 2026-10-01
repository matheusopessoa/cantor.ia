# Task: Controlar o volume da voz do cantor original durante o karaokê

- **Slug:** singer-volume
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** minor em cada app, sobre a versão vigente na implementação (hoje api 2.x, web 0.5.x, worker 0.3.x; a sdd-012 pode ter subido antes)
- **App afetado:** ambos + worker
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (rota nova na API e no worker; store novo no IndexedDB; nenhum campo Prisma)

## 1. Contexto e Motivação
- O browser toca o áudio inteiro da música (voz do cantor + instrumental num arquivo só), vindo
  do cache do aparelho ou de `GET /api/songs/:id/audio` (`karaoke-session.tsx`,
  `acceptAudio`/`begin`; `lib/audio-store.ts`). Não há como baixar só a voz original: truques
  no browser (cancelar o centro do estéreo) levam junto baixo, bumbo e caixa.
- Pedido do usuário (2026-09-26), `specs/tasks.txt` item 13: "dá pra baixar um pouco o volume
  da voz do cantor pra a gente ouvir mais nossa voz? sem baixar o volume do instrumental. Até
  mesmo um controle pra o volume da voz do cantor durante o karaokê".
- O worker já isola a voz com o Demucs em toda preparação (`apps/worker/app/separation.py`,
  `vocals`), mas devolve só a curva de pitch e descarta o áudio.
- Origem das trilhas: entre "separar na hora" e "guardar as trilhas no servidor", apresentadas ao
  usuário em 2026-09-26, o plano adota a **recomendada, separar na hora**, com cache no aparelho,
  porque o servidor não guarda áudio (regra 13 da `specs/sdd-003-api-songs/tasks.md`: o áudio é
  baixado a cada chamada e repassado, sem gravar). O usuário pediu o plano sem escolher
  explicitamente: confirmar na revisão do plano (trocar depois custa refazer a API e o cache).
- Rastreabilidade:
  - `apps/api/docs/arquitetura.md` §controllers/§clients: upload multipart no controller
    (`uploadReference` é o modelo) e repasse em streaming (`getSongAudio` é o modelo); a chamada
    ao worker entra por `worker.client.ts`.
  - `apps/worker/app/main.py` (`_extraction_lock`): uma extração por vez; a separação em trilhas
    usa o Demucs e entra no mesmo semáforo.
  - `apps/web/lib/audio-store.ts`: cache por música no IndexedDB, tudo em try/catch; as trilhas
    ganham um store próprio no mesmo banco.
  - Design system (`apps/web/DESIGN_SYSTEM/readme.md`): o slider usa `.ct-field` + `.ct-range`,
    igual ao "Sua voz no fone" (`MonitorField`); o progresso usa `.ct-progress`/`.ct-loading`.

## 2. Escopo
- **Inclui**
  - **Etapa 0 (go/no-go) antes do resto:** medir, em Chrome e Safari, o formato das trilhas
    (AAC em `.m4a`, Opus em `.webm`/`.ogg` ou MP3): decodifica no `decodeAudioData`, a soma voz
    + instrumental a 100 % soa igual ao original (sem eco/efeito de filtro), e o atraso de codec
    entre as duas trilhas é 0 e em relação ao original fica ≤ 30 ms. Escolhe o formato e registra
    no README do worker.
  - **Worker:** `separation.stems(wav) -> (vocals, instrumental)` em estéreo, com
    `instrumental = mix − vocals` (voz + instrumental = original); `POST /stems` (multipart
    `file`, mesmos limites do `/extract`) devolve `multipart/form-data` com os campos `vocals` e
    `instrumental` (arquivos no formato da Etapa 0). Dentro do semáforo.
  - **API:** `POST /api/songs/:id/stems` (multipart `file`, o áudio que o browser já tem) repassa
    ao worker e devolve o `multipart/form-data` dele em streaming; `workerClient.separateStems`.
  - **Web:**
    - `lib/stems-store.ts` (store `song-stems` no IndexedDB, versão do banco sobe para 2).
    - `lib/singer-volume.ts` (0–100 %, passo 5, padrão 50 %, memorizado no aparelho) +
      `useSingerVolume` em `lib/use-prefs.ts`.
    - `api.separateStems(id, audio)` lendo a resposta com `response.formData()`.
    - Sessão de karaokê: gera as trilhas em segundo plano assim que o áudio da música está
      pronto e elas não estão em cache; com trilhas, toca voz e instrumental sincronizadas
      (duas `AudioBufferSourceNode` com o mesmo `start`) com um `GainNode` só na voz; sem
      trilhas, toca o original como hoje. Slider "Voz do cantor" antes e durante a cantoria.
    - A segunda saída (`lib/music-output.ts`) recebe a mistura (voz ajustada + instrumental).
  - Testes (pytest, Vitest da API e do web), lint, docs (`arquitetura.md`, README do worker,
    `DESIGN_SYSTEM/readme.md` se o slider ganhar variação, `CHANGELOG.md`).
- **Exclui**
  - Guardar trilhas no servidor ou gerá-las na preparação (§1).
  - Trocar de original para trilhas no meio da música (se as trilhas ficarem prontas durante a
    cantoria, valem na próxima).
  - Volume do instrumental, equalização, mudar o tom ou a velocidade.
  - Usar a voz separada na nota (a nota continua pela curva de pitch da referência).

## 3. Impacto Arquitetural

Arquivos novos:
- `apps/worker/tests/test_stems.py` (rota e `stems` com separador falso)
- `apps/api/src/tests/songs/songs.stems.spec.ts`
- `apps/web/lib/stems-store.ts`, `apps/web/lib/singer-volume.ts`,
  `apps/web/tests/singer-volume.spec.ts`
- Componente `SingerVolumeField` dentro de `karaoke-session.tsx` (como o `MonitorField`) ou em
  `components/singer-volume-field.tsx`.

Sem DI; controller → service → client, como o upload de referência (`arquitetura.md`).

Fluxo:

```
sing page: áudio da música pronto (cache, download ou arquivo)
  └─ stems no IndexedDB? ── sim ─► usa
                         └─ não ─► POST /api/songs/:id/stems  (multipart: o próprio áudio, em 2º plano)
                                     song.controller → songService.separateStems (música existe?)
                                       → workerClient.separateStems(buffer, filename)
                                          worker POST /stems: ffmpeg → Demucs → mix − voz → 2 arquivos
                                       ◄─ multipart/form-data { vocals, instrumental } (stream)
                                   browser: response.formData() → salva no IndexedDB
"Começar":
  voz ─► BufferSource ─► GainNode (Voz do cantor) ─┐
  inst ─► BufferSource ────────────────────────────┴─► bus ─► destination (fone)
                                                         └─► segunda saída (caixa/TV)
  microfone ─► retorno (GainNode) ─► destination        (como hoje; nunca na segunda saída)
```

## 4. Contratos e Interfaces

### Worker
```python
def stems(wav: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(2, amostras) a 44,1 kHz → (voz, instrumental) estéreo; instrumental = mix − voz."""
```
`POST /stems` — multipart `file`. 200: `multipart/form-data` com dois arquivos, `vocals` e
`instrumental` (formato da Etapa 0, mesma taxa e mesmo número de amostras). Erros: os do
`/extract` (`too_large` 413, `invalid_audio` 415, `too_long` 422, `internal` 500). Sem `no_voice`:
música instrumental devolve voz silenciosa.

### API
- `POST /api/songs/:id/stems` — multipart `file` (limite de 20 MB do `app.ts`). 200: repassa o
  corpo e o `content-type` (com `boundary`) do worker, em streaming. Erros: música inexistente →
  404; sem arquivo → 400 (`MissingUploadFileError`); worker fora ou falha → 502
  `STEMS_UNAVAILABLE` (nova `StemsUnavailableError`); códigos de arquivo do worker → 413/415/422
  como no upload de referência.
- `workerClient.separateStems(audio: Buffer, filename: string): Promise<WorkerStems>` com
  `WorkerStems = { stream: ReadableStream<Uint8Array>; contentType: string }`; aceita só
  `multipart/form-data`; timeout `WORKER_TIMEOUTS_MS.stems = 5 min`.
- `songService.separateStems(id, audio, filename)`: confere que a música existe e repassa.

### Web
```ts
// lib/singer-volume.ts (puro, testado)
export const SINGER_MIN = 0, SINGER_MAX = 100, SINGER_STEP = 5, DEFAULT_SINGER_VOLUME = 50;
export function normalizeSingerVolume(value: number): number;
export function singerGain(volume: number): number;           // 0–1
export function loadSingerVolume(): number; export function saveSingerVolume(v: number): void;

// lib/stems-store.ts (IndexedDB, try/catch como audio-store)
export interface SongStems { vocals: Blob; instrumental: Blob; sourceSize: number }
export function getSongStems(songId: string): Promise<SongStems | null>;
export function saveSongStems(songId: string, stems: SongStems): Promise<void>;

// lib/api.ts
separateStems(id: string, audio: Blob, signal?: AbortSignal): Promise<{ vocals: Blob; instrumental: Blob }>;

// lib/use-prefs.ts
export function useSingerVolume(): [number, (value: number) => void];
```
`sourceSize` = tamanho do áudio de onde as trilhas saíram: trilha de outro áudio (o arquivo da
música foi trocado) é descartada e gerada de novo.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | O servidor não guarda áudio (sdd-003, regra 13) | Continua: as trilhas saem do áudio que o browser envia e só ficam no IndexedDB do aparelho | Opção recomendada (§1) |
| 2 | — | As trilhas são geradas em segundo plano assim que o áudio da música está pronto na tela de cantar, se não estiverem em cache; uma vez por música por aparelho | Pedido do usuário |
| 3 | — | Sem trilhas (gerando, falhou, sem IndexedDB), a música toca o original, como hoje; o slider fica desabilitado com a explicação | Não travar a cantoria |
| 4 | — | "Voz do cantor" de 0 a 100 %, passo 5, padrão 50 %, memorizado no aparelho; muda o volume na hora, sem estalo (`setTargetAtTime`), antes e durante | Pedido do usuário |
| 5 | — | 100 % soa como o original (voz + instrumental = mix); 0 % é só o instrumental | Etapa 0 |
| 6 | Segunda saída recebe a música (sdd do áudio em duas fontes) | Recebe a mistura com a voz ajustada; o retorno do microfone continua só no fone | Mesma regra de antes |
| 7 | Duração do áudio confere com a letra (±10 s) | As trilhas herdam a duração do original; se a decodificada divergir do original em mais de 100 ms, a sessão descarta as trilhas e toca o original | Sincronia |
| 8 | Nota pela curva de pitch da referência | Sem mudança: o volume da voz original não entra na nota | Escopo |

## 6. Critérios de Aceitação
- **Etapa 0 (go/no-go):** um formato em que Chrome e Safari decodificam as duas trilhas, a soma a
  100 % é indistinguível do original de ouvido e o atraso entre voz e instrumental é 0 amostras
  (e ≤ 30 ms em relação ao original). Sem formato que passe: **no-go**, voltar ao usuário.
- **Sincronia:** as duas fontes começam no mesmo `start(startTime)` do mesmo `AudioContext`; o
  relógio da letra e da nota (`getTimeMs`) não muda.
- **Desempenho:** geração ≤ 2 min por música de 3–4 min em CPU (o Demucs sozinho leva 50–95 s na
  Etapa 0 da sdd-011); tamanho das duas trilhas ≤ 2× o áudio original; a API não carrega o
  arquivo de resposta inteiro em memória (streaming, como o `/audio`).
- **Concorrência:** a geração ocupa o semáforo do worker como uma extração; uma preparação de
  referência espera, sem erro.
- **Robustez:** sem IndexedDB ou com falha na geração, a cantoria funciona com o original; nenhum
  erro sobe como tela de erro.
- **Compatibilidade:** tudo aditivo; testes existentes passam; `CHANGELOG.md` com as três
  entradas.

## 7. Plano de Testes
- **Worker (pytest, separador falso):** `stems` devolve `instrumental = mix − voz` e estéreo;
  `/stems` responde `multipart/form-data` com `vocals` e `instrumental` do mesmo número de
  amostras; arquivo grande → 413; ilegível → 415; longo → 422; tmp limpo. `-m slow`: Demucs de
  verdade num áudio de 10 s.
- **API (Vitest):** `POST /stems` repassa corpo e `content-type` do worker (mock); música
  inexistente → 404; sem arquivo → 400; worker fora → 502 `STEMS_UNAVAILABLE`; código de arquivo
  do worker → 413/415/422; `workerClient.separateStems` recusa `content-type` que não é
  multipart.
- **Web (Vitest, funções puras):** `normalizeSingerVolume`, `singerGain`, padrão e limites.
- **Manual/Smoke:** abrir a tela de cantar de uma música pronta → "Preparando a voz do cantor"
  → slider habilita; cantar com 0 %, 50 % e 100 %; mexer durante a música; recarregar e ver que
  vem do cache; com segunda saída, a caixa acompanha o volume; Safari e Chrome.
- **Lint/testes:** `pnpm --filter web lint && test`, `pnpm --filter api test`, `uv run pytest`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. Atraso de codec (MP3/AAC) desalinha as trilhas do original ou entre si | média | eco/efeito de filtro, letra fora do tempo | Etapa 0 escolhe o formato; as duas trilhas no mesmo formato e configuração; regra 7 descarta trilhas com duração divergente |
| R2. Demucs em CPU ocupa o worker ~1–2 min por música | certa | uma preparação de referência espera | Uma vez por música por aparelho; semáforo existente |
| R3. Upload do áudio do browser para a API (4–8 MB) | certa | alguns segundos na rede local | Só na 1ª vez; limite de 20 MB já existe |
| R4. IndexedDB cheio ou bloqueado | baixa | trilhas não ficam em cache | Try/catch (como `audio-store`); toca o original |
| R5. Demucs deixa resto de voz no instrumental | média | 0 % não é karaokê perfeito | Esperado do `htdemucs`; aviso no hint do slider |

Dependências: nenhuma nova (Demucs e ffmpeg já estão no worker; `Response.formData()` é nativo
nos browsers e no Node).

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma bloqueante — a origem das trilhas segue a opção recomendada, a confirmar na revisão do
plano, §1; o padrão de 50 % segue o pedido "baixar um pouco" e é memorizado depois da primeira
mudança)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md`, o design system ou o código.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva, com go/no-go da Etapa 0.
- [x] Sem mudança em schema Prisma; contratos públicos aditivos.
- [x] Perguntas em aberto foram exauridas.
