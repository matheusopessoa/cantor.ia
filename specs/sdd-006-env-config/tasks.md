# Task: Padronizar as variáveis de ambiente com um arquivo único na raiz

- **Slug:** env-config
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** sem bump (chore de infraestrutura; nenhum contrato público de API/UI muda)
- **App afetado:** ambos (+ compose e scripts na raiz)
- **Tipo de mudança:** chore
- **Impacto público (schema/API/UI contract):** none (muda só nomes/arquivos de configuração: remove `PROD_DB_USER`/`PROD_DB_PASS`)
- **Ordem:** implementar **antes** de sdd-001…004. Essas specs adicionam variáveis seguindo a
  convenção definida aqui.

## 1. Contexto e Motivação
- Hoje as variáveis estão espalhadas, sem convenção e com pontos de leitura soltos:
  - `apps/api/src/config/env.ts:6-9` carrega `apps/api/.env`, mas valida só `NODE_ENV`,
    `JWT_SIGN_SECRET` e `CORS_ALLOWED_ORIGINS`.
  - `DATABASE_URL` é lido direto em `apps/api/src/utils/prisma.ts:4` e `EMAIL_BINDEX_SECRET` em
    `apps/api/src/utils/bindex.ts:4`. Nenhum dos dois é validado quando a API sobe: a falta só
    aparece na primeira query ou no primeiro login.
  - `apps/api/prisma.config.ts:1` usa `import "dotenv/config"`, que depende do diretório atual.
  - `docker-compose.dev.yml:20` repassa o `DATABASE_URL` do host para o container. Dentro do
    container, `localhost` não é o Postgres.
  - `docker-compose.prod.yml:15` usa `PROD_DB_USER`/`PROD_DB_PASS` (ambiente e abreviação no
    nome) e um host que sobrou do boilerplate (`meu-rds-producao.aws.com`).
  - `env.ts:17` tem o padrão de placeholder `https://prod.domain` para `CORS_ALLOWED_ORIGINS`.
  - Não existe `.env.example` (o `.gitignore` já prevê a exceção `!.env.example`).
  - sdd-003 e sdd-004 adicionam `WORKER_URL`, `LRCLIB_BASE_URL` e `NEXT_PUBLIC_API_URL` sem
    uma convenção comum.
- Pedido do usuário (2026-09-25): "planeje o nome das variáveis de ambiente… pra ter um padrão
  e um arquivo para baixar elas e distribuir pra ficar modular, organizado e limpo".
  Interpretação: **um único arquivo onde se preenchem os valores** e **um jeito explícito de cada
  app receber só as variáveis dele**.
- Rastreabilidade: `AGENTS.md` §3 (variáveis de ambiente → atualizar §11 e o README do app),
  §5 (variáveis validadas com Zod em `config/env.ts`), §10 (não versionar segredos);
  `apps/api/docs/arquitetura.md` (`config/` é onde vive a configuração da API).

## 2. Escopo
- **Inclui**
  - Convenção de nomes (seção 4.1), registrada em `AGENTS.md` §11.
  - Catálogo `.env.example` na raiz (versionado, sem segredos), agrupado por serviço.
  - `.env` na raiz (ignorado pelo Git) como **única fonte local de valores**.
  - Script `pnpm env:init`: cria o `.env` a partir do exemplo e gera os segredos.
  - Um ponto único de leitura por app: API em `config/env.ts`, web em `lib/env.public.ts` e
    `lib/env.server.ts` (+ carga da raiz no `next.config.ts`), worker com a convenção
    documentada (sem variáveis no MVP).
  - Compose com `environment:` explícito por serviço, `${VAR:?mensagem}` nas obrigatórias e
    URLs entre containers definidas no próprio compose.
  - `ARG NEXT_PUBLIC_API_URL` no `apps/web/Dockerfile` (o Next embute `NEXT_PUBLIC_*` no
    build).
  - Remoção de `PROD_DB_USER` e `PROD_DB_PASS`.
  - Teste que impede o `.env.example` de ficar desatualizado em relação ao schema da API.
  - Ajuste das seções "Env" de sdd-003 e sdd-004 para apontar para este catálogo (feito junto
    com este plano).
- **Exclui**
  - Gerenciador de segredos (1Password CLI, Doppler, Infisical). O desenho aceita um depois
    sem mudar os apps: basta a ferramenta gerar o mesmo `.env` (ex.:
    `op inject -i .env.tpl -o .env`).
  - Script que gera um `.env` por app (ver decisão na seção 3).
  - Renomear o banco de teste `feedback_test` e o `name` do `package.json` da raiz (sobras do
    boilerplate): follow-up.
  - Trocar os valores de `NODE_ENV` da API (`dev|test|prod`) pelos valores padrão do Node
    (ver risco R2).
  - `nginx.conf`.

## 3. Impacto Arquitetural
- **Decisão: um arquivo, carregado por cada app e validado por cada app.**
  A alternativa era um script que lê o `.env` da raiz e gera `apps/api/.env`,
  `apps/web/.env.local` etc. Foi descartada porque deixa duas cópias de cada segredo em disco,
  as cópias ficam desatualizadas quando alguém esquece de rodar o script, e cria mais um passo
  no setup. Com a carga direta, o "quem recebe o quê" fica explícito em três lugares: no schema
  de cada app, na lista de chaves do web e nos blocos `environment:` do compose.
- Distribuição:
  ```
                     .env.example   (versionado: catálogo, sem segredos)
                           │  pnpm env:init  (copia + gera os *_SECRET)
                           ▼
                         .env        (raiz, ignorado pelo Git: única fonte local)
        ┌──────────────────┼───────────────────┬──────────────────────────────┐
        ▼                  ▼                   ▼                              ▼
   apps/api            apps/api            apps/web                     docker compose
   config/env.ts       prisma.config.ts    next.config.ts               (interpolação ${VAR})
   dotenv(raiz)        dotenv(raiz)        lê a raiz e copia só          ├─ db:     POSTGRES_*
   + Zod: seção API    só DATABASE_URL     WEB_ENV_KEYS                  ├─ api:    seção API
   único leitor de     (CLI do Prisma)     → lib/env.*.ts validam        │          + URLs internas
   process.env                                                           ├─ web:    seção Web
                                                                         │          (build arg + runtime)
                                                                         └─ worker: nenhuma no MVP
  ```
- **Host × container**: os valores do `.env` servem para rodar no host (`localhost`). No
  compose, as URLs entre containers são **sobrescritas no próprio compose** (`db`, `api`,
  `worker`). Assim o mesmo `.env` serve para os dois modos.
- **Testes**: `apps/api/.env.test` continua separado e versionado (`apps/api/vitest.config.ts:6-8`
  explica o motivo). `config/env.ts` **não** carrega o `.env` da raiz quando `NODE_ENV=test`,
  para que nenhum valor de dev entre na suíte.
- Arquivos:
  ```
  .env.example                              novo (versionado)
  scripts/env-init.mjs                      novo (Node puro, sem dependências)
  package.json (raiz)                       script "env:init"
  apps/api/src/config/env.ts                carrega a raiz; schema com todas as variáveis da API; exporta envSchema
  apps/api/src/utils/prisma.ts              usa env.DATABASE_URL
  apps/api/src/utils/bindex.ts              usa env.EMAIL_BINDEX_SECRET
  apps/api/prisma.config.ts                 carrega o .env da raiz por caminho explícito
  apps/api/.env.test                        segredos de teste com ≥ 32 caracteres
  apps/api/src/tests/config/env.spec.ts     novo
  apps/web/next.config.ts                   copia as chaves do web do .env da raiz
  apps/web/lib/env.public.ts                novo: variáveis que vão para o browser
  apps/web/lib/env.server.ts                novo: variáveis só do servidor ("server-only")
  apps/web/Dockerfile                       ARG/ENV NEXT_PUBLIC_API_URL no estágio builder
  docker-compose.dev.yml / docker-compose.prod.yml
  AGENTS.md §1, §4, §11 · README.md
  ```
- Sem DI: `env` continua sendo importado diretamente (`AGENTS.md` §2).

## 4. Contratos e Interfaces

### 4.1 Convenção de nomes
| # | Regra | Exemplo certo | Exemplo errado |
|---|---|---|---|
| 1 | `SCREAMING_SNAKE_CASE`, sem abreviações | `POSTGRES_PASSWORD` | `PROD_DB_PASS` |
| 2 | Formato `<RECURSO>_<ATRIBUTO>`: o prefixo diz **o que** a variável descreve, não quem a lê | `WORKER_URL` (endereço do worker, lido pela API) | `API_WORKER_ADDR` |
| 3 | O sufixo diz o tipo: `_URL` (URL absoluta com esquema e sem barra no final), `_SECRET` (segredo), plural para listas separadas por vírgula (`_ORIGINS`), `_MS` (duração), `_ENABLED` (`true`/`false`) | `LRCLIB_BASE_URL=https://lrclib.net` | `LRCLIB=lrclib.net/` |
| 4 | O ambiente **nunca** vai no nome: o mesmo nome em dev, test e prod, e só o valor muda | `DATABASE_URL` | `PROD_DATABASE_URL` |
| 5 | Nomes impostos por ferramentas são mantidos | `NODE_ENV`, `DATABASE_URL` (Prisma), `POSTGRES_*` (imagem oficial), `NEXT_PUBLIC_*` (Next) | — |
| 6 | `NEXT_PUBLIC_` só para o que pode ir ao browser. Segredo nunca | `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_JWT_SIGN_SECRET` |
| 7 | Só vai para env o que muda entre ambientes ou é segredo. Limites e regras de negócio são constantes no código | `WORKER_URL` | `YOUTUBE_MAX_DURATION_MS` (constante em sdd-001) |
| 8 | Variável nova do worker usa o prefixo `WORKER_` quando descreve o próprio worker | `WORKER_LOG_LEVEL` | `LOG_LEVEL` |

### 4.2 Catálogo
Valores de exemplo = dev rodando no host. "Compose" = valor que o container recebe.

| Variável | Serviço | Obrigatória | Exemplo (host) | Segredo | Compose | Origem |
|---|---|---|---|---|---|---|
| `POSTGRES_USER` | db | sim | `cantor` | não | igual | imagem `postgres` |
| `POSTGRES_PASSWORD` | db | sim | `cantor` | sim (fora do dev) | igual | imagem `postgres` |
| `POSTGRES_DB` | db | sim | `cantor_dev` | não | igual | imagem `postgres` |
| `DATABASE_URL` | api, CLI do Prisma | sim | `postgresql://cantor:cantor@localhost:5432/cantor_dev?schema=public` | sim | dev: montada no compose com o host `db`; prod: `${DATABASE_URL:?}` | `utils/prisma.ts`, `prisma.config.ts` |
| `JWT_SIGN_SECRET` | api | sim | gerado pelo `env:init` | sim | `${JWT_SIGN_SECRET:?}` | `app.ts` |
| `EMAIL_BINDEX_SECRET` | api | sim | gerado pelo `env:init` | sim | `${EMAIL_BINDEX_SECRET:?}` | `utils/bindex.ts` |
| `CORS_ALLOWED_ORIGINS` | api | só em prod | `http://localhost:3000` | não | prod: `${CORS_ALLOWED_ORIGINS:?}` | `config/cors.ts:17` (dev/test usam `origin: true`, `cors.ts:15-16`) |
| `WORKER_URL` | api | não (padrão) | `http://localhost:8000` | não | `http://worker:8000` | sdd-003 |
| `LRCLIB_BASE_URL` | api | não (padrão) | `https://lrclib.net` | não | igual | sdd-003 |
| `NEXT_PUBLIC_API_URL` | web (browser) | sim | `http://localhost:3333` | **nunca** | build arg; prod: URL pública da API | sdd-004 |
| `API_INTERNAL_URL` | web (servidor) | não (padrão = `NEXT_PUBLIC_API_URL`) | `http://localhost:3333` | não | `http://api:3333` | novo: Server Components de sdd-004 buscam dados no servidor, e dentro do container `localhost:3333` não é a API |

- **Ficam fora do `.env`**: `NODE_ENV` (definido por processo: a API usa `dev` por padrão, o
  compose define `dev`/`prod` e o `.env.test` define `test`; o Next define o dele). Um arquivo
  compartilhado não pode ter `NODE_ENV`, porque a API espera `dev|test|prod` e o Next espera
  `development|production`. `PORT` e `HOSTNAME` do web continuam no `apps/web/Dockerfile`.
- **Removidas**: `PROD_DB_USER`, `PROD_DB_PASS`.

### 4.3 Formato do `.env.example`
- Uma seção por serviço, na ordem db → api → web → worker, com cabeçalho indicando quem lê.
- Cada variável tem um comentário curto acima: para que serve, se é obrigatória e, se for
  segredo, como gerar.
- Segredos ficam **vazios** (`JWT_SIGN_SECRET=`): o `env:init` preenche.
- Notas obrigatórias no arquivo:
  - `DATABASE_URL` precisa bater com `POSTGRES_*` (o dotenv não faz interpolação).
  - Trocar `EMAIL_BINDEX_SECRET` invalida a busca de todos os e-mails já cadastrados.
  - `NEXT_PUBLIC_API_URL` é embutido no bundle no build: mudar o valor exige rebuild do web.
  - A seção do worker diz "nenhuma variável no MVP".

### 4.4 API — `config/env.ts`
```ts
export const envSchema: z.ZodType<...>;   // todas as variáveis da API
export const env: z.infer<typeof envSchema>;
export type Env = typeof env;
export type NodeEnv = Env["NODE_ENV"];
```
```
se process.env.NODE_ENV !== "test":
    dotenv.config({ path: <raiz do repo>/.env, quiet: true })   // não sobrescreve o que já veio do processo/compose
parsed = envSchema.safeParse(process.env)
falha → InvalidEnvironmentError (já existe em utils/errors.ts) com os nomes das variáveis, nunca os valores
```
- Campos do schema:
  - `NODE_ENV`: `z.enum(["dev","test","prod"]).default("dev")` (sem mudança).
  - `DATABASE_URL`: `z.url({ protocol: /^postgres(ql)?$/ })`.
  - `JWT_SIGN_SECRET`, `EMAIL_BINDEX_SECRET`: `z.string().min(32)`.
  - `CORS_ALLOWED_ORIGINS`: lista separada por vírgula → `z.array(z.url())`. Sem padrão
    (sai o `https://prod.domain`); obrigatória com ≥ 1 item quando `NODE_ENV=prod`
    (`superRefine`).
  - `WORKER_URL` e `LRCLIB_BASE_URL` entram no schema em **sdd-003** (quem os usa), já com os
    nomes deste catálogo.
- `utils/prisma.ts` e `utils/bindex.ts` passam a importar `env`. O `throw` manual de
  `bindex.ts:7` sai (a validação acontece no boot).
- `prisma.config.ts` carrega o `.env` da raiz por caminho explícito (relativo ao arquivo,
  não ao cwd), também sem sobrescrever o que já está no processo. O `global-setup.ts` da suíte
  continua passando o `DATABASE_URL` de teste pelo ambiente.

### 4.5 Web — carga e leitura
- `next.config.ts`:
  ```
  const WEB_ENV_KEYS = ["NEXT_PUBLIC_API_URL", "API_INTERNAL_URL"] as const;
  se existir <raiz>/.env:
      valores = util.parseEnv(conteúdo)                 // Node ≥ 20.12, sem dependência nova
      para cada chave em WEB_ENV_KEYS: se process.env[chave] === undefined → copia
  ```
  O processo do web nunca recebe `JWT_SIGN_SECRET`, `DATABASE_URL` etc., nem localmente.
- `lib/env.public.ts` (pode ser importado por Client Components):
  ```ts
  export const publicEnv: { apiUrl: string };
  // lê process.env.NEXT_PUBLIC_API_URL de forma LITERAL (sem desestruturar nem acesso dinâmico),
  // senão o Next não embute o valor. Valida com new URL(); inválido → erro no build/boot.
  ```
- `lib/env.server.ts`:
  ```ts
  import "server-only";
  export const serverEnv: { apiInternalUrl: string };  // API_INTERNAL_URL ?? NEXT_PUBLIC_API_URL
  ```
- Uso previsto (sdd-004): `lib/api.ts` usa `serverEnv.apiInternalUrl` quando roda no servidor
  e `publicEnv.apiUrl` no browser.
- **Antes de implementar**, conferir em `apps/web/node_modules/next/dist/docs/` como o
  Next 16 carrega env em monorepo e em que momento embute `NEXT_PUBLIC_*` (`apps/web/AGENTS.md`).
  Ver risco R1.

### 4.6 Script `pnpm env:init` (`scripts/env-init.mjs`)
```
.env já existe → sai com código 1: ".env já existe. Edite à mão ou compare com .env.example."
                 (nunca sobrescreve)
copia .env.example → .env
para cada linha "CHAVE=" vazia cuja CHAVE termina em _SECRET → crypto.randomBytes(32).toString("hex")
grava com permissão 0600
imprime os NOMES das chaves geradas (nunca os valores)
```

### 4.7 Compose
- **Sem `env_file:`**: ele empurraria o `.env` inteiro para todos os containers. Cada serviço
  lista o que recebe em `environment:`.
- `docker-compose.dev.yml`:
  ```yaml
  api:
    environment:
      NODE_ENV: dev
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public
      JWT_SIGN_SECRET: ${JWT_SIGN_SECRET:?rode pnpm env:init}
      EMAIL_BINDEX_SECRET: ${EMAIL_BINDEX_SECRET:?rode pnpm env:init}
      # WORKER_URL: http://worker:8000   ← entra com sdd-001/sdd-003
  web:
    build:
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:3333}
    environment:
      API_INTERNAL_URL: http://api:3333
  ```
- `docker-compose.prod.yml`: `DATABASE_URL`, os dois segredos e `CORS_ALLOWED_ORIGINS` com
  `${VAR:?}`; `NEXT_PUBLIC_API_URL` como build arg obrigatório; `API_INTERNAL_URL:
  http://api:3333`. Sai o host fixo `meu-rds-producao.aws.com`.
- `apps/web/Dockerfile`, estágio `builder`: `ARG NEXT_PUBLIC_API_URL` + `ENV
  NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL` antes do `pnpm build`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | `.env` por app (`env.ts:7`) e `.env` da raiz só para o compose | Um único `.env` na raiz por máquina (no host em dev, no servidor em prod). Exceção: `apps/api/.env.test`, versionado, só com valores de teste | Pedido do usuário |
| 2 | `PROD_DB_USER`/`PROD_DB_PASS` | Mesmo nome em todos os ambientes; o ambiente nunca vai no nome | Convenção 4.1 |
| 3 | O container da API recebe o que o compose repassa sem critério | Cada serviço recebe só o que é dele: `environment:` explícito, sem `env_file:`; o web copia só `WEB_ENV_KEYS` | Menor privilégio |
| 4 | `process.env` lido em `prisma.ts`, `bindex.ts` e `env.ts` | Um ponto de leitura por app. Exceções: arquivos de config de ferramenta (`prisma.config.ts`, `vitest.config.ts`, `next.config.ts`) e helpers de teste | `AGENTS.md` §5 |
| 5 | `DATABASE_URL`/`EMAIL_BINDEX_SECRET` sem validação no boot | Variável faltando ou inválida → o processo não sobe e a mensagem cita o nome, nunca o valor | `AGENTS.md` §5 |
| 6 | — | Segredos com ≥ 32 caracteres, gerados pelo `env:init`, nunca logados | Segurança |
| 7 | — | URLs entre containers ficam no compose, não no `.env` | Seção 3 |
| 8 | — | Variável nova = schema do app + `.env.example` + compose (se o serviço roda em container) + `AGENTS.md` §11, no mesmo commit | Evita catálogo desatualizado |

## 6. Critérios de Aceitação
- **Ponto único**: `grep -rn "process.env" apps/api/src` só encontra `config/env.ts` e
  `tests/` (global-setup e helpers).
- **Falha clara**: sem `JWT_SIGN_SECRET`, a API não sobe e o erro cita a variável. Nenhum valor
  de variável aparece no log.
- **Isolamento dos testes**: `pnpm --filter api test` passa igual com e sem `.env` na raiz.
- **Setup**: num clone limpo, `pnpm env:init` cria o `.env` com segredos de 64 caracteres hex e
  permissão `0600`. Rodar de novo não altera o arquivo.
- **Compose dev**: `pnpm env:init && docker compose -f docker-compose.yml -f
  docker-compose.dev.yml up` sobe db + api, com a API conectando no host `db`.
- **Compose sem `.env`**: `docker compose … config` falha citando `JWT_SIGN_SECRET` e
  "rode pnpm env:init".
- **Menor privilégio**: no `docker compose … config`, o serviço `web` não tem `DATABASE_URL`
  nem `*_SECRET`, e o `api` não tem `NEXT_PUBLIC_*`.
- **Web**: o build com `NEXT_PUBLIC_API_URL` embute o valor. `grep -r "_SECRET" .next/static`
  não encontra nada.
- **Catálogo em dia**: toda chave do `envSchema` da API existe no `.env.example` (teste
  automatizado).
- **Git**: `.env` nunca aparece no `git status` (coberto pelo `.gitignore`; conferir).

## 7. Plano de Testes
- **Vitest** (`apps/api/src/tests/config/env.spec.ts`), usando `envSchema.safeParse` com
  objetos (sem mexer em `process.env`):
  - toda chave de `envSchema` existe no `.env.example` da raiz (lido com `dotenv.parse`);
  - segredo com menos de 32 caracteres → erro;
  - `NODE_ENV=prod` sem `CORS_ALLOWED_ORIGINS` → erro; `dev` sem ela → ok;
  - `DATABASE_URL` com `http://` → erro.
- `apps/api/.env.test`: `JWT_SIGN_SECRET` e `EMAIL_BINDEX_SECRET` passam a ter ≥ 32
  caracteres (continuam sendo valores de teste). A suíte existente continua verde.
- **Manual/Smoke** (registrar no PR): os critérios de compose, `env:init` e web da seção 6.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. No Next 16, copiar para `process.env` dentro do `next.config.ts` pode não valer para o `NEXT_PUBLIC_*` embutido | média | médio | Conferir na doc local antes de codar. Plano B: `loadEnvConfig(<raiz>)` do `@next/env`, que carrega o `.env` inteiro no processo do web **só em dev local**. Nos containers o compose continua passando só as chaves do web |
| R2. A API usa `NODE_ENV=dev\|prod`, fora do padrão do Node (`development\|production`), e alguma lib pode checar `=== "production"` | baixa | baixo | `NODE_ENV` fora do `.env` (seção 4.2). Follow-up: trocar para os valores padrão ou criar `APP_ENV` |
| R3. Alguém com `apps/api/.env` local perde as variáveis | baixa | baixo | Hoje só existe `apps/api/.env.test` (conferido). README e `env:init` explicam o caminho novo |
| R4. Variável nova adicionada ao código, mas não ao `.env` de quem já tem o projeto | média | baixo | Validação no boot cita o nome. A diferença no `.env.example` aparece no PR |
| R5. `DATABASE_URL` e `POSTGRES_*` repetem a mesma informação no `.env` | alta | baixo | Comentário no exemplo. No compose, a URL é montada a partir de `POSTGRES_*` |
| R6. Trocar `EMAIL_BINDEX_SECRET` invalida a busca de e-mails já cadastrados | baixa | alto | Comentário no `.env.example`. O `env:init` nunca sobrescreve um `.env` existente |

Sem dependências novas (`dotenv` já está na API; o web usa `node:util` e `node:fs`;
`server-only` já vem com o Next — confirmar na implementação).

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._ "Baixar e distribuir" foi interpretado como "centralizar num arquivo e repassar a
cada app". Se a ideia for puxar os valores de um gerenciador de segredos, isso entra como
follow-up sem mudar os apps (seção 2, "Exclui").

## 10. Checklist de Conformidade
- [x] Decisões citam `AGENTS.md`, `apps/api/docs/arquitetura.md` ou o código (`caminho:linha`).
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Sem mudança em schema Prisma nem em contrato público de API/UI.
- [x] Perguntas em aberto foram exauridas.
- [x] Na implementação: `AGENTS.md` §1 (`pnpm env:init`), §4 (`.env.example`, `scripts/`) e §11
      (convenção 4.1 + catálogo 4.2, sem `PROD_DB_*`); `README.md` com o passo de setup.
- **Depois deste plano:** sdd-001…004 adicionam variáveis seguindo a regra 8 da seção 5.
