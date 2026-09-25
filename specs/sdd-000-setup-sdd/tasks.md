# Task: Criar a estrutura de SDD e governança de agentes

- **Slug:** setup-sdd
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** n/a (apenas documentação — sem bump em `apps/api` ou `apps/web`)
- **App afetado:** ambos (somente documentação na raiz)
- **Tipo de mudança:** chore
- **Impacto público (schema/API/UI contract):** none

## 1. Contexto e Motivação
- O repositório não tinha governança para agentes de IA nem fluxo de planejamento: tarefas não
  triviais iam direto para o código, sem rastreabilidade.
- Pedido original: prompt "Estrutura de SDD para o repositório cantor.ia", inspirado no projeto
  `itau-vn5-dep-ios-access-area` e adaptado à stack do monorepo.
- Rastreabilidade:
  - Camadas da API descritas em `apps/api/docs/arquitetura.md` (routes → controllers → services →
    repositories, sem DI) viram regra em `AGENTS.md` §2 e na skill `api-architecture`.
  - Princípios do design system (`apps/web/DESIGN_SYSTEM/_ds/atrito-design-system-*/readme.md`)
    e o aviso de `apps/web/AGENTS.md` viram regra na skill `web-architecture`.

## 2. Escopo
- **Inclui**
  - `AGENTS.md` (raiz) com comandos, arquitetura, convenções, fluxo SDD, proibições e dependências.
  - `README.md` (raiz) com a seção "Documentação e Spec-Driven Development (SDD)".
  - Skills em `.agents/skills/`: `code-planner`, `code-implementer`, `code-reviewer`,
    `api-architecture`, `web-architecture`, `open-pull-request`.
  - `specs/tasks.txt` (próxima tarefa: refresh token) e este plano.
- **Exclui**
  - Qualquer código de produção em `apps/api` ou `apps/web`.
  - `CHANGELOG.md` (será criado na primeira mudança de contrato público, conforme `AGENTS.md` §6).
  - Configuração de lint para a API.
  - Preenchimento de owners/maintainers (dado inexistente no repositório).

## 3. Impacto Arquitetural
- Nenhuma camada de código é alterada. Somente arquivos Markdown/texto na raiz.
- Novos arquivos:
  ```
  AGENTS.md
  README.md
  .agents/skills/{code-planner,code-implementer,code-reviewer,api-architecture,web-architecture,open-pull-request}/SKILL.md
  specs/tasks.txt
  specs/sdd-000-setup-sdd/tasks.md
  ```
- Fluxo de trabalho resultante:
  ```
  specs/tasks.txt ──► code-planner ──► specs/<id>/tasks.md ──► code-implementer
                                             │ (blocked?)            │
                                             ▼                       ▼
                                      Perguntas em Aberto      code-reviewer ──► open-pull-request
                                                                (APROVADO?)        (sob demanda)
  ```
- Ausência de DI preservada e documentada (`AGENTS.md` §2, §5).

## 4. Contratos e Interfaces
- Nenhum model Prisma, schema Zod, rota ou tipo exportado é alterado.
- Contrato de processo introduzido: template de 10 seções de `specs/<feature-id>/tasks.md`
  (definido em `.agents/skills/code-planner/SKILL.md`) e convenção `sdd-<NNN>-<slug>`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | Sem processo definido para tarefas não triviais | Planejamento obrigatório via `code-planner` antes da implementação | Pedido do usuário |
| 2 | Camadas documentadas apenas em `apps/api/docs/arquitetura.md` | Camadas viram critério bloqueante no `code-reviewer` | `apps/api/docs/arquitetura.md` |
| 3 | Mudanças de schema sem regra explícita | Exigem migration, changelog e bump de versão | `AGENTS.md` §6 |

## 6. Critérios de Aceitação
- Todos os arquivos listados na seção 2 existem e referenciam caminhos reais do repositório
  (validado contra `apps/api/src/`, `apps/web/app/` e `apps/web/DESIGN_SYSTEM/`).
- `specs/` não aparece em nenhum `.gitignore` (`.gitignore` da raiz, `apps/api/.gitignore` e
  `apps/web/.gitignore` não o incluem).
- Nenhum segredo é citado por valor — apenas nomes de variáveis.
- Performance/segurança/compatibilidade: não aplicável (sem código executável).

## 7. Plano de Testes
- **Unit tests (Vitest):** não aplicável — nenhum arquivo em `apps/api/src/` foi tocado.
- **Lint:** não aplicável — nenhum arquivo em `apps/web/` foi tocado.
- **Manual:** conferir que os links relativos em `README.md`, `AGENTS.md` e nas skills abrem os
  arquivos corretos; `grep -rn specs apps/*/.gitignore` sem resultados.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Documentação divergir do código com o tempo | média | Agentes seguindo regras obsoletas | Princípio "código prevalece" + tabela de atualização em `AGENTS.md` §3 |
| Caminho do design system com hash (`atrito-design-system-04edc5c1-...`) mudar em reexportação | média | Links quebrados | Skills usam também o glob `_ds/*/readme.md`; atualizar `AGENTS.md` §3 e `README.md` |
| Artefatos de build/SO (`dist/`, `.DS_Store`) versionados por engano | baixa | Build ou lixo commitado | `.gitignore` completo na raiz (inclui `dist/`, `.DS_Store`, `.env*` com exceção de `apps/api/.env.test`) |

## 9. Perguntas em Aberto (bloqueantes)

_Nenhuma._ (Owners/maintainers ficam como pendência não bloqueante em `AGENTS.md` §12.)

## 10. Checklist de Conformidade
- [x] Todas as decisões citam `apps/api/docs/arquitetura.md` ou o design system.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Se há mudança em símbolo público/schema Prisma, seção 4 reflete `breaking` quando aplicável e há migration planejada. (n/a)
- [x] Perguntas em aberto foram exauridas.
