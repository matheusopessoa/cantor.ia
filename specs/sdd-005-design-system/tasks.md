# Task: Refatorar o design system para o cantor.ia Design System

- **Slug:** design-system
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready (implementado em 2026-09-25; plano registrado junto com a entrega)
- **Versão-alvo:** n/a (o DS não tem versão própria; `apps/web` sobe para 0.2.0 na sdd-004)
- **App afetado:** web (somente `apps/web/DESIGN_SYSTEM/` + documentação)
- **Tipo de mudança:** refactor
- **Impacto público (schema/API/UI contract):** breaking (contrato de UI: tokens e caminho do DS mudaram por completo)

## 1. Contexto e Motivação
- O DS anterior, "Atrito", foi criado para um app de detox digital: monocromático,
  anti-gamificação, movimento lento, copy contida. Isso é o oposto de um karaokê com nota e
  ranking (risco R5 da sdd-004).
- O usuário pediu para refazer todo o DS com visual inspirado em **anos 80, fliperama e Guitar
  Hero**, antes de implementar as telas (sdd-004). Pedido original em 2026-09-25, usando a skill
  `ui-ux-pro-max`.
- Decisões do usuário no mesmo dia:
  - a inspiração guia só o visual e o tom e **nunca aparece escrita** em texto da interface;
  - o nome do sistema é **cantor.ia Design System**, sem codinome.
- Rastreabilidade:
  - `AGENTS.md` §3: mudança em tokens/componentes exige atualizar o readme do DS.
  - `AGENTS.md` §5 (Web): estilos via Tailwind 4 + tokens do `DESIGN_SYSTEM/`.
  - Telas e estados a cobrir: `specs/sdd-004-web-karaoke/tasks.md` §2 e §3, incluindo o fluxo do
    YouTube de `specs/sdd-003-api-songs/tasks.md`.

## 2. Escopo
- **Inclui**
  - Remoção do DS Atrito: `_ds/atrito-design-system-*/` (tokens, bundle JS, manifesto, regras de
    lint da ferramenta que o gerou), `support.js`, `image-slot.js`, `.thumbnail` e a vitrine antiga.
  - Estrutura nova e plana em `apps/web/DESIGN_SYSTEM/`: `styles.css`, `tailwind-theme.css`,
    `tokens/`, `components/`, `assets/mark.svg`, `readme.md`, `DESIGN_SYSTEM.html`.
  - Tokens: cores (dark-only), tipografia, espaçamento, efeitos (brilho neon, CRT), movimento.
  - Componentes CSS com prefixo `ct-` para todas as telas do MVP, incluindo o fluxo do YouTube.
  - Ponte Tailwind 4 (`@theme inline`) para usar os tokens como utilitários.
  - Vitrine com todos os tokens e componentes, validada no navegador (desktop e 375px).
  - Readme com princípios, mapeamentos de jogo, tabela "Telas → componentes", tabela "Erros da
    referência → mensagem", voz e texto, checklist de entrega.
  - Atualização das referências ao caminho antigo: `AGENTS.md`, `README.md`, skills
    `code-planner` e `web-architecture`, sdd-004.
- **Exclui**
  - Integração no `apps/web` (`globals.css`, `layout.tsx`, remoção do Geist via `next/font`):
    fica na sdd-004.
  - Componentes React: o DS entrega CSS. Os componentes React nascem na sdd-004 aplicando as
    classes `ct-*`.
  - Tema claro.
  - Fontes self-hosted (Google Fonts via `@import` no MVP).

## 3. Impacto Arquitetural
- Camada afetada: só o DS (`apps/web/DESIGN_SYSTEM/`). Nenhum código de `apps/web/app/` muda aqui.
- Estrutura:
  ```
  apps/web/DESIGN_SYSTEM/
  ├── styles.css            # entrada única: só @import (tokens → componentes)
  ├── tailwind-theme.css    # @theme inline → bg-surface, text-neon-pink, font-hud, shadow-glow-cyan…
  ├── tokens/  fonts · colors · typography · spacing · effects · motion · base
  ├── components/  button · form · surface · game · brand
  ├── assets/mark.svg
  ├── readme.md             # fonte de verdade das regras visuais
  └── DESIGN_SYSTEM.html    # vitrine (servir a pasta por HTTP; @import não funciona em file://)
  ```
- Consumo previsto (sdd-004):
  ```
  app/globals.css
    @import "tailwindcss"
    @import "../DESIGN_SYSTEM/styles.css"          ← tokens + classes ct-*
    @import "../DESIGN_SYSTEM/tailwind-theme.css"  ← utilitários mapeados para os tokens
          │
          ▼
  components/*.tsx  → className="ct-btn ct-btn--primary"  (+ utilitários de layout)
  ```
- Os nomes do `tailwind-theme.css` são diferentes dos tokens do DS (`--font-hud`, não
  `--font-arcade`) para não criar referência circular dentro do `@theme inline`.

## 4. Contratos e Interfaces
Contrato de UI (**BREAKING** em relação ao Atrito: nenhum token antigo sobrevive). O único
consumidor é o `apps/web`, que ainda não importava o DS, então não há código a migrar.

- **Tokens principais**
  | Grupo | Tokens |
  |---|---|
  | Superfícies | `--bg-page` `--bg-sunken` `--bg-surface` `--bg-raised` `--bg-scrim` |
  | Texto | `--text-primary` `--text-secondary` `--text-tertiary` `--text-disabled` `--text-on-neon` |
  | Neons | `--neon-pink` `--neon-cyan` `--neon-yellow` `--neon-purple` `--neon-orange` |
  | Trastes | `--fret-green` `--fret-red` `--fret-yellow` `--fret-blue` `--fret-orange` |
  | Jogo | `--pitch-reference` `--pitch-voice` `--hit-perfect/good/miss` `--grade-s…d` `--rank-1…3` `--lyric-sung/unsung` |
  | Fontes | `--font-display` (Bungee) `--font-arcade` (Silkscreen) `--font-score` (Press Start 2P) `--font-body` (Rubik) |
  | Efeitos | `--glow-*` `--text-glow-*` `--shadow-press` `--scanlines` `--vignette` |
  | Movimento | `--dur-instant…count` `--ease-out` `--ease-in` `--ease-inout` `--ease-snap` + keyframes `ct-*` |
- **Componentes (classes)**
  | Arquivo | Classes |
  |---|---|
  | `button.css` | `.ct-btn` (`--primary` `--secondary` `--ghost` `--danger` `--sm` `--lg` `--start` `--block`), `.ct-icon-btn` |
  | `form.css` | `.ct-field`, `.ct-input`, `.ct-input-group`, `.ct-search`, `.ct-name-entry`, `.ct-range`, `.ct-dropzone`, `.ct-tabs`/`.ct-tab` |
  | `surface.css` | `.ct-panel`, `.ct-stage`, `.ct-song-row`, `.ct-badge`, `.ct-alert`, `.ct-tv`, `.ct-loading` |
  | `game.css` | `.ct-lyrics`/`.ct-lyric`, `.ct-highway`, `.ct-gem`, `.ct-hit`, `.ct-hud`, `.ct-progress`, `.ct-countdown`, `.ct-score`, `.ct-grade`, `.ct-meter`, `.ct-ranking` |
  | `brand.css` | `.ct-wordmark`, `.ct-marquee`, `.ct-horizon` |
- **Convenções de API das classes**: estados por `is-*` (`is-current`, `is-you`, `is-dragover`)
  ou atributos ARIA (`aria-selected`, `aria-invalid`, `disabled`). Valores contínuos por custom
  property setada via JS (`--progress` na letra, `--value` em barras e medidores).
- **Códigos de erro exibidos**: a tabela "Erros da referência → mensagem" do readme é o
  contrato de texto para os `ReferenceErrorCode` da sdd-003 e o `INVALID_YOUTUBE_URL`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | DS Atrito: preto e branco, sem gamificação, movimento lento | Dark-only com neons, brilho como hierarquia, recompensa com overshoot | Pedido do usuário (2026-09-25) |
| 2 | — | A inspiração (anos 80, fliperama, Guitar Hero) guia só visual e tom; nenhum texto da interface cita essas referências | Decisão do usuário (2026-09-25) |
| 3 | — | O sistema se chama **cantor.ia Design System**, sem codinome | Decisão do usuário (2026-09-25) |
| 4 | — | Press Start 2P só recebe números e palavras fixas em inglês: não tem maiúsculas acentuadas (Õ, Í, Ê) | Encontrado na validação visual ("BOTõES") |
| 5 | — | Cada cor de jogo tem um significado fixo (referência ciano, voz rosa, PERFECT/GOOD/MISS verde/amarelo/vermelho, conceitos S–D) e nunca é o único sinal da informação | Acessibilidade + consistência entre telas |
| 6 | — | Um único `ct-btn--primary` por tela | Hierarquia de ação |
| 7 | — | A espera do processamento mostra tempo decorrido, nunca porcentagem inventada | A API não informa progresso real (sdd-003) |
| 8 | — | Erro nunca aparece como código ou texto técnico; a tela usa a tabela de mensagens do readme | Voz e texto do DS |

## 6. Critérios de Aceitação
- **Contraste** (calculado, fundo `#0b0620`): texto 18:1, secundário 10.6:1, terciário 6.5:1,
  todos os neons ≥ 5.7:1, texto escuro sobre qualquer neon ≥ 5.7:1. Só `--text-disabled`
  (2.8:1) fica abaixo de 4.5:1, de propósito.
- **Acessibilidade**: foco visível (anel ciano) em todo interativo; alvos ≥ 48px;
  `prefers-reduced-motion` desliga piscar, grade, pulso e contagem; informação nunca só por cor.
- **Responsivo**: vitrine sem rolagem horizontal em 375px; `.ct-input-group` empilha abaixo de
  520px.
- **Letra de karaokê**: o preenchimento atravessa quebras de linha em sequência
  (`box-decoration-break: slice`), validado na vitrine.
- **Acentuação**: todo texto em pt-BR renderiza com os acentos certos (Bungee, Silkscreen e
  Rubik cobrem latin-ext).
- **Sem literais de cor**: componentes usam só tokens. Exceções aceitas: `#000` em máscaras
  CSS (só o canal alfa importa) e alguns `rgba` de translucidez (fundo do HUD, brilho interno
  do palco, faixas do highway). O SVG da marca tem as cores embutidas.
- **Performance**: CSS puro, sem JS no DS; fontes com `display=swap`; efeitos pesados
  (scanlines, horizonte animado) restritos ao palco e ao hero.
- **Sem referência ao Atrito** em código, no DS, em `AGENTS.md`, `README.md` e nas skills (só
  o histórico das specs cita o nome).

## 7. Plano de Testes
- **Validação visual (feita em 2026-09-25, no navegador embutido)**: vitrine em desktop e em
  375px. Seções: princípios, cores, tipografia, botões, formulários, superfícies, preparar
  música (YouTube), karaokê, resultado, voz.
- **Bugs encontrados e corrigidos na validação**:
  1. Press Start 2P sem maiúsculas acentuadas → Silkscreen para texto, Press Start só para números.
  2. Preenchimento da letra pintava as duas linhas ao mesmo tempo → gradiente com `slice`.
  3. Nota final estourava o painel → token `--fs-score` e `white-space: nowrap`.
  4. Lâmpadas do letreiro fora do lugar → ordem das camadas no keyframe `ct-chase`.
  5. Subtítulo do hero sem contraste sobre o sol → fundo `--bg-scrim`.
- **Contraste**: script Python de razão WCAG para cada par texto/fundo e neon/fundo.
- **Na sdd-004**: `pnpm --filter web lint` e `build` depois de integrar o DS; smoke das telas
  seguindo a tabela "Telas → componentes".
- Não há testes automatizados de CSS no repositório. Regressão visual automatizada fica como
  follow-up.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Google Fonts indisponível ou bloqueado | baixa | médio | Fallbacks de sistema em cada `--font-*`. Self-host como follow-up |
| Efeitos neon (sombras múltiplas, scanlines) pesando em máquinas fracas | média | médio | Efeitos pesados só no palco e no hero; canvas do highway é da sdd-004 e deve medir 60 fps |
| Brilho e piscar incomodando (fotossensibilidade) | baixa | alto | No máximo 3 piscadas em qualquer segundo (WCAG 2.3.1), em áreas pequenas; tudo desliga em `prefers-reduced-motion` |
| Miniaturas de `i.ytimg.com` fora do ar ou vídeo removido | baixa | baixo | Capa cai para a inicial sobre `--grad-sunset`; TV mostra o fundo escuro |
| DS e telas divergirem com o tempo | média | médio | Regra da sdd-004: componente novo entra primeiro no DS (readme + vitrine) |

Dependências externas: Google Fonts (Bungee, Silkscreen, Press Start 2P, Rubik). Nenhuma
dependência npm.

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._

## 10. Checklist de Conformidade
- [x] Decisões citam `AGENTS.md`, as specs 003/004 ou decisão do usuário.
- [x] Nenhum código de aplicação foi escrito (o DS é CSS/documentação; telas ficam na sdd-004).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Mudança de contrato de UI marcada como **breaking**, sem consumidores a migrar.
- [x] Readme do DS atualizado (`AGENTS.md` §3).
- [x] Perguntas em aberto foram exauridas.
- **Relação com outras specs:** pré-requisito visual da sdd-004; contrato de mensagens de erro
  alinhado com a sdd-003.
