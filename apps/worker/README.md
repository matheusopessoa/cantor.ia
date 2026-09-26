# cantor.ia worker

Serviço Python que extrai a **curva de pitch da voz** de uma música, a partir de um arquivo
enviado ou de um vídeo do YouTube. Só a API (`apps/api`) fala com ele. Plano:
[`specs/sdd-001-worker-pitch/tasks.md`](../../specs/sdd-001-worker-pitch/tasks.md).

```
áudio ─► ffmpeg (44.1 kHz estéreo) ─► Demucs htdemucs (stem vocals) ─► torchcrepe tiny (10 ms)
                                                                       ─► PitchTrack
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

O primeiro start baixa os pesos do `htdemucs` (~80 MB, do Hugging Face). Docker:
`docker compose up worker` (a imagem já vem com os pesos).

## Testes

```bash
uv run pytest              # 39 testes, ~5 s, sem rede e sem Demucs (yt-dlp falso + sinais sintéticos)
uv run pytest -m slow      # pipeline completo com Demucs num áudio de 10 s (~2 min)
uv run pytest -m network   # baixa um vídeo real do YouTube
```

Conferir uma curva a olho:

```bash
uv run python scripts/plot_track.py musica.mp3 saida.png
```

## Contrato

| Rota | Entrada | Saída |
|---|---|---|
| `GET /health` | — | `{ status, models: { demucs, crepe } }` |
| `POST /extract` | multipart `file` (+ `separate`, padrão `true`) | `PitchTrack` |
| `POST /youtube/extract` | `{ videoId, separate? }` | `PitchTrack` |
| `POST /youtube/audio` | `{ videoId }` | bytes `audio/mp4` (ou `audio/mpeg`, se precisou converter) |

`PitchTrack` = `{ version: 1, hopMs: 10, durationMs, midi: (number | null)[] }`: uma nota MIDI
fracionária a cada 10 ms (69.00 = A4 440 Hz), `null` onde não há voz.

Erros: `{ error, message }`. O `message` é só para log.

| `error` | HTTP | Quando |
|---|---|---|
| `too_large` | 413 | arquivo enviado ou áudio do YouTube > 20 MB |
| `invalid_audio` | 415 | ffmpeg não lê o arquivo (ou falta o campo `file`) |
| `too_long` | 422 | áudio ou vídeo > 10 min |
| `no_voice` | 422 | nenhum frame com voz |
| `invalid_video_id` | 400 | `videoId` fora de `^[A-Za-z0-9_-]{11}$` (o yt-dlp nem é chamado) |
| `video_unavailable` | 422 | privado, removido, restrição de idade, ao vivo |
| `download_failed` | 502 | yt-dlp falhou ou passou de 2 min (o download é cancelado de verdade e o tmp é limpo quando a thread termina) |
| `internal` | 500 | erro inesperado |

Uma extração por vez (semáforo). Downloads do YouTube e o `/youtube/audio` ficam fora dele.

## Desempenho (Mac ARM, CPU, medido em 2026-09-25)

Música de 3:33 pelo `/youtube/extract`: **72 s** de ponta a ponta (download ~2 s, Demucs ~51 s,
crepe ~20–33 s). `/health` responde em ~1 ms durante a extração.

O crepe roda com o modelo **`tiny`**. No benchmark contra o `full`, os dois tiveram a mesma
precisão (erro mediano de 6 cents em voz sintética, 0,1% dos frames divergindo > 50 cents em
voz real), mas o `full` foi ~10x mais lento (~6 min por música) e passou de 8 GB de RAM.
Detalhes na seção 8 da spec.

## Manutenção

O YouTube muda com frequência e quebra o `yt-dlp`. Quando o download começar a falhar
(`download_failed`):

```bash
uv lock --upgrade-package yt-dlp && uv sync
```
