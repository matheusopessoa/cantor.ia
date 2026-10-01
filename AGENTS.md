# AGENTS.md — cantor.ia

Fonte de verdade para o Claude (e qualquer agente de IA) que trabalha neste repositório.
Em caso de divergência entre este arquivo e o código, **o código prevalece** — valide no código
e proponha a correção aqui.

Monorepo pnpm (Node.js/TypeScript) com três workspaces e um app Python fora do pnpm:

- `apps/api` — backend Fastify + Prisma (Postgres), validação com Zod, testes com Vitest.
- `apps/web` — frontend Next.js 16 (App Router) + React 19 + Tailwind CSS 4, com design system
  próprio em `apps/web/DESIGN_SYSTEM/`.
- `apps/mcp` — servidor MCP (stdio, `@modelcontextprotocol/sdk`) para o Claude Code revisar a
  letra das músicas pelas rotas `/api/review/*` da API (sdd-012). Registrado no `.mcp.json` da
  raiz.
- `apps/worker` — serviço Python 3.12 (FastAPI + `uv`) que extrai a curva de pitch da voz de uma
  música (arquivo ou YouTube). Não tem `package.json`, então o pnpm o ignora.

---

## 1. Comandos do Projeto

| Comando | Descrição | Quando usar |
|---|---|---|
| `pnpm install` | Instala dependências de todos os workspaces (raiz + `apps/*`). | Primeira vez ou após mudanças em dependências. |
| `pnpm dev` | Sobe tudo de uma vez: Postgres de dev no Docker (espera o healthcheck), depois API (3333), web (5173) e worker (8000) como processos locais, com a saída prefixada por serviço. Mata antes qualquer processo preso nessas portas. `--no-worker` pula o worker. Ctrl+C derruba os três; `pnpm dev:stop` libera as portas e para o banco. | Desenvolvimento local do stack inteiro (o jeito padrão de ligar o projeto). |
| `pnpm env:init` | Cria o `.env` da raiz a partir do `.env.example` e gera os `*_SECRET`. Nunca sobrescreve um `.env` existente. | Primeira vez no projeto. |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db` | Sobe o Postgres de desenvolvimento (`db`, porta 5432) com os valores do `.env` da raiz. | Antes de rodar a API localmente. |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` | Sobe db + api + web em containers. | Testar o stack completo em Docker. |
| `pnpm --filter api dev` | Roda a API em watch mode (`tsx watch src/server.ts`, porta 3333). Mata antes qualquer processo na 3333. | Desenvolvimento local da API. |
| `pnpm --filter web dev` | Roda o Next.js em dev (porta 5173; a 3000 fica livre para outros projetos e a 5000 é do AirPlay do macOS). Mata antes qualquer processo na 5173 (como o `dev` da API faz na 3333), para um servidor antigo travado não segurar a porta. | Desenvolvimento local do web. |
| `pnpm --filter api build` | Compila a API (`tsc`). | Validação de build / CI. |
| `pnpm --filter web build` | Builda o Next.js. | Validação de build / CI. |
| `pnpm --filter api test` | Sobe o Postgres de teste isolado (`docker-compose.test.yml`, porta 5433), aplica as migrations (`prisma migrate deploy` no `global-setup.ts`) e roda `vitest run`. | Antes de commit/PR que toca `apps/api`. |
| `pnpm --filter api test:watch` | Mesma suíte, em watch mode. | Durante o desenvolvimento de testes. |
| `pnpm --filter web lint` | Roda ESLint (flat config) no web. | Antes de commit/PR que toca `apps/web`. |
| `pnpm --filter web test` | Roda `vitest run` nas funções puras de `apps/web/lib/` (`apps/web/tests/*.spec.ts`, sem DOM nem browser). `test:watch` para watch mode. | Antes de commit/PR que toca `apps/web/lib`. |
| `pnpm --filter mcp test` | Roda `vitest run` em `apps/mcp/tests/` (formatação, cliente HTTP com `fetch` falso, env). Nada sobe a API. | Antes de commit/PR que toca `apps/mcp`. |
| `pnpm --filter mcp start` | Sobe o servidor MCP no stdio (`tsx src/server.ts`); é o que o `.mcp.json` da raiz faz. Precisa de `LYRICS_REVIEW_SECRET` no `.env`. | Só para depurar à mão; o Claude Code sobe sozinho pelo `.mcp.json` (`/mcp` lista o servidor `cantor`). |
| `pnpm --filter api db:migrate` | Cria/aplica migration Prisma em dev (`prisma migrate dev`). | Mudança em `prisma/schema.prisma`. |
| `pnpm --filter api db:generate` | Regenera o Prisma Client (saída em `apps/api/src/generated/prisma`). | Após alterar o schema. |
| `pnpm --filter api db:studio` | Abre o Prisma Studio. | Inspeção manual dos dados. |
| `uv sync` (em `apps/worker`) | Cria o `.venv` e instala as dependências do worker. Requer `ffmpeg` e `deno` no PATH (`brew install ffmpeg deno`). | Primeira vez ou após mudar `pyproject.toml`. |
| `uv run uvicorn app.main:app --reload --port 8000` (em `apps/worker`) | Roda o worker em dev. O primeiro start baixa os pesos do Demucs. | Desenvolvimento local do worker. |
| `uv run pytest` (em `apps/worker`) | Suíte do worker, sem rede e sem Demucs (~5 s). `-m slow` roda o Demucs; `-m network` baixa do YouTube. | Antes de commit/PR que toca `apps/worker`. |

> A API hoje **não tem lint configurado** (`apps/api` não tem ESLint). Se uma tarefa adicionar
> lint à API, documente o comando nesta tabela.

---

## 2. Arquitetura e Padrões

- **`apps/api`**: arquitetura em camadas simples e unidirecional —
  `routes → controllers → services → repositories → banco de dados`, com `clients/` (HTTP
  externo: LRCLIB e worker, chamados pelos services) e `utils/` como peças compartilhadas
  sem estado de negócio. Desde a sdd-016 a API guarda em disco as trilhas (voz e
  instrumental) de cada referência pronta (`repositories/stems.repository.ts`, pasta
  `SONG_STEMS_DIR`), e o karaokê toca direto delas (`GET /api/songs/:id/stems/:stem`). **Não há injeção de dependência** via
  construtor/factories/interfaces: os módulos são importados diretamente. Documentado em
  [`apps/api/docs/arquitetura.md`](apps/api/docs/arquitetura.md).
- **`apps/web`**: Next.js App Router (`app/`), estilizado com Tailwind 4 e os tokens/componentes
  de `apps/web/DESIGN_SYSTEM/`. Páginas são Server Components que buscam `SongDto`/ranking via
  `lib/api.server.ts` e entregam a Client Components em `components/` (busca, preparação com
  polling, sessão de karaokê). Letra, canvas e nota usam `effectiveLyrics(song)`
  (`lib/lyrics.ts`: a letra alinhada pela API, senão a original; sdd-007). O browser fala
  com a API por `lib/api.ts`; o áudio da música
  fica em cache no IndexedDB (`lib/audio-store.ts`); o microfone passa por um `AudioWorklet`
  (`public/worklets/capture.worklet.js`) e o pitch é detectado com `pitchy` (`lib/recorder.ts`).
  Plano de referência: `specs/sdd-004-web-karaoke/tasks.md`.
- **`apps/worker`**: FastAPI stateless, sem banco. Pipeline ffmpeg → Demucs (`htdemucs`, voz) →
  torchcrepe (`tiny`, 10 ms) → `PitchTrack`; com `stems` no pedido (sdd-016), a mesma passada
  do Demucs também devolve as trilhas de voz e instrumental em AAC (resposta multipart). O
  Demucs e o MMS_FA rodam na GPU do Mac (`mps`) quando ela existe (`WORKER_DEVICE`, `app/device.py`);
  crepe e Whisper local ficam em CPU; com a letra no pedido, a mesma voz isolada passa
  pelo alinhador forçado `torchaudio.pipelines.MMS_FA` (wav2vec2 + CTC, 20 ms) e cada linha
  ganha início, fim e confiança (`alignment`, sdd-010). Com letras candidatas no pedido
  (música nova, sdd-011), a voz passa antes pelo Whisper e o worker escolhe a letra que
  combina com o que é cantado (ou usa a transcrição) e alinha a escolhida. O Whisper é o
  `whisper-1` da OpenAI quando há `OPENAI_API_KEY` (sdd-014: só a voz isolada vai, em MP3 mono
  16 kHz) e o `faster-whisper` na CPU sem a chave, que também é a reserva quando a OpenAI falha
  (`app/transcription.py`; `app/config.py` lê a chave do ambiente ou do `.env` da raiz).
  Também é a busca de músicas do app (YouTube Music, `ytmusicapi`) e, na revisão da letra
  (sdd-012), alinha a letra atual e a proposta sobre a mesma voz (`/youtube/align`). O áudio só
  existe no tmp da requisição. Só a API fala com ele. Contrato em
  `specs/sdd-001-worker-pitch/tasks.md`, `specs/sdd-010-lyrics-forced-alignment/tasks.md`,
  `specs/sdd-011-lyrics-from-video/tasks.md`, `specs/sdd-012-lyrics-review-mcp/tasks.md` e em
  `apps/worker/README.md`.
- **`apps/mcp`**: servidor MCP stdio, sem estado e sem banco: só fala com `/api/review/*` da
  API com o token `LYRICS_REVIEW_SECRET` (`src/api-client.ts`), lê o `.env` da raiz
  (`src/env.ts`) e formata as respostas em texto para o Claude (`src/format.ts`, puro). Quatro
  ferramentas: `list_songs_to_review`, `get_song_lyrics`, `check_lyrics_fix` (conferência no
  áudio, nada gravado) e `apply_lyrics_fix` (só depois de o usuário aprovar). O Claude não
  escreve letra de memória: corrige com a transcrição, as letras dos sites e o score do áudio.
  Só o stderr recebe log (o stdout é o protocolo). Plano: `specs/sdd-012-lyrics-review-mcp/tasks.md`;
  uso em `apps/mcp/README.md`.

| Camada | Onde vive | Responsabilidade |
|---|---|---|
| Routes | `apps/api/src/routes/` | Mapear método + URL para um controller. Nenhuma lógica. |
| Controllers | `apps/api/src/controllers/` | Fronteira HTTP: validar com Zod (`schema.parse`), chamar o service, devolver resposta. Único lugar que conhece `FastifyRequest`/`FastifyReply`. |
| Services | `apps/api/src/services/` | Regra de negócio. Não conhece HTTP nem SQL. Retorna DTOs simples (ex.: `PublicUser`). |
| Repositories | `apps/api/src/repositories/` | Acesso a dados via Prisma Client (retorna models do Prisma) ou, para as trilhas (sdd-016), a pasta local `SONG_STEMS_DIR` (`stems.repository.ts`, o único módulo que toca o sistema de arquivos). |
| Clients | `apps/api/src/clients/` | Integrações HTTP externas (LRCLIB, worker). Chamados pelos services; validam a resposta com Zod e lançam `AppError`/`WorkerClientError`. |
| Utils | `apps/api/src/utils/` | Prisma singleton, hash, bindex, schemas Zod (`validators.ts`), erros, error handler global. |
| Config | `apps/api/src/config/` | Variáveis de ambiente validadas com Zod (`env.ts`) e CORS (`cors.ts`). |
| App Router | `apps/web/app/` | Páginas e layouts do Next.js. |
| Design System | `apps/web/DESIGN_SYSTEM/` | Tokens (cores, tipografia, espaçamento) e componentes reutilizáveis da UI. |
| Worker | `apps/worker/app/` | `main.py` (rotas, erros, semáforo), `audio.py` (ffmpeg), `separation.py` (Demucs), `pitch.py` (crepe), `alignment.py` (MMS_FA), `transcription.py` (Whisper: OpenAI `whisper-1` ou `faster-whisper` local), `config.py` (env com `pydantic-settings`), `device.py` (`cpu`/`mps` do Demucs e do MMS_FA, sdd-016), `lyrics_selection.py` (escolha da letra), `youtube.py` (yt-dlp), `ytmusic.py` (YouTube Music). |
| MCP | `apps/mcp/src/` | `server.ts` (as 4 ferramentas, stdio), `api-client.ts` (HTTP para `/api/review/*`, erros legíveis), `env.ts` (`.env` da raiz, Zod), `format.ts` (texto das respostas, puro). |

---

## 3. Princípios de Decisão

- **Código prevalece sobre documentação**: em caso de divergência, valide no código e proponha
  correção na documentação.
- **Atualização de documentação:**

| Tipo de alteração | Documento a atualizar |
|---|---|
| Rota, controller, service ou repository em `apps/api` | `apps/api/docs/arquitetura.md` |
| `prisma/schema.prisma` (novo model/campo) | `apps/api/docs/arquitetura.md` + comentário no schema + migration |
| Tokens/componentes em `apps/web/DESIGN_SYSTEM/` | `apps/web/DESIGN_SYSTEM/readme.md` |
| Variáveis de ambiente (`docker-compose.*.yml`, `.env.test`, `config/env.ts`) | `AGENTS.md` §11 e o `README.md` do app afetado |

---

## 4. Estrutura de Pastas

```
cantor.ia/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/          # cors.ts, env.ts
│   │   │   ├── clients/         # lrclib.client.ts, worker.client.ts (HTTP externo)
│   │   │   ├── controllers/     # auth, health, song, performance, review (revisão da letra, sdd-012)
│   │   │   ├── services/        # auth, health, scoring (nota), alignment (letra ↔ áudio), lyrics-source (letras candidatas), lyrics-review (revisão pelo MCP), song, youtube-suggestion, performance
│   │   │   ├── repositories/    # user, song, performance, stems (pasta local das trilhas, sdd-016)
│   │   │   ├── routes/          # auth.routes.ts, health.routes.ts, song.routes.ts, review.routes.ts (token de serviço)
│   │   │   ├── utils/           # prisma, hash, bindex, validators, errors, error-handler, pitch, lrc, youtube, review-auth
│   │   │   ├── generated/       # Prisma Client gerado (ignorado pelo Git)
│   │   │   ├── tests/           # alignment/, auth/, clients/, config/, errors/, healthcheck/, lrc/, lyrics/, performances/, review/, scoring/, songs/, stems/, youtube/, helpers/
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── docs/
│   │   │   └── arquitetura.md
│   │   ├── prisma.config.ts
│   │   ├── vitest.config.ts
│   │   ├── .env.test            # env da suíte de testes (sem segredos reais)
│   │   └── Dockerfile
│   ├── web/
│       ├── app/                 # layout.tsx, page.tsx (busca), songs/[id]/page.tsx (preparar), songs/[id]/sing/page.tsx (karaokê), error.tsx, not-found.tsx, globals.css
│       ├── components/          # Client Components: song-search, song-prep, karaoke-session, pitch-canvas, lyrics-view, score-result, ranking-list…
│       ├── lib/                 # api.ts (cliente tipado), api.server.ts, types.ts (espelho dos DTOs), pitch.ts, lyrics.ts, recorder.ts, audio-store.ts (IndexedDB), env.public.ts, env.server.ts
│       ├── tests/               # *.spec.ts do Vitest (só funções puras de lib/)
│       ├── public/worklets/     # capture.worklet.js (AudioWorklet do microfone)
│       ├── DESIGN_SYSTEM/       # cantor.ia Design System: readme.md, styles.css, tokens/, components/, DESIGN_SYSTEM.html
│       ├── vitest.config.mts
│       ├── AGENTS.md            # avisos sobre a versão do Next.js
│       └── Dockerfile
│   ├── mcp/                     # servidor MCP (stdio) da revisão da letra (sdd-012)
│   │   ├── src/                 # server.ts, api-client.ts, env.ts, format.ts
│   │   ├── tests/               # *.spec.ts do Vitest (format, api-client com fetch falso, env)
│   │   ├── README.md            # como configurar e usar no Claude Code
│   │   ├── tsconfig.json / vitest.config.ts
│   │   └── package.json
│   └── worker/                  # Python 3.12 + uv (fora do pnpm)
│       ├── app/                 # main, audio, separation, pitch, alignment, transcription, config, device, lyrics_selection, youtube, ytmusic, schemas, errors
│       ├── tests/               # pytest (conftest com sinais sintéticos e yt-dlp falso)
│       ├── scripts/             # plot_track.py, compare_devices.py (cpu vs mps numa música real, sdd-016)
│       ├── pyproject.toml / uv.lock
│       └── Dockerfile
├── .env.example                 # catálogo versionado de todas as variáveis (sem segredos)
├── .env                         # valores locais, ignorado pelo Git (pnpm env:init)
├── .data/stems/                 # trilhas guardadas pela API (SONG_STEMS_DIR), ignorada pelo Git (sdd-016)
├── .mcp.json                    # registra o servidor MCP `cantor` (apps/mcp) no Claude Code
├── scripts/
│   ├── dev.mjs                  # `pnpm dev`: db + api + web + worker de uma vez
│   └── env-init.mjs             # cria o .env e gera os segredos
├── docker-compose.yml           # base (api + web + worker)
├── docker-compose.dev.yml       # db de desenvolvimento + env de dev de api/web
├── docker-compose.test.yml      # db isolado de testes (porta 5433)
├── docker-compose.prod.yml
├── pnpm-workspace.yaml          # packages: apps/*
├── specs/
│   ├── tasks.txt
│   └── sdd-<NNN>-<slug>/tasks.md
├── .claude/skills               # link simbólico → ../.agents/skills (registro no Claude Code)
└── .agents/skills/
    ├── code-planner/SKILL.md
    ├── code-implementer/SKILL.md
    ├── code-reviewer/SKILL.md
    ├── api-architecture/SKILL.md
    ├── web-architecture/SKILL.md
    └── open-pull-request/SKILL.md
```

---

## 5. Convenções de Código

- **Linguagem**: TypeScript estrito (`"strict": true` em ambos os `tsconfig.json`). A API roda em
  módulos ESM (`"type": "module"`, `module: nodenext`) — imports relativos usam extensão `.js`.
- **Nomenclatura**: arquivos em `kebab-case.ts` sufixados por camada (`user.repository.ts`,
  `auth.service.ts`, `auth.controller.ts`, `auth.routes.ts`); funções/variáveis em `camelCase`;
  tipos e interfaces em `PascalCase`. Schemas Zod exportados seguem o padrão existente
  `camelCase` + sufixo `Schema` (`registerUserBodySchema`, `loginBodySchema`).
- **Services/repositories**: exportados como objeto literal (`export const authService = { ... }`).
- **Injeção de dependência**: nenhuma — módulos são importados diretamente entre camadas (ver §2).
- **Validação**: schemas Zod em `utils/validators.ts`, aplicados com `.parse()` nos controllers
  (fronteira HTTP). Variáveis de ambiente validadas em `config/env.ts`.
- **Erros**: `AppError` (com `statusCode`) e subclasses de negócio em `utils/errors.ts`; tratados
  centralmente por `utils/error-handler.ts` (`ZodError` → 400, `AppError` → `statusCode`, demais
  → 500), registrado em `app.ts`.
- **Persistência**: Prisma Client como instância única em `utils/prisma.ts`; adapter
  `@prisma/adapter-pg` sobre Postgres.
- **Segurança**: hashing com `bcryptjs` (`utils/hash.ts`); blind index determinístico
  HMAC-SHA256 para busca de e-mail (`utils/bindex.ts`, depende de `EMAIL_BINDEX_SECRET`);
  autenticação via `@fastify/jwt` (`JWT_SIGN_SECRET`).
- **Testes**: Vitest, arquivos `*.spec.ts` em `apps/api/src/tests/`. A suíte sobe um Postgres
  isolado via `docker-compose.test.yml` (porta 5433, dados em `tmpfs`), roda sem paralelismo entre
  arquivos e faz `TRUNCATE` antes de cada teste — `helpers/database.ts` recusa bancos cujo nome
  não termine em `_test`.
- **Web**: App Router do Next.js; ESLint flat config (`eslint.config.mjs`); estilos via
  Tailwind 4 + tokens do `DESIGN_SYSTEM/` (classes `ct-*`; nunca hex ou fonte crua em
  componente). Leia `apps/web/AGENTS.md` antes de gerar código Next.js. As regras do React
  Compiler no ESLint do Next 16 proíbem `setState` síncrono dentro de `useEffect` e ler refs
  durante o render: preferências do dispositivo entram por `useSyncExternalStore`
  (`lib/use-prefs.ts`). Testes: Vitest em `apps/web/tests/*.spec.ts`, só para funções puras de
  `lib/`.

---

## 6. Fluxo Obrigatório para Novos Parâmetros Públicos

Ao alterar contratos públicos (models/campos do `prisma/schema.prisma`, schemas Zod exportados,
contratos de rotas Fastify, tipos exportados de `utils/`):

1. Validar necessidade no código e em `apps/api/docs/arquitetura.md`.
2. Marcar explicitamente como exportado (`export`) e, se for campo de model Prisma, gerar a
   migration (`pnpm --filter api db:migrate`).
3. Adicionar/atualizar testes em `apps/api/src/tests/`.
4. Atualizar `apps/api/docs/arquitetura.md` (e o `readme.md` do design system, se for contrato
   de UI).
5. Escrever entrada em `CHANGELOG.md` (criar na raiz se ainda não existir).
6. Fazer bump de versão em `apps/api/package.json` / `apps/web/package.json` se breaking change
   ou release.
7. Solicitar revisão de, no mínimo, um maintainer.

---

## 7. Instruções para Agentes de IA

- **Co-autoria em commits**: `Co-authored-by: Claude <noreply@anthropic.com>`.

- **Formato de commit**: Conventional Commits — `feat:`, `fix:`, `docs:`, `style:`, `refactor:`,
  `test:`, `chore:`.
- **Comportamento geral**: nunca expor segredos (`.env`, `EMAIL_BINDEX_SECRET`, `JWT_SIGN_SECRET`,
  `DATABASE_URL`); confirmar regras no código antes de afirmá-las; citar arquivos e linhas nas
  justificativas.

---

## 8. Fluxo de Trabalho com SDD

```
1. Escreva a tarefa em `specs/tasks.txt`.
2. Gere o plano técnico invocando a skill `code-planner`.
   - Lê `specs/tasks.txt`, `AGENTS.md` e
     `apps/api/docs/arquitetura.md` (ou o design system, se a tarefa for de UI).
   - Produz `specs/<feature-id>/tasks.md` com as 10 seções definidas.
   - Se houver ambiguidade, o plano sai com `status: blocked` e uma seção "Perguntas em Aberto".
3. Revise o plano com um maintainer (se aplicável).
4. Implemente invocando a skill `code-implementer`.
   - Lê `specs/<feature-id>/tasks.md`, `AGENTS.md` e docs relevantes.
   - Implementa código + testes e roda lint/testes (`pnpm --filter api test` e/ou `pnpm --filter web lint`).
   - Encerra indicando que a skill `code-reviewer` deve ser executada.
5. Revise invocando a skill `code-reviewer`.
   - Coleta `git status`, `git diff --staged`, `git diff`, `git log`.
   - Lê arquivos modificados, roda lint e testes.
   - Emite conclusão `APROVADO` ou `AJUSTES NECESSARIOS`.
6. (Opcional) Abra o PR invocando a skill `open-pull-request` (remote: `github.com/matheusopessoa/cantor.ia`).
```

`specs/` é **versionado**. Não usar `docs/specs/` ou outro caminho legado para entrada de tarefas.
Convenção de `<feature-id>`: `sdd-<NNN>-<slug>` (ex.: `sdd-001-refresh-token`), com `NNN`
sequencial a partir do maior existente em `specs/`.

---

## 9. Skills de Automação

As skills vivem em [`.agents/skills/`](.agents/skills/). `.claude/skills` é um link simbólico para
essa pasta, para o Claude Code registrar as skills como comandos (`/code-planner`,
`/code-reviewer` etc.). Edite sempre em `.agents/skills/`.

| Skill | Quando usar |
|---|---|
| [`code-planner`](.agents/skills/code-planner/SKILL.md) | Planejar qualquer tarefa não trivial (antes de codar). |
| [`code-implementer`](.agents/skills/code-implementer/SKILL.md) | Implementar a partir de um plano `specs/<feature-id>/tasks.md`. |
| [`code-reviewer`](.agents/skills/code-reviewer/SKILL.md) | Revisão técnica antes de commit/PR. |
| [`api-architecture`](.agents/skills/api-architecture/SKILL.md) | Dúvidas sobre camadas, rotas, Prisma, contratos públicos em `apps/api`. |
| [`web-architecture`](.agents/skills/web-architecture/SKILL.md) | Dúvidas sobre páginas, componentes e tokens em `apps/web`. |
| [`open-pull-request`](.agents/skills/open-pull-request/SKILL.md) | **Só quando explicitamente invocada.** Criar PR via `gh`. |

---

## 10. Proibições Globais

- Não versionar segredos, tokens, senhas, chaves de API ou `.env` (o `.gitignore` da raiz ignora
  `.env*`, com exceção explícita de `.env.example`, o catálogo sem valores reais, e de
  `apps/api/.env.test`, que é versionado para a suíte de testes — não adicionar segredos reais a
  nenhum dos dois).
- Não usar `README.md` como fonte de verdade; confirme regras no código e em `apps/api/docs/`.
- Não commitar código sem testes.
- Não ignorar lint/formatador sem justificar explicitamente.
- Não alterar `prisma/schema.prisma` ou contratos públicos sem migration, changelog e bump de
  versão.
- Não fazer `rm -rf`, `git reset --hard`, `git push -f` ou reescrita de história sem confirmação
  explícita.
- Não carregar `open-pull-request` automaticamente; só quando o usuário pedir.
- Não tratar `specs/` como rascunho oculto; os planos SDD são públicos no repositório e **não**
  devem entrar em nenhum `.gitignore`.

---

## 11. Dependências Externas

| Dependência | Versão mínima | Uso | Onde é referenciada |
|---|---|---|---|
| `fastify` | ^5.10.0 | Framework HTTP da API | `apps/api/src/app.ts`, `server.ts` |
| `@prisma/client` / `prisma` | ^7.8.0 | ORM e migrations | `apps/api/src/utils/prisma.ts`, `prisma/schema.prisma` |
| `@prisma/adapter-pg` | ^7.8.0 | Adapter Prisma ↔ Postgres | `apps/api/src/utils/prisma.ts` |
| `zod` | ^4.4.3 | Validação de entrada e de env | `apps/api/src/utils/validators.ts`, `config/env.ts` |
| `bcryptjs` | ^3.0.3 | Hashing de senha | `apps/api/src/utils/hash.ts` |
| `@fastify/jwt` | ^10.2.0 | Autenticação JWT | `apps/api/src/app.ts`, `services/auth.service.ts` |
| `@fastify/cors` | ^11.3.0 | CORS | `apps/api/src/config/cors.ts` |
| `@fastify/multipart` | ^10.1.2 | Upload da referência de pitch (1 arquivo, 20 MB) | `apps/api/src/app.ts`, `controllers/song.controller.ts` |
| `vitest` | ^4.1.10 | Testes da API | `apps/api/src/tests/`, `vitest.config.ts` |
| `next` | 16.2.10 | Framework do frontend | `apps/web/app/` |
| `react` / `react-dom` | 19.2.4 | UI do frontend | `apps/web/app/` |
| `tailwindcss` | ^4 | Estilos do frontend | `apps/web/app/globals.css`, `postcss.config.mjs` |
| `server-only` | ^0.0.1 | Impede importar código de servidor em Client Components | `apps/web/lib/env.server.ts`, `lib/api.server.ts` |
| `pitchy` | ^4.1.0 | Detecção de pitch da voz no browser (McLeod Pitch Method), hop de 10 ms | `apps/web/lib/recorder.ts` |
| `vitest` (web) | ^5.0.2 | Testes das funções puras de `apps/web/lib/` | `apps/web/tests/`, `vitest.config.mts` |
| `@modelcontextprotocol/sdk` | ^1.30.1 | Servidor MCP (stdio) da revisão da letra, sdd-012 | `apps/mcp/src/server.ts` |
| `zod` / `dotenv` (mcp) | ^4.6.5 / ^18.0.4 | Validação do `.env` e das entradas das ferramentas | `apps/mcp/src/env.ts`, `server.ts` |
| `tsx` / `vitest` (mcp) | ^4.23.15 / ^5.0.2 | Sobe o servidor sem build (`.mcp.json`) / testes | `apps/mcp/package.json`, `.mcp.json` |
| `postgres` (Docker) | 15-alpine | Banco de dados (dev e test) | `docker-compose.dev.yml`, `docker-compose.test.yml` |
| `fastapi` / `uvicorn` | 0.141 / 0.54 | Servidor HTTP do worker | `apps/worker/app/main.py` |
| `demucs` | 4.1 | Isola a voz (modelo `htdemucs`) | `apps/worker/app/separation.py` |
| `torch` / `torchaudio` | 2.14 / 2.11 | Runtime dos modelos; o `torchaudio` também traz o `MMS_FA` (alinhamento forçado da letra, checkpoint de 1,2 GB baixado uma vez) e o `forced_align` | `apps/worker/pyproject.toml` (só Mac ARM e Linux em `tool.uv.environments`), `apps/worker/app/alignment.py` |
| `torchcrepe` | 0.0.24 | Pitch da voz (modelo `tiny`) | `apps/worker/app/pitch.py` |
| `yt-dlp` | 2026.8.19 | Baixa o áudio do YouTube (projeto pessoal, não comercial) | `apps/worker/app/youtube.py` |
| `ytmusicapi` | 1.12.3 | Busca de músicas e letra licenciada do YouTube Music (API não oficial) | `apps/worker/app/ytmusic.py` |
| `httpx` (worker) | 0.28.1 | Cliente HTTP da transcrição pela OpenAI (sdd-014; também o `TestClient` dos testes) | `apps/worker/app/transcription.py` |
| `pydantic-settings` | 2.15.0 | Configuração do worker (`OPENAI_API_KEY`), do ambiente ou do `.env` da raiz, sdd-014 | `apps/worker/app/config.py` |
| API da OpenAI (`whisper-1`) | — | Transcrição da voz isolada com tempo por palavra quando há `OPENAI_API_KEY` (pago por minuto; `/v1/audio/transcriptions` sem retenção nem treino) | `apps/worker/app/transcription.py` |
| `faster-whisper` | 1.2.1 | Transcrição da voz (`large-v3-turbo` int8, CPU; pesos de ~1,6 GB baixados no build) para escolher a letra, sdd-011 | `apps/worker/app/transcription.py` |
| `ffmpeg` / `deno` (binários) | — | Decodificar áudio / runtime JS exigido pelo `yt-dlp` | Homebrew no dev, `apps/worker/Dockerfile` |

### Variáveis de ambiente

**Onde ficam**: um único `.env` na raiz (ignorado pelo Git), criado com `pnpm env:init` a partir
do catálogo versionado `.env.example`. Exceção: `apps/api/.env.test`, versionado, só com valores
de teste. Plano de referência: `specs/sdd-006-env-config/tasks.md`.

**Como chegam a cada app**:
- API: `apps/api/src/config/env.ts` carrega o `.env` da raiz (exceto com `NODE_ENV=test`) e valida
  com Zod. É o único arquivo de `src/` que lê `process.env` (exceções: `tests/`).
- CLI do Prisma: `apps/api/prisma.config.ts` carrega o mesmo `.env` por caminho explícito.
- Web: `apps/web/next.config.ts` copia do `.env` da raiz **só** as chaves do web; o código lê via
  `lib/env.public.ts` (browser) e `lib/env.server.ts` (`server-only`).
- Worker: `apps/worker/app/config.py` (`pydantic-settings`, sdd-014) lê do ambiente e, fora do
  Docker, do `.env` da raiz; o ambiente do processo vence o arquivo. A suíte (`tests/conftest.py`)
  força a chave ausente: nunca chama a OpenAI, exceto no `-m network`.
- MCP: `apps/mcp/src/env.ts` lê o `.env` da raiz (sdd-012).
- Compose: cada serviço lista o que recebe em `environment:` (nunca `env_file:`); obrigatórias
  com `${VAR:?mensagem}`. Endereços entre containers (`db`, `api`, `worker`) ficam no compose.

**Convenção de nomes**:
1. `SCREAMING_SNAKE_CASE`, sem abreviações (`POSTGRES_PASSWORD`, não `DB_PASS`).
2. `<RECURSO>_<ATRIBUTO>`: o prefixo diz **o que** a variável descreve, não quem a lê
   (`WORKER_URL` é o endereço do worker, lido pela API).
3. Sufixo diz o tipo: `_URL` (absoluta, com esquema), `_SECRET` (≥ 32 caracteres, nunca logado),
   plural para listas separadas por vírgula (`_ORIGINS`), `_MS` (duração), `_ENABLED` (`true`/`false`).
4. O ambiente nunca vai no nome: o mesmo nome em dev, test e prod.
5. Nomes impostos por ferramentas são mantidos: `NODE_ENV`, `DATABASE_URL`, `POSTGRES_*`, `NEXT_PUBLIC_*`.
6. `NEXT_PUBLIC_` só para o que pode ir ao browser (é embutido no bundle no build).
7. Só vai para env o que muda entre ambientes ou é segredo; limites e regras são constantes no código.
8. Variável nova = schema do app + `.env.example` + compose (se roda em container) + esta tabela,
   no mesmo commit.

| Variável | Serviço | Obrigatória | Segredo | Lida/validada em |
|---|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | db | sim | senha sim | `docker-compose.dev.yml` |
| `DATABASE_URL` | api, CLI do Prisma | sim | sim | `config/env.ts`, `prisma.config.ts` |
| `JWT_SIGN_SECRET` | api | sim | sim | `config/env.ts` |
| `EMAIL_BINDEX_SECRET` | api | sim | sim (trocar invalida a busca de e-mails) | `config/env.ts` |
| `CORS_ALLOWED_ORIGINS` | api | só em prod | não | `config/env.ts` |
| `WORKER_URL` | api | não (padrão: `http://localhost:8000`; compose: `http://worker:8000`) | não | `config/env.ts` |
| `LRCLIB_BASE_URL` | api | não (padrão: `https://lrclib.net`) | não | `config/env.ts` |
| `LYRICS_REVIEW_SECRET` | api, mcp | não (sem ela `/api/review/*` responde 503 e o MCP não sobe; vazia conta como ausente) | sim (≥ 32; token de serviço da revisão da letra, sdd-012) | `config/env.ts`, `apps/mcp/src/env.ts` |
| `SONG_STEMS_DIR` | api | não (padrão: `.data/stems` na raiz do repo; relativa é resolvida contra a raiz; compose: volume `/data/stems`) | não | `config/env.ts` |
| `NEXT_PUBLIC_API_URL` | web (browser, build-time), mcp | sim | **nunca** | `lib/env.public.ts`, `apps/mcp/src/env.ts` |
| `API_INTERNAL_URL` | web (servidor) | não (padrão: `NEXT_PUBLIC_API_URL`) | não | `lib/env.server.ts` |
| `OPENAI_API_KEY` | worker | não (sem ela, ou vazia: Whisper local na CPU) | **sim** (nunca na API nem no web; `SecretStr`, nunca logada) | `apps/worker/app/config.py` |
| `WORKER_DEVICE` | worker | não (padrão `auto`: `mps` na GPU do Mac se houver, senão `cpu`; `cpu`/`mps` forçam, `mps` sem MPS derruba o boot; vazia conta como `auto`) | não | `apps/worker/app/config.py`, `app/device.py` |

`NODE_ENV` não fica no `.env`: é definido por processo (API: `dev` por padrão, `test` pelo
`.env.test`, `prod` pelo compose; o Next define o dele).

---

## 12. Contexto do Projeto

- **Repositório**: cantor.ia — `github.com/matheusopessoa/cantor.ia`.
- **Gerenciador de pacotes**: pnpm 10.24.0, workspaces em `apps/*`.
- **Apps**: `api` (v2.4.0), `web` (v0.8.0), `worker` (v0.7.0), `mcp` (v0.1.0) — ainda sem releases/tags publicadas.
- **Squad/owners/maintainers**: _(preencher — não há esse dado no repositório hoje)_.
- **Infra**: Docker Compose para dev (`docker-compose.dev.yml`), testes
  (`docker-compose.test.yml`) e produção (`docker-compose.prod.yml`); `nginx.conf` presente na
  raiz (ainda vazio).
