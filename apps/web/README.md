# cantor.ia — web

Frontend do karaokê (Next.js 16, App Router, React 19, Tailwind 4 + cantor.ia Design System).
Consome a API em `apps/api` e não guarda áudio no servidor.

## Telas

| Rota | Arquivo | O que faz |
|---|---|---|
| `/` | `app/page.tsx` + `components/song-search.tsx` | Busca no LRCLIB (via API) e cadastra a música escolhida. |
| `/songs/[id]` | `app/songs/[id]/page.tsx` + `components/song-prep.tsx` | Referência de pitch por link do YouTube ou upload, polling do status, resultado do alinhamento da letra, nome do jogador, ranking e "Cantar". |
| `/songs/[id]/sing` | `app/songs/[id]/sing/page.tsx` + `components/karaoke-session.tsx` | Karaokê: música no fone, letra sincronizada (a alinhada pela API, via `effectiveLyrics`), pitch ao vivo, ajuste fino da letra, nota e ranking. |

Páginas são Server Components (buscam `SongDto` e ranking com `lib/api.server.ts`); a
interação fica em Client Components (`components/`). Plano: `specs/sdd-004-web-karaoke/tasks.md`.

## Áudio e microfone

- **Áudio da música**: cache no IndexedDB por música (`lib/audio-store.ts`). Sem cache, baixa
  via `GET /api/songs/:id/audio` (com progresso) se a referência veio do YouTube; senão pede o
  arquivo, que fica só no dispositivo. Áudio com duração diferente da letra em mais de 10 s é
  recusado.
- **Microfone**: `AudioWorklet` em `public/worklets/capture.worklet.js` manda blocos de 10 ms
  para `lib/recorder.ts`, que detecta o pitch com `pitchy` e monta o `PitchTrack` (hop de
  10 ms) enviado à API. A latência (`outputLatency + baseLatency`) é descontada automaticamente;
  o ajuste fino da letra (±10 s, só deslocamento, nunca velocidade) vai como `offsetMs` e é
  aplicado sobre a letra já alinhada pela API (`alignedLyrics`, sdd-007).
- Use fone de ouvido: sem fone, o microfone capta a música.

## Comandos

```bash
corepack pnpm --filter web dev     # http://localhost:3000 (precisa da API em NEXT_PUBLIC_API_URL)
corepack pnpm --filter web lint    # ESLint
corepack pnpm --filter web test    # Vitest: funções puras de lib/ (tests/*.spec.ts)
corepack pnpm --filter web build   # next build
```

Para o fluxo completo, suba também o Postgres, a API (`pnpm --filter api dev`) e o worker
(`uv run uvicorn app.main:app --port 8000` em `apps/worker`). Ver `AGENTS.md` da raiz.

## Variáveis de ambiente

O web não tem `.env` próprio: o `next.config.ts` lê o `.env` da raiz do monorepo (crie com
`pnpm env:init` na raiz) e copia só as chaves abaixo. Leia sempre por `lib/env.public.ts` ou
`lib/env.server.ts`, nunca `process.env` direto.

| Variável | Onde | Observação |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | browser (`publicEnv.apiUrl`, usado por `lib/api.ts`) | Embutida no bundle no `next build`: mudar exige rebuild. No Docker, é build arg. Nunca coloque segredo aqui. |
| `API_INTERNAL_URL` | servidor (`serverEnv.apiInternalUrl`, usado por `lib/api.server.ts`) | Opcional; sem ela usa `NEXT_PUBLIC_API_URL`. No compose é `http://api:3333`. |

Para adicionar uma variável ao web: inclua a chave em `WEB_ENV_KEYS` (`next.config.ts`), no
módulo de leitura certo, no `.env.example` da raiz e no compose.

## Design system

Tokens e componentes vivem em `DESIGN_SYSTEM/` (leia o `readme.md` de lá). `app/globals.css`
importa `styles.css` e `tailwind-theme.css`; componentes usam as classes `ct-*` e utilitários
Tailwind mapeados para os tokens. As webfonts entram por `<link>` no `app/layout.tsx`.
