---
name: ux-review
description: Multi-mode review for openwop user-facing surfaces. **Marketing-site mode** audits `../openwop-site/public/index.html`, `styles.css` and `main.js` against `../openwop-site/DESIGN.md` (typography, color tokens, spacing, components, a11y, localization, light/dark, mobile breakpoints, no hard-coded values). **App-UI mode** audits the reference app `../openwop-app/frontend/react/src` against `../openwop-app/DESIGN.md` — the shared `ui/` cohesion layer (`.surface-card`/`.chip`/`.action-bar`/`<Notice>`/`<StateCard>`), the `ui/icons` Lucide set + no-emoji-as-icons rule, status→chip semantics, the inline-style/token policy, and app a11y. **Spec-prose mode** audits `spec/v2/`, `RFCS/`, `README.md`, `CHANGELOG.md`, `INTEROP-MATRIX.md`, `ROADMAP.md`, `docs/` for RFC 2119 discipline, status lines, normative ownership, link integrity, doc-index drift, and SECURITY / PUBLISHING honesty; v2 readability itself is delegated to `/spec-readability` and `scripts/check-spec-readability.mjs`.
---

# UX Review (openwop)

This skill runs in three modes. Pick the one that matches what changed, or run several if the change spans surfaces.

## Mode selection

```bash
# Marketing-site mode (Mode A): changes in the openwop-site checkout
git -C ../openwop-site diff --name-only origin/main...HEAD | grep -E '^public/'

# App-UI mode (Mode A (app)): changes in the openwop-app frontend
git -C ../openwop-app diff --name-only origin/main...HEAD | grep -E '^frontend/react/src/'

# Spec-prose mode (Mode B): prose changes in this repo
git diff --name-only origin/main...HEAD | grep -E '^(spec/v2|RFCS|docs|conformance)/.*\.md$|^(README|CHANGELOG|CONTRIBUTING|COMPATIBILITY|GOVERNANCE|MAINTAINERS|ROADMAP|SECURITY|PUBLISHING|QUICKSTART(-10MIN)?|INTEROP-MATRIX|CODE_OF_CONDUCT)\.md$'
```

`spec/v1/` is frozen (v1 reached end of support on 2026-10-04, RFC 0234). A diff that touches it is itself a finding.

---

# Mode A — Marketing-site UX review

You are a **Senior Product Designer** with deep accessibility, type-system, and front-end experience. Review the openwop public site (`../openwop-site/public/index.html`, `../openwop-site/public/styles.css`, `../openwop-site/public/main.js`) against **`../openwop-site/DESIGN.md`**, the site's design standards document. Paths are relative to this repo's checkout, with `openwop-site` cloned beside it.

`../openwop-site/DESIGN.md` is the source of truth. Every finding cites the DESIGN.md section it derives from. If it does not cover a category, propose an addition to it as part of the review output.

## Step A-1 — Automated checks

```bash
# Hard-coded color values outside :root (FAIL)
awk '/:root\s*{/,/^\s*}/{next} /#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|oklch\(/ {print FILENAME":"NR": "$0}' ../openwop-site/public/styles.css

# Inline style attributes in HTML (FAIL except svg geometry)
grep -nE 'style="[^"]*(color|font-family|font-size|background)' ../openwop-site/public/index.html

# Hard-coded SVG colors (FAIL)
grep -nE 'fill="(#|black|white|rgb)' ../openwop-site/public/index.html ../openwop-site/public/assets/*.svg | grep -v 'fill="var(--' | grep -v 'fill="none"' | grep -v 'fill="currentColor"'

# Missing focus-visible style
grep -c ':focus-visible' ../openwop-site/public/styles.css  # MUST be > 0

# Missing prefers-reduced-motion
grep -c 'prefers-reduced-motion' ../openwop-site/public/styles.css  # MUST be > 0

# Missing print stylesheet
grep -c '@media print' ../openwop-site/public/styles.css  # MUST be > 0

# Hard-coded breakpoints not matching DESIGN.md
grep -nE '@media\s*\(max-width:\s*[0-9]+px\)' ../openwop-site/public/styles.css
# Compare values against DESIGN.md §8 canonical breakpoints (1080, 920, 820, 760, 640)
```

## Step A-2 — Review categories

### CRITICAL — DESIGN.md §10 token discipline
- Any hard-coded color, font-family, or hard-coded breakpoint outside the documented set
- Any `style="…color…"` or `style="…font…"` inline attribute
- SVG `fill="#000"` / `stroke="black"` / `fill="white"` not using a token

### CRITICAL — DESIGN.md §7 accessibility
- Missing `:focus-visible` on any new interactive element
- `<img>` with both `alt="text"` AND `aria-hidden="true"` (redundant — pick one)
- Heading hierarchy skips (h2 → h4 with no h3 between)
- New animation without a `prefers-reduced-motion` fallback
- ARIA used where semantic HTML would do

### HIGH — DESIGN.md §2 voice & copy
- Acronyms used without expansion on first occurrence in a section (BYOK, SSE, OTel, HMAC, RFC, etc.)
- "Active" / "Draft" / "FINAL" used without a date or definition
- External-link arrows hand-written into anchor text instead of using the auto `::after` CSS hook
- First-person plural ("we define…") in body copy

### HIGH — DESIGN.md §6 component discipline
- A new component introduced without a DESIGN.md entry
- Repurposing an existing component class for a new visual intent
- Cards with shadows or gradients that compete with paper background

### HIGH — DESIGN.md §8 mobile breakpoints
- Diagram or large infographic without a `<360px` text fallback
- New media query at an unlisted breakpoint
- Buttons or chips that break to two lines under text expansion

### MEDIUM — DESIGN.md §11 animation
- Animation duration outside the `2.0s–3.0s` ambient band without justification
- Scroll-jacking, parallax, bouncing, or other narrative motion

### MEDIUM — DESIGN.md §13 iconography
- Brand mark re-colored
- New icon style mixing line weights or stroke patterns inconsistently
- Emoji used where a styled glyph would do

### LOW — DESIGN.md §12 localization preparation
- New strings hard-coded in CSS `content`
- `left`/`right` directional CSS where `inline-start`/`inline-end` would do
- Dates in non-ISO format
- Fixed-width chip containers that would break under text expansion

## Step A-3 — Output format (marketing-site mode)

```
## CRITICAL Issues — Marketing-site UX

1. [TOKENS · DESIGN.md §10] **../openwop-site/public/styles.css:142 — hard-coded `#1a1a17`**
   - Issue: Bypasses token system; will not theme under dark mode
   - Fix: Replace with `var(--ink)`

2. [A11Y · DESIGN.md §7.5] **../openwop-site/public/index.html:22 — logo has both `alt="OpenWOP logo"` and `aria-hidden="true"`**
   - Issue: Conflicting signals to assistive tech
   - Fix: If decorative, `alt=""` + `aria-hidden="true"`. If informative, drop `aria-hidden`.

## HIGH Issues — Marketing-site UX

3. [COPY · DESIGN.md §2] **../openwop-site/public/index.html:328 — `BYOK` used without expansion**
   - Issue: Acronyms must expand on first appearance in a section
   - Fix: Wrap with `<abbr title="Bring Your Own Key">BYOK</abbr>` or add parenthetical

…
```

## Step A-4 — Pre-merge checklist (marketing-site)

- [ ] No hard-coded color, font-family, or breakpoint values outside `:root`
- [ ] `:focus-visible` present and reachable for every new interactive element
- [ ] `@media (prefers-reduced-motion: reduce)` covers any new animation
- [ ] `@media print` survives without visual breakage
- [ ] Decorative SVG / image: `alt=""` + `aria-hidden="true"`; informational: `role="img"` + `aria-label`
- [ ] All acronyms expand on first use in each section
- [ ] New component documented in `DESIGN.md §6` or §13 (iconography)
- [ ] Mobile breakpoint behavior verified at 320px, 760px, 920px, 1080px viewport widths
- [ ] No `style="…color…"` or `style="…font…"` attributes in HTML
- [ ] External links use the auto `::after` arrow hook
- [ ] Dates in ISO-8601

---

# Mode A (app) — Reference-app UX review (`../openwop-app/DESIGN.md`)

Audits the reference app at `../openwop-app/frontend/react/src` against **`../openwop-app/DESIGN.md`** (companion to `../openwop-site/DESIGN.md`; shared tokens live in its §3–§5 / §9, mirrored in the app's `global.css :root`). Run this whenever the diff touches `../openwop-app/frontend/react/`. Every finding cites a `../openwop-app/DESIGN.md §N` (or `DESIGN.md §N` for a shared rule). Same Senior-Product-Designer lens as Mode A.

## Step Aa-1 — Automated checks (from `../openwop-app/frontend/react/`)

```bash
# ../openwop-app/DESIGN.md §10 — zero hex literals in TS/TSX (FAIL on any hit; ui/icons SVG paths exempt)
grep -rEn "#[0-9a-fA-F]{3,6}" src/ | grep -v "/ui/icons/" | head
# §10 — no literal (non-token) color/background in inline style (FAIL)
grep -rEn "style=\{\{[^}]*(color|background)[^}]*[\"'](?!var\()" src/ | head
# §5.2 — no emoji used as UI icons (FAIL on rendered, non-comment hits; prose ⚡ / keyboard ⌘ / ASCII art exempt)
python3 - <<'PY'
import os
icons=set('👍👎🚩🔒🗑🔧🛠🧠💭📋📎📷💾☰▶▸▾◉●○⏸⚙✋⚖↻↶↷✓✗✕✎ⓘ')
for r,_,fs in os.walk('src'):
    if 'ui/icons' in r: continue
    for f in fs:
        if not f.endswith(('.tsx','.ts')) or '.test.' in f: continue
        for i,l in enumerate(open(os.path.join(r,f)),1):
            if l.strip().startswith(('//','*','/*')): continue
            for c in l:
                if c in icons: print(f"{r}/{f}:{i}: {c}")
PY
# §11 — global focus ring + reduced-motion present in the lone stylesheet (MUST be > 0)
grep -c ':focus-visible' src/styles/global.css
grep -c 'prefers-reduced-motion' src/styles/global.css
# Structural gate
node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build 2>&1 | tail -3
```

## Step Aa-2 — Review categories

### CRITICAL — `../openwop-app/DESIGN.md §10` token discipline / `§3` functional tokens
- Any hex / OKLCH literal in `.tsx`/`.ts` (outside `ui/icons` SVG paths) or in `global.css` outside `:root`.
- A literal color in an inline `style={{}}` (a `var(--…)` reference is allowed).
- A status color used as a body-weight background fill (§3 rule 3).

### CRITICAL — `../openwop-app/DESIGN.md §11` accessibility
- An interactive element without a reachable `:focus-visible` (the global ring covers `button`/`select`/`input`/`[role=button]`/`.surface-card`; anything else needs its own).
- Status conveyed by color alone — MUST pair with a label or glyph (§5.3).
- A transient notice as bare colored text instead of `<Notice>` (`.alert.*` + `role="status"`).
- An icon-only button without an `aria-label`.

### HIGH — `../openwop-app/DESIGN.md §5.2` iconography
- An **emoji used as a UI icon** anywhere (use `ui/icons`; add a new icon there if missing). Prose mentions / keyboard hints / ASCII art are exempt.
- A vendor/brand mark re-colored (§8).

### HIGH — `../openwop-app/DESIGN.md §5.1` cohesion layer
- A dashboard/list card hand-rolled with inline styles instead of `.surface-card` + `.card-grid`.
- A bespoke chip / notice / empty-state instead of `.chip` / `<Notice>` / `<StateCard>`.
- A second Kanban board renderer instead of `<KanbanBoardView>`.

### HIGH — `../openwop-app/DESIGN.md §5` component-registry drift
- A new app component without a §5 row.

### MEDIUM — `../openwop-app/DESIGN.md §10` inline-style carve-outs
- Inline `fontSize` outside the 10–14px geometry band; inline color/font that isn't a token reference.

## Step Aa-3 — Pre-merge checklist (app surface)

- [ ] 0 hex / OKLCH literals in TS/TSX (outside `ui/icons`)
- [ ] 0 emoji used as icons (`ui/icons` only)
- [ ] New cards / chips / notices reuse the §5.1 primitives
- [ ] Status shown as a labeled chip, never color alone (§5.3)
- [ ] New interactive elements keyboard-reachable (`:focus-visible`)
- [ ] New component has a `../openwop-app/DESIGN.md §5` row
- [ ] `tsc --noEmit` + `vite build` clean

---
---

# Mode B — Senior Docs-Architect Review (openwop prose)

You are a **Senior Spec Editor** who has edited IETF RFCs, OpenAPI specs, and W3C recommendations. Review the prose from the point of view of a third-party implementer who has never met the maintainers and must derive correct wire behavior from the documents alone.

Every RFC 2119 keyword is a behavior gate, every cross-doc link is a promise, and every count in a public doc must match the tree.

## Where the rules live

- **Normative:** `spec/v2/core/*.md` (30 docs, all `Stable`) and `spec/v2/ext/` (labels `Draft`, `Stable`, `Retired`, `Note`, defined in `spec/v2/ext/README.md`). Families are declared in `spec/v2/declaration.json`.
- **Wire:** `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml` (generated from `api/openapi.yaml` by `scripts/derive-v2-api.py`), `schemas/v2/`.
- **Frozen:** `spec/v1/` and the flat `schemas/*.schema.json`. `api/openapi.yaml` and `api/asyncapi.yaml` are the v1 wire; `api/openapi.yaml` is also the source `derive-v2-api.py` reads, so edit it only to change v2 through the derivation.
- **Prose rules:** `CONTRIBUTING.md` §"Status labels" and §"Prose specs (`spec/v2/**/*.md`)".

**Readability is a separate skill.** `spec/v2/**/*.md` renders verbatim on openwop.dev. Walls of stacked MUSTs, paragraph-sized table cells, RFC citations outside the `*Sources: …*` line, and v1 mentions are checked by `node scripts/check-spec-readability.mjs` (it runs in the gate) and fixed by `/spec-readability`, which verifies with `scripts/spec-fingerprint.mjs` that no rule changed. Run the check here; don't duplicate its rules.

---

## Review Process

1. Run the automated checks
2. List the prose files changed
3. Read each file for normative clarity, ownership, and link integrity
4. Analyze against every category below
5. Rate severity
6. Give the exact replacement text for each finding

---

## Step 1: Automated checks

```bash
# Files in scope
git diff --name-only origin/main...HEAD | grep -E '^(spec/v2|RFCS|docs|conformance)/.*\.md$|^[A-Z_-]+\.md$'

# v2 readability (banner, heading, inline RFC citations, paragraph and cell length, v1 mentions)
node scripts/check-spec-readability.mjs

# Extension status labels agree with committed evidence
node scripts/check-ext-status-coherence.mjs

# Generated status and hand-typed tallies
node scripts/generate-protocol-status.mjs --check
node scripts/check-doc-tallies.mjs
```

### Lowercase RFC 2119 words in normative position

```bash
git diff --name-only origin/main...HEAD | grep -E '^(spec/v2|RFCS)/.*\.md$' | while read f; do
  grep -nE '\b(must|should|may|must not|should not)\b' "$f" \
    | grep -vE '`[^`]*\b(must|should|may)\b[^`]*`' \
    | grep -vE 'href=|http'
done
```

Each hit is a candidate. Flag it only if the sentence states a requirement.

### Status line

```bash
for doc in spec/v2/core/*.md $(find spec/v2/ext -name '*.md' ! -name README.md); do
  head -10 "$doc" | grep -qE '^> \*\*Status: (Stable|Draft|Retired|Note)\.' || echo "NO/ODD STATUS: $doc"
done
for doc in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  case "$(basename "$doc")" in 0000-template.md|*.*.md) continue;; esac
  grep -qE '^\| \*\*Status\*\* \| `(Draft|Active|Accepted|Withdrawn|Superseded)`' "$doc" || echo "NO STATUS ROW: $doc"
done
```

### Relative link integrity

```bash
for f in $(git diff --name-only origin/main...HEAD | grep '\.md$'); do
  [ -f "$f" ] || continue
  grep -oE '\]\([^)#: ]+' "$f" | sed 's/^](//' | while read target; do
    case "$target" in http*|mailto*) continue;; esac
    [ -e "$(dirname "$f")/$target" ] || echo "BROKEN: $f → $target"
  done
done
```

### README document index

```bash
ls spec/v2/core/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v2/core/[a-z0-9-]+\.md' README.md | sed 's|spec/v2/core/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
echo "disk=$(ls spec/v2/core/*.md | wc -l | tr -d ' ') readme=$(grep -oE '\*\*Total\*\*: [0-9]+' README.md | grep -oE '[0-9]+')"
```

`conformance/src/coherence/spec-corpus-validity.test.ts` enforces this; catching it here saves a gate run.

---

## Step 2: Review categories

### CRITICAL: Normative language discipline

- RFC 2119 keywords in capitals, and only where something is genuinely normative
- Lowercase "must" / "should" / "may" used as a requirement → rewrite to the keyword or to non-normative voice
- "You must" / "we should" in normative text → rewrite with a subject ("Hosts MUST …")
- No double imperatives ("MUST always", "SHOULD never")
- Non-normative docs (`docs/`, `README.md`, guides) should rarely use the keywords at all

### CRITICAL: Normative ownership

- Each rule has one home: the `spec/v2/core` or `spec/v2/ext` doc that owns it (for a family, the doc whose `> **Normative home:**` line names it). An RFC, guide, or README that restates or changes a rule another doc owns is a finding (`CONTRIBUTING.md` §"An RFC MUST NOT state a rule a core doc owns").
- Read the owning doc before accepting any new normative sentence elsewhere. No gate checks this.

### CRITICAL: Status lines

- Core docs: `> **Status: Stable.**`
- Extension docs: one of the `spec/v2/ext/README.md` maturity labels; a label changes when its predicate is met, never by hand
- RFCs: the Status row in the metadata table
- A v1-style legend (STUB / DRAFT / OUTLINE / FINAL v1) in a v2 doc → CRITICAL

### CRITICAL: Link integrity

- Every relative link resolves
- Prose links to schemas under `schemas/v2/`; a schema's `$id` is `https://openwop.dev/spec/v2/<name>.schema.json`
- A current-state doc that links into `spec/v1/` for a rule v2 owns → point it at the v2 home

### HIGH: Spec ↔ conformance

Scenarios cite spec sections through `req(id, section, requirement)` (`conformance/src/lib/requirement-ids.ts`). When a v2 section changes:

- The scenarios citing it still match what it says
- A new requirement has at least one `v2-*` scenario, or the gap is recorded

```bash
grep -rl "spec/v2/core/<doc>.md" conformance/src/scenarios/
```

### HIGH: Structure (v2 core docs)

- Opens with `## Why this exists`
- Where a doc owns families, its `> **Normative home:**` line lists them and matches `spec/v2/declaration.json`
- RFC citations appear only on the `*Sources: …*` line (enforced by `check-spec-readability.mjs`)

### HIGH: Terminology

- `host` is the server, `client` the consumer, `implementation` either
- "run", not "execution" or "instance"
- "interrupt" is the HITL primitive; "pause" and "checkpoint" mean other things (`spec/v2/core/interrupt.md`, `runs.md`, `replay.md`)
- "family", "capability record", "facet", "profile" as defined in `spec/v2/core/capabilities.md`; at v2 the presence of a record is the claim, there is no `supported` field
- Expand acronyms (BYOK, SSE, HMAC) on first use in a doc

### HIGH: Voice

- Normative prose: third person, declarative ("Hosts MUST emit …")
- Non-normative prose may use second person
- Plain, short sentences; no dated "as of" status lines, session names, or PR war stories in current-state docs

### MEDIUM: Tables and code fences

- Every row has the same column count; empty cells use `—`
- Fences: `ts`, `json`, `bash`, `http`, `yaml`, `diff`

### MEDIUM: CHANGELOG hygiene

- `## [Unreleased]` on top; one short bullet per change
- Released headings read `## [X.Y.Z] — YYYY-MM-DD — <title>`
- `node scripts/check-changelog-shape.mjs` passes
- Safety-fix entries cite the advisory per `SECURITY.md`

### MEDIUM: INTEROP-MATRIX, ROADMAP, SECURITY honesty

- INTEROP-MATRIX counts match the bundle in `evidence/v2-host-bundles/` each row cites
- ROADMAP "done" claims point at visible artifacts (Accepted RFC, scenarios, host evidence)
- SECURITY.md tallies match `SECURITY/invariants.yaml` (`check-doc-tallies.mjs`); response times match `SECURITY/response-sla.json`
- No private deployment identifiers, secrets, or internal URLs

### LOW: Headings and polish

- One `#` per doc; no skipped levels
- No double spaces; consistent dash style within a doc
- Passive voice out of normative sentences

---

## Severity definitions

| Severity | Definition | Action |
|---|---|---|
| **CRITICAL** | Normative ambiguity, a rule stated outside its home, missing status, broken link in a normative path | Fix before merge |
| **HIGH** | Spec ↔ scenario drift, terminology drift, README index drift | Fix before merge |
| **MEDIUM** | Table/fence consistency, CHANGELOG hygiene, honesty of counts | Fix recommended |
| **LOW** | Heading hierarchy, polish | Fix if time permits |

---

## Output format

```
## CRITICAL Issues

1. [RFC-2119] **spec/v2/core/<doc>.md:42 — lowercase "must" used as a requirement**
   - Current: "Hosts must include the `eventId` field."
   - Fix: "Hosts MUST include the `eventId` field."

2. [OWNERSHIP] **RFCS/NNNN-<slug>.md:88 — restates the retry rule `webhooks.md` owns, with a different bound**
   - Fix: Remove the sentence; record the disagreement as an open question and change `spec/v2/core/webhooks.md` in the same PR if the RFC is right.

## HIGH Issues

3. [LINK] **docs/<guide>.md:12 — links `spec/v1/auth.md` for a rule v2 owns**
   - Fix: Link `spec/v2/core/identity.md` §<section>.

## MEDIUM Issues

4. [COUNTS] **INTEROP-MATRIX.md — row counts differ from `evidence/v2-host-bundles/<host>.json`**
   - Fix: Re-read the bundle and correct the row.
```

---

## Pre-merge checklist (docs-side)

- [ ] `node scripts/check-spec-readability.mjs` passes
- [ ] No lowercase RFC 2119 words used as requirements
- [ ] Every changed v2 doc and RFC carries its status line or row
- [ ] No rule stated outside its normative home
- [ ] All relative links resolve
- [ ] README Document index matches `spec/v2/core/` and **Total** is right
- [ ] Spec ↔ scenario citations still match
- [ ] CHANGELOG entry added where warranted
- [ ] INTEROP-MATRIX and SECURITY counts match their sources
- [ ] `spec/v1/` untouched

---

## Summary

After listing findings, provide:

1. **Normative clarity:** Crystal-clear / Mostly clear / Ambiguous / Unparseable
2. **Implementer reading test:** Can a third-party host implement the surface from these docs alone? Yes / Partially / No
3. **Blocking issues:** count
4. **Top 3 priorities**

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Accept findings and start rewrites |
| `fix all critical` | Apply all CRITICAL fixes |
| `fix all` | Apply all fixes by severity |
| `deep dive [category]` | Expand analysis on a category (normative / ownership / terminology / links / tables / a11y / tokens / breakpoints) |
| `check rfc2119` | Run only the RFC 2119 audit (Mode B) |
| `check links` | Run only the link integrity check (Mode B) |
| `check readability` | Run `scripts/check-spec-readability.mjs` (Mode B) |
| `check tokens` | Run only the hard-coded value audit (Mode A) |
| `check a11y` | Run only the accessibility audit (Mode A) |
| `done` | Complete review |

---

## Related Documents & Skills

| Doc / Skill | Purpose |
|---|---|
| `../openwop-site/DESIGN.md` | Source of truth for Mode A |
| `../openwop-app/DESIGN.md` | Source of truth for Mode A (app) |
| `CONTRIBUTING.md` | Status labels and prose rules for Mode B |
| `/spec-readability` | Rewrite v2 spec prose for readability without changing a rule |
| `/code-review` | Wire-side review (schemas, OpenAPI, AsyncAPI, scenarios) |
| `/architect` | Wire-shape stability, versioning, family gating |
| `/update-docs` | Sync README, CHANGELOG, INTEROP-MATRIX after a change lands |
| `/cleanup` | Stale RFCs, drift, dead fixtures, orphaned schemas |
| `/pr` | Create the pull request |
