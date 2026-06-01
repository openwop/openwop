# OpenWOP Reference App — Design Standards

> Source of truth for `apps/workflow-engine/frontend/react/`. Reviewed by `/ux-review`.
>
> **Companion to `DESIGN.md`.** Shared tokens (palette, type triple, spacing) live in `DESIGN.md §3`–§5 and §9, mirrored verbatim in `apps/workflow-engine/frontend/react/src/styles/global.css :root`. This doc covers what is **app-specific**: app-only components, app-only animations, framework-integration rules (xyflow, Firebase Auth), and the app's broader UX register.

When the marketing site (`DESIGN.md`) and this doc disagree on a shared token, the bug is one of them is out of sync — they MUST land in lockstep.

---

## 1. Purpose & audience

`apps/workflow-engine/frontend/react/` is the reference deployment behind `https://app.openwop.dev/`. It exists so protocol implementers and evaluators can exercise the v1 wire contract without cloning the repo — workflow building, run lifecycle, SSE event streaming, HITL interrupts, capability discovery, BYOK paste-and-run.

Visual register: **the same editorial-technical voice as the marketing site**, applied to an interactive surface. Where the marketing site is read once, the app is operated. Editorial discipline applies to chrome, navigation, headings, status, and labels; the workflow canvas is allowed denser geometric tooling.

---

## 2. Token sync

The `:root` block in `src/styles/global.css` carries:

| Block | Source of truth | Sync rule |
|---|---|---|
| Shared editorial palette (`--paper`, `--ink`, `--rule`, `--clay`, `--star-glow`, type triple) | `DESIGN.md §4` + `public/styles.css :root` | **MUST stay identical**; change both in one commit. The CSS file carries a `SYNC RULE` comment block above `:root` |
| Warm-dark override (`@media (prefers-color-scheme: dark)`) | `DESIGN.md §9.1` (deferred — informative) | Not wired today; lands across all three surfaces in one release |
| App-functional tokens (`--color-success` / `--color-warning` / `--color-danger`) | This doc, §3 | App-only; not mirrored to marketing site |
| Legacy app aliases (`--color-bg`, `--color-surface`, `--font-sans`, …) | This doc, §4 | Transitional. Shrinks over time as references migrate to canonical names |
| App geometry (`--radius`, `--space-1..6`, `--radius-bubble`, etc.) | This doc | App-only |

The marketing site has no `--color-success` etc.; the app needs them because it surfaces run states. Status colors are **functional, not brand**.

---

## 3. App-functional tokens

```css
--color-success: oklch(62% 0.13 145);   /* desaturated forest, on-paper safe */
--color-warning: oklch(72% 0.14 75);    /* warmer amber, neighbour of --star-glow */
--color-danger:  oklch(55% 0.16 28);    /* muted brick red */
--color-ai:      oklch(60% 0.12 280);   /* indigo for the AI node category and the "pipeline" template badge; distinct from clay (flow) and the success/warning/danger triad */
--scrim:         rgb(0 0 0 / 0.6);      /* modal backdrop; intentionally neutral on either theme */
```

Rules:

1. **Use functional tokens only for run-state semantics.** A button doesn't get `--color-danger` for emphasis — it gets clay. `--color-danger` is reserved for `RunStatus = failed | cancelled`, error banners, and the destructive secondary state of confirm dialogs.
2. **Status colors will lift in dark mode when it lands** (DESIGN.md §9.2 invariant 4): success → `oklch(72% 0.14 145)`, warning → `oklch(80% 0.14 75)`, danger → `oklch(65% 0.16 28)`, ai → `oklch(70% 0.12 280)`. Keep the chroma; lift the luminance. The lifted values are not in the stylesheet today because dark mode is deferred (`DESIGN.md §9`).
3. **Never use a status color as a background fill at body weight.** Surface as an icon, a dot, a label, or a hairline. Backgrounds compete with `--paper`.

---

## 4. Legacy aliases (transitional)

The app's pre-migration tokens are aliased to the shared palette:

```css
--color-bg:           var(--paper);
--color-surface:      var(--paper);
--color-surface-2:    var(--paper-2);
--color-border:       var(--rule);
--color-text:         var(--ink);
--color-text-muted:   var(--ink-3);
--color-accent:       var(--clay);
--color-accent-hover: oklch(54% 0.13 40);
--font-sans:          var(--sans);
--font-mono:          var(--mono);
```

These exist so the Phase A token swap is atomic — every existing component keeps rendering. **Subsequent phases migrate references off the aliases:** `var(--color-bg)` → `var(--paper)`, `var(--color-text)` → `var(--ink)`, `var(--color-accent)` → `var(--clay)`. When zero references remain to a given alias, delete the alias.

Do not add new references to the alias block. Net new code uses canonical names.

---

## 5. Components — app-specific canonical list

Cross-surface components (`.btn`, `.marker`, etc.) live in `DESIGN.md §6`. The list below is app-only.

| Class | Purpose | Notes |
|---|---|---|
| `.app-shell` | top-level flex column wrapper | min-height 100vh |
| `.app-header` | sticky app nav | 64px tall; ink on paper; matches `.topbar` register from the marketing site |
| `.app-main` | scrollable content region under `.app-header` | inherits `--paper` |
| `.app-footer` | minimal footer | mono attribution, paper |
| `.card` | generic surface card | border-only via `--rule`; no shadow; hover tint `--clay-wash`; matches `.compare-card` register |
| `.status-badge` + `.completed` / `.failed` / `.cancelled` / `.running` variants | run-state pill | mono label; functional color from §3; no fill — color on `--paper-2` |
| `.muted` | low-emphasis text | `var(--ink-3)`; mono OR sans depending on context |
| `.secondary` | secondary button surface | matches `.btn-ghost` register |
| `.chat-feed` + `.message-bubble.user` / `.message-bubble.assistant` | chat surfaces | bubble: clay for user, paper-2 for assistant; metadata rendered in mono `--ink-3` |
| `.workflow-canvas` | xyflow wrapper | sets a `:where(.react-flow)` scope for token overrides (see §7) |
| `.interrupt-card` | HITL interrupt surface | matches `.compare-card` register; clay-rule top border to mark "action required" |
| `.byok-wizard` | BYOK step-through | progressive disclosure; `<abbr>`-expand acronyms per step per DESIGN.md §2 |
| `.signin-button` (Google / GitHub variants) | auth chrome | wraps vendor brand SVG marks; container is ink-on-paper; **brand marks themselves are never re-colored** (DESIGN.md §13) |
| `.demo-host-banner` | "you're on the demo host" banner | clay-wash background, mono marker, dismissible |
| `.env-chip` + `.env-chip-{info,warning,danger,muted}` | envelope-events timeline chip (RFC 0030/0031/0032/0033) | left rule-rail tinted with the variant's functional token; mono `.env-chip-tag` color matches; body in ink-2; pill / quote / detail sub-elements stay paper-on-paper to keep the bubble calm when chips stack |
| `.envelope-events` | the in-bubble timeline wrapper holding stacked `.env-chip` rows | column flex with 6px gap; sits between `MessageRenderer` and `AgentEventCards` inside `MessageBubble` |
| `.reasoning-disclosure` | RFC 0030 §A `<details>` for the `envelope.payload.reasoning` string | distinct from `ThoughtsDisclosure` — uses an `ⓘ` info glyph (vs `…` ellipsis), dashed top divider, AI-coloured left-bar on the open body |
| `.prompt-tier-one-chip` | Tier-1 subset finding on a schema-hint prompt (RFC 0030 §B) | warning-tinted mono chip; appears on the prompt-list-item card; pairs with a banner above the list when `capabilities.envelopes.tierOneSubsetCompliance` is `strict` / `warn` |

### 5.1 Shared UI primitives — the cross-surface cohesion layer (`src/ui/`)

These exist so the three product surfaces (Agents, Workflows, Kanban) read as **one** product instead of three bolted-together apps. The failure mode they fix: a surface reimplementing a card/chip/notice with inline styles + hardcoded hex that bypass the token layer. Defined once in `global.css`, plus two React primitives in `src/ui/`. **Reach for these before hand-rolling an inline-styled widget.**

| Class / Component | Purpose | Notes |
|---|---|---|
| `.surface-card` | the one list/dashboard card primitive | clone of `.workflow-card`: `--color-surface` bg, `--rule` border, `--radius`, `--space-3 --space-4` padding, hover → `--clay` border / `--paper-2`, `:focus-visible` ring. Navigational cards render as `<a>` / `<Link>` so keyboard + semantics come free |
| `.card-grid` | responsive card grid | `repeat(auto-fill, minmax(280px, 1fr))`, `--space-3` gap, single column ≤ 640px |
| `.action-bar` | button-cluster wrapper | flex + wrap + `--space-2` gap; the one way to group Open / Run / Delete actions so they read as parallel |
| `.btn-sm` | small button size | 12px / `--space-1 --space-2`; replaces ad-hoc inline `fontSize` on buttons |
| `.chip` + `.chip--{success,warning,danger,accent,ai,muted}` | status / source / label chips | 12px pill; color families are token-driven (no hex); pairs a Lucide icon + text label so color is **never** the sole signal (§11) |
| `.ui-input` | text-input baseline | `--space-2 --space-3` padding, `--rule` border, `--radius`; opt-in class (avoids regressing the many bare `<input>`s elsewhere) |
| `.state-card` + `<StateCard>` (`src/ui/StateCard.tsx`) | empty / loading / error block | dashed border, optional Lucide `icon`, title, one-line body, and **one** next-action CTA. Every empty state MUST name its single next action |
| `<Notice variant=success\|error\|info\|warning>` (`src/ui/Notice.tsx`) | transient notice | renders `.alert.{variant}` + a leading Lucide icon + `role="status" aria-live="polite"` — never bare colored text, never a hardcoded hex, never a `⚠`/`✓` emoji prefix |
| `<KanbanBoardView>` (`src/kanban/KanbanBoardView.tsx`) | the ONE Kanban board renderer | shared by `/boards` (KanbanPage) and the embedded agent-workspace Board tab. @dnd-kit drag-and-drop (pointer + keyboard sensor) + rich cards (source chip, workflow name, priority, run link) + trigger-lane affordance. A surface MUST NOT reimplement a second board |

Global focus ring: `button`, `button.secondary`, `select`, `input`, `textarea`, `[role=button]`, and `.surface-card` all receive `outline: 2px solid var(--color-accent); outline-offset: 2px` on `:focus-visible` (one block in `global.css`). New interactive elements inherit it.

Half-step spacing tokens: `--space-1-5: 6px` and `--space-2-5: 10px` cover the genuine micro-gaps authors reach for; **all** spacing still comes from the `--space-*` set — never inline a raw rem.

### 5.2 Iconography — the app-wide Lucide icon set (`src/ui/icons`)

- **One icon vocabulary.** Every UI icon is an inline-SVG component adapted from Lucide (Apache-2.0) under `src/ui/icons/`, re-exported from `src/ui/icons/index.ts`. Props: `{ size?: number; strokeWidth?: number; style?: CSSProperties }` (`CircleIcon` adds `filled?`). Icons render `stroke="currentColor"`, so they inherit the surrounding text color — place them in a span with the desired color, or where the color already applies.
- **No emoji as UI icons — anywhere.** An emoji rendered as a decorative/affordance glyph is a bug; use a component from `ui/icons`. Add a new icon by copying an existing `<Name>Icon.tsx`, pasting the Lucide path, and re-exporting from `index.ts`. **Exempt** (these are not icons): prose mentions of a symbol (e.g. "drop a card into a ⚡ trigger lane" describing the column's `ZapIcon`), keyboard-shortcut hints (`⌘`, `⌗`), ASCII-art diagrams, and bullets (`•`).
- **Canonical mappings** (the vocabulary): status `✓`/`✕`/`⏸`/`●`/`○` → `Check`/`X`/`Pause`/`Circle`(`filled` for ●); disclosure `▸`/`▾` → `ChevronRight`/`ChevronDown`; back-links `←` → `ArrowLeft`; feedback `👍`/`👎`/`🚩` → `ThumbsUp`/`ThumbsDown`/`Flag`; `🔧`/`🛠` → `Wrench`; `🔒` → `Lock`; `✎` → `Pencil`; `🗑` → `Trash`; `⚙` → `Settings`; `ⓘ` → `Info`; `📎` → `Paperclip`; `📋` → `Clipboard`; `💾` → `Save`; `⚖` → `Scale`; `💭` → `MessageSquare`; `☰` → `Menu`; `↻` → `RotateCw`; `↶`/`↷` → `Undo`/`Redo`; `⚡` → `Zap`; `▶` → `Play`; the workflow glyph → `Workflow`; `🧠` → `Sparkles`.
- **Brand / vendor marks are exempt and never re-colored** — the OpenWOP robot, the Google `g`, the GitHub octocat (see §8 and DESIGN.md §13).

### 5.3 Status → chip semantics

Run / agent / node status is rendered as a chip (color **and** label — never color alone, §11), mapped centrally rather than per-component:

- Agent + run status → a `.chip--*` via `agents/agentViewModel.ts` `statusMeta`: active → `chip--success`, working/running → `chip--accent`, waiting/paused → `chip--warning`, needs-setup/failed/cancelled → `chip--danger`.
- Node-canvas run status uses the §3 functional tokens on `.builder-node*` badges paired with a Lucide glyph (`CircleIcon filled` / `Check` / `X` / `Pause`), color via `var(--color-warning/success/danger/ai)`.
- **Severity reuses the same functional tokens.** A task's priority is a severity signal, not a run state, but it lives on the same axis: a `High`-priority card uses `chip--danger` (always with the visible "High" label, §11). This is the one sanctioned reuse of a functional token outside run state — do not extend it to non-severity dimensions (role, source, owner), which differentiate by glyph/label instead (§5.2, §5.4).

Do not invent a per-surface status palette; reuse these mappings so a "completed" state looks identical everywhere.

### 5.4 Role glyphs — differentiate by icon, never by color

A roster of named coworkers must read at a glance, but role is **not** a run-state, so it does not earn a functional/accent color (§3 reserves those for status). Differentiation is therefore by **Lucide glyph only**, mapped centrally in `agents/roleTemplates.ts` (`roleThemeForKey` / `roleThemeForAgent`): `sales-ops → Briefcase`, `support-triage → LifeBuoy`, `finance-ops → Scale`, `engineering-ops → Wrench`, `marketing-ops → Megaphone`, custom/unknown → `Bot`. The glyph rides as a small bordered badge on the otherwise-uniform clay avatar (dashboard card + workspace header) and inline on the create-agent role picker. The role key is derived from the seeded `host:demo-<key>` agentRef, else inferred from the workflow portfolio. Do not give a role its own accent color or avatar tint.

When adding a new app-specific component:

1. Add a row here.
2. Cite the marketing-site register it borrows from (`.compare-card`, `.proof-card`, `.pack`, `.start`).
3. Use only shared tokens for color/type/spacing.
4. No shadows heavier than the marketing site's `.terminal`; no gradients that compete with paper.

---

## 6. Animations

The app animates more than the marketing site because it shows live activity. Discipline:

| Keyframe | Purpose | Constraint |
|---|---|---|
| `openwop-pulse` | "live / streaming" indicator (opacity 0.2 → 0.8 → 0.2) | duration 1.6s–2.4s; opacity only |
| `openwop-mic-pulse` | recording / capturing prompt | box-shadow ring using `--color-danger` alpha; ≤ 6px ring radius |

Rules:

1. **All animations MUST honor `prefers-reduced-motion: reduce`.** The shared rule in `global.css` zeroes durations.
2. No animation drives a state change (e.g., do not animate a card *into* the success state — set the state, animate the badge once and stop).
3. New keyframes are app-only unless they are also added to `DESIGN.md §11`.

---

## 7. xyflow (workflow canvas) theming

`@xyflow/react` ships its own CSS. The app scopes overrides to `.builder-canvas` (matches the wrapper class in `src/builder/canvas/BuilderCanvas.tsx`) and uses xyflow's canonical CSS-variable surface plus a few direct selector overrides where the variable surface doesn't reach:

```css
.builder-canvas {
  --xy-background-color-default: var(--paper);
  --xy-background-pattern-color-default: var(--rule-2);
  --xy-edge-stroke-default: var(--ink-2);
  --xy-edge-stroke-selected-default: var(--clay);
  --xy-handle-background-color-default: var(--clay);
  --xy-handle-border-color-default: var(--paper);
  --xy-controls-button-background-color-default: var(--paper);
  --xy-controls-button-background-color-hover-default: var(--clay-wash);
  --xy-controls-button-color-default: var(--ink);
  --xy-controls-button-border-color-default: var(--rule);
}
```

Direct selector overrides cover the rest:

- `.builder-canvas .react-flow__edge-path` — `stroke: var(--ink-2); stroke-width: 1.5;`
- `.builder-canvas .react-flow__edge.selected .react-flow__edge-path` — `stroke: var(--clay); stroke-width: 2;`
- `.builder-canvas .react-flow__controls` — paper background, rule border, 2px radius, ink-shadow
- `.builder-canvas .react-flow__handle` — 12×12 clay disc with a 2px paper border (the "port" affordance)

Node-internal styling (the React component each `<Handle>` renders inside) uses app tokens directly via `.builder-node*` classes. Port labels render in `--mono` at 10px / 0.04em. Node body uses `--sans`.

Background: dotted grid using `var(--rule-2)`. **Never** the default cool-gray grid.

---

## 8. Firebase Auth chrome

The Google + GitHub sign-in buttons embed vendor brand SVGs. DESIGN.md §13 invariant:

- **Vendor brand SVG marks are never re-colored.** Use the exact Google `g` mark + the GitHub octocat in their canonical fills.
- The surrounding `.signin-button` container chrome (border, label, focus ring) follows the app's editorial register: `border: 1px solid var(--rule)`, `background: var(--paper)`, `color: var(--ink)`, `font-family: var(--sans)`.
- "Continue with Google" / "Continue with GitHub" label uses `--sans` weight 500.

---

## 9. BYOK wizard editorial pass

The BYOK wizard is a credibility moment for the protocol — the user is pasting a model-provider key and trusting the host's session-scoping promise. Visual register:

- One panel per step (paste, validate, confirm, succeed).
- First-occurrence acronyms expand per panel via `<abbr title="…">` (DESIGN.md §2): **BYOK**, **KMS**, **HMAC**.
- Status uses functional tokens (§3); the "secret accepted" success state is a single clay accent dot + body confirmation, NOT a green checkmark fill.
- Copy is third-person factual ("Keys live in-session and are redacted from event payloads"), not first-person ("we promise we won't store this").

---

## 10. Inline-style policy

DESIGN.md §10/§11 ban `style="…color/font…"` in HTML. The same rule applies to React's `style={{}}` prop — with the carve-outs below:

- **Geometry MAY remain inline** (`gridTemplateAreas`, `transform: translate(...)`, `gridColumn`, `top` / `left` for absolute-positioned coordinate-driven UI, `gap`, `padding`, `display`).
- **Component-local typographic scale MAY remain inline as literal `fontSize` values** in the 10–14px range (`fontSize: 10`, `fontSize: 11`, `fontSize: 12`). These are geometry, not brand, and tracking them through a className utility table adds noise without buying themability. ~97 such residuals live in the chat module and are deliberately allowed.
- **Token-referenced font-family is allowed inline** (`style={{ fontFamily: 'var(--mono)' }}` / `'var(--serif)'` / `'var(--sans)'`). The *value* is a token (themeable) even though the *placement* is inline. Literal font-family strings (`fontFamily: 'JetBrains Mono'` etc.) are still banned.
- **Color / background MUST be className-driven** through global.css, OR pass a token reference through inline `style` (`style={{ background: 'var(--clay-soft)' }}` is allowed because the value is a token; `style={{ background: '#5b8cff' }}` is not).
- **Dynamic per-event tinting** (e.g., a node that shifts hue with a metric, or a category accent that varies per `entry.kind`) goes through a CSS custom property set inline (`style={{ '--metric-tint': value }}`) and consumed by a className, OR a token reference forwarded inline (`style={{ background: entry.accent }}` where `entry.accent` is `var(--color-ai)` etc.). Literal hex / rgb / OKLCH values are not allowed in the dynamic-tint path.

Lint gates:

- `grep -rEn "#[0-9a-fA-F]{3,6}" src/` MUST return 0 hits (zero hex literals anywhere in TS/TSX). Post-Phase-E bar: enforced.
- `grep -rEn "style=\{\{[^}]*(color|background)[^}]*[\"'](?!var\()" src/` MUST return 0 hits (no literal color values inline). Post-Phase-E bar: enforced.
- `grep -rEn "style=\{\{[^}]*(color|background|font)" src/` shows the residuals allowed by the carve-outs above; should be reviewed but not blocked.
- **No emoji as UI icons (§5.2).** A scan for emoji rendered as icons in JSX (excluding comments, prose, keyboard hints, ASCII art) MUST be empty — use `ui/icons`. Practical scan:
  ```bash
  # rendered decorative glyphs in non-comment lines; expect 0 (prose ⚡ excepted)
  python3 - <<'PY'
  import os,re
  icons=set('👍👎🚩🔒🗑🔧🛠🧠💭📋📎📷💾☰▶▸▾◉●○⏸⚙✋⚖↻↶↷✓✗✕✎ⓘ')
  for r,_,fs in os.walk('src'):
      if 'ui/icons' in r: continue
      for f in fs:
          if not f.endswith(('.tsx','.ts')) or '.test.' in f: continue
          for i,l in enumerate(open(os.path.join(r,f)),1):
              s=l.strip()
              if s.startswith(('//','*','/*')): continue
              for c in l:
                  if c in icons: print(f"{r}/{f}:{i}: {c}")
  PY
  ```

---

## 11. Accessibility (inherits DESIGN.md §7, plus app-specific)

In addition to the marketing-site rules:

- Run-status badges MUST NOT communicate state by color alone. Always pair the color with a text label OR a glyph.
- Chat bubbles MUST have a `role="log"` ancestor and announce new entries via `aria-live="polite"`.
- Interrupt cards MUST trap focus into the response form on render; releasing focus is contingent on submission or dismissal.
- xyflow canvases MUST expose keyboard navigation; if vendor defaults are insufficient, add app-level handlers.
- Firebase popup auth flows MUST surface a visible "still signing in…" status if the popup is closed mid-flow.

---

## 12. Component checklist for any new app addition

Before merging a PR that introduces a new app component:

- [ ] New class added to §5 (app components) OR DESIGN.md §6 (if it's cross-surface)
- [ ] Reuses the §5.1 cohesion primitives (`.surface-card` / `.chip` / `.action-bar` / `.btn-sm` / `<StateCard>` / `<Notice>`) instead of a bespoke inline-styled card/chip/notice
- [ ] Icons come from `ui/icons` (§5.2) — **no emoji as icons**
- [ ] Status is shown as a labeled chip, never color alone (§5.3 / §11)
- [ ] Uses only shared tokens (canonical names) + app-functional tokens for color/type/spacing
- [ ] No hard-coded hex / OKLCH literal in component CSS
- [ ] No inline `style={{}}` for color/font (geometry OK)
- [ ] Has `:focus-visible` keyboard reachability
- [ ] Renders correctly under `prefers-color-scheme: dark` when that override lands (deferred today — see DESIGN.md §9)
- [ ] Has a documented breakpoint behavior for ≤760px
- [ ] All animations honor `prefers-reduced-motion`
- [ ] Acronyms expand on first appearance per panel

---

## 13. Related files

- `DESIGN.md` — marketing-site standards + shared tokens
- `apps/workflow-engine/frontend/react/src/styles/global.css` — the lone stylesheet (tokens, the §5.1 cohesion layer, focus ring, `.alert.*`, `.status-badge`)
- `apps/workflow-engine/frontend/react/src/ui/` — shared primitives: `Notice.tsx`, `StateCard.tsx`, and `icons/` (the §5.2 app-wide Lucide set)
- `apps/workflow-engine/frontend/react/src/kanban/KanbanBoardView.tsx` — the one shared drag-and-drop board
- `apps/workflow-engine/frontend/react/index.html` — Google Fonts link
- `apps/workflow-engine/DEPLOY.md`, `DEPLOY-SMOKE.md` — deployment + smoke
- `.claude/skills/ux-review/SKILL.md` — the review skill that enforces this doc (Mode A, app surface)

---

## 14. Open standards we follow

Same as DESIGN.md §16: WCAG 2.2 AA, OKLCH, `prefers-reduced-motion` / `prefers-color-scheme` / `prefers-contrast`, RFC 2119 keyword discipline in any normative app prose (e.g., the `/privacy` page).
