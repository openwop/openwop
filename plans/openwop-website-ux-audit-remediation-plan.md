# OpenWOP Website — UX Audit Remediation Plan

> Companion to the 2026-05-23 UX/UI audit of `openwop.dev`. Each section below is
> sequenced for execution, scoped, and traceable back to a numbered audit finding
> (C# = Critical, H# = High, M# = Medium, L# = Low). Estimates are calendar-time
> for one focused contributor; many items can be parallelized.
>
> **How to read this plan.** Phase 0 is a "stop-the-bleed" credibility pass —
> nothing here requires design or content review and most items are single-line
> edits. Phases 1–3 stage the larger structural and governance work behind it.
> Phase 4 is the strategic surface-area expansion that takes OpenWOP from
> "elegant product site" to "credible public standard."
>
> **Status legend.** `[ ]` = not started · `[~]` = in flight · `[x]` = done ·
> `[-]` = deferred (with rationale).

---

## Phase 0 — Credibility quick wins (target: < 1 day)

These changes have zero design or governance risk and remove the most obvious
trust-defeating signals before any other work lands. Land as a single PR titled
`site: credibility quick-wins (UX audit phase 0)`.

### 0.1 Remove AI-codegen attribution everywhere · C1, L31

- [ ] Delete the `<span>Built with Claude Code</span>` line from
      `@/Users/david/dev/openwop/public/index.html:1841`.
- [ ] Grep the rest of `public/` for the same string and delete each instance
      (`public/for/*/index.html`, `public/governance/index.html`,
      `public/security/index.html`, every other subpage uses the same footer
      template).
- [ ] Grep the build / template source under `site/templates/` and
      `scripts/build-*.{mjs,sh}` for the same string; remove at the template
      level so it does not regenerate.
- [ ] Grep `*.md` docs (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`) for the
      same phrase; remove or replace with a neutral acknowledgement if it is
      load-bearing somewhere.

**Acceptance:** `rg -i "built with claude"` returns zero hits in `public/`,
`site/`, and root markdown.

### 0.2 Fix social-handle and contact metadata · C2, C3

- [ ] Remove any references to `security@openwop.ai`, and any RFC that references it. 
      That email address doesn't exist and there ins't a replacement email address.

**Acceptance:** `rg -F "openwop.ai" public/` shows zero hits
unless the rationale is documented in-line.

### 0.3 Honest-label the conformance / hosts claim · C4, C5, M24

- [ ] Update the "Running today" card at
      `@/Users/david/dev/openwop/public/index.html:455-459` from
      `5 hosts in the leaderboard / 4 reference hosts · 1 third-party` to
      `5 hosts measured / 4 reference + 1 sibling project (vendor.myndhyve)`.
- [ ] In the comparison table at
      `@/Users/david/dev/openwop/public/index.html:1564-1568`, change
      `5 hosts` under "Multiple independent implementations" to
      `4 reference + 1 sibling` and add a footnote: "Sibling = same maintainer
      org. A genuinely independent host is tracked under
      `ROADMAP.md` → Independent-implementation tripwire."
- [ ] On `/conformance/`, hide the In-memory row that currently shows `—`
      across all columns, or move it to a "Not measured this round" sub-table.
- [ ] Add a single-line "How to submit your host to the leaderboard" CTA at
      the top of `/conformance/` linking to `INTEROP-MATRIX.md` and the
      conformance suite README.

**Acceptance:** No string `5 hosts` appears anywhere on the site without a
neighbor sentence explaining the 4+1 breakdown.

### 0.4 Soften the `FINAL v1` framing · C6

- [ ] Replace `v1.1 FINAL specification` at
      `@/Users/david/dev/openwop/public/index.html:472` with
      `v1.1 stable · additive`.
- [ ] In `/spec/v1/index.html`, replace per-doc `FINAL v1` badges with
      `Stable · v1.1` (regenerate via the build script, do not hand-edit).
- [ ] Add a new top-of-`/rfcs/` paragraph: "v1.1 is the stable wire contract;
      RFCs at Draft / Active target v1.2 (additive) unless explicitly labelled
      `Safety fix` per `COMPATIBILITY.md` §3."
- [ ] Update `CHANGELOG.md` and `README.md` to use the same vocabulary.

**Acceptance:** No occurrence of `FINAL` as a status on any public page. The
status vocabulary documented on `/spec/v1/` matches what each doc actually
shows.

### 0.5 Delete internal artifacts from the public spec build · L (new)

- [ ] Remove `public/spec/v1/V1-FINAL-COMPLETION-PLAN.html` from the build
      output. Either gate the corresponding markdown behind an `internal/`
      directory or add it to the build's exclude list.

**Acceptance:** `curl -I https://openwop.dev/spec/v1/V1-FINAL-COMPLETION-PLAN.html`
returns 404.

### 0.6 Accessibility one-liners · H, M21, M22

- [ ] Add to `public/styles.css`:
      ```css
      @media (prefers-reduced-motion: reduce) {
        .pulse, animateMotion { animation: none !important; display: none; }
        .flow-path { stroke-dasharray: none; }
      }
      ```
- [ ] Audit `--ink-3` and `--clay` against `--paper` with a contrast checker
      (Stark, axe, or `npx pa11y`); for any pair < 4.5:1 at body sizes, bump
      the token or restrict use to ≥ 14 px.
- [ ] Add `aria-current="page"` wiring in `main.js` for the subnav links so
      screen-reader users get position context.

**Acceptance:** `npx pa11y https://openwop.dev/ --standard WCAG2AA` returns 0
errors on the homepage; manual reduced-motion check shows static diagrams.

### 0.7 Hero CTAs (copy only) · H7, H10

- [ ] Move `meta-row` (Apache 2.0 / wire contract / Conformance tested / SDKs)
      directly under the headline as a status pill row.

### 0.8 Footer `Built with Claude Code` removal smoke test

- [ ] After 0.1–0.8 land, run `npm run openwop:check` (or the build's
      equivalent) plus the link-checker; verify nothing else was broken by
      the touch-up.

---

## Phase 1 — Information architecture & navigation (target: 2–4 days)

Restructures the top nav, footer, and a few orphan pages to put
standards-credibility surfaces in front of evaluators.

### 1.1 Top-nav rewrite · H8, M15, L28

#### Desktop (≥ 760 px)

- [ ] Replace the top nav (`@/Users/david/dev/openwop/public/index.html:120-127`)
      with two dropdowns flanked by direct links:
      ```
      Quickstart   Protocol ▼   Implement ▼   Community   Changelog   GitHub →
      ```
- [ ] **`Protocol ▼`** dropdown groups the standards-body surfaces:
      - `Spec` → `/spec/v1/`
      - `Conformance` → `/conformance/`
      - `RFCs` → `/rfcs/`
      - `Governance` → `/governance/`
      - `Security` → `/security/`
      - `Roadmap` → `/roadmap/`
      Anchor target (the dropdown label itself, when clicked) lands on a new
      `/protocol/index.html` summary page that lists each surface in one
      paragraph each.
- [ ] **`Implement ▼`** dropdown groups the four audience landings:
      - `Workflow authors` → `/for/workflow-authors/`
      - `Host implementers` → `/for/host-implementers/`
      - `Pack authors` → `/for/pack-authors/`
      - `Production evaluators` → `/for/production-evaluators/`
      Anchor target lands on `/implement/index.html` (see §1.4).
- [ ] Dropdown behaviour: open on hover **and** on click/Enter/Space; close
      on `Escape` or focus-out; first item receives focus on keyboard open.
      Mark the trigger with `aria-haspopup="menu"` and toggle
      `aria-expanded`. Mark the menu with `role="menu"` and items with
      `role="menuitem"`.
- [ ] Highlight the active section in the nav: when the current URL is
      under `/spec/`, `/conformance/`, `/rfcs/`, `/governance/`, `/security/`,
      or `/roadmap/`, mark the `Protocol ▼` trigger with
      `aria-current="true"` and a visual underline. Same rule for
      `Implement ▼` over `/for/*` and `/implement/`.

#### Mobile (< 760 px)

- [ ] Replace the inline `topnav` with a hamburger button on the right side
      of the top bar:
      - Button: `<button class="nav-toggle" aria-label="Open menu"
        aria-controls="site-menu" aria-expanded="false">`. Icon is a
        three-bar SVG; toggles to a close (`×`) glyph when open.
      - Hide the desktop `topnav` at `< 760 px` via CSS; show only the
        hamburger.
- [ ] Drawer: full-height slide-in panel from the right (`width: min(320px,
      85vw)`), backed by a dimmed scrim that closes on tap. Drawer is
      `<nav id="site-menu" role="dialog" aria-modal="true"
      aria-label="Site navigation">`.
- [ ] Drawer structure (flat, no nested dropdowns — the desktop dropdowns
      become labelled groups):
      ```
      ┌─────────────────────────────┐
      │ OpenWOP        [×] close    │
      ├─────────────────────────────┤
      │ Quickstart                  │
      │                             │
      │ PROTOCOL                    │
      │   Spec                      │
      │   Conformance               │
      │   RFCs                      │
      │   Governance                │
      │   Security                  │
      │   Roadmap                   │
      │                             │
      │ IMPLEMENT                   │
      │   Workflow authors          │
      │   Host implementers         │
      │   Pack authors              │
      │   Production evaluators     │
      │                             │
      │ Community                   │
      │ Changelog                   │
      │                             │
      │ ─────────────────────────── │
      │ GitHub →                    │
      └─────────────────────────────┘
      ```
      Group headings (`PROTOCOL`, `IMPLEMENT`) are `<h3>` with
      `text-transform: uppercase; letter-spacing: .12em; font-size: 11px;
      color: var(--ink-3);`.
- [ ] Interaction:
      - Open: click hamburger → drawer slides in (250 ms ease-out), scrim
        fades in, focus moves to first focusable element (close button).
      - Close: tap close button, tap scrim, press `Escape`, or activate any
        link. Focus returns to the hamburger trigger.
      - Trap focus inside the drawer while open; restore body scroll-lock
        with `overflow: hidden` on `<html>`.
      - Honour `prefers-reduced-motion: reduce` — drawer appears instantly,
        no slide animation.
- [ ] All drawer interaction lives in `public/main.js`; no framework. Keep
      the JS surface ≤ ~60 lines.

#### Cross-cutting

- [ ] Apply the same nav (desktop + mobile) to every subpage template under
      `public/` and `site/templates/page.html`. Audit every existing subpage
      for divergence from the canonical template.
- [ ] Update the static fallback in `public/404.html` so the nav still works
      on error pages.
- [ ] Add a CSS-only fallback for users with JS disabled: the hamburger
      button is a `<details><summary>` that expands the drawer in-flow
      (less polished but functional).

**Acceptance:**
- Every public page exposes `Protocol`, `Implement`, and `Community` from
  the top nav at ≤ 1 click on desktop, ≤ 2 taps on mobile.
- Keyboard-only navigation can reach every nav item in tab order, open
  each dropdown with Enter/Space, and dismiss with Escape.
- `npx pa11y https://openwop.dev/` reports zero new accessibility errors
  on the nav.
- Mobile drawer passes a manual screen-reader smoke test (VoiceOver iOS
  or TalkBack) — group labels announced, focus trapped, scrim dismisses.

### 1.2 Create `/community/` · M15

- [ ] Author a new `/community/index.html` page using the existing subpage
      template (`spec-page-grid` + `spec-doc`). At minimum:
      - GitHub Discussions link (enable if not already).
      - GitHub Issues link with issue-template pointers.
      - Code of Conduct link.
      - Mailing-list / chat — either a live link (Discord / Matrix / Zulip)
        or a stub block titled "Real-time chat is on the roadmap; subscribe to
        Discussions for now."
      - Office-hours / RFC-comment-window cadence (lift from `GOVERNANCE.md`).
- [ ] Link from top nav and footer.

**Acceptance:** `/community/` resolves; the page lists at least 3 channels
even if 1 is "planned."

### 1.3 Create `/maintainers/` · M17

- [ ] Render `MAINTAINERS.md` as `/maintainers/index.html` via the existing
      markdown-to-HTML build. Show name, affiliation, scope of authority,
      lead-maintainer designation, and contact (GitHub handle).
- [ ] Cross-link from `/governance/`, footer "Project" group, and the
      `MAINTAINERS.md` repo file.

**Acceptance:** A reader can answer "who runs this project?" from one page in
< 30 s.

### 1.4 Create `/implement/` summary landing · L28

- [ ] New page that introduces the four `/for/<role>/` landings in one place
      with a one-paragraph teaser per role. Title: "Implementing OpenWOP."
- [ ] Set as the dropdown anchor target in the top nav.

**Acceptance:** Dropdown anchor target resolves; each card links to its full
landing.

### 1.5 Render `INTEROP-MATRIX.md` as `/adopters/` (or `/implementations/`) · M18

- [ ] Add a build step that converts `INTEROP-MATRIX.md` into
      `public/implementations/index.html`. Match the spec-doc subpage style.
- [ ] On the homepage, replace the raw GitHub link at
      `@/Users/david/dev/openwop/public/index.html:170, 1426, 1810` with the
      on-site URL.
- [ ] If/when external adopters land, split into `/adopters/` (consuming) vs.
      `/implementations/` (host implementers).

**Acceptance:** No homepage CTA points at a raw `github.com/.../INTEROP-MATRIX.md`.

### 1.6 Render OpenAPI + AsyncAPI on-site · M (new) / DX

- [ ] Mount Redoc (or Swagger UI) at `/api/rest/` over `api/openapi.yaml`.
      Existing build is at `public/api/rest/`; replace the static index with
      a Redoc page.
- [ ] Mount AsyncAPI React (or generated HTML via `@asyncapi/html-template`)
      at `/api/events/` over `api/asyncapi.yaml`.
- [ ] Add `/api/grpc/` with the rendered `.proto` doc (`protoc-gen-doc` or
      similar).
- [ ] Add all three to the footer "Specification" group.

**Acceptance:** A developer can read the request/response shapes without
opening raw YAML.

### 1.7 Footer hygiene · L28

- [ ] Reorder the footer "Project" column to: Roadmap · Changelog · FAQ ·
      Security · Governance · Maintainers · Contributing · Code of Conduct ·
      Watch releases.

**Acceptance:** Footer is shorter, alphabetized within each group, and free
of attribution clutter.

---

## Phase 2 — Homepage content restructure (target: 3–5 days)

Reduces visual length and improves the order in which an evaluator encounters
evidence. Should land as a single PR after Phase 1 nav is in place.

### 2.1 Subnav rewrite · H11

- [ ] On mobile (< 600 px), render the subnav as a `<select>` instead of a
      horizontal scroller.

**Acceptance:** Sub-nav fits on one row at 1280 px; no horizontal scroll on
mobile.

### 2.2 Spec table sanity · L29

- [ ] Replace every `<small>` inside the spec table at
      `@/Users/david/dev/openwop/public/index.html:1394-1436` with either a
      `<p class="row-detail">` or a `<details><summary>` block.
- [ ] Split the "Version" cell into two rows: a one-line status, and the
      multi-paragraph detail in a collapsible.

**Acceptance:** Screen-reader reads the row in one logical chunk; the row
height on desktop is ≤ 2x its current value.

### 2.3 Typography restraint · L27

- [ ] Reduce `<em>` italic usage in body copy. Stop using them
      as ambient texture.
- [ ] Sweep the homepage `block-lede` paragraphs and replace inline `<em>`
      with plain `<span>` where the italic adds no information.

**Acceptance:** Reduce use of `<em>` spans.

### 2.4 Section-marker consistency · L26

- [ ] Pick either `§ 01 / Specification` numbering everywhere, or "Where to
      start" plain labels everywhere. Apply uniformly.

**Acceptance:** Every section header uses the same labelling system.

### 2.5 Live-demo caveat · H14

- [ ] In the `§ 07 / Try it live` section, lift the "browser-session-scoped,
      24-hour reset" caveat into a tag pill *adjacent to* the
      `Open app.openwop.dev` button — not 2 paragraphs above it.

**Acceptance:** A user clicking the button has read the caveat in the same
visual chunk.

---

## Phase 3 — Spec / RFC / changelog readability (target: 3–5 days)

### 3.1 `/spec/v1/` reading order · M12, M19

- [ ] Add a "Start here" sidebar (or top-of-page card) that names 5 documents
      in reading order: `positioning`, `capabilities`, `run-options`,
      `stream-modes`, `webhooks`.
- [ ] Group the rest by section (Surface, Lifecycle, Agents, Packs,
      Conformance, Profiles); the build already groups but the grouping is
      too fine — collapse to 6 groups.
- [ ] Unify status badge format: `Stable · v1.1 · 2026-04-27` everywhere.
- [ ] Add a per-doc "Edit this page on GitHub" link (template change).

**Acceptance:** A first-time reader sees a "Read in this order" card above
the fold of `/spec/v1/`. Every doc page has an Edit link.

### 3.2 `/rfcs/` filter + grouping · M13

- [ ] Add client-side status filter (Draft / Active / Accepted / Withdrawn /
      Superseded) — no build change required, `main.js` toggles `display:none`.
- [ ] Add a topic column derived from the RFC title (Agent / Auth / Host
      capability / Conformance / Governance / Composition / Envelope / Other).
- [ ] Hide `RFC NNNN: <Title>` (the template) from the default view or label
      it explicitly `Template (not a real RFC)`.
- [ ] Add a search input that filters rows on title text.

**Acceptance:** A reader can answer "what RFCs are in flight on agent
identity?" in ≤ 3 interactions.

### 3.3 `/changelog/` chunking · M (new)

- [ ] Split the 1948-line single page into per-version anchors with a
      sticky "Latest release" card at the top and a left-rail version list.
- [ ] Confirm the build can regenerate from `CHANGELOG.md` without manual
      edits.

**Acceptance:** Loading `/changelog/` is < 1 s to first paint; jumping to a
specific release uses an anchor, not a Ctrl-F.

### 3.4 Versioned URLs · S (new), M19

- [ ] Introduce `/spec/v1.1/` as the canonical URL; redirect `/spec/v1/` →
      `/spec/v1.1/` (or vice versa, whichever the build prefers) via the
      Firebase hosting rewrites in `firebase.json`.
- [ ] Add a `/spec/latest/` alias that always points at the newest stable
      version.
- [ ] Add a per-doc "Other versions" link slot in the template (empty until
      v1.2 lands).

**Acceptance:** Reader can pin a URL to `/spec/v1.1/run-options.html` and
have it survive when v1.2 ships.

### 3.5 Per-doc status discipline · S4 (new)

- [ ] Introduce a 4-tier status vocabulary: `Stable` / `Stabilizing` /
      `Draft` / `Experimental`. Document at `/governance/spec-status.html`.
- [ ] Apply consistently across `spec/v1/*.md` front-matter; regenerate the
      site.
- [ ] Stop using `FINAL` as a status anywhere.

**Acceptance:** Every doc page shows exactly one of the four statuses.

---

## Phase 4 — Strategic credibility surface (target: 2–8 weeks)

These items move OpenWOP from "elegant site" to "credible standard." Each is
larger than a quick win and several have external dependencies (a third-party
contributor, an audit firm, a working-group ratification vote).

### 4.1 Spec versioning & changelog automation · S (new)

- [ ] Wire `/changelog/` rendering to fire automatically when `CHANGELOG.md`
      changes.
- [ ] Wire the spec build so that a future `spec/v1.2/` directory triggers a
      `/spec/v1.2/` URL plus a `/spec/latest/` redirect update with no
      hand-edits.

**Acceptance:** A maintainer can ship a spec version bump in a single PR
without touching site templates.

---
