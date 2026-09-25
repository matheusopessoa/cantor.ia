# Atrito Design System

> **Atrito** — a dopamine-detox app that adds *intentional friction* before you open
> attention-traps (Instagram, TikTok, YouTube). Breath screens, wait timers and
> conscious barriers that make you pause and decide if you really want to go in.
> The interface is the antidote to addictive design: strictly black & white,
> minimal, calm — an "anti-app."

*"Atrito" is Portuguese for **friction**. Everything here is in service of slowing
the user down by a few deliberate seconds.*

---

## Sources

This system was authored **from a written brand brief** — no codebase or Figma file
was provided. All visual decisions (the monochrome palette, Geist typography, the
friction-by-ink-density motif, the breath-ring intercept) are original
interpretations of the brief. If you have an existing Atrito codebase, Figma, or
brand assets, attach them via the Import menu and this system should be reconciled
against them.

**Font note (needs confirmation):** the brief suggested *Inter or Geist*. We chose
**Geist** (Geist Sans + Geist Mono) and load it from **Google Fonts** rather than
self-hosted binaries — the sandbox cannot fetch font binaries to vendor them in.
If you want offline/self-hosted fonts, drop the `.woff2` files into `assets/fonts/`
and swap the `@import` in `tokens/fonts.css` for local `@font-face` rules.

---

## Core principle: reward the exit, not the use

The product's one non-negotiable idea: **the interface should create purposeful
friction.** Important actions (opening a blocked app) require deliberate steps —
pause, breathe, confirm. Atrito celebrates the moments you *step away*, never the
moments you scroll. This shows up in every layer:

- **No dopamine cues.** No accent colors, no red badges, no aggressive
  notifications, no celebratory confetti for screen time.
- **Slow on purpose.** Microinteractions are deliberately unhurried — transitions
  ease out over 400–700ms, the breath cycle runs 4s. Nothing feels urgent.
- **Hierarchy without color.** Everything is black & white. Importance is carried
  by *value* (light↔dark), *size*, and *weight* — never hue.

---

## CONTENT FUNDAMENTALS

**Tone:** serious but warm. No judgement, ever. Language invites reflection; it
never punishes or shames. Think of a calm friend, not a nagging app.

- **Person:** addresses the user as **you**; the app refers to itself rarely and
  quietly as **we** ("We add a little friction back" / "We reward leaving").
- **Casing:** sentence case for everything readable. The wordmark **atrito** is
  lowercase. Micro-labels (eyebrows) are UPPERCASE with wide tracking, used sparingly.
- **Length:** short. One idea per screen. Sentences are calm and complete, not
  clipped or hype-y. White space carries the rest.
- **Punctuation:** em dashes for the reflective beat ("Notice the urge — it passes.").
  Real typographic characters (— " ' …), never ASCII substitutes.
- **No emoji. No exclamation marks.** Enthusiasm is expressed through restraint.
- **Numbers are factual, not gamified.** "23 opens avoided" not "🔥 23!! New record".

**Voice examples (verbatim from the system):**
- Eyebrow → headline: `RECENT PAUSES` · "Quietly, it adds up."
- Intercept: "You're about to open **Instagram**" / "Take a moment. Notice the urge — it passes."
- Onboarding: "The apps are designed to be hard to put down." / "We reward leaving, not staying."
- Buttons: **Step away** (primary, encouraged) vs **Open anyway** (secondary, gated behind a timer).
- App list: "Choose how much friction stands between you and each app."

---

## VISUAL FOUNDATIONS

**Color.** Strictly achromatic. A single ink ramp (`--ink-1000` → `--paper`) plus
semantic aliases. There is **no accent hue anywhere** — adding one breaks the system.
The only theme variant is **dark** (`.atrito-dark`), used for the breath/intercept
screens to mark them as a distinct, quieter mode. *Friction levels* are encoded by
**ink density** — 1 / 2 / 3 filled marks — not by color.

**Typography.** Geist for everything; Geist Mono for numerals only (timers,
counters, stats — the one place numbers are allowed to be large and present).
The system leans **light**: headings are weight 300, body 400, medium 500 is the
heaviest UI weight; 700 is reserved for the wordmark. Display sizes are
intentionally oversized to slow the eye. Tracking is tight on display (−0.03em),
wide on uppercase micro-labels (+0.18em).

**Spacing & layout.** Whitespace is the primary material — the scale is generous
(up to 128px). Mobile-first single column, `--content-max: 440px`. Minimum tap
target 48px. Sections breathe with 64–96px gaps.

**Backgrounds.** Pure paper white (`#fff`) by default; near-black (`#0a0a0a`) for
intercept screens. **No gradients, no imagery, no textures, no patterns.** Flatness
is the point.

**Borders.** Hairlines (1px) do most of the structural work, since there is almost
no fill and almost no shadow. A 1.5px "strong" border (ink-900) marks selected /
active states and outline controls.

**Elevation / shadow.** Almost none — Atrito is flat and papery. A single very soft
shadow (`--shadow-sheet`, `0 2px 40px rgba(0,0,0,0.08)`) exists only for floating
sheets. No layered drop shadows, no glows.

**Corner radii.** Soft but restrained: 8 / 14 / 22px, plus full pill for circular
elements (timer rings, avatars, toggle tracks) only. Nothing bubbly.

**Cards.** Flat surfaces defined by a hairline border (`Card variant="default"`),
a quiet inset fill (`sunken`), or the inverse dark surface (`inverse`). No shadow,
no colored left-border accents, no rounded-corner-plus-glow tropes.

**Motion.** Deliberately unhurried. Two easings: `--ease-calm` (gentle ease-out)
and `--ease-inout` (slow symmetric). Durations 220 / 420 / 700ms, plus a 4s breath
cycle. **No bounce, no spring, no urgency.** Entrances are slow fades + small
upward drifts. The breath ring scales gently between 0.94 and 1.0.

**Hover / press.** Hover is a faint achromatic wash (`rgba(0,0,0,0.04)`), never a
color shift. Solid buttons darken from ink-900 → ink-700. Press is a subtle
`scale(0.985)` — a small, slow give, not a snap.

**Transparency & blur.** Used sparingly: white-on-dark text uses alpha
(`rgba(255,255,255,0.62)`) for secondary hierarchy; the intercept scrim is
`rgba(0,0,0,0.55)`. No backdrop-blur glassmorphism.

---

## ICONOGRAPHY

Atrito uses **thin (1.5px) monochrome line icons** in the *Lucide* family style —
stroke-only, `currentColor`, round caps and joins, no fills, no color. They are
quiet and uniform, matching the calm aesthetic.

- **Where they live:** `ui_kits/atrito-app/icons.jsx` defines the in-app set
  (`home`, `shield`, `chart`, `clock`, `wind`, `leaf`, `chevron`, `close`, `check`,
  `settings`, `moon`, `arrowR`, `pause`, …) as inline React SVG factories exported
  to `window.AtritoIcons`. Call `AtritoIcons.home(size, stroke)`.
- **Substitution flag:** these are *hand-rolled in the Lucide visual style*, not the
  Lucide package itself. If you prefer the real library, swap in
  [lucide](https://lucide.dev) (stroke-width 1.5) — the proportions match. **Flagged
  for your confirmation.**
- **App "icons":** monitored apps (Instagram, TikTok…) are shown as **monochrome
  initials in a bordered tile**, never their real brand logos/colors — deliberately
  stripping the apps of their visual pull.
- **No emoji. No unicode glyphs as icons** (except the literal `×` close affordance
  and `✓` check on the intercept, used as type, not iconography).
- **Brand marks:** `assets/logo-wordmark.svg` (mark + "atrito") and `assets/mark.svg`
  (the pause-ring alone — a thin ring with a deliberate gap, evoking a breath / pause).

---

## INDEX / manifest

**Root**
- `styles.css` — global entry point (import manifest only). Consumers link this.
- `readme.md` — this file.
- `SKILL.md` — Agent-Skills-compatible front matter for download/reuse.

**`tokens/`** — design tokens, all `@import`ed by `styles.css`
- `fonts.css` — Geist + Geist Mono (Google Fonts).
- `colors.css` — ink ramp, semantic aliases, friction levels, `.atrito-dark` scope.
- `typography.css` — font stacks, weights, type scale, line-heights, tracking.
- `spacing.css` — spacing scale, radii, borders, (minimal) shadow, motion.
- `base.css` — element resets + `.atrito-eyebrow` / `.atrito-numeric` / `.atrito-wordmark` utilities.

**`components/`** — reusable React primitives (namespace `window.AtritoDesignSystem_04edc5`)
- `core/` — **Button**, **IconButton**, **Card**, **Badge**, **Stat**
- `forms/` — **Switch**, **FrictionSelector** *(the signature control)*
- `feedback/` — **BreathRing** *(the wait-timer ring)*
- `lists/` — **AppRow** *(monitored-app row)*

**`ui_kits/atrito-app/`** — interactive mobile app recreation
- `index.html` — phone shell: onboarding → home → apps → intercept → stats
- `HomeScreen`, `AppsScreen`, `StatsScreen`, `OnboardingScreen`, `BreathScreen`, `icons`

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Motion, Brand)

**`assets/`** — `logo-wordmark.svg`, `mark.svg`
