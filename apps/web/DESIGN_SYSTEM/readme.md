# cantor.ia Design System

> **cantor.ia** é um karaokê web que dá nota de 0 a 10 para a sua cantoria (afinação +
> entrada no tempo) e grava seu nome num ranking de fliperama. O visual mistura **anos 80
> synthwave**, **gabinete de fliperama** e **Guitar Hero**: noite índigo, neon, sol listrado,
> grade no horizonte e trastes coloridos.

Vitrine ao vivo: abra [`DESIGN_SYSTEM.html`](DESIGN_SYSTEM.html) servindo esta pasta
(`python3 -m http.server` dentro de `apps/web/DESIGN_SYSTEM/`). Os `@import` não funcionam
via `file://`.

---

## Estrutura

```
DESIGN_SYSTEM/
├── styles.css            # ponto de entrada único (só @import)
├── tailwind-theme.css    # ponte Tailwind 4: @theme inline → utilitários (bg-surface, text-neon-pink…)
├── tokens/
│   ├── fonts.css         # Google Fonts: Bungee, Silkscreen, Press Start 2P, Rubik
│   ├── colors.css        # noite, lilás, neons, trastes, semânticos, jogo, gradientes
│   ├── typography.css    # famílias, pesos, escala, letra da música
│   ├── spacing.css       # espaço, raios, bordas, layout, z-index
│   ├── effects.css       # brilhos neon, sombra de botão físico, scanlines, vinheta
│   ├── motion.css        # durações, easings, @keyframes ct-*
│   └── base.css          # reset, foco, utilitários (.ct-label, .ct-numeric, .ct-crt…)
├── components/
│   ├── button.css        # .ct-btn (+ --primary/--secondary/--ghost/--danger/--start), .ct-icon-btn
│   ├── form.css          # .ct-field, .ct-input, .ct-input-group, .ct-search, .ct-name-entry,
│   │                     # .ct-range, .ct-dropzone, .ct-tabs/.ct-tab
│   ├── surface.css       # .ct-panel, .ct-stage, .ct-song-row, .ct-badge, .ct-alert,
│   │                     # .ct-tv (miniatura do YouTube), .ct-loading (espera longa)
│   ├── game.css          # .ct-lyric, .ct-highway, .ct-gem, .ct-hit, .ct-hud, .ct-progress,
│   │                     # .ct-countdown, .ct-score, .ct-grade, .ct-meter, .ct-ranking
│   └── brand.css         # .ct-wordmark, .ct-marquee, .ct-horizon
├── assets/mark.svg       # ícone: microfone com cabeça de sol synthwave
└── DESIGN_SYSTEM.html    # vitrine de todos os tokens e componentes
```

## Como usar no Next.js (`apps/web`)

```css
/* app/globals.css */
@import "tailwindcss";
@import "../DESIGN_SYSTEM/styles.css";
@import "../DESIGN_SYSTEM/tailwind-theme.css";
```

- Componentes React em `apps/web/components/` aplicam as classes `ct-*`. Layout fino fica com
  utilitários Tailwind mapeados para os tokens (`bg-surface`, `text-fg-2`, `font-hud`,
  `shadow-glow-cyan`, `rounded-btn`).
- **Nunca use hex, px de cor ou fonte crus em componentes.** Tudo vem de `var(--token)` ou de
  utilitário do tema.
- Todas as classes do DS têm o prefixo `ct-` para não colidir com o Tailwind.
- Estados por classe `is-*` (`is-current`, `is-you`, `is-dragover`). Valores contínuos por
  custom property (`--progress`, `--value`) setados via JS.
- O `next/font` do layout atual (Geist) deve ser removido: as fontes vêm de `tokens/fonts.css`.

---

## Princípios

1. **O palco acende quando você canta.** Não existe sombra de elevação: o que importa
   *brilha*. Em repouso, sem brilho. Interativo, brilho suave. Ação principal, foco e
   recompensa, brilho forte.
2. **Letra sempre legível.** Nenhum efeito compete com a letra da música: Rubik 800/900,
   contorno escuro e preenchimento ciano de karaokê. Ela precisa ser lida a 1 m da tela
   enquanto a pessoa canta.
3. **Recompensa com punch, o resto rápido.** Nota, conceito e recorde entram com overshoot
   (`--ease-snap`). Hover e press ficam em ≤ 150ms, entradas em ≤ 240ms. Nada é lento sem motivo.
4. **Um rosa por tela.** `--action-primary` (rosa preenchido) marca a única ação principal
   (START, Cantar, Enviar). Ciano em contorno é ação de apoio.
5. **Movimento reduzido é respeitado.** Com `prefers-reduced-motion`, nada pisca, a grade para,
   o pulso some e a contagem da nota aparece direto no valor final.

---

## Cores

Dark-only (`color-scheme: dark`). Contraste medido contra `--bg-page` `#0b0620`:

| Grupo | Tokens | Uso |
|---|---|---|
| Noite | `--night-950…500` | fundos (`--bg-sunken/page/surface/raised`) e bordas |
| Lilás | `--lilac-050/200/300/500` | texto 18:1 · 10.6:1 · 6.5:1 · desabilitado 2.8:1 (só estado desabilitado) |
| Neons | `--neon-pink/cyan/yellow/purple/orange` | ação, foco, recorde, estrutura. Todos ≥ 5.7:1 |
| Trastes | `--fret-green/red/yellow/blue/orange` | ordem do Guitar Hero. Acerto e conceito |

Texto escuro (`--text-on-neon`) sobre qualquer neon fica ≥ 5.7:1.

**Mapeamentos de jogo (não invente outros):**

| Significado | Token | Cor |
|---|---|---|
| Melodia original (referência) | `--pitch-reference` | ciano |
| Sua voz | `--pitch-voice` | rosa |
| Perfect (≤ 50 cents) / Good (≤ 100) / Miss | `--hit-perfect/good/miss` | verde / amarelo / vermelho |
| Conceito S / A / B / C / D | `--grade-s…d` | amarelo / verde / azul / laranja / vermelho |
| Faixa do conceito | S ≥ 9.0 · A ≥ 7.0 · B ≥ 5.0 · C ≥ 3.0 · D < 3.0 | |
| 1º / 2º / 3º lugar | `--rank-1/2/3` | amarelo / ciano / laranja |
| Letra cantada / não cantada | `--lyric-sung/unsung` | ciano / lilás claro |

Nunca comunique algo **só** pela cor: acerto também vem escrito (PERFECT/GOOD/MISS),
conceito é uma letra e o ranking tem a posição escrita.

## Tipografia

| Voz | Token | Fonte | Uso |
|---|---|---|---|
| Letreiro | `--font-display` | Bungee | títulos (caixa alta automática), botões |
| HUD | `--font-arcade` | Silkscreen | micro-labels, nomes, ranking, START |
| Placar | `--font-score` | Press Start 2P | **só números e palavras fixas em inglês**: `8.4`, `3-2-1`, `PERFECT` |
| Leitura | `--font-body` | Rubik | texto corrido e **a letra da música** |

⚠️ O Press Start 2P não tem maiúsculas acentuadas (Õ, Í, Ê). Ele nunca recebe texto em
português, porque o resultado sai quebrado ("BOTõES"). Para texto de HUD, use Silkscreen.

## Forma e profundidade

- Raios: `2px` (badge/input), `6px` (botão/painel), `12px` (palco). `pill` só para gemas e LEDs.
- Bordas de `2px` são o padrão, e `4px` marca palco e conceito.
- Botão físico: `--shadow-press` (bloco sólido embaixo) que afunda 3px no `:active`.
- Texturas: `.ct-crt` aplica scanlines e vinheta sobre uma área. Use só no palco e no hero,
  nunca sobre formulários.

## Movimento

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | 150ms | hover, press |
| `--dur-base` | 240ms | entrada de blocos, troca de linha da letra |
| `--dur-slow` | 400ms | troca de tela, pop do placar |
| `--dur-beat` | 500ms | pulso da linha de acerto e do START |
| `--dur-count` | 1200ms | contagem da nota subindo |
| `--ease-snap` | overshoot | **só recompensa** (nota, conceito, recorde) |

Keyframes disponíveis: `ct-flicker`, `ct-blink`, `ct-pop`, `ct-beat`, `ct-chase`,
`ct-grid-scroll`, `ct-gem-fall`, `ct-countdown`, `ct-scan`, `ct-rise`.

## Componentes-chave do jogo

- **Letra (`.ct-lyric`)**: três estados (`is-past`, `is-current`, `is-next`). A linha atual
  recebe `--progress` de 0 a 1 e preenche da esquerda para a direita, **atravessando quebras
  de linha em sequência**. O texto vai dentro de `.ct-lyric__text`.
- **Highway (`.ct-highway`)**: pista em perspectiva estilo Guitar Hero. O `<canvas>` com as
  curvas de pitch vai dentro de `.ct-highway__lane`, e `.ct-highway__hitline` pulsa no beat.
- **Placar (`.ct-score`, `.ct-grade`, `.ct-meter`)**: nota em Press Start, conceito inclinado
  em -6° e medidores de LED de 10 segmentos (`--value` 0–1). O `.ct-meter__bar` leva
  `role="meter"` com `aria-valuenow`.
- **Ranking (`.ct-ranking` dentro de `.ct-marquee`)**: tabela HIGH SCORES com pódio colorido e
  a sua linha (`tr.is-you`) com seta piscando.

## Telas → componentes

| Tela / estado | Componentes |
|---|---|
| Home / busca | `.ct-horizon` + `.ct-wordmark--hero`, `.ct-search`, lista de `.ct-song-row` (capa = miniatura do YouTube quando houver `youtubeVideoId`, senão a inicial sobre `--grad-sunset`) + `.ct-badge` de status |
| Preparar música, sem referência | `.ct-tabs` "Link do YouTube \| Enviar arquivo" → `.ct-input-group` (link + "Usar vídeo") ou `.ct-dropzone`; link "Procurar no YouTube" na dica |
| Preparar música, processando | `.ct-tv` com a miniatura do vídeo + `.ct-loading` (tempo decorrido; nunca porcentagem falsa) + `.ct-name-entry` para adiantar o nome |
| Preparar música, falhou | `.ct-alert--danger` ou `--warning` com a mensagem do código de erro (tabela abaixo) e as abas de volta |
| Preparar música, pronta | `.ct-name-entry`, ranking (`.ct-marquee` + `.ct-ranking`), `.ct-btn--start` |
| Baixando o áudio para cantar | `.ct-progress` com `--value` real (`Content-Length`). Sem tamanho conhecido, use `.ct-loading` |
| Karaokê | `.ct-stage.ct-crt` → `.ct-hud` + `.ct-progress`, `.ct-highway` (canvas), `.ct-lyrics`, `.ct-countdown`, `.ct-range` do offset |
| Resultado | `.ct-score`, `.ct-grade`, `.ct-meter--pitch/--timing`, `.ct-badge--new-record`, ranking com `tr.is-you` |

A miniatura vem de `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (`default.jpg` na linha da
busca), com `alt` descritivo na TV e `alt=""` na capa da linha (é decorativa, porque o título
já está ao lado).

### Erros da referência → mensagem

A API devolve um código (`referenceError`), e o web mostra o texto abaixo. Nunca mostre o
código cru.

| Código | Tipo | Título | Corpo |
|---|---|---|---|
| `INVALID_YOUTUBE_URL` | danger | Esse link não é do YouTube | Cole o endereço de um vídeo, tipo youtu.be/… ou youtube.com/watch?v=… |
| `VIDEO_UNAVAILABLE` | danger | Esse vídeo não abre | Ele é privado, tem restrição de idade ou foi removido. Tente outro link. |
| `TOO_LONG` | warning | Música longa demais | O limite é 10 minutos. Procure a versão de estúdio. |
| `DURATION_MISMATCH` | warning | Duração não bate com a letra | O vídeo tem {video} e a letra, {letra}. Procure a versão "official audio". |
| `NO_VOICE` | warning | Não achamos voz nesse áudio | Parece ser só instrumental. Use a versão original, com o cantor. |
| `DOWNLOAD_FAILED` | danger | O YouTube não deixou baixar | Tente de novo em alguns minutos ou envie o arquivo de áudio. |
| `INVALID_AUDIO` | danger | Não conseguimos ler esse arquivo | Envie um MP3, M4A, WAV, OGG ou FLAC de até 20 MB. |
| `INTERNAL` | danger | Deu ruim do nosso lado | Tente de novo. Se continuar, envie o arquivo de áudio. |

## Voz e texto

**A inspiração não aparece por escrito.** Anos 80, fliperama e Guitar Hero guiam só o
visual e o tom. Nenhum texto da interface cita essas referências (nada de "estilo anos 80",
"como no Guitar Hero").

Português do Brasil, frases curtas, energia de locutor de fliperama. Termos de jogo em
inglês (PRESS START, HIGH SCORE, PERFECT, 1ST) aparecem **só no HUD**, como nos fliperamas.

- ✅ "Coloque o fone e aperte START." · "Novo recorde. Seu nome está no topo." ·
  "Quase lá. Faltou entrar no tempo em 3 versos."
- ❌ Mensagem técnica ("Erro 409…") · humilhar quem cantou mal · emoji como ícone · mais de
  uma exclamação por tela.

## Ícones

Estilo Lucide: SVG com traço de 2px, `currentColor`, pontas arredondadas. Ícone sozinho em
botão (`.ct-icon-btn`) exige `aria-label`. Nada de emoji.

## Checklist antes de entregar uma tela

- [ ] Só um `ct-btn--primary` visível
- [ ] Nenhum hex ou fonte crua no componente
- [ ] Texto em pt-BR nunca em `--font-score`
- [ ] Foco visível em todo elemento interativo (anel ciano)
- [ ] Alvos de toque ≥ 48px
- [ ] Sem rolagem horizontal em 375px
- [ ] Testado com `prefers-reduced-motion: reduce`
- [ ] Informação nunca só por cor
