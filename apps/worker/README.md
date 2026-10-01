# cantor.ia worker

Serviço Python que extrai a **curva de pitch da voz** de uma música, a partir de um arquivo
enviado ou de um vídeo do YouTube, e, quando recebe a letra, **alinha cada linha ao instante em
que é cantada** (alinhamento forçado, sdd-010). Quando recebe **letras candidatas** em vez da
letra, transcreve a voz com o Whisper (o `whisper-1` da OpenAI quando há `OPENAI_API_KEY`, o
`faster-whisper` na CPU sem ela; sdd-014) e **escolhe a letra** que combina com o que é
cantado, ou usa a própria transcrição (sdd-011). Também **separa a música em voz e instrumental** para o
karaokê baixar a voz do cantor (sdd-013) e é a busca de músicas do app (YouTube Music). Só a
API (`apps/api`) fala com ele. Planos:
[`specs/sdd-001-worker-pitch/tasks.md`](../../specs/sdd-001-worker-pitch/tasks.md),
[`specs/sdd-010-lyrics-forced-alignment/tasks.md`](../../specs/sdd-010-lyrics-forced-alignment/tasks.md),
[`specs/sdd-011-lyrics-from-video/tasks.md`](../../specs/sdd-011-lyrics-from-video/tasks.md),
[`specs/sdd-013-singer-volume/tasks.md`](../../specs/sdd-013-singer-volume/tasks.md) e
[`specs/sdd-014-transcription-openai/tasks.md`](../../specs/sdd-014-transcription-openai/tasks.md).

```
áudio ─► ffmpeg (44.1 kHz estéreo) ─► Demucs htdemucs (stem vocals) ─┬─► torchcrepe tiny (10 ms) ─► PitchTrack
                                                                     ├─► 16 kHz ─► Whisper ─► escolha da letra ─┐   (só com lyricsCandidates)
                                                                     └─► 16 kHz ─► MMS_FA (wav2vec2) ─► forced_align ◄┘─► Alignment
```

Stateless: o áudio só existe num diretório temporário da requisição e é apagado ao final
(no `/youtube/audio`, logo depois do último byte enviado).

> Projeto pessoal e não comercial: baixar do YouTube viola os termos do YouTube e só é aceito
> nesse contexto (decisão de 2026-09-25). Rever antes de expor publicamente.

## Rodar

Requer Python 3.12 (o `uv` baixa sozinho), `ffmpeg` e `deno` no PATH:

```bash
brew install ffmpeg deno
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

O primeiro start baixa os pesos do `htdemucs` (~80 MB, do Hugging Face), do `MMS_FA`
(~1,2 GB, `dl.fbaipublicfiles.com`, para `~/.cache/torch/hub/checkpoints/`) e do Whisper
`large-v3-turbo` do `faster-whisper` (~1,6 GB, Hugging Face). Docker: `docker compose up
worker` (a imagem já vem com os pesos).

### Configuração

Uma variável, opcional, lida por `app/config.py` do ambiente ou, fora do Docker, do `.env` da
raiz (o ambiente do processo vence o arquivo):

| Variável | Efeito |
|---|---|
| `OPENAI_API_KEY` | Transcreve a voz com o `whisper-1` da OpenAI (sdd-014). Sem ela (ou vazia), o Whisper local na CPU. **Segredo**: nunca vai para a API nem para o web, nem aparece em log. Ponha um limite mensal de gasto no projeto da OpenAI. |
| `WORKER_DEVICE` | Device do Demucs e do MMS_FA (sdd-016): `auto` (padrão) usa a GPU do Mac (`mps`) quando `torch.backends.mps.is_available()`, senão `cpu`; `cpu`/`mps` forçam (`mps` sem MPS derruba o boot com a mensagem). O crepe (`tiny`, sem ganho medido) e o Whisper local (ctranslate2) ficam em CPU. No Docker (Linux) `auto` vira `cpu`. O `/health` diz qual foi escolhido. |

Com a chave, o boot **não** carrega o Whisper local (`/health`: `transcription: "openai"`,
`models.whisper: false`); ele só carrega se a reserva for usada.

## Testes

```bash
uv run pytest              # ~10 s, sem rede e sem modelos (yt-dlp falso, sinais sintéticos, log-probs fabricadas)
uv run pytest -m slow      # pipeline completo com Demucs num áudio de 10 s (~2 min)
uv run pytest -m network   # baixa um vídeo real do YouTube e chama a OpenAI (3 s de voz sintética; pulado sem OPENAI_API_KEY)
```

A suíte padrão nunca usa a `OPENAI_API_KEY` do `.env` (`tests/conftest.py` força a chave
ausente): sem rede e sem gasto.

Conferir uma curva a olho, ou medir o alinhador em músicas reais (baixa do YouTube):

```bash
uv run python scripts/plot_track.py musica.mp3 saida.png
uv run python scripts/align_spike.py songs.json --keep-audio /tmp/spike   # ver o docstring do script
uv run python scripts/transcribe_spike.py <id> yt:<videoId> --keep-audio /tmp/spike   # Whisper + escolha da letra (sdd-011)
uv run python scripts/transcribe_spike.py <id> ... --provider openai|local           # compara os provedores, com custo (sdd-014)
```

## Contrato

| Rota | Entrada | Saída |
|---|---|---|
| `GET /health` | — | `{ status, transcription: "openai" \| "local", device: "cpu" \| "mps" \| null, models: { demucs, crepe, mms_fa, whisper } }` — `transcription` é o provedor principal (sdd-014); `device` é o do Demucs/MMS_FA (sdd-016; nulo só antes do boot resolver); `models.whisper` diz se o Whisper **local** está carregado |
| `POST /extract` | multipart `file` (+ `separate`, padrão `true`; + `lyrics`, string JSON de `LyricsLine[]`; ou + `lyricsCandidates`, string JSON de `LyricsCandidate[]`, e `lyricsPrompt`; + `stems`, padrão `false`) | `ExtractResponse` em JSON; com `stems=true` e `separate=true` (sdd-016), `multipart/form-data` com as partes `result` (o mesmo JSON), `vocals` e `instrumental` (AAC `.m4a`, o formato do `/stems`), da **mesma** passada do Demucs; erros sempre em JSON |
| `POST /youtube/extract` | `{ videoId, separate?, lyrics?: LyricsLine[], lyricsCandidates?: LyricsCandidate[], lyricsPrompt?, stems? }` | como o `/extract` |
| `POST /stems` | multipart `file` (mesmos limites do `/extract`) | `multipart/form-data` com os arquivos `vocals` e `instrumental` (AAC `.m4a` estéreo a 44,1 kHz, 112 kbps, mesmo número de amostras; `instrumental = mix − voz`), com `Content-Length` (sdd-013) |
| `POST /youtube/align` | `{ videoId, separate?, current: LyricsLine[], proposed: LyricsLine[] }` | `AlignResponse = { durationMs, current: Alignment \| null, proposed: Alignment \| null }` — a letra atual e a proposta de uma revisão alinhadas sobre a mesma voz, com **uma** passada do wav2vec2; sem crepe nem Whisper; nada é gravado (sdd-012) |
| `POST /youtube/audio` | `{ videoId }` | bytes `audio/mp4` (ou `audio/mpeg`, se precisou converter) |
| `POST /youtube/search` | `{ query }` (1 a 200 caracteres) | `{ candidates: YoutubeCandidate[] }` — até 15, na ordem do YouTube, sem baixar nada (sdd-008) |
| `POST /ytmusic/search` | `{ query, withLyrics? }` (padrão `true`) | `{ songs: YtmusicSong[] }` — até 8 músicas do YouTube Music; sem `withLyrics`, `lyrics.status` vem `none` (a busca do app, sdd-011) |
| `POST /ytmusic/song` | `{ videoId }` | `YtmusicSong` — metadados e letra do vídeo (cadastro e coleta de letra da API, sdd-011) |

`PitchTrack` = `{ version: 1, hopMs: 10, durationMs, midi: (number | null)[] }`: uma nota MIDI
fracionária a cada 10 ms (69.00 = A4 440 Hz), `null` onde não há voz.

`ExtractResponse` = `PitchTrack & { alignment: Alignment | null }` (sdd-010). `LyricsLine` =
`{ text, startMs? }` (o `startMs` do LRC só serve para detectar intervalos longos entre linhas).
`Alignment` = `{ version: 1, model: "mms_fa", frameMs: 20, lines: LineAlignment[] }`, com
exatamente um `LineAlignment = { index, startMs, endMs, score }` por linha enviada, na mesma
ordem; `startMs`/`endMs`/`score` são `null` em linha sem texto alinhável (instrumental, só
símbolos, 1 caractere). `score` é a média das probabilidades dos caracteres da linha (0..1);
quem aceita ou recusa a linha é a API. `alignment` é `null` sem `lyrics`, quando nenhuma linha
tem texto alinhável, quando há mais caracteres que frames ou quando o alinhador falha (a curva
continua valendo; a API cai no método por pausas).

Com `lyricsCandidates` (sdd-011; nunca junto de `lyrics`), `ExtractResponse` traz também
`lyrics: SelectedLyrics = { source: "lrclib" | "ytmusic" | "whisper", wer, candidates:
[{ source, wer }], lines: LyricsLine[] }`, o `alignment` é sobre `lyrics.lines` e
`transcript: TranscriptWord[] = [{ text, startMs, endMs, probability }]` traz as palavras do
Whisper (sdd-012: a API guarda como evidência para a revisão da letra; lista vazia quando o
Whisper falhou; `null` com `lyrics` conhecida).
`LyricsCandidate` = `{ source: "lrclib" | "ytmusic", lines: LyricsLine[] }` (`startMs`
opcional: letra só em texto). Regras em "Escolha da letra", abaixo.

`YtmusicSong` = `{ videoId, title, artist, album, durationS, lyrics: { status: "synced" |
"plain" | "none" | "error", source, lines: [{ text, startMs, endMs }] } }` (`ytmusicapi`, API
não oficial do YouTube Music; `source` é quem licencia a letra, LyricFind ou Musixmatch).

`YoutubeCandidate` = `{ videoId, title, channel, durationS, viewCount, isLive }`: o resultado
flat do `ytsearch15:` do yt-dlp (`extract_flat`, 1 requisição, ~1–2 s). `channel`,
`durationS` e `viewCount` são nulos quando o YouTube não informa; `isLive` marca ao vivo e
estreias. A API (`youtube-suggestion.service.ts`) filtra pela duração da letra e ranqueia;
plano em [`specs/sdd-008-youtube-suggestion/tasks.md`](../../specs/sdd-008-youtube-suggestion/tasks.md).

Erros: `{ error, message }`. O `message` é só para log.

| `error` | HTTP | Quando |
|---|---|---|
| `too_large` | 413 | arquivo enviado ou áudio do YouTube > 20 MB |
| `invalid_audio` | 415 | ffmpeg não lê o arquivo (ou falta o campo `file`) |
| `too_long` | 422 | áudio ou vídeo > 10 min |
| `no_voice` | 422 | nenhum frame com voz |
| `invalid_video_id` | 400 | `videoId` fora de `^[A-Za-z0-9_-]{11}$` (o yt-dlp nem é chamado) |
| `video_unavailable` | 422 | privado, removido, restrição de idade, ao vivo; no `/ytmusic/song`, vídeo que o YouTube Music não conhece |
| `download_failed` | 502 | yt-dlp falhou 3 vezes seguidas (esperas de 2 s e 5 s entre as tentativas; vídeo indisponível, longo ou grande demais não é tentado de novo) ou passou de 2 min no total (o download é cancelado de verdade e o tmp é limpo quando a thread termina) |
| `invalid_query` | 400 | `query` ausente, vazia ou com mais de 200 caracteres (o yt-dlp nem é chamado) |
| `search_failed` | 502 | yt-dlp falhou na busca ou passou de 20 s (a thread termina sozinha no `socket_timeout`; nada fica em disco); `ytmusicapi` falhou ou passou de 30 s |
| `invalid_lyrics` | 400 | `lyrics` não é uma lista de `{ text, startMs? }`, `lyricsCandidates` fora do formato, ou os dois juntos; no `/youtube/align`, `current`/`proposed` ausentes ou fora do formato (bug da API, não do usuário) |
| `internal` | 500 | erro inesperado |

Uma extração por vez (semáforo; o Whisper e o alinhador da letra rodam dentro dele, depois do
crepe; o `/stems` também entra nele). Downloads do YouTube, o `/youtube/audio` e as buscas
ficam fora dele.

## Alinhamento da letra (sdd-010)

`app/alignment.py`. A letra é normalizada por linha (NFKD sem acentos e cedilha, minúsculas, só
`a-z`; espaços, pontuação, dígitos e apóstrofos somem: `"Não, 'tava ali!"` → `naotavaali`) e vira
a sequência de alvos do CTC. O `MMS_FA` (wav2vec2-large multilíngue, alfabeto romanizado) roda
sobre a voz isolada reamostrada a 16 kHz, em janelas de 20 s sem sobreposição (cada janela perde
até 1 frame na borda), e o `forced_align` acha o caminho que canta a letra inteira em ordem.

Decisões calibradas no spike (2026-09-26, `scripts/align_spike.py`, 3 músicas reais):

- **`*` (áudio não transcrito)** entra antes de linha que vem depois de um intervalo > 4 s no
  LRC (`STAR_GAP_MS`), antes da primeira linha quando a intro passa disso, e no fim da letra.
  O torchaudio dá ao `*` log-prob 0 (probabilidade 1) em todo frame, e assim ele engolia o
  começo da linha seguinte (1ª linha do Infiel 1,36 s atrasada). Com `STAR_LOG_PROB = -2`
  (p ≈ 0,14) o resultado ficou idêntico ao "sem estrela" nas 3 músicas e a estrela continua
  disponível para adlib, refrão a mais e solo, onde nem os caracteres da letra nem o blank
  explicam o áudio.
- **Linha com menos de 2 caracteres** não é alinhada (`MIN_TOKENS`). Mais tokens que frames
  (ou nada alinhável) → todas as linhas `null`, sem exceção.
- **Falha do modelo** (exceção, sem memória) → `alignment: null` com log, nunca 500: a melodia
  não pode falhar por causa da letra.
- **Várias letras sobre a mesma voz** (`align_many`, sdd-012): o `/youtube/align` alinha a
  letra atual e a proposta de uma revisão com uma única passada do wav2vec2 (`emissions`) e
  um `forced_align` por letra; letra sem texto alinhável ou que falha vem `null` sem
  derrubar a outra.
- O limiar de aceite (`score ≥ 0,4`), a duração máxima (20 s) e o mínimo de metade das linhas
  aceitas ficam na API (`FORCED_CONFIG` em `apps/api/src/services/alignment.service.ts`).

### Resultado do go/no-go (Mac ARM, CPU)

Gabarito = `original − offsetMs` que a jogadora precisou pôr no slider (passos de 100 ms, de
ouvido). Critério: ≥ 80 % das linhas com texto aceitas e a 1ª linha cantada a ≤ 300 ms do gabarito.

| Música (vídeo) | Aceitas | 1ª linha | Mediana Δ | p90 \|Δ\| | Demucs | MMS_FA | RAM pico |
|---|---|---|---|---|---|---|---|
| Tiago Iorc, Tempo Perdido (`tyE1PFSSdg8`) | 26/30 (87 %) | sem gabarito | — | — | 42 s | 9–10 s | 3,3 GB |
| Marília Mendonça, Infiel ao vivo (`eCyMh-mZ1B0`, offset −6 600) | 45/48 (94 %) | +0,48 s | +0,27 s | 0,45 s | 43 s | 9 s | 3,3 GB |
| Pitty, Na Sua Estante (`DP3j6hgS4VY`, offset +10 000) | 33/40 (82 %) | −0,09 s | −0,09 s | 0,23 s | 52 s | 11 s | 3,3 GB |

Leitura: **go**. No Tempo Perdido o LRC do LRCLIB vem de outra gravação (1ª linha aos 47 s num
vídeo em que ela é cantada aos 0,3 s) e o alinhador achou todas as linhas mesmo assim, o que o
método por pausas não tinha como fazer. No Infiel todas as 45 linhas aceitas ficam a ≈ +0,27 s
do gabarito, ou seja, o próprio slider da jogadora carrega esse viés; a 1ª linha está a
≈ 0,2 s da mediana da música. As linhas recusadas (score < 0,4) são em geral versos curtos
repetidos ("E selvagem", "Iê, infiel") ou o último verso antes de um solo, e a API as
reposiciona pelo deslocamento da vizinha. O `forced_align` em si leva 0,03 s; o custo é o
wav2vec2 (~10 s por música de 3–4 min), dentro do orçamento de ≤ 4 min de ponta a ponta e
≤ 6 GB de RAM.

## Escolha da letra (sdd-011)

`app/transcription.py` + `app/lyrics_selection.py`. Com `lyricsCandidates`, a voz isolada passa
pelo Whisper, por um de dois provedores (sdd-014):

- **`openai`** (com `OPENAI_API_KEY`): a voz vira MP3 mono 16 kHz 64 kbps no tmp da requisição
  (≤ 5 MB para 10 min; o limite da OpenAI é 25 MB) e vai a `POST /v1/audio/transcriptions` com
  `whisper-1`, `verbose_json` e tempo por palavra e por segmento (o único modelo da OpenAI que
  dá tempo por palavra; os `gpt-*-transcribe` não dão). `httpx`, timeout de 120 s e 1 nova
  tentativa em rede, timeout, 429 e 5xx. Sem VAD nem probabilidade por palavra, a invenção é
  filtrada pela heurística do próprio Whisper: saem as palavras de segmento com
  `no_speech_prob > 0,6` **e** `avg_logprob < -1,0`, ou com `compression_ratio > 2,4`
  (repetição em laço); `probability` de cada palavra é `exp(avg_logprob)` do segmento. Só a voz
  isolada e o `prompt` saem da máquina; o endpoint não retém nem treina com o áudio.
- **`local`** (sem a chave, e reserva de qualquer falha da OpenAI: rede, 5xx depois da nova
  tentativa, 401, resposta malformada): `faster-whisper`, `large-v3-turbo` int8 em CPU, tempo
  por palavra, `condition_on_previous_text=False` e `vad_filter` contra repetição e invenção em
  trecho sem voz; verso com probabilidade média < 0,4 é descartado. Com a chave, só carrega na
  primeira vez que a reserva é usada.

`lyricsPrompt` ("artista - título") só ajuda a grafia de nomes: o Whisper não "conhece" a letra.

- **Medida:** WER por palavra (substituições + remoções + inserções sobre as palavras da
  candidata), com a mesma normalização dos dois lados (NFKD sem acento, minúsculas,
  `[a-z0-9]`, sem `[Refrão]`/`(2x)`).
- **Escolha:** a candidata de menor WER, se `≤ MAX_WER` (0,35); empate a 0,02 prefere
  `ytmusic` (letra licenciada) a `lrclib`. Letra de outra gravação com o mesmo texto combina
  (o tempo vem do MMS_FA); letra de outra música não. Nenhuma aceita, ou nenhuma candidata →
  a transcrição vira a letra (`source: "whisper"`), em versos quebrados por pausa ≥ 600 ms ou a
  cada 10 palavras.
- **Dica de tempo** (`startMs` de cada linha, usado pelo `*` do alinhador e pela API para
  reposicionar versos recusados): o da própria candidata quando ela tem tempo; senão, o da 1ª
  palavra da linha casada na transcrição; sem casamento, a vizinha ± 1 s.
- **Falhas:** a OpenAI que falha cai no Whisper local; os dois falhando, a extração segue
  (fica a primeira candidata, `wer: null`); transcrição vazia e nenhuma candidata → `lines: []`.

### Resultado do go/no-go da sdd-011 (Mac ARM, CPU, 2026-09-26)

`scripts/transcribe_spike.py`, `large-v3-turbo` int8, 8 músicas do banco de dev + 3 do Tim
Bernardes (só no YouTube Music ou só com letra em texto no LRCLIB). WER da transcrição contra a
letra cadastrada (ou a do YouTube Music); "Encaixados" = versos da letra escolhida que o MMS_FA
aceita (score ≥ 0,4).

| Música | WER | Escolhida (WER das candidatas) | Encaixados | Whisper |
|---|---|---|---|---|
| Tiago Iorc, Tempo Perdido | 8 % | lrclib (8 %, 8 %) | 26/30 | 89 s |
| Marília Mendonça, Infiel (ao vivo) | 8 % | lrclib (8 %, 8 %) | 45/48 | 65 s |
| Pitty, Na Sua Estante | 3 % | lrclib (3 %, 3 %) | 33/40 | 58 s |
| Legião Urbana, Eduardo e Mônica | 7 % | ytmusic (7 %, 7 %, 7 %) | 63/69 | 73 s |
| Tim Bernardes, Tanto Faz | 10 % | ytmusic (10 %) | 24/29 | 49 s |
| Tim Bernardes, Meus 26 | 8 % | ytmusic (8 %, 8 %) | 52/62 | 84 s |
| Tim Bernardes, Olha | 7 % | ytmusic (7 %, 7 %) | 31/33 | 71 s |
| John Denver, Country Roads | 25 % | lrclib (26 %, 25 %) | 16/30 | 46 s |
| Christina Perri, A Thousand Years | 12 % | whisper (sem candidata: LRCLIB 503) | 15/25 | 55 s |
| Linkin Park, Papercut | 37 % | whisper (sem candidata: LRCLIB 503) | 9/35 | 41 s |
| Nirvana, Smells Like Teen Spirit | 84 % | whisper (lrclib 84 % recusadas) | 1/11 | 21 s |

Leitura: **go**. WER mediano 8 % (critério ≤ 12 %); com candidata disponível, a escolha pegou
a letra de um site em 8 de 8 e nunca a de outra música (Tempo Perdido: LRC de outra gravação,
texto igual → aceito, tempo pelo MMS_FA). Whisper 21–89 s por música e pico de 3,2 GB de RAM
com Demucs + crepe + MMS_FA + Whisper carregados (critérios ≤ 90 s e ≤ 7 GB); Demucs 54–94 s e
MMS_FA 11–20 s, então a ponta a ponta fica em ~3–4 min (≤ 6 min). As três escolhas `whisper`
com candidata vazia foram o LRCLIB respondendo 503 (4 de 11 consultas): a API agora tenta de
novo (`LRCLIB_CONFIG`). Voz embolada (Nirvana) segue sem solução: nem a letra certa encaixa.

### Resultado do go/no-go da sdd-014 (OpenAI `whisper-1`, 2026-09-26)

`scripts/transcribe_spike.py --provider openai`, as mesmas 11 músicas. "Transcrição" é o tempo
de ponta a ponta da chamada: codificar a voz em MP3, enviar e receber. Nenhuma música caiu na
reserva local.

| Música | WER (local) | Escolhida (WER das candidatas) | Encaixados | Transcrição (local) |
|---|---|---|---|---|
| Tiago Iorc, Tempo Perdido | 8 % (8 %) | lrclib (8 %, 8 %) | 26/30 | 7 s (89 s) |
| Marília Mendonça, Infiel (ao vivo) | 7 % (8 %) | lrclib (7 %, 7 %) | 45/48 | 9 s (65 s) |
| Pitty, Na Sua Estante | 4 % (3 %) | lrclib (4 %, 4 %) | 34/40 | 10 s (58 s) |
| Legião Urbana, Eduardo e Mônica | 5 % (7 %) | ytmusic (4 %, 5 %, 5 %) | 63/69 | 17 s (73 s) |
| Tim Bernardes, Tanto Faz | 12 % (10 %) | ytmusic (12 %, 12 %, 12 %) | 23/29 | 7 s (49 s) |
| Tim Bernardes, Meus 26 | 6 % (8 %) | ytmusic (6 %, 6 %) | 51/62 | 10 s (84 s) |
| Tim Bernardes, Olha | 12 % (7 %) | ytmusic (12 %, 12 %) | 29/33 | 11 s (71 s) |
| John Denver, Country Roads | 5 % (25 %) | lrclib (6 %, 5 %) | 16/30 | 7 s (46 s) |
| Christina Perri, A Thousand Years | 13 % (12 %) | whisper (sem candidata: LRCLIB 503) | 17/30 | 8 s (55 s) |
| Linkin Park, Papercut | 25 % (37 %) | whisper (sem candidata: LRCLIB 503) | 11/43 | 27 s (41 s) |
| Nirvana, Smells Like Teen Spirit | 100 % (84 %) | whisper (lrclib 100 % recusadas) | 0/13 | 18 s (21 s) |

Leitura: **go**. WER mediano 8 %, igual ao local (critério ≤ 12 %; no-go acima de 20 %). Com
candidata, a escolha pegou a letra de um site em 8 de 8 e nunca a de outra música. Transcrição
de 7 a 27 s (mediana 10 s; critério ≤ 30 s), contra 21 a 89 s na CPU. Custo: 44,5 min de voz,
cerca de US$ 0,27 a US$ 0,006/min (cerca de US$ 0,024 por música). As duas escolhas `whisper`
sem candidata foram de novo o LRCLIB respondendo 503. No Nirvana a OpenAI detectou o idioma
errado ("nynorsk") e nada encaixa, como no local: segue sem solução.

RAM: o pico medido no script foi de 3,96 GB **sem** o Whisper local carregado, acima dos 3,2 GB
da sdd-011 com os quatro modelos. O pico vem do Demucs e do MMS_FA nas músicas mais longas
(Meus 26 e Nirvana, 5 min), e o `ru_maxrss` não separa os modelos. O critério "o pico cai"
**não foi confirmado** por essa medida. O ganho certo é outro: o worker não carrega os ~1,6 GB
do Whisper local no boot (`/health`: `models.whisper: false`) e não gasta os 21–89 s de CPU por
música.

## Trilhas separadas (sdd-013)

`POST /stems`: ffmpeg → Demucs (`separation.stems`) → `vocals` e `instrumental = mix − vocals`
(e não a soma dos outros stems do Demucs: assim voz + instrumental reconstrói o original e nada
da música se perde) → `audio.encode_aac` → resposta multipart em streaming. Sem `no_voice`:
música instrumental devolve uma voz silenciosa. O browser guarda as duas no IndexedDB e toca as
duas sincronizadas, com um ganho só na voz; o servidor não guarda nada.

### Resultado do go/no-go da Etapa 0 (2026-09-26)

Sinais sintéticos (voz + instrumental = mix, 6 s com cliques e 30 s "musicais"), codificados
com o ffmpeg e decodificados com os dois decodificadores que os browsers usam no
`decodeAudioData`: **ffmpeg** (Chromium) e **CoreAudio** (`afconvert`, o do Safari). Critérios:
decodifica nos dois, atraso voz↔instrumental 0, atraso das trilhas contra o original ≤ 30 ms,
soma a 100 % igual ao original (sem eco nem filtro), tamanho das duas ≤ 2× o original.

| Formato | ffmpeg | CoreAudio | voz−inst | trilhas−original | erro da soma (sinal musical) | tamanho das duas / original |
|---|---|---|---|---|---|---|
| AAC `.m4a` 128 kbps | ok | ok | 0 amostras | 0 amostras (0 ms) | −38 dB (o mix codificado sozinho: −37 dB) | 1,6× |
| Opus `.ogg` 96 kbps | ok | ok | 1 amostra | 0 | −29 dB | 1,5× |
| Opus `.webm` 96 kbps | ok | **não decodifica** | 1 | 0 | −29 dB | 1,5× |
| MP3 128 kbps | ok | ok | 0 | 0 | −26 dB | 2,0× |

Leitura: **go** com **AAC em `.m4a`**: o mesmo formato do áudio do YouTube, os dois
decodificadores tiram o priming do codec (mesmo número de amostras do WAV, atraso 0) e a soma
das trilhas fica no ruído de codec (melhor que o próprio mix codificado). No sinal sintético a
voz, quase silêncio entre as frases, comprimiu a ~75 kbps (1,6× no total); numa música real
(Tim Bernardes, Tanto Faz, original de 3,18 MB a 128 kbps) a voz isolada do Demucs não comprime
mais que o instrumental e a 128 kbps as duas deram 2,02× o original, por isso a trilha sai a
**112 kbps** (~1,75×). Em Chrome e Safari o `decodeAudioData` reamostra as duas trilhas para a
taxa do `AudioContext` do mesmo jeito. Custo por música de 3–4 min: o Demucs (50–95 s em CPU)
mais ~2 s de codificação.

## Desempenho (Mac M5, 16 GB, medido em 2026-09-26)

Música de 3:33 ("Tempo Perdido", Tiago Iorc) com a letra e `stems=true` (sdd-016), em
processo (`scripts/compare_devices.py`), download à parte (~3 s):

| etapa | `WORKER_DEVICE=cpu` | `WORKER_DEVICE=mps` (padrão neste Mac) |
|---|---|---|
| Demucs (`separation.stems`) | 45,8 s | **14,8 s** |
| crepe `tiny` (sempre em CPU) | 23,8 s | 25,2 s |
| MMS_FA (`alignment.align`) | 9,6 s | **5,3 s** |
| AAC das duas trilhas | 2,9 s | 2,8 s |
| **total** | **82,3 s** | **48,4 s** |

Antes da sdd-016 (2026-09-25, CPU): 72 s sem a letra, ~82 s com ela. O que mudou: o Demucs e
o MMS_FA na GPU do Mac (Etapa B) e mais ~3 s de AAC para devolver as trilhas (Etapa A), que
poupam o segundo Demucs de 50–95 s e o segundo download no karaokê. O crepe `tiny` não ganha
nada em `mps` (medido: 5,9 s vs 5,5 s em 60 s de áudio) e fica em CPU, sem mudar a curva.
`/health` responde em ~1 ms durante a extração.

Qualidade na mesma música (`scripts/compare_devices.py`, 20 866 frames, 30 linhas). O Demucs
usa um deslocamento aleatório por rodada (`shifts=1` no `Separator`), então **duas rodadas em
CPU também diferem**; a linha de base é `cpu` vs `cpu`:

| | `cpu` vs `mps` | `cpu` vs `cpu` (ruído entre rodadas) |
|---|---|---|
| frames iguais em voz/sem voz | 96,9 % | 97,0 % |
| frames com voz dentro de 50 cents | 99,96 % | 99,98 % |
| linhas com início dentro de ±40 ms | 28/30 | 28/30 |
| maior diferença no início de uma linha | 140 ms | 140 ms |
| diferença média do `score` por linha | 0,014 | 0,015 |

O MPS fica dentro do ruído entre rodadas: `auto` escolhe `mps`. Para reproduzir:
`uv run python scripts/compare_devices.py tyE1PFSSdg8 --lrclib "Tiago Iorc" "Tempo Perdido"`
(e `--devices cpu,cpu` para a linha de base).

O crepe roda com o modelo **`tiny`**. No benchmark contra o `full`, os dois tiveram a mesma
precisão (erro mediano de 6 cents em voz sintética, 0,1% dos frames divergindo > 50 cents em
voz real), mas o `full` foi ~10x mais lento (~6 min por música) e passou de 8 GB de RAM.
Detalhes na seção 8 da spec.

## Manutenção

O YouTube recusa downloads de vez em quando (403 no link do áudio, "confirm you're not a bot",
conexão caída) e a mesma chamada passa segundos depois: por isso o download tenta até 3 vezes
(`youtube.DOWNLOAD_ATTEMPTS`, `RETRY_DELAYS_S`). Cada falha fica no log do worker com a
mensagem do `yt-dlp` (`download do YouTube falhou (<videoId>, tentativa N de 3): ...`).

O YouTube também muda com frequência e quebra o `yt-dlp`. Quando o download começar a falhar
sempre (`download_failed` depois das 3 tentativas):

```bash
uv lock --upgrade-package yt-dlp && uv sync
```
