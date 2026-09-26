# cantor.ia

Monorepo pnpm com:

- [`apps/api`](apps/api) — API em Fastify + Prisma (Postgres), validação com Zod, testes com Vitest.
- [`apps/web`](apps/web) — frontend em Next.js 16 (App Router) + React 19 + Tailwind CSS 4.

## Começando

```bash
pnpm install
pnpm env:init                                    # cria o .env da raiz e gera os segredos
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres de dev (porta 5432)
pnpm --filter api dev                            # API em http://localhost:3333
pnpm --filter web dev                            # Web em http://localhost:3000
```

Todas as variáveis de ambiente ficam num único `.env` na raiz. O catálogo, com o que cada uma
faz, é o [`.env.example`](.env.example); a convenção de nomes está em
[`AGENTS.md` §11](AGENTS.md#11-dependências-externas).

Testes e lint:

```bash
pnpm --filter api test   # sobe um Postgres isolado na porta 5433 e roda o Vitest
pnpm --filter web lint
```

A lista completa de comandos está em [`AGENTS.md`](AGENTS.md#1-comandos-do-projeto).

---

## Documentação e Spec-Driven Development (SDD)

### Documentação técnica

| Documento | Consulte quando... |
|---|---|
| [`apps/api/docs/arquitetura.md`](apps/api/docs/arquitetura.md) | precisar entender as camadas da API, o fluxo de requisição ou como adicionar um recurso novo. |
| [`apps/web/DESIGN_SYSTEM/readme.md`](apps/web/DESIGN_SYSTEM/readme.md) | for tocar em tokens, componentes ou padrões visuais do frontend. |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | for gerar código Next.js — contém avisos sobre a versão do Next.js usada no projeto. |

A fonte de verdade é o **código-fonte**. Este `README.md` é apenas um resumo. Documentos de regras
de negócio, modelos de domínio e integrações externas ainda não existem neste repositório — crie-os
em `apps/api/docs/` conforme forem necessários, seguindo o mesmo padrão de `arquitetura.md`.

### Como trabalhar com SDD

Este projeto adota **Spec-Driven Development (SDD)**: antes de implementar uma tarefa não trivial,
escreve-se um **plano técnico** que rastreia decisões até `apps/api/docs/arquitetura.md` (ou ao
design system, para UI).

**Fluxo recomendado:**

1. **Escreva a tarefa** em `specs/tasks.txt` (texto livre — o que precisa ser feito e por quê).
2. **Gere o plano técnico** invocando a skill [`code-planner`](.agents/skills/code-planner/SKILL.md).
   - A skill lê `specs/tasks.txt` + `AGENTS.md` + docs relevantes.
   - Produz `specs/<feature-id>/tasks.md` seguindo o template SDD.
   - Se houver ambiguidade, o plano sai com `status: blocked` e uma seção **Perguntas em Aberto** — resolva-as antes de implementar.
3. **Revise o plano** com um maintainer.
4. **Implemente** invocando a skill [`code-implementer`](.agents/skills/code-implementer/SKILL.md), seguindo as etapas do `tasks.md`.
5. **Revise** invocando a skill [`code-reviewer`](.agents/skills/code-reviewer/SKILL.md) antes de commit/PR.
6. **(Opcional) Abra o PR** invocando a skill [`open-pull-request`](.agents/skills/open-pull-request/SKILL.md), somente quando solicitado.
7. **Atualize `CHANGELOG.md`** e faça bump de versão em `apps/api/package.json`/`apps/web/package.json` se aplicável.

**Convenções do SDD neste repositório:**

- `specs/` é **versionada** e centraliza os artefatos SDD:
  - `specs/tasks.txt` — descrição da tarefa atual.
  - `specs/<feature-id>/tasks.md` — plano técnico gerado por `code-planner` (`<feature-id>` = `sdd-<NNN>-<slug>`).
- Nenhuma decisão de design entra no plano sem citação a `apps/api/docs/arquitetura.md` ou ao design system.
- Mudanças em models do `prisma/schema.prisma` ou em contratos públicos são **breaking changes** — devem estar explicitamente marcadas no plano e no `CHANGELOG.md`.

**Guia para agentes de IA:** [`AGENTS.md`](AGENTS.md).
