# OpenWOP — Design Standards

> Source of truth for the public marketing site (`public/index.html`, `public/styles.css`, `public/main.js`) and any future surfaces (docs, blog, dashboards). Reviewed by `/ux-review`.

This document codifies the design system already encoded in `public/styles.css` and adds normative rules for localization, light/dark mode, accessibility, theme usage, and responsive breakpoints. Anything that contradicts this file is a bug.

---

## 1. Purpose & audience

OpenWOP's surfaces are read by protocol implementers, dev-tool evaluators, and the spec community. The visual register is **editorial-technical** — Instrument Serif headlines paired with mono labels, restrained clay accent, generous whitespace. We optimise for *evaluation* and *comprehension*, not for marketing flourish.

When in doubt: cut, don't add.

---

## 2. Voice & copy

- **Headlines (h1/h2)**: serif, with one or two italicised words for emphasis (`em` element rendered in clay). Never more than two.
- **Lede paragraphs**: declarative, ≤ 32 words, no jargon on first use.
- **Body**: factual third person ("OpenWOP defines…", not "we define…"). Active voice.
- **Acronyms** (`BYOK`, `SSE`, `OTel`, `RFC`, `HMAC`): expand on first appearance in a section using an `<abbr title="…">` or parenthetical. Subsequent uses MAY be bare.
- **Status labels** (FINAL, Active, Draft): treat as proper-noun keywords; italic + lower-case at point of use, sentence-case when defining ("status: Active"). Always cite the date the status changed.
- **External-link arrows**: `↗` for off-site, `→` for in-page anchors. The CSS rule `a[href^="http"]…::after { content: " ↗"; }` adds these automatically — do not hand-add them to anchor text. Exceptions (`.btn`, `.brand`, `.view`, `.pill`, `.meta-link`, `.pack a`) are listed in `styles.css`.

---

## 3. Type system

| Family | CSS var | Use |
|---|---|---|
| `Instrument Serif` | `--serif` | h1, h2, italic `em` accents inside headlines, branded shibboleths (`.accent-term`) |
| `Geist` | `--sans` | body copy, lede, list items, button labels |
| `Geist Mono` | `--mono` | section markers (`§ 01 / …`), labels, tags, code, terminal blocks, SVG node labels |

### Type scale (clamp-based, responsive)

| Token | Size | Where |
|---|---|---|
| Display | `clamp(40px, 6vw, 78px)` | hero headline (`h1.headline`) |
| H2 | `clamp(36px, 5vw, 60px)` | section h2s |
| H3 | `30px` | pillar / compare / anatomy headings |
| Body | `16px` | paragraphs, lists |
| Small | `13.5px`–`14px` | spec-table small, anatomy `<p>`, pack descriptions |
| Mono label | `10–11.5px` letter-spacing `0.04em` uppercase | markers, tags, footer column headers, SVG labels |

**Rule:** use the existing CSS classes (`.headline`, `.lede`, `.marker`, `.node-label`). Do NOT set `font-size` inline except for SVG text where the class system does not reach.

---

## 4. Color tokens

All colors live in `:root` in `public/styles.css`. **NEVER use hex values, OKLCH literals, or hard-coded `rgb()` outside this token block.**

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f4f1ea` | page background |
| `--paper-2` | `#ece8de` | recessed panels (terminal bar, install blocks, hover tints) |
| `--rule` | `#d9d4c5` | hairlines (section borders, table borders, footer top) |
| `--rule-2` | `#c4bfae` | secondary hairlines (separator lines inside cards, SVG axis lines) |
| `--ink` | `#1a1a17` | primary text, h1/h2, button bg |
| `--ink-2` | `#4a4842` | body copy, lede |
| `--ink-3` | `#837f72` | sub-labels, meta text, mono section markers |
| `--clay` | `oklch(58% 0.13 40)` | accent — single use per visual region (eyebrow badge, italic in h2, pulses, terminate state, branded glyph) |
| `--clay-soft` | `oklch(58% 0.13 40 / 0.10)` | hover wash on cards |
| `--clay-rule` | `oklch(58% 0.13 40 / 0.35)` | accent borders |

### Token usage rules

1. **No raw colour values in component CSS.** Always reference the token: `color: var(--ink-2);`. If a new shade is required, propose a new token rather than inlining.
2. **No inline `style="color:…"` in HTML.** The one historical exception (`BYOK` inline) is now `.accent-term`; the pattern is forbidden going forward.
3. **Accent discipline.** Clay is a punctuation colour, not a fill. Rule of thumb: one or two clay elements per fold. If a section already has a clay-accented headline italic, do not also clay the buttons.

---

## 5. Spacing tokens

| Token | Value | Use |
|---|---|---|
| `--maxw` | `1240px` | content max-width |
| `--gutter` | `clamp(20px, 4vw, 56px)` | left/right padding on `.wrap` |
| Section vertical | `clamp(64px, 8vw, 120px)` | `section.block` padding |
| Hero vertical | `clamp(56px, 9vw, 120px)` top / `clamp(64px, 9vw, 110px)` bottom | `section.hero` padding |
| Grid gap (hero) | `clamp(32px, 5vw, 80px)` | `.hero-grid` |
| Grid gap (compare) | `clamp(20px, 3vw, 36px)` | `.compare` |

**Rule:** new sections inherit `section.block` padding. Custom paddings must use `clamp()` between a mobile floor and a desktop ceiling, never a single fixed value.

---

## 6. Components — canonical list

The page composes from a small fixed set. Adding a new component is a design decision and requires a DESIGN.md entry.

| Class | Purpose | Notes |
|---|---|---|
| `.topbar` | sticky nav | 64px tall; ink on paper |
| `.eyebrow` / `.marker` | mono section badge (`v1.0`, `§ 01 / …`) | always paired with a `.dot` |
| `.headline` | display serif | use `em` for italics |
| `.lede` | hero or section intro paragraph | `max-width: 50ch` |
| `.block-lede` | optional softening paragraph under a `.block-head` h2 | `max-width: 64ch` |
| `.actions` + `.btn` + `.btn-primary` / `.btn-ghost` | CTA pair | always two buttons max (hero); `.demo-cta` is the section-end variant that MAY carry up to three |
| `.meta-row` | hero credibility chips | each chip uses `<b>`; one MAY be a `.meta-link` |
| `.pillars` / `.pillar` | 3-up feature grid | borders only — no card chrome |
| `.anatomy` + `.ana-list` + `.ana-art` | letter-keyed list + figure | letters A–F |
| `.spec` + `.row` + `.key` + `.val` | versioned spec table | 2×N grid; `.val small` for sub-text |
| `.compare` + `.compare-card` | side-by-side positioning | bordered cards |
| `.start` + `.terminal` | quickstart layout + faux terminal | `.term-bar` + `.term-body` |
| `.packs` + `.pack` | 4-up package grid (Ecosystem) | hover tint clay-soft |
| `.diagram-card` + `.diagram-mobile-summary` | hero figure + mobile fallback | hidden ↔ shown at 760px |
| `.foot` + `.foot-grid` + `.foot-mark` | footer | 4-column at desktop; 2-col + brand spanning at ≤760px |
| `.demo-flow` + `li` | numbered "what to try" grid (Try-it-live block) | 3-up at desktop, 2-up ≤920, 1-up ≤640; `.demo-k` marker in clay; serif italic h3; hover tint clay-wash |
| `.star-cta` + `.btn-star` | "Star on GitHub" callout band | clay-wash band with a 2-col grid (text + ink-on-paper inline-flex button); stacks ≤920; button is excepted from the auto-`↗` rule; star glyph uses `--star-glow` |

Any new card must inherit a border-only or rule-only style — never a shadow heavier than the terminal's, never a gradient that competes with the page paper background.

---

## 7. Accessibility standards (normative)

These are MUST-have for every surface.

### 7.1 Heading hierarchy
- Exactly one `<h1>` per page (the hero headline).
- `<h2>` opens each section block. Skip-levels (h2 → h4) forbidden.
- Marker text (`§ 01 / Specification`) is decorative; the visible h2 carries the semantic weight.

### 7.2 Focus visibility
- `:focus { outline: none; } :focus-visible { outline: 2px solid var(--clay); outline-offset: 3px; }` is the global pattern.
- Mouse clicks suppress the ring; keyboard tab restores it.
- `.btn` uses `outline-offset: 4px` for higher contrast against the ink background.
- New interactive elements MUST inherit or define an equivalent focus ring.

### 7.3 Reduced motion
- Wrap all `animation`, `transition`, and SVG `animateMotion` / `animate` in `@media (prefers-reduced-motion: no-preference)` OR provide a kill-switch under `@media (prefers-reduced-motion: reduce)`.
- The current global kill-switch (lines under `@media (prefers-reduced-motion: reduce)` in `styles.css`) freezes pulses, blinks, and reveal transitions. New animations MUST opt-in via this kill-switch.

### 7.4 Color contrast
- Body text on `--paper`: AAA (`--ink` / `--ink-2`).
- Sub-labels (`--ink-3` on paper): AA — borderline; MUST be paired with bold weight, larger size (≥14px), or accompanying visual context.
- Clay on paper: AA at `font-weight ≥ 500`. Do not use clay for body paragraphs.

### 7.5 Images and SVG
- Decorative SVG / `<img>`: `alt=""` + `aria-hidden="true"`. Do not use both `alt="Description"` AND `aria-hidden="true"` — pick one.
- Informational figures: `role="img"` + a comprehensive `aria-label`. Pulses and decorative paths inside MUST be `aria-hidden="true"` on their parent group.
- Robot head and person icon glyphs MUST inherit `var(--ink)` stroke; do not hard-code black.

### 7.6 Keyboard navigation
- Document-order tab sequence — no `tabindex > 0`.
- Anchor links (`href="#section"`) MUST move focus to the target heading. (Today this is best-effort; future improvement: focus management JS.)
- All buttons are native `<button>` or `<a>` — never `<div>` or `<span>` with a click handler.

### 7.7 ARIA economy
- Prefer semantic HTML over ARIA. Only add `role` / `aria-*` where native semantics fall short (e.g. SVG figures).
- `aria-label` text MUST mirror the visual content; never use it to hide one story while showing another.

### 7.8 Print
- `@media print` flattens backgrounds, removes animations and decorative chrome, expands external link `href` after anchor text. New components MUST not break the print stylesheet — test with print preview.

---

## 8. Mobile breakpoints

The site uses **six canonical breakpoints**. Do not invent new ones.

| Token | Width | What collapses |
|---|---|---|
| `--bp-wide` | `≤ 1080px` | `.packs` 4 → 2 cols |
| `--bp-md` | `≤ 920px` | `.hero-grid` 2 → 1 col; `.start` 2 → 1 col; `.foot-grid` 5 → 3 cols |
| `--bp-sm` | `≤ 820px` | `.pillars` 3 → 1 col |
| `--bp-mobile` | `≤ 760px` | `.spec` 2 → 1 col; **diagram-card hidden, `.diagram-mobile-summary` shown**; `.topnav .hide-sm` items hidden |
| `--bp-xs` | `≤ 640px` | `.packs` 2 → 1 col; `.foot-grid` 3 → 2 cols |
| `--bp-xxs` | `≤ 480px` | iPhone-SE-class micro-mobile: `.brand-sub` hidden so the GitHub pill clears the brand mark; `.hero h1` drops one type step |

(These are documentation tokens — the CSS today inlines the literal values. Future refactor: hoist to `:root` so they can be changed in one place.)

### Diagram on mobile

`FIG. 01` is too information-dense for sub-760px viewports. The pattern:

1. Author both the SVG diagram AND a fallback `<ol class="diagram-mobile-summary">` that mirrors the diagram's narrative in text.
2. CSS shows one or the other based on viewport.
3. The fallback is keyboard-accessible by default (it's a list of items).

Any future infographic MUST follow this pattern unless the SVG's text labels are confirmed legible at 320px viewport width.

---

## 9. Light / dark mode

**All three openwop surfaces are light-mode only today** — `public/` (marketing site), `apps/workflow-engine/frontend/react/` (reference app), and `registry/` (pack registry at packs.openwop.dev) ship the warm editorial palette without a `@media (prefers-color-scheme: dark)` override. A user on a dark-OS sees the same cream / ink / clay register everywhere.

Dark mode is **deferred** until a coherent warm-dark variant lands across all three surfaces in the same release. The recipe below is the candidate; it isn't wired anywhere right now.

### 9.1 Candidate warm-dark token override (deferred — informative)

```css
@media (prefers-color-scheme: dark) {
  :root {
    --paper:        #1a1a17;
    --paper-2:      #232220;
    --rule:         #3a3833;
    --rule-2:       #4a4842;
    --ink:          #f4f1ea;
    --ink-2:        #d9d4c5;
    --ink-3:        #a8a39a;
    --ink-shadow:   rgb(0 0 0 / 0.35);
    /* --clay, --clay-soft/rule/wash/glow/bg-hi, --star-glow stay identical;
       OKLCH keeps them luminance-balanced on either surface. */
  }
}
```

The inversion `paper ↔ ink`, `paper-2 ↔ ink-2`, etc., is the contract — same token names, swapped role. Any future doc-level override MUST follow this same shape.

### 9.2 Implementation invariants (apply when dark mode lands)

1. **No component CSS changes when dark mode flips.** If a component breaks in dark mode, it had hard-coded values — that is the test.
2. The `@media (prefers-color-scheme: dark)` block lives inside the same `:root` declaration as the light tokens, never as a separate stylesheet.
3. A manual override class on `<html>` (`.theme-dark`, `.theme-light`) MAY be added for explicit user toggle; the media query is the default.
4. App-side functional tokens (`--color-success` / `--color-warning` / `--color-danger` / `--color-ai`) lift by ~10% luminance in the dark block to maintain on-dark contrast. They are NOT brand tokens and are NOT mirrored to the marketing site.
5. All three surfaces (`public/`, `apps/.../react/src/styles/global.css`, `registry/scripts/build-index.mjs`) MUST adopt the override in one release — partial-coverage dark mode produces the "two of three surfaces feel different" failure mode that triggered §9's walk-back.

### 9.3 SVG fills

- SVG nodes that use `fill="var(--paper)"` and `stroke="var(--ink)"` will theme automatically when dark mode lands.
- SVG nodes that use raw `fill="#000"` or `fill="black"` will NOT theme. These are bugs; convert to tokens.
- The robot head embedded in the orchestrator uses `var(--paper)` + `var(--ink)` and will theme correctly.

### 9.4 Clay accent across modes

OKLCH provides automatic visual consistency. The shared `--clay: oklch(58% 0.13 40)` works on both `--paper: #f4f1ea` and the candidate dark `--paper: #1a1a17`. Verify contrast (target: WCAG AA at body weight) before shipping any clay-on-dark-paper combination.

---

## 10. Theme tokens — no hard-coded values

This section is the enforcement contract. Lint rule:

**FAIL** any change that introduces:
- A hex color (`#1a1a17`, `#fff`, etc.) outside `:root`.
- An `rgb(…)`, `rgba(…)`, `hsl(…)`, or raw `oklch(…)` outside `:root`.
- A literal `0`/`auto`/`none` in spacing if a `clamp()` or token would do.
- An inline `style="color:…"` or `style="font-family:…"` in HTML.
- An SVG `fill="black"` / `stroke="#000"` / `fill="white"` etc.

Allowed:
- SVG numeric attributes (`stroke-width="1.4"`, `r="9"`) when they represent geometry, not theme.
- `opacity="0.3"` and similar transparency multipliers.
- `font-size` in SVG inline (because CSS selectors are unreliable for SVG text).

If a value is reused twice, it MUST become a token.

---

## 11. Animation guidelines

- **Ambient, not narrative.** SVG pulses on FIG. 01 are out-of-phase, continuous, and decorative — they suggest "this thing is running" rather than telling a story.
- **Duration range.** Each pulse: `2.0s – 3.0s`. Reveal transitions: `0.8s`. Hover: `0.15s – 0.25s`. Anything outside this band must be justified.
- **No bouncing, no parallax, no scroll-jacking.** Editorial tone forbids these.
- **Respect `prefers-reduced-motion`.** Already covered in §7.3; restated here because it's the most common forgotten rule.

---

## 12. Localization standards

The site is English-only today. Future i18n MUST observe:

### 12.1 Source-text separation
- All user-visible strings live in HTML, never in CSS `content` declarations (except decorative glyphs like `↗`).
- Author future translations as data attributes or as parallel files (`index.en.html`, `index.es.html`) — not as JS string interpolation.

### 12.2 Text expansion
- Reserve ~ 30% horizontal headroom in card layouts. German and Finnish translations expand by ~25%. Buttons must not break to two lines.
- Use `min-width` rather than `width` on chip / button containers.

### 12.3 Bidirectional support
- Use logical CSS properties (`margin-inline-start`, `padding-inline-end`, `border-inline-start`) instead of `left`/`right` where text flow matters.
- Test against `dir="rtl"` on `<html>` before declaring an i18n surface done.

### 12.4 Number / date / currency
- All dates on the page MUST be ISO-8601 (`2026-05-08`), never `5/8/26` or `May 8, 2026`. The marketing voice can render them inside prose ("FINAL v1 · 2026-05-08").
- Currency, percentages: avoid until the site has a real i18n strategy.

### 12.5 Typography
- Instrument Serif and Geist both have good Latin coverage but limited support for Cyrillic, Greek, Arabic, CJK. Localization MUST swap the family for an appropriate fallback when those scripts appear — do not stretch the brand fonts to languages they do not support.

---

## 13. Iconography

- **Brand robot.** `assets/OpenWOP.svg`. When embedded in the orchestrator, MUST scale via `transform="translate(…) scale(0.16)"` and inherit `var(--ink)` for strokes. Never re-color the brand mark.
- **Person glyph.** iOS `person.circle` style — outer container circle, head circle inside, body circle clipped by the container via `clipPath`. Stroke `2`, `var(--ink)`.
- **Inline arrows.** `↗` for off-site, `→` for in-page, `↺` reserved for the orchestrator loop indicator. No emoji.
- **Glyph SVGs in pillars.** `viewBox="0 0 44 44"`, `stroke="currentColor"`, one optional clay accent stroke per glyph.

### 13.1 Diagram-label inlining exception

Per-label `style="font-size:…"` is permitted on `<text>` elements inside the FIG. 01 hero diagram (and any future diagram following the same pattern). Diagram legibility tuning routinely requires fractional sizes (`8.5px`, `9.5px`) that don't map cleanly to the §3 type scale. The label color, however, MUST resolve to a token: `style="fill:var(--ink)"`, `var(--ink-3)`, `var(--clay)`, never a literal `#hex` or `oklch(…)` value. Class-based label sizing is acceptable too; the inline-style carve-out is the practical default.

### 13.2 OG-share asset exception

`public/assets/og-*.svg` (Open Graph / Twitter Card share images) MAY inline literal `#hex` and `oklch(…)` colors. These assets are rendered by external link-preview services (Twitter / LinkedIn / Slack / Discord) outside our CSS context, so token-based `var(…)` references would not resolve. Update the literal values in the same release whenever the canonical palette in `public/styles.css :root` changes — keep the SVG and the token block in lockstep so the social preview matches the live site.

---

## 14. Component checklist for any new addition

Before merging a new component, confirm:

- [ ] Uses existing class taxonomy or proposes a new one with a DESIGN.md entry
- [ ] No hard-coded color, font-family, or spacing values
- [ ] Passes WCAG AA contrast for both text and non-text elements
- [ ] Has a `:focus-visible` style
- [ ] Respects `prefers-reduced-motion`
- [ ] Renders correctly under `prefers-color-scheme: dark` once dark mode lands (only requirement today: no hard-coded colors)
- [ ] Has a documented breakpoint behavior for ≤760px
- [ ] All copy strings are in HTML, not CSS `content`
- [ ] Uses logical CSS properties for any directional layout
- [ ] External links use the auto-arrow CSS hook
- [ ] No `tabindex > 0`
- [ ] SVG `alt`/`aria-*` follows §7.5

---

## 15. Related files

| File | Purpose |
|---|---|
| `public/styles.css` | Marketing-site visual rules + canonical shared `:root` (tokens, components, responsive, a11y) |
| `public/index.html` | Marketing-site page composition; copy lives here |
| `public/main.js` | Reveal-on-scroll observer + GitHub-star count fetch |
| `public/assets/OpenWOP.svg` | Brand mark |
| `DESIGN.app.md` | Companion design doc for the reference app at `apps/workflow-engine/frontend/react/`. App-specific components, functional status tokens, xyflow + Firebase Auth carve-outs |
| `apps/workflow-engine/frontend/react/src/styles/global.css` | Reference-app stylesheet; `:root` mirrors `public/styles.css` per the SYNC RULE in DESIGN.app.md §2 |
| `.claude/skills/ux-review/SKILL.md` | Review skill that enforces this document and `DESIGN.app.md` |

---

## 16. Open standards we follow

- **WCAG 2.2** Level AA for accessibility.
- **WAI-ARIA Authoring Practices 1.3** for interaction patterns.
- **ISO-8601** for dates.
- **OKLCH** for color (better perceptual uniformity than HSL; built-in alpha).
- **`prefers-reduced-motion`**, **`prefers-color-scheme`**, **`prefers-contrast`** media queries.

When this document and an open standard disagree, the open standard wins and DESIGN.md is updated.
