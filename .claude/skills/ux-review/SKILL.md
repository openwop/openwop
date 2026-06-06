---
name: ux-review
description: Multi-mode review for openwop user-facing surfaces. **Marketing-site mode** audits `../openwop-site/public/index.html`, `../openwop-site/public/styles.css`, `../openwop-site/public/main.js` against `DESIGN.md` (typography, color tokens, spacing, components, a11y, localization, light/dark, mobile breakpoints, no hard-coded values). **App-UI mode** audits the reference app `../openwop-app/frontend/react/src` against `../openwop-app/DESIGN.md` — the shared `ui/` cohesion layer (`.surface-card`/`.chip`/`.action-bar`/`<Notice>`/`<StateCard>`), the `ui/icons` Lucide set + no-emoji-as-icons rule, status→chip semantics, the inline-style/token policy, and app a11y. **Spec-prose mode** audits `spec/v1/`, `RFCS/`, `README.md`, `CHANGELOG.md`, `INTEROP-MATRIX.md`, `ROADMAP.md`, `docs/` for RFC 2119 keyword discipline, Status legend, table format, normative voice, cross-doc link integrity, "Why this exists" + "Open spec gaps", doc-index drift, and PUBLISHING / SECURITY surface honesty.
---

# UX Review (openwop)

This skill runs in one of two modes — pick the mode that matches what changed, or run both back-to-back if the change spans surfaces.

## Mode selection

```bash
# Marketing-site mode (Mode A): any change touching ../openwop-site/public/ or assets used by the live site
git diff --name-only origin/main..HEAD | grep -E '^../openwop-site/public/'

# App-UI mode (Mode A (app)): any change to the reference app frontend — reviewed against ../openwop-app/DESIGN.md
git diff --name-only origin/main..HEAD | grep -E '^../openwop-app/frontend/react/src/'

# Spec-prose mode (Mode B): any change touching prose
git diff --name-only origin/main..HEAD | grep -E '^(spec/v1|RFCS|docs|public)/.*\.md$|^(README|CHANGELOG|CONTRIBUTING|COMPATIBILITY|GOVERNANCE|MAINTAINERS|ROADMAP|SECURITY|PUBLISHING|QUICKSTART(-10MIN)?|INTEROP-MATRIX|CODE_OF_CONDUCT)\.md$'
```

Run whichever modes match the diff (marketing → app → prose); the app surface (`../openwop-app/frontend/react/`) is reviewed against `../openwop-app/DESIGN.md`, the marketing site against `DESIGN.md`.

---

# Mode A — Marketing-site UX review

You are a **Senior Product Designer** with deep accessibility, type-system, and front-end experience. Review the openwop public site (`../openwop-site/public/index.html`, `../openwop-site/public/styles.css`, `../openwop-site/public/main.js`) against the **`DESIGN.md`** standards document at the repo root.

`DESIGN.md` is the source of truth. Every finding cites the DESIGN.md section it derives from. If `DESIGN.md` does not cover a category, propose an addition to it as part of the review output.

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

Audits the reference app at `../openwop-app/frontend/react/src` against **`../openwop-app/DESIGN.md`** (companion to `DESIGN.md`; shared tokens live in `DESIGN.md §3–§5 / §9`, mirrored in the app's `global.css :root`). Run this whenever the diff touches `../openwop-app/frontend/react/`. Every finding cites a `../openwop-app/DESIGN.md §N` (or `DESIGN.md §N` for a shared rule). Same Senior-Product-Designer lens as Mode A.

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

# Mode B — Senior Docs-Architect Review (openwop prose)

You are a **Senior Spec Editor** with 15+ years of experience editing IETF RFCs, OpenAPI specs, and W3C recommendations. Review the openwop prose corpus from the perspective of a third-party implementer who has never met the maintainer and must derive correct wire-conformant behavior from the document alone.

Your review must be **precise, unambiguous, and uncompromising on normative clarity**. Every word the maintainer writes is a wire contract. Every cross-doc link is a promise. Every RFC 2119 keyword is a behavior gate.

---

## Review Process

1. **Run automated checks** to catch common issues quickly (RFC 2119 lowercase, broken links, missing Status legend)
2. **Identify all prose files changed** in this session
3. **Examine each file** for normative clarity, structure, and cross-doc integrity
4. **Analyze against every category below** — no exceptions
5. **Rate severity** of each finding
6. **Provide actionable rewrites** with the exact replacement text

---

## Step 1: Automated checks

```bash
# Files in scope
git diff --name-only origin/main..HEAD | grep -E '^(spec/v1|RFCS|docs|public)/.*\.md$|^(README|CHANGELOG|CONTRIBUTING|COMPATIBILITY|GOVERNANCE|MAINTAINERS|ROADMAP|SECURITY|PUBLISHING|QUICKSTART(-10MIN)?|INTEROP-MATRIX|CODE_OF_CONDUCT)\.md$'
```

### RFC 2119 lowercase audit (NON-NORMATIVE language in NORMATIVE position)

Search changed prose for lowercase forms of RFC 2119 keywords used as normative imperatives:

```bash
# Find lowercase "must" / "should" / "may" / "must not" / "should not" outside of:
#   - inside code fences
#   - inside inline backticks
#   - inside hyperlink anchors / URLs
git diff --name-only origin/main..HEAD | grep -E '^(spec/v1|RFCS)/.*\.md$' | while read f; do
  grep -nE '\b(must|should|may|must not|should not)\b' "$f" \
    | grep -vE '`[^`]*\b(must|should|may)\b[^`]*`' \
    | grep -vE 'href=|http' \
    | grep -vE '\b(MUST|SHOULD|MAY|MUST NOT|SHOULD NOT)\b'
done
```

Each match is a candidate finding — flag if the surrounding sentence is normative.

### Missing Status legend

```bash
for doc in spec/v1/*.md RFCS/*.md; do
  [[ "$doc" == "RFCS/0000-template.md" || "$doc" == "RFCS/README.md" ]] && continue
  if ! head -30 "$doc" | grep -qE '(\*\*Status\*\*|Status:|status:)'; then
    echo "NO STATUS: $doc"
  fi
done
```

### Stale Status tags

Per `auth.md §status legend`: STUB / DRAFT / OUTLINE / FINAL. Check for ad-hoc statuses:

```bash
grep -hE '^>\s*\*\*Status' spec/v1/*.md | sort -u
```

Anything other than STUB / DRAFT / OUTLINE / FINAL → flag.

### Cross-doc link integrity

```bash
# Find every relative link and verify the target exists
for f in spec/v1/*.md RFCS/*.md README.md CHANGELOG.md INTEROP-MATRIX.md ROADMAP.md GOVERNANCE.md CONTRIBUTING.md COMPATIBILITY.md; do
  [[ ! -f "$f" ]] && continue
  grep -oE '\]\(\.\.?/[^)]+\)' "$f" | while read link; do
    target="${link#](}"
    target="${target%)}"
    target="${target%%#*}"
    dir=$(dirname "$f")
    # Resolve relative to the file's directory
    resolved="$dir/$target"
    if [[ ! -e "$resolved" ]]; then
      echo "BROKEN: $f → $target"
    fi
  done
done
```

### Inline JSON Schemas in OpenAPI / AsyncAPI

```bash
# Per CONTRIBUTING.md §"OpenAPI / AsyncAPI": never inline; always cross-file $ref
grep -nE '^\s+schema:\s*$' api/openapi.yaml | head -10
```

Each match is a candidate (the next lines may be an inline shape rather than a `$ref`).

---

## Step 2: Review categories

### CRITICAL: Normative language discipline

Per `CONTRIBUTING.md` §"Prose specs":

- **RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT) in capital letters** for every normative requirement
- Lowercase "must" / "should" / "may" used as normative imperative → CRITICAL break (ambiguous to non-native English readers, fails standard ID parsers)
- Plain-English imperatives ("you must," "we should") → CRITICAL; rewrite to MUST / SHOULD or non-normative voice
- Conditional normative ("if X, then implementations MUST Y") preferred over imperative bare ("implementations MUST always Y")
- No double-imperatives: "MUST always" / "SHOULD never" — simplify to MUST / SHOULD NOT

### CRITICAL: Status legend present and current

- Every `spec/v1/*.md` and `RFCS/*.md` carries a header line: `> **Status:** STUB | DRAFT | OUTLINE | FINAL v1`
- For docs marked FINAL v1: cite the freeze date
- For RFCs: Status row in the metadata table — `Draft` / `Active` / `Accepted` / `Withdrawn` / `Superseded`
- Mixing legends (FINAL v1 in an RFC; Active in a spec doc) → CRITICAL

### CRITICAL: Per-doc structure (spec docs)

Per `CONTRIBUTING.md` §"Prose specs":

- New surface area MUST include a "Why this exists" paragraph at the top — flag absence as CRITICAL
- New surface area MUST include an "Open spec gaps" table at the end (or `None.` if comprehensive)
- Section headings stable; numbered headings allowed where useful
- Footnotes or sidebars: keep non-normative content out of normative sections

### CRITICAL: Cross-doc link integrity

- Every relative link resolves
- Spec ↔ schema cross-references: prose links to schema file; schema `$id` is the canonical URL; spec MAY also embed a permalink to the `$id`
- Spec ↔ RFC: every RFC's "Affects" field names the docs it touches; those docs include a backlink in their "References" section
- Spec ↔ INTEROP-MATRIX: profile predicates in `profiles.md` exactly match the column headers in INTEROP-MATRIX

### HIGH: Conformance citation in scenarios

`conformance/src/scenarios/*.test.ts` assertions use `driver.describe('spec.md §section', 'requirement')`. Reviewing a docs change means cross-checking that:

- Every spec section the change touches still has the conformance scenarios that cite it
- New sections have at least one corresponding scenario citation

This isn't a prose check per se but is the docs ↔ test integrity contract.

### HIGH: Table format consistency

openwop uses Markdown tables heavily. Inconsistencies erode trust:

- Header row uses bold cells or `**Field** | **Value**` style; choose one and stay consistent within a doc
- Body rows align on `|` — every row has the same column count
- Empty cells use `—` (em-dash) not blank or `-`
- Numeric columns right-aligned via `---:`
- Status / classification columns use the legend exactly (e.g., FINAL v1, never "final v1")

### HIGH: Voice + register

- Normative prose: third-person, declarative ("Hosts MUST emit", "Clients SHOULD retry")
- Non-normative prose: second-person allowed ("you can," "we recommend")
- No first-person plural in normative ("we MUST" is wrong; "Hosts MUST" is right)
- No imperative without subject ("MUST emit X" → "Hosts MUST emit X")

### HIGH: Cross-doc terminology consistency

Check the touched files for terminology drift against the canonical vocabulary:

- "host" / "client" / "implementation" — `host` is the server, `client` is the consumer, `implementation` is either
- "run" / "execution" / "instance" — use "run" only (per `rest-endpoints.md`)
- "interrupt" — not "pause" or "checkpoint" (those are different concepts per `interrupt.md`, `replay.md`)
- "channel" / "channel value" — per `channels-and-reducers.md`, not "state" or "variable"
- "capability" / "profile" / "scale tier" / "production profile" — distinct, defined in `capabilities.md` / `profiles.md` / `scale-profiles.md` / `production-profile.md`
- "BYOK" — always uppercase; expand on first use in a doc
- "AgentRef" / "Agent identity" — title-case proper nouns

### HIGH: README "Document index" drift

```bash
# Every spec/v1/*.md should appear in README's Document index
ls spec/v1/*.md | sed 's|.*/||' > /tmp/disk-docs.txt
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sed 's|spec/v1/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
```

- Disk has, README doesn't → CRITICAL add a row
- README has, disk doesn't → CRITICAL fix the link or remove the row

### MEDIUM: Code-fence dialect consistency

- TypeScript: ```` ```ts ```` (not `typescript`, not `js` for TS code)
- JSON: ```` ```json ```` (not `JSON`)
- Bash / shell: ```` ```bash ```` (not `sh`, not unqualified)
- HTTP examples: ```` ```http ```` (not `text` for HTTP)
- YAML (OpenAPI / AsyncAPI snippets): ```` ```yaml ````
- JSON Schema: ```` ```json ```` (not a separate dialect — flag if you see `jsonschema`)
- Diffs: ```` ```diff ```` for schema / OpenAPI diffs

### MEDIUM: CHANGELOG hygiene

- `[Unreleased]` section present at top with subsections: `### Added` / `### Changed` / `### Deprecated` / `### Removed` / `### Fixed` / `### Security`
- Per-package CHANGELOG (conformance, ../openwop-sdks/sdk/typescript) follows the same template
- Safety-fix changes cite the advisory ID per `SECURITY.md`
- Released sections have a date (YYYY-MM-DD) and a link or comparison ref to the prior version

### MEDIUM: ROADMAP + tripwire honesty

- Per `ROADMAP.md` and `MAINTAINERS.md`: vendor-neutral migration tripwire (≥1 non-steward maintainer) — has this changed?
- "DONE" claims supported by visible artifacts (RFC at Accepted; conformance scenarios; reference-host evidence)
- Active quarter has explicit deliverables, not aspirational language

### MEDIUM: INTEROP-MATRIX prose

- Reading rows section accurately describes how to derive a row
- "Add A Host" steps actually work end-to-end (validate by following them for a hypothetical host)
- No private deployment identifiers, secrets, or internal result paths

### MEDIUM: SECURITY surface prose

- `SECURITY.md` reporting SLA matches the triage SLA in `CONTRIBUTING.md` §"Triage SLA"
- Threat-model docs (`SECURITY/threat-model-*.md`) cross-reference the relevant spec docs
- `SECURITY/invariants.yaml` rows include a stable ID, the MUST-NOT, and the conformance scenario file

### LOW: Heading hierarchy

- `#` only once per doc (title)
- `##` for top-level sections
- `###` for subsections; `####` permitted, deeper levels strongly discouraged
- No skipped levels (`##` to `####`)

### LOW: Sentence-level polish

- No double spaces
- Em-dashes (`—`) with no surrounding spaces, OR en-dashes (`–`) in numeric ranges; consistent within a doc
- Oxford comma: use throughout
- Avoid passive voice in normative sentences ("X SHOULD be done by hosts" → "Hosts SHOULD do X")
- Avoid jargon without definition; first use → expand or link

### LOW: Diagrams + ASCII art

- ASCII art used sparingly; prefer prose tables for state machines, transitions
- If diagrams added, ensure they render in the spec site build (`../openwop-site/site/src/build.mjs`)

---

## Severity definitions

| Severity | Definition | Action |
|---|---|---|
| **CRITICAL** | Normative ambiguity (lowercase RFC 2119 used normatively, missing Status, broken link in normative path) | Must fix before merge |
| **HIGH** | Terminology drift, table inconsistency, README index drift | Should fix before merge |
| **MEDIUM** | Code-fence dialect, CHANGELOG hygiene, ROADMAP honesty | Fix recommended |
| **LOW** | Heading hierarchy, sentence polish, diagram positioning | Fix if time permits |

---

## Output format

```
## CRITICAL Issues

1. [RFC-2119] **spec/v1/<doc>.md:42 — lowercase "must" used as normative imperative**
   - Current: "Hosts must include the `eventId` field."
   - Issue: Lowercase "must" is ambiguous to non-native English readers and fails standard ID parsers (per IETF RFC 2119)
   - Fix: Replace with capital MUST: "Hosts MUST include the `eventId` field."

2. [STRUCTURE] **spec/v1/new-surface.md — missing "Why this exists" paragraph**
   - Issue: New surface area docs require a "Why this exists" paragraph at the top per CONTRIBUTING.md §"Prose specs"
   - Fix: Add 2–3 sentence rationale explaining what this doc covers and why it lives at the spec layer (not impl)

## HIGH Issues

3. [LINK] **spec/v1/observability.md:88 — broken link to `./old-name.md`**
   - Fix: Update to the current filename, or remove the reference

4. [README-INDEX] **README.md — `spec/v1/host-capabilities.md` missing from Document index**
   - Fix: Add row with `Status: FINAL v1`, word count, and one-line summary

## MEDIUM Issues

5. [TERM] **spec/v1/<doc>.md — uses "checkpoint" where "interrupt" is meant**
   - Fix: Per interrupt.md, "interrupt" is the canonical HITL primitive; "checkpoint" refers to a different concept in replay.md

## LOW Issues

6. [POLISH] **CHANGELOG.md — double spaces between sentences in entry**
   - Fix: Single space
```

---

## Pre-merge checklist (docs-side)

- [ ] No lowercase RFC 2119 keywords used as normative imperatives
- [ ] Every changed `spec/v1/*.md` and `RFCS/*.md` carries a Status legend
- [ ] New surface area has "Why this exists" + "Open spec gaps" sections
- [ ] All relative cross-doc links resolve
- [ ] README "Document index" matches `spec/v1/` on disk
- [ ] Tables in changed files have consistent header style + column alignment
- [ ] Code-fence dialects consistent (`ts`, `json`, `bash`, `yaml`, `http`, `diff`)
- [ ] CHANGELOG `[Unreleased]` entry added for prose changes that warrant one
- [ ] Terminology matches canonical vocabulary (host / client / run / interrupt / channel / capability / profile)
- [ ] No first-person plural ("we MUST") in normative prose
- [ ] Reference-host advertisement in INTEROP-MATRIX matches actual evidence files

---

## Summary

After listing findings, provide:

1. **Normative clarity score:** Crystal-clear / Mostly clear / Ambiguous / Unparseable
2. **Implementer reading test:** Can a third-party host implement the wire surface from these docs alone, without conversation with the maintainer? Yes / Partially / No
3. **Blocking issues:** Count that must be resolved before merge
4. **Top 3 priorities:** Most impactful fixes for normative clarity

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Accept findings and start rewrites |
| `fix all critical` | Apply all CRITICAL fixes |
| `fix all` | Apply all fixes by severity |
| `deep dive [category]` | Expand analysis on a category (normative / terminology / links / tables / a11y / tokens / breakpoints) |
| `check rfc2119` | Run only the RFC 2119 lowercase audit (Mode B) |
| `check links` | Run only the cross-doc link integrity check (Mode B) |
| `check terms` | Run only the terminology consistency check (Mode B) |
| `check tokens` | Run only the hard-coded value audit (Mode A) |
| `check a11y` | Run only the accessibility audit (Mode A) |
| `done` | Complete review |

---

## Related Documents & Skills

| Doc / Skill | Purpose |
|---|---|
| `DESIGN.md` (repo root) | **Source of truth for Mode A.** Typography, color tokens, spacing, components, accessibility, mobile breakpoints, localization, light/dark mode, no-hard-coded-values policy. Every Mode A finding cites a DESIGN.md section. |
| `/code-review` | Wire-side review (schemas, OpenAPI, AsyncAPI, SDK code) |
| `/architect` | Wire-shape stability, version negotiation, capability gating |
| `/update-docs` | Sync README index / CHANGELOG / INTEROP-MATRIX / RFC index after a change lands |
| `/browser` | Validate the site renders the corpus correctly |
| `/cleanup` | Address stale RFCs, drift, dead fixtures, orphaned schemas |
| `/pr` | Create the pull request |
