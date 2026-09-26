# AGENTS.md — cantor.ia

Fonte de verdade para o Claude (e qualquer agente de IA) que trabalha neste repositório.
Em caso de divergência entre este arquivo e o código, **o código prevalece** — valide no código
e proponha a correção aqui.

Monorepo pnpm (Node.js/TypeScript) com dois workspaces e um app Python fora do pnpm:

- `apps/api` — backend Fastify + Prisma (Postgres), validação com Zod, testes com Vitest.
- `apps/web` — frontend Next.js 16 (App Router) + React 19 + Tailwind CSS 4, com design system
  próprio em `apps/web/DESIGN_SYSTEM/`.
- `apps/worker` — serviço Python 3.12 (FastAPI + `uv`) que extrai a curva de pitch da voz de uma
  música (arquivo ou YouTube). Não tem `package.json`, então o pnpm o ignora.

---

## 1. Comandos do Projeto

| Comando | Descrição | Quando usar |
|---|---|---|
| `pnpm install` | Instala dependências de todos os workspaces (raiz + `apps/*`). | Primeira vez ou após mudanças em dependências. |
| `pnpm env:init` | Cria o `.env` da raiz a partir do `.env.example` e gera os `*_SECRET`. Nunca sobrescreve um `.env` existente. | Primeira vez no projeto. |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db` | Sobe o Postgres de desenvolvimento (`db`, porta 5432) com os valores do `.env` da raiz. | Antes de rodar a API localmente. |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` | Sobe db + api + web em containers. | Testar o stack completo em Docker. |
| `pnpm --filter api dev` | Roda a API em watch mode (`tsx watch src/server.ts`, porta 3333). Mata antes qualquer processo na 3333. | Desenvolvimento local da API. |
| `pnpm --filter web dev` | Roda o Next.js em dev (porta 3000). | Desenvolvimento local do web. |
| `pnpm --filter api build` | Compila a API (`tsc`). | Validação de build / CI. |
| `pnpm --filter web build` | Builda o Next.js. | Validação de build / CI. |
| `pnpm --filter api test` | Sobe o Postgres de teste isolado (`docker-compose.test.yml`, porta 5433), aplica as migrations (`prisma migrate deploy` no `global-setup.ts`) e roda `vitest run`. | Antes de commit/PR que toca `apps/api`. |
| `pnpm --filter api test:watch` | Mesma suíte, em watch mode. | Durante o desenvolvimento de testes. |
| `pnpm --filter web lint` | Roda ESLint (flat config) no web. | Antes de commit/PR que toca `apps/web`. |
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
  `routes → controllers → services → repositories → banco de dados`, com `utils/` como peças
  compartilhadas sem estado de negócio. **Não há injeção de dependência** via
  construtor/factories/interfaces: os módulos são importados diretamente. Documentado em
  [`apps/api/docs/arquitetura.md`](apps/api/docs/arquitetura.md).
- **`apps/web`**: Next.js App Router (`app/`), estilizado com Tailwind 4 e os tokens/componentes
  de `apps/web/DESIGN_SYSTEM/`.
- **`apps/worker`**: FastAPI stateless, sem banco. Pipeline ffmpeg → Demucs (`htdemucs`, voz) →
  torchcrepe (`tiny`, 10 ms) → `PitchTrack`. O áudio só existe no tmp da requisição. Só a API
  fala com ele. Contrato em `specs/sdd-001-worker-pitch/tasks.md` e em `apps/worker/README.md`.

| Camada | Onde vive | Responsabilidade |
|---|---|---|
| Routes | `apps/api/src/routes/` | Mapear método + URL para um controller. Nenhuma lógica. |
| Controllers | `apps/api/src/controllers/` | Fronteira HTTP: validar com Zod (`schema.parse`), chamar o service, devolver resposta. Único lugar que conhece `FastifyRequest`/`FastifyReply`. |
| Services | `apps/api/src/services/` | Regra de negócio. Não conhece HTTP nem SQL. Retorna DTOs simples (ex.: `PublicUser`). |
| Repositories | `apps/api/src/repositories/` | Acesso a dados via Prisma Client. Retorna models do Prisma. |
| Utils | `apps/api/src/utils/` | Prisma singleton, hash, bindex, schemas Zod (`validators.ts`), erros, error handler global. |
| Config | `apps/api/src/config/` | Variáveis de ambiente validadas com Zod (`env.ts`) e CORS (`cors.ts`). |
| App Router | `apps/web/app/` | Páginas e layouts do Next.js. |
| Design System | `apps/web/DESIGN_SYSTEM/` | Tokens (cores, tipografia, espaçamento) e componentes reutilizáveis da UI. |
| Worker | `apps/worker/app/` | `main.py` (rotas, erros, semáforo), `audio.py` (ffmpeg), `separation.py` (Demucs), `pitch.py` (crepe), `youtube.py` (yt-dlp). |

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
│   │   │   ├── controllers/     # auth.controller.ts, health.controller.ts
│   │   │   ├── services/        # auth.service.ts, health.service.ts
│   │   │   ├── repositories/    # user.repository.ts
│   │   │   ├── routes/          # auth.routes.ts, health.routes.ts
│   │   │   ├── utils/           # prisma.ts, hash.ts, bindex.ts, validators.ts, errors.ts, error-handler.ts
│   │   │   ├── generated/       # Prisma Client gerado (ignorado pelo Git)
│   │   │   ├── tests/           # auth/, config/, healthcheck/, helpers/, setup.ts, global-setup.ts
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
│       ├── app/                 # layout.tsx, page.tsx, globals.css
│       ├── lib/                 # env.public.ts (browser), env.server.ts (server-only)
│       ├── DESIGN_SYSTEM/       # cantor.ia Design System: readme.md, styles.css, tokens/, components/, DESIGN_SYSTEM.html
│       ├── public/
│       ├── AGENTS.md            # avisos sobre a versão do Next.js
│       └── Dockerfile
│   └── worker/                  # Python 3.12 + uv (fora do pnpm)
│       ├── app/                 # main, audio, separation, pitch, youtube, schemas, errors
│       ├── tests/               # pytest (conftest com sinais sintéticos e yt-dlp falso)
│       ├── scripts/plot_track.py
│       ├── pyproject.toml / uv.lock
│       └── Dockerfile
├── .env.example                 # catálogo versionado de todas as variáveis (sem segredos)
├── .env                         # valores locais, ignorado pelo Git (pnpm env:init)
├── scripts/
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
  Tailwind 4 + tokens do `DESIGN_SYSTEM/`. Leia `apps/web/AGENTS.md` antes de gerar código
  Next.js.

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
| `vitest` | ^4.1.10 | Testes da API | `apps/api/src/tests/`, `vitest.config.ts` |
| `next` | 16.2.10 | Framework do frontend | `apps/web/app/` |
| `react` / `react-dom` | 19.2.4 | UI do frontend | `apps/web/app/` |
| `tailwindcss` | ^4 | Estilos do frontend | `apps/web/app/globals.css`, `postcss.config.mjs` |
| `server-only` | ^0.0.1 | Impede importar código de servidor em Client Components | `apps/web/lib/env.server.ts` |
| `postgres` (Docker) | 15-alpine | Banco de dados (dev e test) | `docker-compose.dev.yml`, `docker-compose.test.yml` |
| `fastapi` / `uvicorn` | 0.141 / 0.54 | Servidor HTTP do worker | `apps/worker/app/main.py` |
| `demucs` | 4.1 | Isola a voz (modelo `htdemucs`) | `apps/worker/app/separation.py` |
| `torch` / `torchaudio` | 2.14 / 2.11 | Runtime dos modelos | `apps/worker/pyproject.toml` (só Mac ARM e Linux em `tool.uv.environments`) |
| `torchcrepe` | 0.0.24 | Pitch da voz (modelo `tiny`) | `apps/worker/app/pitch.py` |
| `yt-dlp` | 2026.8.19 | Baixa o áudio do YouTube (projeto pessoal, não comercial) | `apps/worker/app/youtube.py` |
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
| `NEXT_PUBLIC_API_URL` | web (browser, build-time) | sim | **nunca** | `lib/env.public.ts` |
| `API_INTERNAL_URL` | web (servidor) | não (padrão: `NEXT_PUBLIC_API_URL`) | não | `lib/env.server.ts` |

`NODE_ENV` não fica no `.env`: é definido por processo (API: `dev` por padrão, `test` pelo
`.env.test`, `prod` pelo compose; o Next define o dele).

---

## 12. Contexto do Projeto

- **Repositório**: cantor.ia — `github.com/matheusopessoa/cantor.ia`.
- **Gerenciador de pacotes**: pnpm 10.24.0, workspaces em `apps/*`.
- **Apps**: `api` (v1.0.0), `web` (v0.1.0), `worker` (v0.1.0) — ainda sem releases/tags publicadas.
- **Squad/owners/maintainers**: _(preencher — não há esse dado no repositório hoje)_.
- **Infra**: Docker Compose para dev (`docker-compose.dev.yml`), testes
  (`docker-compose.test.yml`) e produção (`docker-compose.prod.yml`); `nginx.conf` presente na
  raiz (ainda vazio).
