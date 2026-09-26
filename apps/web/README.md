# cantor.ia — web

Frontend do karaokê (Next.js 16, App Router, React 19, Tailwind 4 + cantor.ia Design System).
Consome a API em `apps/api` e não guarda áudio no servidor.

## Telas

| Rota | Arquivo | O que faz |
|---|---|---|
| `/` | `app/page.tsx` + `components/song-search.tsx` | Busca em duas abas (sdd-015): "Pela letra" (LRCLIB, padrão; cadastra e a preparação sugere o vídeo) e "Pelo vídeo" (YouTube Music, sdd-011; cadastra e já prepara). Sem resultado pela letra, oferece procurar pelo vídeo (`lib/song-search.ts`). |
| `/songs/[id]` | `app/songs/[id]/page.tsx` + `components/song-prep.tsx` | Referência de pitch por link do YouTube ou upload, polling do status, resultado do alinhamento da letra, nome do jogador, ranking e "Cantar". |
| `/songs/[id]/sing` | `app/songs/[id]/sing/page.tsx` + `components/karaoke-session.tsx` | Karaokê: música no fone, letra sincronizada (a alinhada pela API, via `effectiveLyrics`), pitch ao vivo, ajuste fino da letra, volume da voz do cantor, nota e ranking. |

Páginas são Server Components (buscam `SongDto` e ranking com `lib/api.server.ts`); a
interação fica em Client Components (`components/`). Plano: `specs/sdd-004-web-karaoke/tasks.md`.

## Áudio e microfone

- **Áudio da música**: cache no IndexedDB por música (`lib/audio-store.ts`). Sem cache, baixa
  via `GET /api/songs/:id/audio` (com progresso) se a referência veio do YouTube; senão pede o
  arquivo, que fica só no dispositivo. Áudio com duração diferente da letra em mais de 10 s é
  recusado.
- **Voz do cantor** (sdd-013): com o áudio pronto, a tela de cantar pede em segundo plano a
  `POST /api/songs/:id/stems` (manda o próprio áudio) as trilhas de voz e instrumental, que
  ficam no IndexedDB (`lib/stems-store.ts`; o banco compartilhado é aberto em
  `lib/indexed-db.ts`). Com elas, a música toca em duas fontes sincronizadas e o slider "Voz do
  cantor" (`lib/singer-volume.ts`, 0–100 %, padrão 50 %, memorizado) controla um `GainNode` só
  na voz, antes e durante a cantoria; a segunda saída recebe a mesma mistura. Sem trilhas
  (gerando, falhou, sem IndexedDB, duração fora de ±100 ms do original), toca o original.
- **Microfone**: `AudioWorklet` em `public/worklets/capture.worklet.js` manda blocos de 10 ms
  para `lib/recorder.ts`, que detecta o pitch com `pitchy` e monta o `PitchTrack` (hop de
  10 ms) enviado à API. A latência (`outputLatency + baseLatency`) é descontada automaticamente;
  o ajuste fino da letra (±10 s, só deslocamento, nunca velocidade) vai como `offsetMs` e é
  aplicado sobre a letra já alinhada pela API (`alignedLyrics`, sdd-007).
- Use fone de ouvido: sem fone, o microfone capta a música.

## Comandos

```bash
corepack pnpm --filter web dev     # http://localhost:5173 (precisa da API em NEXT_PUBLIC_API_URL)
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
