# Task: Criar o worker Python que extrai a curva de pitch da voz de uma música

- **Slug:** worker-pitch
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** worker 0.1.0 (app novo)
- **App afetado:** novo app `apps/worker` (+ infra na raiz)
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** additive (novos contratos HTTP internos `POST /extract`, `POST /youtube/extract`, `POST /youtube/audio` e formato `PitchTrack`)

## 1. Contexto e Motivação
- Para dar nota à afinação precisamos de uma referência: a melodia cantada na gravação original.
  Não existe base pública de melodias, então a referência é **extraída do áudio original**.
- Extração de voz e pitch exige o ecossistema Python (PyTorch). Node não tem equivalentes
  maduros, por isso o processamento fica num serviço separado e stateless.
- Para o usuário não precisar ter o arquivo, o worker também **baixa o áudio do YouTube** com
  `yt-dlp` a partir do id do vídeo. O download fica no worker porque o `yt-dlp` é Python e o
  ffmpeg já está lá. Decisão do usuário em 2026-09-25: projeto pessoal, sem fins comerciais
  (baixar do YouTube viola os termos do YouTube; aceito só nesse contexto).
- Pedido original: `specs/tasks.txt`, item 1 (MVP de nota de cantoria).
- Rastreabilidade:
  - `AGENTS.md` §2 descreve só `apps/api` e `apps/web`; este plano adiciona um terceiro app e
    atualiza §1, §2, §4 e §11.
  - O worker **não** acessa o banco: a persistência continua exclusiva da camada
    `repositories` da API (`apps/api/docs/arquitetura.md`, seção `src/repositories/`).

## 2. Escopo
- **Inclui**
  - App `apps/worker` em Python 3.12 gerenciado com `uv` (`pyproject.toml` + `uv.lock`).
  - FastAPI com `GET /health` e `POST /extract` (multipart, campo `file`).
  - Pipeline: decodificar (ffmpeg) → estéreo 44.1 kHz → Demucs `htdemucs` (stem `vocals`, média
    para mono) → torchcrepe **`tiny`** (reamostra para 16 kHz, hop 10 ms, decoder `weighted_viterbi`
    próprio) → limiar de periodicidade e de volume → MIDI por frame.
  - Arquivo temporário apagado em `finally` (o áudio nunca é persistido).
  - Limites: 20 MB por arquivo, 10 min de duração, formatos que o ffmpeg decodifica
    (mp3, wav, m4a, ogg, flac).
  - Parâmetro `separate` (padrão `true`): `false` pula o Demucs, usado nos testes com sinais
    sintéticos e para extrair pitch de gravações só de voz na calibração.
  - Download do YouTube com `yt-dlp` (usado como biblioteca Python, não como subprocess),
    recebendo **só o `videoId`** de 11 caracteres:
    - `POST /youtube/extract`: baixa para tmp e roda o mesmo pipeline do `/extract`.
    - `POST /youtube/audio`: baixa e devolve os bytes do áudio, para o navegador tocar (a API
      faz proxy).
  - Runtime JS (Deno) no dev (Homebrew) e no Dockerfile: as versões recentes do `yt-dlp` exigem
    um runtime JS externo para o YouTube (confirmar na implementação com a doc do `yt-dlp`).
  - Script `scripts/plot_track.py` (dev) que plota um PitchTrack em PNG, para validação visual.
  - Testes com `pytest`.
  - `Dockerfile` do worker com os pesos do `htdemucs` e do torchcrepe já baixados no build.
  - Serviço `worker` em `docker-compose.yml` (porta 8000) e regras Python no `.gitignore`.
- **Exclui**
  - Fila, GPU, autenticação entre serviços (rede interna do compose).
  - Qualquer acesso ao Postgres.
  - Transcrição de letra (Whisper): fica fora do MVP.
  - URLs livres ou outros sites suportados pelo `yt-dlp`: só YouTube, só por `videoId`.
  - Cookies/login do YouTube: vídeos privados, com restrição de idade ou bloqueados na região
    falham com erro claro.

## 3. Impacto Arquitetural
- App novo, fora do workspace pnpm (não tem `package.json`, então o `apps/*` do
  `pnpm-workspace.yaml` o ignora).
- Estrutura:
  ```
  apps/worker/
  ├── pyproject.toml          # fastapi, uvicorn, python-multipart, demucs, torch, torchaudio,
  │                           # torchcrepe, numpy, soundfile, yt-dlp; dev: pytest, httpx, matplotlib
  ├── uv.lock
  ├── .python-version         # 3.12
  ├── Dockerfile
  ├── README.md
  ├── app/
  │   ├── main.py             # FastAPI: rotas, limites, tratamento de erro
  │   ├── audio.py            # decode via ffmpeg → numpy float32 mono; duração; reamostragem
  │   ├── separation.py       # Demucs htdemucs → stem vocals (modelo carregado 1x no startup)
  │   ├── pitch.py            # torchcrepe → (hz, periodicity) → MIDI | None por frame
  │   ├── youtube.py          # yt-dlp: videoId → arquivo de áudio em tmp (limites, sem playlist)
  │   └── schemas.py          # Pydantic: PitchTrack, YoutubeRequest, ErrorResponse
  ├── scripts/plot_track.py
  └── tests/
      ├── conftest.py         # geradores de senoide/silêncio/glissando em WAV temporário
      ├── test_pitch.py
      ├── test_youtube.py     # yt-dlp mockado, sem rede
      └── test_api.py
  ```
- Fluxo:
  ```
  API ──multipart──► POST /extract
                      │ valida tamanho/tipo → grava em tmp
                      ▼
                   audio.decode ──► duração > 10 min? ──► 422
                      ▼
                   separation.vocals (se separate=true)
                      ▼
                   pitch.track (16 kHz, hop 10 ms, torchcrepe "tiny", decoder weighted_viterbi)
                      ▼
                   periodicidade < 0.5 ou RMS < gate → null
                      ▼
                   200 PitchTrack        (finally: apaga tmp)
  ```
- Fluxo do YouTube:
  ```
  API ──JSON {videoId}──► POST /youtube/extract | POST /youtube/audio
                      │ valida videoId (^[A-Za-z0-9_-]{11}$), senão 400
                      │ monta a URL canônica https://www.youtube.com/watch?v=<id>
                      ▼
                   yt-dlp: lê os metadados antes de baixar
                      │ ao vivo, > 10 min ou indisponível → 422
                      ▼
                   download bestaudio (prefere m4a) → tmp da requisição
                      ├─ /youtube/extract → mesmo pipeline do /extract → 200 PitchTrack
                      │                     (finally: apaga tmp)
                      └─ /youtube/audio   → FileResponse com BackgroundTask que apaga o tmp
                                            DEPOIS de enviar o último byte; em erro antes da
                                            resposta, o except apaga na hora
  ```
- Modelos carregados uma única vez no `lifespan` do FastAPI; o processamento pesado roda em
  `run_in_threadpool` para não bloquear o event loop (`/health` continua respondendo). O
  download do `yt-dlp` também roda em `run_in_threadpool`.
- **Uma extração por vez** (`asyncio.Semaphore(1)`): as outras aguardam. Evita estourar a RAM
  com dois Demucs em paralelo na CPU. No `/youtube/extract`, o **download acontece antes** de
  pegar o semáforo: só separação + pitch ficam serializados. O `/youtube/audio` **não** entra
  nesse semáforo (é só download, leve): tocar uma música não pode esperar minutos atrás de uma
  extração.
- Não há DI: o app Python segue o mesmo espírito da API, com módulos importados diretamente.

## 4. Contratos e Interfaces
- **`POST /extract`** — `multipart/form-data`
  - Campos: `file` (obrigatório), `separate` (bool, opcional, padrão `true`).
  - `200` → `PitchTrack`
  - `413` arquivo > 20 MB · `415` não decodificável · `422` duração > 10 min ou áudio sem
    nenhum frame com voz · `500` erro inesperado.
  - Corpo de erro: `{ "error": WorkerErrorCode, "message": string }`, com
    `WorkerErrorCode` = `too_large` (413) · `invalid_audio` (415) · `too_long` (422) ·
    `no_voice` (422) · `invalid_video_id` (400) · `video_unavailable` (422) ·
    `download_failed` (502) · `internal` (500). A API traduz esses códigos para os códigos
    exibidos ao usuário (sdd-003); o `message` é só para log.
- **`POST /youtube/extract`** — JSON `{ "videoId": string, "separate"?: boolean }`
  - `200` → `PitchTrack`
  - `400 invalid_video_id` · `422 video_unavailable` (indisponível, privado, com restrição de
    idade ou ao vivo) · `422 too_long` (> 10 min) · `422 no_voice` · `502 download_failed`
    (falha do `yt-dlp`, ex.: o YouTube mudou algo) · `500 internal`.
- **`POST /youtube/audio`** — JSON `{ "videoId": string }`
  - `200` → bytes do áudio com `Content-Type` `audio/mp4` (m4a/AAC) ou `audio/mpeg` (se
    precisou converter) e `Content-Length` preenchido (o web usa para mostrar progresso).
  - Mesmos erros do `/youtube/extract`, exceto "sem voz".
  - Formato: `bestaudio[ext=m4a]/bestaudio`. Se não vier m4a, converte para MP3 com ffmpeg.
    Chrome e Safari decodificam os dois com `decodeAudioData`; Opus/WebM não é garantido no
    Safari.
- Opções fixas do `yt-dlp` (em `youtube.py`): `noplaylist`, `max_filesize` 20 MB,
  `match_filter` recusando `is_live` e `duration > 600`, `socket_timeout` 30 s, sem cookies,
  `outtmpl` dentro do diretório temporário da requisição. Timeout total do download: 2 min.
- **`GET /health`** → `{ "status": "ok", "models": { "demucs": bool, "crepe": bool } }`.
- **`POST /youtube/search`** (adicionado pela sdd-008, 2026-09-26): busca sem download para a
  API sugerir o vídeo certo; contrato, erros `invalid_query`/`search_failed` e opções do
  `yt-dlp` em [`specs/sdd-008-youtube-suggestion/tasks.md`](../sdd-008-youtube-suggestion/tasks.md) §4.
- **Formato `PitchTrack`** (contrato compartilhado com `apps/api` em sdd-002 e com
  `apps/web` em sdd-004; o mesmo formato vale para a referência e para a voz cantada):
  ```ts
  type PitchTrack = {
    version: 1;
    hopMs: 10;
    durationMs: number;              // duração do áudio de entrada
    midi: (number | null)[];         // 1 valor a cada 10 ms; nota MIDI fracionária
                                     // (69.00 = A4 440 Hz), 2 casas decimais; null = sem voz
  };
  ```
  Uma música de 4 min vira ~24.000 valores (~150 KB em JSON).
- Pydantic:
  ```python
  class PitchTrack(BaseModel):
      version: Literal[1] = 1
      hopMs: Literal[10] = 10
      durationMs: int
      midi: list[float | None]
  ```
- Conversão: `midi = 69 + 12 * log2(hz / 440)`, arredondado a 2 casas.
- Constantes (em `pitch.py`): `HOP_MS = 10`, `PERIODICITY_THRESHOLD = 0.5`,
  `FMIN_HZ = 65` (C2), `FMAX_HZ = 1100` (~C#6), `SILENCE_DB = -60`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Não existe referência de melodia | Referência = pitch da voz isolada do áudio (arquivo enviado ou baixado do YouTube) | Pedido do usuário (MVP) |
| 2 | — | O áudio (upload ou baixado do YouTube) **nunca** é persistido: é apagado ao fim da requisição, com sucesso ou erro | Decisão do usuário ("Descartar") |
| 3 | — | Frames sem voz confiável viram `null`, e não 0 | Necessário para o scoring (sdd-002) ignorar silêncios |
| 4 | — | Faixa vocal de 65 a 1100 Hz; fora disso vira `null` | Faixa de voz humana cantada |
| 5 | — | Áudio > 10 min ou > 20 MB é rejeitado (no YouTube, checado nos metadados antes de baixar) | Protege a CPU do worker |
| 6 | — | O worker aceita só `videoId` do YouTube (11 caracteres) e monta a URL canônica. Nunca recebe URL livre | Segurança: o `yt-dlp` suporta centenas de sites e URLs genéricas (SSRF) |
| 7 | — | Download do YouTube só para uso pessoal, não comercial | Decisão do usuário (2026-09-25). Rever antes de abrir ao público |

## 6. Critérios de Aceitação
- Senoide de 440 Hz com 3 s (`separate=false`) → ≥ 95% dos frames com `midi` ∈ [68.9, 69.1].
- 3 s de silêncio → todos os frames `null`, e a resposta é `422` (sem voz).
- Glissando de 220 para 440 Hz → curva monotônica crescente de ~57 a ~69 (tolerância ±0.3).
- `len(midi) == round(durationMs / 10)` (±1).
- Uma música real de 4 min em CPU (Mac de desenvolvimento) processa em **≤ 3 min**. Medir e
  registrar no README do worker. Se estourar, aplicar o fallback do risco R2.
- Plot de 3 músicas reais conferido visualmente: a curva segue a melodia da voz e não o
  instrumental (validação manual, registrada no PR).
- Nenhum arquivo sobra em `/tmp` depois de requisições com sucesso e com erro, incluindo os
  fluxos do YouTube (teste automatizado). No `/youtube/audio`, o arquivo **existe** até o fim
  do envio e some logo depois (teste lendo a resposta inteira e checando o tmp em seguida).
- Todo erro devolve um `WorkerErrorCode` da lista da seção 4 (teste por código).
- `GET /health` responde em < 100 ms mesmo durante uma extração em andamento.
- `videoId` inválido (`abc`, `../../etc/passwd`, uma URL completa) → `400` **sem** chamar o
  `yt-dlp` (teste com mock verificando zero chamadas).
- `POST /youtube/audio` responde normalmente enquanto uma extração ocupa o semáforo.
- Smoke: 1 vídeo real "official audio" → `/youtube/extract` devolve PitchTrack com `durationMs`
  próximo da duração do LRCLIB, e `/youtube/audio` devolve um arquivo que toca no Chrome e no
  Safari.

## 7. Plano de Testes
- **pytest (`apps/worker/tests`)**
  - `test_pitch.py`: senoide, silêncio, glissando, ruído branco (≥ 90% `null`), conversão
    Hz→MIDI, tamanho do array.
  - `test_api.py` (com `httpx`/`TestClient`, sempre `separate=false` para não carregar o
    Demucs no CI): 200 com PitchTrack válido; 413; 415 (arquivo texto renomeado para `.mp3`);
    422 (silêncio); tmp limpo após sucesso e após erro.
  - `test_youtube.py` (`yt_dlp.YoutubeDL` substituído com `monkeypatch`, sem rede): validação
    do `videoId`; URL canônica montada; metadados ao vivo ou > 10 min → 422 sem baixar;
    `DownloadError` → 502; vídeo indisponível → 422; `/youtube/audio` com m4a → `audio/mp4` e
    com outro formato → conversão para `audio/mpeg`; tmp limpo.
  - Um teste marcado `@pytest.mark.slow` roda o pipeline completo com Demucs num trecho curto
    (10 s) de áudio gerado (senoide + ruído). Fora da suíte padrão.
  - Um teste marcado `@pytest.mark.network` baixa um vídeo real curto. Fora da suíte padrão
    (depende da rede e do YouTube).
- **Manual/Smoke:** `uv run python scripts/plot_track.py <mp3>` em 3 músicas conhecidas.
- **Lint:** fora do escopo (o repo ainda não tem lint Python). Registrar como follow-up.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. `demucs` (pacote original) está sem manutenção ativa e pode não instalar com torch/Python recentes | média | alto | Fixar Python 3.12 e as versões de torch/torchaudio compatíveis no `uv.lock`. Plano B: pacote `audio-separator` com o mesmo modelo `htdemucs` |
| R2. torchcrepe `full` lento demais em CPU | **ocorreu** | — | **Aplicado**: modelo `tiny` (benchmark abaixo). Registrado no README do worker |
| R3. Imagem Docker grande (torch + pesos ≈ 2–3 GB) | alta | baixo | Usar wheel de torch só para CPU (`--index-url .../cpu`) e build multi-stage |
| R4. Backing vocals / coro contaminam a curva | média | médio | Aceito no MVP. Viterbi + limiar de periodicidade reduzem o efeito. Documentar |
| R5. Direitos autorais e termos do YouTube (baixar viola os termos) | alta | médio (projeto pessoal) | Uso pessoal e não comercial (decisão do usuário, 2026-09-25). Áudio só em tmp e apagado em `finally`, coberto por teste. Não expor publicamente sem rever |
| R6. `yt-dlp` quebra quando o YouTube muda algo | alta | médio | Manter o `yt-dlp` atualizado (`uv lock --upgrade-package yt-dlp`). Erro 502 com mensagem clara. Upload de arquivo continua como alternativa |
| R7. YouTube bloqueia IPs de datacenter ("confirme que você não é um robô") | média (se hospedado em nuvem) | médio | Rodar o worker em casa/local. Upload de arquivo como alternativa |

Dependências (versões a confirmar com a skill `latest-deps` na implementação): `fastapi`,
`uvicorn[standard]`, `python-multipart`, `demucs`, `torch`, `torchaudio`, `torchcrepe`,
`numpy`, `soundfile`, `yt-dlp`; dev: `pytest`, `httpx`, `matplotlib`. Binários: `ffmpeg` e
`deno` (Homebrew no dev, instalados no Dockerfile).

### Decisões da implementação (2026-09-25)

- **Crepe `tiny`, fixo.** O usuário cogitou uma opção "melhor (full) × mais rápida (tiny)" no
  front. O benchmark mostrou que não há ganho de qualidade no `full`, então ficou só o `tiny`,
  sem opção (decisão do usuário).

  | Medida | `tiny` | `full` |
  |---|---|---|
  | Voz sintética (40 notas A2–A5, harmônicos + vibrato): erro mediano / p90 | 6,1 / 16,1 cents | 6,3 / 15,7 cents |
  | Sintética: frames dentro de 50 cents · erros de oitava | 100% · 0% | 100% · 0% |
  | Sintética: voz falsa nas pausas | 6% | 19% |
  | Voz real (30 s isolados): tempo · pico de RAM · frames com voz | 3,0 s · 2,2 GB · 70,5% | 63,4 s · 8,7 GB · 77,1% |
  | Voz real: full × tiny onde os dois têm voz | mediana 5 cents, 0,1% > 50 cents, 0 oitavas | |
  | Música inteira (3:33): crepe · total com Demucs | 33 s · ~1,5 min | 355 s · ~6,8 min |

  Os frames extras do `full` são quase todos bordas de nota (95% dos trechos ≤ 50 ms).
- **Decoder `weighted_viterbi` próprio.** O `viterbi` do torchcrepe 0.0.24 devolve o centro do
  bin (20 cents), o que reprovava o critério de ±10 cents na senoide. O decoder novo usa o
  viterbi para escolher o bin e a média ponderada de ±4 bins para a precisão.
- **`batch_size=256` no crepe.** Com 2048, o processo morria por falta de memória (exit 137).
- **`tool.uv.environments` = Mac ARM + Linux.** Sem isso, o `demucs` 4.1 força `torch<2.3` por
  causa do Mac Intel, e o `torchaudio` novo não carrega.
- **`torch` só-CPU no Linux** (índice `download.pytorch.org/whl/cpu`): tira as dependências CUDA
  da imagem (R3).
- **R1 não ocorreu:** o `demucs` voltou a ser mantido (4.1.0, com `huggingface-hub` e `sphn`).
- **Dependência de runtime JS:** o `yt-dlp` usa o `deno` do PATH (instalado no Dockerfile).
- **`.gitignore` local** em `apps/worker/` para os artefatos Python, em vez de mexer no da raiz.
- **Dockerfile em 3 estágios** (`base` → `deps` → `runtime`). O `sphn` (dependência do `demucs`)
  não tem wheel para Linux ARM, que é o que o Docker gera em Mac Apple Silicon: o estágio `deps`
  compila com Rust + `libopus-dev` + `pkg-config`, e o `runtime` copia só o `.venv` (e leva a
  `libopus0`). Em x86_64 o wheel vem pronto. `.dockerignore` tira testes, scripts e `.venv`.
- **Timeout do download cancela a thread de verdade** (achado da revisão). O `asyncio.wait_for`
  não para a thread do `yt-dlp`, que recriaria o tmp e deixaria o áudio no disco (regra 2). Agora
  um `threading.Event` é checado no `progress_hook` (levanta `DownloadCancelled`) e o tmp é limpo
  de novo quando a thread termina. Teste de regressão confirmado: falha sem o cancelamento.
- **Áudio do YouTube > 20 MB → `too_large`** (antes saía `too_long`).
- **Imagem: 3,24 GB** (R3 dentro do previsto). Container testado: `/health` ok, música de 3:33
  em 76 s pelo `/youtube/extract`, `/youtube/audio` ok, tmp vazio, ~1 GB de RAM em repouso.

### Resultado dos critérios (2026-09-25)

| Critério (seção 6) | Resultado |
|---|---|
| Senoide 440 Hz ≥ 95% em [68.9, 69.1] | ok (com `weighted_viterbi`) |
| Silêncio → tudo `null` e 422 | ok |
| Glissando 220→440 monotônico, ~57 → ~69 | ok |
| `len(midi) == round(durationMs/10)` ±1 | ok |
| Música real de ~4 min em ≤ 3 min | ok: 3:33 em 72 s de ponta a ponta |
| Curva segue a voz, não o instrumental | ok em 1 música (Lá♭ maior, faixa de barítono 56–63, vibrato visível). Faltam as outras 2 do critério, a fazer no smoke da sdd-003 |
| Nada sobra no tmp (sucesso, erro, `/youtube/audio` após o envio) | ok (testes + checagem manual) |
| `/health` < 100 ms durante extração | ok: ~1 ms |
| `videoId` inválido → 400 sem chamar o yt-dlp | ok |
| `/youtube/audio` fora do semáforo | ok |
| Smoke real: `/youtube/extract` e `/youtube/audio` | ok (m4a, 3,4 MB em 2,5 s). Tocar no Chrome/Safari fica para a sdd-004 |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `AGENTS.md`, `apps/api/docs/arquitetura.md` ou o pedido do usuário.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Sem mudança em schema Prisma. Contrato `PitchTrack` definido aqui e reutilizado em sdd-002/003/004.
- [x] Perguntas em aberto foram exauridas.
- [x] Na implementação: `AGENTS.md` atualizado (introdução, §1 com `uv sync` /
      `uv run uvicorn` / `uv run pytest`, §2, §4, §11 e §12). Artefatos Python num `.gitignore`
      local em `apps/worker/`. Serviço `worker` no `docker-compose.yml` (sem porta pública no prod).
