---
name: open-pull-request
description: Abre um Pull Request no GitHub (matheusopessoa/cantor.ia) via gh, com título em Conventional Commits e body padronizado. Carregar SOMENTE quando o usuário pedir explicitamente para abrir um PR.
disable-model-invocation: true
---

# Open Pull Request

## Persona

Você é um(a) assistente de automação de Git/PR.

> **Atenção:** só carregue esta skill quando explicitamente invocada pelo usuário
> (progressive disclosure). Nunca abra PR por iniciativa própria.

## Pré-condições

Verifique todas antes de agir; se alguma falhar, pare e explique o que falta:

- Repositório Git válido com remote configurado (`github.com/matheusopessoa/cantor.ia`):
  `git remote -v`.
- `gh` instalado e autenticado: `gh auth status`.
- Branch atual **não** é `main`: `git branch --show-current`.
- Branch atual publicada no remote: `git rev-parse --abbrev-ref --symbolic-full-name @{u}`.
  Se não estiver, pergunte antes de `git push -u origin <branch>`.
- Existem mudanças a submeter: `git log --oneline main..HEAD` não vazio.

## Fluxo

1. **Branch base**: `main`.
2. **Valide as mudanças**: `git status`, `git diff --stat main...HEAD`,
   `git log --oneline main..HEAD`. Avise se houver alterações não commitadas.
3. **PR existente**: `gh pr list --head <branch> --state open`. Se existir, informe o link e pare.
4. **Título** em Conventional Commits (`feat`, `fix`, `docs`, `style`, `refactor`, `test`,
   `chore`), inferido dos commits e da spec `specs/<feature-id>/tasks.md` quando houver.
5. **Body** com as seções:

   ```markdown
   ## What
   <o que muda e por quê; link para specs/<feature-id>/tasks.md>

   ## How
   <abordagem técnica, camadas tocadas>

   ## Testing
   <comandos rodados e resultados: pnpm --filter api test / pnpm --filter web lint>

   ## Impact
   <contratos públicos, schema Prisma/migrations, env vars, breaking changes>

   ## Checklist
   - [ ] Spec SDD revisada (`code-reviewer`: APROVADO)
   - [ ] Testes passando
   - [ ] Lint passando (web)
   - [ ] Docs atualizadas (`apps/api/docs/arquitetura.md` / design system / AGENTS.md)
   - [ ] CHANGELOG.md e bump de versão, se aplicável
   ```

6. **Crie o PR**: `gh pr create --base main --head <branch> --title "<título>" --body "<body>"`.
7. **Informe o link** do PR ao usuário.
