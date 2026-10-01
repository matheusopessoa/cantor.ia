# Task: Transcrever a voz pela API da OpenAI (whisper-1), com o Whisper local de reserva

- **Slug:** transcription-openai
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-26
- **Status:** ready
- **Versão-alvo:** worker minor sobre a vigente na implementação (hoje 0.3.0 → 0.4.0; a sdd-012/013 podem ter subido antes). API e web sem mudança.
- **App afetado:** worker (+ env/compose/docs na raiz)
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (variável de ambiente nova e opcional `OPENAI_API_KEY`; `GET /health` ganha `transcription`; contrato de `/extract` e `/youtube/extract` inalterado)

## 1. Contexto e Motivação
- A transcrição da sdd-011 roda na CPU do Mac (`app/transcription.py`, `faster-whisper`
  `large-v3-turbo` int8): **21–89 s por música**, cerca de um terço do processamento, somada ao
  Demucs (54–94 s), crepe (20–33 s) e MMS_FA (11–20 s) (`apps/worker/README.md`, "Resultado do
  go/no-go da sdd-011"). O worker chega a 367 % de CPU (medido em 2026-09-26).
- Pedido do usuário (2026-09-26): "ficou pesado pra nossa CPU", "o mais fácil é o Whisper, faça
  com ele". Decisões do usuário (2026-09-26): modelo **`whisper-1`**; sem chave ou com a API fora,
  **manter o Whisper local como reserva**.
- Fatos da doc da OpenAI (consultada em 2026-09-26, `developers.openai.com/api/docs/guides/speech-to-text`
  e `/guides/your-data`): só `whisper-1` devolve tempo por palavra/segmento
  (`response_format=verbose_json`, `timestamp_granularities[]=word` e `segment`); `prompt` até
  224 tokens; arquivo até 25 MB (MP3, M4A, WAV, WebM…); nenhuma probabilidade por palavra;
  `/v1/audio/transcriptions` sem retenção (nem de abuso nem de estado) e sem treino.
- Rastreabilidade:
  - `apps/worker/app/main.py` (`_select_lyrics`): a transcrição já é isolada numa chamada
    `transcription.transcribe(mono, prompt) -> Transcript`, com degradação controlada (falha →
    primeira candidata, `wer: null`). A troca fica **dentro** de `transcription.py`.
  - `apps/worker/app/lyrics_selection.py` (`hint_starts`, `transcript_lines`) usa `Word.startMs`
    e `Word.endMs`: por isso `whisper-1`, que mantém esse contrato.
  - `AGENTS.md` §11 (convenção de env, regra 5: nome imposto por ferramenta é mantido →
    `OPENAI_API_KEY`; regra 7: modelo e limites são constantes no código, não env).

## 2. Escopo
- **Inclui**
  - `app/config.py` (novo): configuração do worker validada com `pydantic-settings`
    (`OPENAI_API_KEY: SecretStr | None`), lida do ambiente e, fora do Docker, do `.env` da raiz
    (mesma regra da API em `apps/api/src/config/env.ts`). Primeira variável de ambiente do
    worker.
  - `app/transcription.py`: dois provedores atrás da mesma `transcribe(mono, prompt) -> Transcript`:
    - **`openai`** (quando há chave): codifica a voz isolada em MP3 mono 16 kHz 64 kbps
      (ffmpeg, no tmp da requisição), `POST https://api.openai.com/v1/audio/transcriptions`
      com `model=whisper-1`, `response_format=verbose_json`,
      `timestamp_granularities[]=word` e `segment`, `prompt`; converte para `Transcript`.
    - **`local`** (sem chave, ou reserva quando a OpenAI falha): o `faster-whisper` de hoje,
      carregado **sob demanda** (não no boot quando há chave: não ocupa RAM à toa).
  - Filtro de invenção sem `vad_filter` nem probabilidade por palavra (R6 da sdd-011): descartar
    as palavras de segmentos com `no_speech_prob > 0,6` **e** `avg_logprob < -1,0`, ou com
    `compression_ratio > 2,4` (repetição em laço). `Word.probability` = `exp(avg_logprob)` do
    segmento da palavra (o campo continua existindo; a sdd-012 planeja guardá-lo).
  - Cliente HTTP com `httpx` (já no lock, sobe de `dev` para dependência de produção): timeout
    de 120 s, 1 nova tentativa em rede/timeout/429/5xx (espera 2 s); 4xx restante não repete.
  - `GET /health`: `models.whisper` passa a dizer se a transcrição local está carregada (como
    hoje) e entra `transcription: "openai" | "local"` (provedor principal).
  - `lifespan` e `Dockerfile`: com chave, o `transcription.load()` do boot não roda; os pesos
    continuam baixados no build (a reserva não pode depender de rede).
  - `scripts/transcribe_spike.py`: flag `--provider openai|local` para a Etapa 0 abaixo.
  - Env: `.env.example`, `docker-compose.yml` (`environment:` do worker com
    `OPENAI_API_KEY: ${OPENAI_API_KEY:-}`), `AGENTS.md` §11, `apps/worker/README.md`,
    `CHANGELOG.md`.
  - Testes (pytest, sem rede): conversão da resposta, filtro de segmentos, reserva local,
    health, config.
- **Exclui**
  - Terceirizar o Demucs, o crepe ou o MMS_FA.
  - `gpt-transcribe`/`gpt-4o-*-transcribe` (sem tempo por palavra; descartado pelo usuário).
  - Mudança no contrato do worker para a API, na API ou no web.
  - Limite de gasto/orçamento no código (fica no painel da OpenAI: limite mensal por projeto).
  - Cache de transcrição (o áudio não é guardado; redo transcreve de novo).

## 3. Impacto Arquitetural

Camadas: só o worker (`app/config.py` novo, `app/transcription.py`, `app/main.py` no
`lifespan`/`health`, `app/audio.py` ganha a codificação para MP3 a partir do array). Sem DI:
módulos importados diretamente, como hoje. O semáforo de extração (`main.py`,
`_extraction_lock`) continua cobrindo a transcrição: ela roda dentro do `_extract_sync`.

```
_extract_sync (thread, dentro do semáforo)
  ffmpeg → Demucs(voz) → crepe
  └─ lyricsCandidates? → _select_lyrics(mono, candidates, prompt)
       └─ transcription.transcribe(mono, prompt)
            ├─ config.openai_api_key?  ── sim ─► audio.encode_mp3(mono, tmp)  (16 kHz mono 64 kbps, ≤ 5 MB p/ 10 min)
            │                                    └─ httpx POST api.openai.com/v1/audio/transcriptions
            │                                         whisper-1, verbose_json, words + segments, prompt
            │                                    ├─ ok ─► _from_openai(json) ─► filtro de segmentos ─► Transcript
            │                                    └─ falha (após 1 retry) ─► log.warning ─► local ▼
            └─ não ───────────────────────────► _local(mono, prompt)  (faster-whisper, load sob demanda)
       └─ lyrics_selection.choose(candidates, transcript)   (inalterado)
  → MMS_FA(letra escolhida)                                  (inalterado)
```

Arquivos novos: `apps/worker/app/config.py`, `apps/worker/tests/test_config.py`.
Arquivos alterados: `app/transcription.py`, `app/audio.py`, `app/main.py`, `Dockerfile`
(comentário; o `load()` do build continua), `pyproject.toml`/`uv.lock` (`httpx` em produção,
`pydantic-settings`), `tests/test_transcription.py`, `tests/test_api.py` (health),
`scripts/transcribe_spike.py`, `.env.example`, `docker-compose.yml`, docs.

## 4. Contratos e Interfaces

### Configuração (`app/config.py`)
```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=<raiz>/.env se existir, extra="ignore")
    OPENAI_API_KEY: SecretStr | None = None   # vazio ("") conta como ausente

def settings() -> Settings            # lido uma vez (cache); nunca loga o valor
```

### Transcrição (`app/transcription.py`) — interface pública inalterada
```python
MODEL_NAME = "large-v3-turbo"          # local (reserva)
OPENAI_MODEL = "whisper-1"
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_TIMEOUT_S = 120
OPENAI_RETRY_DELAY_S = 2
# Filtro de invenção (R6 da sdd-011, sem VAD): heurística clássica do Whisper.
NO_SPEECH_MAX = 0.6; LOGPROB_MIN = -1.0; COMPRESSION_MAX = 2.4

@dataclass(frozen=True) class Word: text; startMs; endMs; probability      # inalterado
@dataclass(frozen=True) class Transcript: words; language                  # inalterado

def provider() -> Literal["openai", "local"]
def load() -> None                     # só o local; idempotente
def is_loaded() -> bool
def transcribe(mono: np.ndarray, prompt: str | None = None) -> Transcript   # openai → reserva local
def _from_openai(body: dict) -> Transcript   # puro: verbose_json → Transcript (testável sem rede)
```
- Resposta esperada do `verbose_json` (campos usados): `language`, `words[] { word, start, end }`,
  `segments[] { start, end, avg_logprob, no_speech_prob, compression_ratio }`. Cada palavra
  pertence ao segmento que contém o seu `start`; palavra fora de qualquer segmento fica com
  `probability` 1,0 e não é filtrada. Resposta fora desse formato → falha (vai para a reserva).
- `language` da OpenAI vem por extenso ("portuguese"): mapear para o código de 2 letras quando
  conhecido, senão manter o texto (só informativo).

### Áudio (`app/audio.py`)
```python
def encode_mp3(mono: np.ndarray, dst: Path, sample_rate: int = 16_000, bitrate: str = "64k") -> Path
```
Escreve no diretório temporário da extração (apagado no fim, como o resto; a sdd-001 exige que
o áudio só exista no tmp da requisição).

### Worker HTTP
- `GET /health`: `{ status, transcription: "openai" | "local", models: { demucs, crepe, mms_fa, whisper } }`
  (aditivo; `whisper` continua sendo "modelo local carregado"). A API não lê `models`
  (`apps/api/src/clients/worker.client.ts`), então nenhum consumidor quebra.
- `/extract`, `/youtube/extract`: sem mudança de contrato.

### Env (`AGENTS.md` §11)
| Variável | Serviço | Obrigatória | Segredo | Lida/validada em |
|---|---|---|---|---|
| `OPENAI_API_KEY` | worker | não (sem ela: Whisper local na CPU) | **sim** | `apps/worker/app/config.py` |

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Transcrição sempre local (`faster-whisper`, CPU) | Com `OPENAI_API_KEY`: `whisper-1` na OpenAI; sem: local, como hoje | Usuário, 2026-09-26 |
| 2 | Falha do Whisper → primeira candidata, `wer: null` (sdd-011 §6) | Falha da OpenAI (após 1 nova tentativa) → **Whisper local**; falha dos dois → a política de hoje | Usuário ("manter o local como reserva") + sdd-011 |
| 3 | O modelo local carrega no boot | Com chave, carrega **só** na primeira vez que a reserva for usada (e fica carregado) | Motivação: RAM/CPU |
| 4 | Só a voz isolada é transcrita | Idem: vai à OpenAI só a voz separada pelo Demucs, em MP3 mono 16 kHz, nunca a URL nem metadados além do `prompt` ("artista - título") | Privacidade; sdd-011 regra 6 |
| 5 | `vad_filter` e probabilidade por verso < 0,4 descartam invenção | OpenAI: descarta segmento com (`no_speech_prob > 0,6` e `avg_logprob < -1,0`) ou `compression_ratio > 2,4`; local: como hoje | R6 da sdd-011; heurística padrão do Whisper |
| 6 | — | A chave nunca aparece em log, erro ou resposta; erro da OpenAI é logado só com status e `error.type` | `AGENTS.md` §7 e §10 |
| 7 | Uma extração por vez (semáforo) | Inalterado: a chamada à OpenAI ocupa o semáforo, mas sem CPU | `main.py` `_extraction_lock` |

## 6. Critérios de Aceitação
- **Etapa 0 (go/no-go), antes de trocar o padrão**: `scripts/transcribe_spike.py --provider openai`
  nas mesmas 11 músicas da Etapa 0 da sdd-011 (8 do banco + 3 do Tim Bernardes):
  - WER mediano ≤ 12 % (local: 8 %) e a regra 6 da sdd-011 continua escolhendo a letra de um
    site em 8 de 8 músicas com candidata, nunca a de outra música;
  - transcrição ≤ 30 s por música (local: 21–89 s), com o upload incluso;
  - custo anotado (minutos × preço vigente do `whisper-1` no painel);
  - resultado em tabela no `apps/worker/README.md`, ao lado da da sdd-011. Se o WER mediano
    passar de 20 %: **no-go**, parar e voltar ao usuário.
- CPU: com chave, o worker não carrega o `faster-whisper` no boot (`/health`:
  `transcription: "openai"`, `models.whisper: false`) e o pico de RAM cai em relação aos 3,2 GB
  medidos na sdd-011 (anotar o novo número no README).
- Resiliência: OpenAI fora (timeout, 5xx, 401 de chave inválida, resposta malformada) nunca
  gera 500 nem `FAILED`: cai no local; `models.whisper` vira `true` depois disso.
- Segurança: `OPENAI_API_KEY` só no worker (nunca na API nem no web), fora do Git (`.env`),
  opcional no compose (`${OPENAI_API_KEY:-}`), nunca logada; o MP3 fica no tmp da requisição e
  some no fim.
- Compatibilidade: sem mudança no contrato do worker para a API; worker minor; `CHANGELOG.md`.

## 7. Plano de Testes
- **Worker (pytest, sem rede, sem modelo)**
  - `test_config.py`: sem variável → `None`; vazia → `None`; com valor → `SecretStr` e o
    `repr` não mostra o valor.
  - `test_transcription.py`:
    - `_from_openai`: palavras em ms, texto sem espaço/pontuação à esquerda, `probability` do
      segmento, palavra fora de segmento, `language` mapeado;
    - filtro: segmento silencioso (`no_speech_prob` alto + `avg_logprob` baixo) sai, segmento
      repetido (`compression_ratio` alto) sai, segmento bom fica;
    - `transcribe` com chave: requisição certa (`model`, `response_format`, as duas
      granularidades, `prompt`, arquivo MP3, header `Authorization`) via
      `httpx.MockTransport`; 5xx e depois 200 → usa a segunda; 5xx duas vezes → reserva local
      (modelo falso); 401 → reserva sem nova tentativa; JSON malformado → reserva;
    - sem chave: vai direto ao local (testes atuais continuam valendo);
    - `load()` não é chamado no boot com chave (lifespan).
  - `test_api.py`: `/health` com `transcription` nos dois modos.
  - `-m network` (fora da suíte padrão): uma chamada real à OpenAI com 3 s de voz sintética,
    pulada sem `OPENAI_API_KEY`.
- **Regressão**: `uv run pytest` inteiro; `pnpm --filter api test` sem mudança (contrato igual).
- **Manual/Smoke**: com a chave no `.env`, `pnpm dev`, cadastrar uma música nova e comparar o
  tempo total e a CPU com o de antes; derrubar a rede no meio (ou chave inválida) e ver a
  reserva local terminar a música.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. `whisper-1` é "legado" e pode ser aposentado | média (prazo longo) | transcrição cai sempre na reserva local | A reserva cobre; trocar de modelo é mudar `transcription.py` (a doc lista `gpt-transcribe`, sem timestamps: exigiria outra sdd) |
| R2. Custo por música | certa | gasto na conta da OpenAI | Só músicas novas e redo transcrevem (~3–4 min de voz cada); limite mensal no painel do projeto; custo medido na Etapa 0 |
| R3. Mais invenção em trecho sem voz (sem VAD) | média | versos fantasmas na letra automática | Filtro de segmentos (regra 5), calibrado na Etapa 0; a Demucs já zera o instrumental |
| R4. Voz de música protegida saindo da máquina | certa | — | Projeto pessoal e não comercial (memória do projeto); endpoint sem retenção nem treino (doc de 2026-09-26) |
| R5. Chave vazada | baixa | uso indevido da conta | Só no `.env` (ignorado pelo Git) e no `environment:` do compose; `SecretStr`; nunca logada; revogar no painel |
| R6. Upload lento em rede ruim | baixa | processamento mais longo | MP3 de ≤ 5 MB (10 min); timeout de 120 s → reserva local |

Dependências: `pydantic-settings` (nova, worker) e `httpx` (de `dev` para produção), versões
atuais via skill `latest-deps`. Nenhuma dependência nova na API ou no web.

## 9. Perguntas em Aberto (bloqueantes)
_(nenhuma — modelo e comportamento sem chave decididos pelo usuário em 2026-09-26, §1)_

## 10. Checklist de Conformidade
- [x] Todas as decisões citam o código (`app/main.py`, `app/lyrics_selection.py`,
      `apps/api/src/config/env.ts`), `AGENTS.md` §11 ou a sdd-011.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 preenchida de forma substantiva, com go/no-go da Etapa 0.
- [x] Sem mudança em schema Prisma nem contrato da API; contrato do worker só aditivo (`/health`).
- [x] Perguntas em aberto foram exauridas.
