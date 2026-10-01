# cantor.ia MCP

Servidor [MCP](https://modelcontextprotocol.io) (stdio) que deixa o **Claude Code revisar a
letra das músicas** do cantor.ia, sob demanda e com o usuário aprovando cada gravação
(sdd-012). Quando nenhum site tem a letra, ela vira a transcrição do Whisper, com erros de
palavra; este servidor dá ao Claude a letra em uso, o que o Whisper ouviu e as letras dos
sites, confere a proposta no áudio pela API e só grava depois do "sim". Plano:
[`specs/sdd-012-lyrics-review-mcp/tasks.md`](../../specs/sdd-012-lyrics-review-mcp/tasks.md).

```
Claude Code ─ stdio ─► apps/mcp ─ HTTP + Bearer LYRICS_REVIEW_SECRET ─► apps/api /api/review/* ─► worker (conferência no áudio)
```

Não fala com o banco nem com o worker: só com a API. Não tem estado.

## Configurar

1. `LYRICS_REVIEW_SECRET` no `.env` da raiz (≥ 32 caracteres; `pnpm env:init` gera um num
   `.env` novo, ou `openssl rand -hex 32`). A API lê a mesma variável: sem ela, `/api/review/*`
   responde 503 e o resto da API segue normal. Reinicie a API depois de mudar o `.env`.
2. `pnpm install` na raiz (instala `apps/mcp`).
3. O servidor já está registrado no [`.mcp.json`](../../.mcp.json) da raiz como `cantor`
   (`node apps/mcp/node_modules/tsx/dist/cli.mjs apps/mcp/src/server.ts`, lendo
   `NEXT_PUBLIC_API_URL` e `LYRICS_REVIEW_SECRET` do `.env`). No Claude Code, `/mcp` mostra o
   servidor e as 4 ferramentas; ele pede permissão por ferramenta.
4. `pnpm dev` (API + worker de pé: a conferência baixa o áudio e roda o Demucs e o alinhador).

## Ferramentas

| Ferramenta | Entrada | O que devolve |
|---|---|---|
| `list_songs_to_review` | `{ limit? }` | músicas `READY`, da mais urgente para a menos (letra `whisper` primeiro, depois menor encaixe no áudio), com origem da letra, versos e se já foi revisada |
| `get_song_lyrics` | `{ songId }` | versos numerados com tempo, a transcrição da voz em trechos e as letras dos sites |
| `check_lyrics_fix` | `{ songId, lines: string[] }` | antes/depois verso a verso com o score de cada um no áudio, resumo e um `checkId` (vale 30 min). **Nada é gravado.** Demora 1–3 min |
| `apply_lyrics_fix` | `{ songId, checkId }` | grava a letra conferida e marca `lyricsSelection.reviewedAt`. **Só depois do usuário aprovar** |

A proposta é sempre a letra **inteira** (um item por verso; verso instrumental = `""`). A API
calcula o diff (igual / editado / novo / removido), dá a cada verso proposto o tempo do verso
que ele substitui e realinha tudo ao áudio.

## Limite

O Claude **não escreve a letra de memória** (direitos autorais): corrige pontos com base na
transcrição, nas letras dos sites e no score do áudio. Um verso editado cujo score cai é sinal
de que a correção não bate com o que é cantado.

## Erros

Toda falha da API vira texto legível para o Claude (status + código + o que fazer), nunca um
stack trace: `401 UNAUTHORIZED` (segredo diferente do da API), `503 REVIEW_DISABLED` (API sem
a variável), `409 REVIEW_NEEDS_VIDEO` (referência por arquivo: sem áudio para conferir), `409
REFERENCE_NOT_READY`, `410 REVIEW_CHECK_EXPIRED` (30 min, ou a API reiniciou), `409
LYRICS_CHANGED` (redo ou outra revisão no meio), `502 ALIGN_FAILED` (worker), `UNREACHABLE` e
`TIMEOUT` (rede).

## Desenvolvimento

```bash
pnpm --filter mcp test     # Vitest: format, api-client (fetch falso) e env; nada sobe a API
pnpm --filter mcp build    # tsc → dist/
pnpm --filter mcp start    # sobe o servidor no stdio (é o que o .mcp.json faz, via tsx)
```

Só o stderr recebe log: o stdout é o protocolo.
