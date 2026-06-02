---
name: browser
description: Validate the openwop public surfaces. Mode A — the spec site (site/, public/, registry/, openwop.dev): build, serve, verify the doc index renders, schemas serve, redocly/asyncapi previews, registry pack pages resolve, no broken cross-doc links. Mode B — the demo app (apps/workflow-engine/frontend/react, app.openwop.dev): a static dark-mode + CSS-integrity audit (empty-:is() nesting-break fingerprint, hover color-pin traps, third-party-widget theming, hardcoded light fallbacks) since there is no headless browser in this environment. Pick the mode that matches the surface, or run both.
---

# Browser-Surface Validation (openwop)

openwop has **two** public browser surfaces, and they are validated differently:

- **Mode A — the spec site** (`openwop.dev`, `packs.openwop.dev`): the credibility surface, regenerated from the corpus by `site/src/build.mjs`. Drift between the site and the corpus erodes trust even when the corpus is correct. This is the historical body of this skill (Steps 0–9 below).
- **Mode B — the demo app** (`app.openwop.dev`, source `apps/workflow-engine/frontend/react/`): the interactive reference app. Its bugs are *runtime/visual* — broken dark-mode contrast, off-screen popovers, mis-themed third-party widgets, silently-dropped CSS rules — none of which `npm run openwop:check` or the spec-site checks catch.

## Mode selection

```bash
# What changed / what to audit?
git diff --name-only origin/main..HEAD | grep -E '^(site/|public/|registry/|api/|spec/v1/|RFCS/|schemas/)' && echo "→ run MODE A (spec site)"
git diff --name-only origin/main..HEAD | grep -E '^apps/workflow-engine/frontend/react/' && echo "→ run MODE B (demo app)"
```

Run Mode A for spec-site/registry/doc changes, Mode B for demo-app changes, or **both** for "do a full audit". `$ARGUMENTS` selects the target — "site", "app", or "full".

> **Hard constraint: there is no headless browser in this environment.** Mode B cannot *render* the app. It is a **static + build-time** audit that encodes the failure modes we have actually shipped (see Mode B). Build/lint-green ≠ visually correct — Mode B always ends by naming the surfaces a human must click through, in **both** light and dark.

## Target: $ARGUMENTS

---

# MODE A — Spec site (`openwop.dev` / `packs.openwop.dev`)

---

## Step 0: What "spec site" means in openwop

| Surface | Source | Build / Serve |
|---|---|---|
| Landing page + doc index | `public/index.html`, `public/styles.css`, `public/main.js` | Firebase Hosting (`firebase.json`) |
| Generated spec doc pages | `site/templates/` + `spec/v1/*.md` + `RFCS/*.md` | `site/src/build.mjs` → `site/dist/` |
| OpenAPI preview | `api/openapi.yaml` | `npx redocly preview-docs api/openapi.yaml` |
| AsyncAPI preview | `api/asyncapi.yaml` | `npx @asyncapi/cli start studio --file api/asyncapi.yaml` (or `generate fromTemplate`) |
| JSON Schemas as resources | `schemas/*.schema.json` | Hosted at `openwop.dev/spec/v1/<name>.schema.json` (per schema `$id`) |
| Pack registry index | `registry/v1/`, `registry/index.html`, `registry/scripts/` | Firebase Hosting (`packs.openwop.dev`) |
| Signed registry keys | `registry/keys/` | Hosted; Ed25519 trust-anchor surface per `node-packs.md` |

Per `README.md`'s claims (2026-05-11), `packs.openwop.dev` is "live with a signed registry" — verifying this is part of the skill.

---

## Step 1: Build the static site

```bash
# Inspect site config
ls site/
cat site/package.json
cat site/src/build.mjs | head -50

# Build (regenerates site/dist/ from spec corpus)
( cd site && node src/build.mjs ) 2>&1 | tail -30

# Inspect the output
ls -la site/dist/
```

If `site/src/build.mjs` errors:
- Most likely: a doc referenced from a template no longer exists, OR a new `spec/v1/` doc is not registered in the template
- Fix the template or register the new doc

---

## Step 2: Serve locally + smoke

```bash
# Quick local serve
( cd site && node src/serve.mjs ) &
SITE_PID=$!
sleep 2

# Smoke the landing + a few key pages
curl -sS http://localhost:8080/ | head -40
curl -sS http://localhost:8080/spec/v1/auth.md 2>&1 | head -20
curl -sS http://localhost:8080/spec/v1/capabilities.md 2>&1 | head -20

# Stop
kill "$SITE_PID" 2>/dev/null
```

Or, for the static `public/` landing (Firebase Hosting target):

```bash
# Use firebase emulator if available
firebase emulators:start --only hosting 2>&1 | tail -20 &
EMU_PID=$!
sleep 5
curl -sS http://localhost:5000/ | head -40
kill "$EMU_PID" 2>/dev/null
```

---

## Step 3: Validate doc index parity

The README's "Document index" table is the canonical list of public spec docs. Every doc the site renders must appear in the README; every README row must point at a doc that renders.

```bash
# Extract README doc-index targets
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sort -u > /tmp/site-readme-docs.txt

# Extract docs on disk
ls spec/v1/*.md | sed 's|.*/||' | sed 's|^|spec/v1/|' | sort -u > /tmp/site-disk-docs.txt

# Drift
diff /tmp/site-readme-docs.txt /tmp/site-disk-docs.txt
```

For each drift entry:
- README has, disk doesn't → broken link; fix README OR restore the doc
- Disk has, README doesn't → unindexed surface; add the README row

---

## Step 4: Validate cross-doc links

Spec docs reference each other via relative paths. Broken links erode trust.

```bash
# Find every relative link in spec/v1 and verify the target exists
grep -rEoh '\(\./[a-z0-9-]+\.md(#[^)]+)?\)' spec/v1/*.md RFCS/*.md | sort -u | while read link; do
  target="${link%\)}"
  target="${target#(}"
  path="${target%%#*}"
  if [[ "$path" == ./* ]] && [[ ! -f "spec/v1/${path#./}" ]] && [[ ! -f "RFCS/${path#./}" ]]; then
    echo "BROKEN: $target (in containing doc)"
  fi
done
```

Note: this is a coarse check. For thorough validation, use a Markdown link checker (`npx markdown-link-check` against the rendered HTML).

---

## Step 5: Schema JSONs served at advertised `$id`

Every `schemas/<name>.schema.json` declares `$id: https://openwop.dev/spec/v1/<name>.schema.json`. Verify each schema file is reachable at that path on the live site:

```bash
# Local check (against serve.mjs)
for schema in schemas/*.schema.json; do
  name=$(basename "$schema")
  declared_id=$(grep -E '"\$id"' "$schema" | head -1 | sed 's/.*"\$id":\s*"//; s/",\s*$//')
  echo "schema=$name advertised=$declared_id"
done

# Live check (if site is deployed) — verify content-type
for schema in schemas/*.schema.json; do
  name=$(basename "$schema")
  curl -sI "https://openwop.dev/spec/v1/$name" | head -5
done
```

Content-type SHOULD be `application/schema+json` or at minimum `application/json`. HTML responses indicate the file isn't being served as a static asset.

---

## Step 6: OpenAPI + AsyncAPI previews

```bash
# Preview OpenAPI in a browser
npx -y @redocly/cli@latest preview-docs api/openapi.yaml &
REDOCLY_PID=$!
sleep 3
echo "OpenAPI preview on http://localhost:8080 — open and verify endpoints render"
# Kill when done
kill "$REDOCLY_PID" 2>/dev/null

# Bundle to ensure publishable HTML
npx -y @redocly/cli@latest bundle api/openapi.yaml -o /tmp/openwop-openapi-bundle.yaml
echo "Bundle byte count: $(wc -c < /tmp/openwop-openapi-bundle.yaml)"

# AsyncAPI bundle / HTML generation
npx -y @asyncapi/cli@latest generate fromTemplate api/asyncapi.yaml @asyncapi/html-template -o /tmp/openwop-asyncapi-html 2>&1 | tail -10
ls /tmp/openwop-asyncapi-html/ 2>/dev/null | head -5
```

If either fails, the spec site cannot render that surface cleanly — flag as HIGH.

---

## Step 7: Registry surface (`packs.openwop.dev`)

The registry is its own public surface. Validate:

```bash
ls registry/
ls registry/v1/
cat registry/index.html | head -40

# Validate every pack listed in the v1 index actually exists on disk
ls registry/v1/ | while read entry; do
  if [[ -d "registry/v1/$entry" ]]; then
    if [[ -f "registry/v1/$entry/manifest.json" ]]; then
      echo "OK: registry/v1/$entry"
    else
      echo "MISSING MANIFEST: registry/v1/$entry"
    fi
  fi
done

# Signing keys directory
ls registry/keys/ 2>&1
```

Per `node-packs.md` and `registry-operations.md`:
- Every published pack manifest must be signed (Ed25519)
- Signing key rotation has a documented runbook
- The registry index page should advertise the trust-anchor key fingerprints

If any check fails, the README's "live with a signed registry" claim drifts from reality — flag for `/cleanup audit hosts`.

---

## Step 8: Public landing page (`public/`)

The `public/index.html` + `public/styles.css` + `public/main.js` are Firebase Hosting's root. Smoke them:

```bash
# Static checks
grep -E '<title>|<meta name="description"' public/index.html
wc -l public/main.js public/styles.css

# If there's a working tree change (per gitStatus): public/index.html and public/styles.css are modified
git diff --stat public/

# Common drift: README claims a status (FINAL v1) but the public landing claims a different status
grep -E 'FINAL|v1|status' public/index.html | head -10
grep -E '^>\s*\*\*Status' README.md
```

If the landing page claims different status / version than the README, fix the landing.

---

## Step 9: Findings + severity

Present findings as an issue list. Cite the surface and the artifact.

```
## CRITICAL Issues

1. [REGISTRY] **packs.openwop.dev advertised as "live with signed registry" — verification failed**
   - Issue: registry/v1/<pack>/manifest.json missing for advertised pack
   - Risk: README claim is dishonest; implementers depending on the registry hit 404
   - Fix: Either publish the missing manifests, OR downgrade the README + ROADMAP claim until they exist

## HIGH Issues

2. [SCHEMA-MIME] **schemas served as text/html instead of application/json**
   - Issue: curl https://openwop.dev/spec/v1/run-event.schema.json returns HTML
   - Risk: Ajv2020 in third-party hosts cannot resolve $ref against $id
   - Fix: firebase.json hosting rewrites must include *.schema.json → application/schema+json

3. [DOC-INDEX] **spec/v1/host-capabilities.md is on disk but not in README doc index**
   - Fix: Add row to README "Document index" table

## MEDIUM Issues

4. [LINK-CHECK] **Broken relative link in spec/v1/observability.md → ./old-name.md**
   - Fix: Update to current filename

## LOW Issues

5. [LANDING] **public/index.html claims "v1.0" but README claims "FINAL v1 (2026-05-08)"**
   - Fix: Align the landing page status with the canonical README status
```

---

## Pre-publish Checklist

Before pushing site changes to `openwop.dev`:

- [ ] `( cd site && node src/build.mjs )` builds clean
- [ ] Every doc in `spec/v1/` is reachable through the site
- [ ] Every schema is served with correct content-type at its `$id` URL
- [ ] OpenAPI preview renders all endpoints
- [ ] AsyncAPI preview renders all channels
- [ ] README's "Document index" table matches disk
- [ ] Relative cross-doc links resolve
- [ ] Registry surface (if claiming live) returns manifests + signing keys honestly
- [ ] `public/index.html` status / version claims align with README
- [ ] `firebase deploy --only hosting:docs` (when ready) — but only after the prior items pass

---

# MODE B — Demo app (`app.openwop.dev`)

Source: `apps/workflow-engine/frontend/react/` (lone stylesheet: `src/styles/global.css`). Deployed as the Firebase Hosting target `app` (the React SPA) in front of the Cloud Run backend — see `apps/workflow-engine/DEPLOY.md` + CLAUDE.md's deploy digest.

**Scope split — do not duplicate `/ux-review`.** `/ux-review` Mode A(app) owns *token discipline* against `DESIGN.app.md` (hex literals, emoji-as-icons, component-registry drift, focus rings). Mode B here owns what ux-review and `openwop:check` **cannot** see: **build-time CSS integrity** and **dark-mode runtime rendering**. These are the bugs we have actually shipped to `app.openwop.dev` and then fixed one screenshot at a time — encode them so the next audit catches them in one pass.

## Step B-1: Build + CSS structural integrity — the empty-`:is()` fingerprint (CRITICAL)

```bash
cd apps/workflow-engine/frontend/react
rm -rf dist && npm run build 2>&1 | tail -6           # tsc + vite; must exit 0
CSS=$(ls dist/assets/index-*.css)

# THE check. An empty `:is()` in the BUILT bundle is the unambiguous fingerprint
# of a local CSS nesting break: an unclosed `{` upstream made esbuild's nesting
# transform swallow every following rule as a child and lower the (empty) parent
# to `:is()`, which matches nothing → those rules silently vanish at runtime.
test "$(grep -oE ':is\(\)' "$CSS" | wc -l | tr -d ' ')" = 0 \
  && echo "OK: 0 empty :is()" || echo "FAIL: empty :is() present — a rule block was swallowed"
```

Why this is the canonical detector (and brace-counting is NOT sufficient): a comment/string-aware brace counter reports the *global* balance, but **two defects can cancel** — one missing `}` plus one stray `}` nets to depth 0 and passes the brace check while the file is locally broken and N rules are dropped. That exact pattern shipped past the `#522` brace fix and broke `/keys` (provider badges), then the minimap, then more. **The built-bundle `:is()` count is the reliable signal; run it too:**

```bash
# Necessary but not sufficient — run alongside the :is() check, never instead of it.
python3 - "$PWD/src/styles/global.css" <<'PY'
import sys
s=open(sys.argv[1]).read(); i=0; n=len(s); inb=False; ins=None; stack=[]; line=1; stray=0
while i<n:
    c=s[i]; nx=s[i+1] if i+1<n else ''
    if c=='\n': line+=1
    if inb:
        if c=='*' and nx=='/': inb=False; i+=2; continue
        i+=1; continue
    if ins:
        if c=='\\': i+=2; continue
        if c==ins: ins=None
        i+=1; continue
    if c=='/' and nx=='*': inb=True; i+=2; continue
    if c in '"\'': ins=c; i+=1; continue
    if c=='{': stack.append(line)
    elif c=='}':
        if stack: stack.pop()
        else: stray+=1; print("STRAY } at line", line)
    i+=1
print(f"strays={stray} depth={len(stack)} first_unmatched_open_lines={stack[:10]}")
PY
```

If `:is()` > 0: find the swallowed block (the first `:is()` selector names the first dropped rule), walk *up* to the nearest rule missing its `}`, and recover it verbatim from the pre-break commit (`git show <good-sha>:…/global.css`). NEVER fix a stylesheet with a broad `re.sub(count=0)` — that is what deleted `background:` + `}` from a dozen rules in the first place.

> **Durable fix to recommend:** add `grep -c ':is()' dist/assets/index-*.css` (assert 0) to the `pr-checks.yml` frontend gate so a swallowed-rule regression fails CI instead of shipping. This is the single highest-leverage follow-up — file it.

## Step B-2: Dark-mode hover color-pin trap (HIGH)

The global rule `button:hover { background: var(--clay); color: var(--paper) }` (specificity `0,1,1`) is meant for standalone clay-fill buttons. It **beats** any ghost/menu item that sets its color at `0,1,0` — so on hover the text flips to `--paper` (near-black in dark mode) on a dark hover box → **black-on-black, unreadable**. This hit the account menu and the workflow-card menu.

```bash
cd apps/workflow-engine/frontend/react
# Menu/ghost-item :hover rules that set background but NOT color → candidates for the trap.
grep -nE '\.(account-menu|workflow-card-menu|app-nav|.*-menu|.*-item)[^{]*:hover\s*\{' src/styles/global.css
# For each hit, confirm the rule (or the same selector) pins `color:` — a ghost item
# that changes background on hover MUST also pin `color: var(--color-text)` (or
# `var(--color-danger)` for destructive items), mirroring `.account-menu-trigger`.
```

Flag any popover/menu/ghost `:hover` that changes `background` without an explicit `color:`.

## Step B-3: Third-party widget dark theming (HIGH)

Vendored widgets (React Flow / `@xyflow/react` in the builder) ship light-mode defaults that read as glaring white boxes on the dark canvas. Two traps: (a) the widget declares its theming CSS vars on a **deeper** element than yours, shadowing an ancestor override; (b) a direct `fill`/`background` override flattens per-item color.

```bash
cd apps/workflow-engine/frontend/react
# MiniMap must be themed AND its node blips colored per-node via the `nodeColor`
# PROP (a CSS `fill` override on `.react-flow__minimap-node` flattens every blip).
grep -nE 'react-flow__minimap|nodeColor|maskColor|MiniMap' src/styles/global.css src/builder/canvas/BuilderCanvas.tsx
# Controls + handles themed?
grep -nE 'react-flow__controls|--xy-(controls|handle|minimap)' src/styles/global.css
```

Verify: minimap `background`/mask are themed via tokens, node color comes from the `nodeColor` prop (not a flat CSS `fill`), and controls/handles use `--xy-*` token overrides. The CAVEAT to state in findings: you cannot confirm the blips actually render without a browser — name it as a human-verify item.

## Step B-4: Hardcoded light fallbacks (MEDIUM)

A literal `#fff` / `white` / light hex used as a `background`/`fill` outside the `:root` and dark-theme override blocks will not flip in dark mode.

```bash
cd apps/workflow-engine/frontend/react
# Light backgrounds in the built bundle (resolved) — the dark-theme block lives near the top of global.css.
grep -nE '(background|fill)\s*:\s*(#fff|#ffffff|white)\b' src/styles/global.css
# TSX inline styles with non-token colors (ux-review also flags hex; here we care about light fills specifically).
grep -rnE "style=\{\{[^}]*(background|fill)[^}]*(#fff|white)" src/ | head
```

## Step B-5: Overlay / popover positioning (MEDIUM)

A popover anchored `top: calc(100% + …)` opens **downward**; if its trigger sits at the bottom of the viewport (e.g. the sidebar footer account chip), the menu renders off-screen. Footer-anchored popovers must open upward (`bottom: …`) and, in a left sidebar, extend rightward (`left: 0`, not `right: 0`, so a wide menu doesn't spill off-screen).

```bash
grep -nE '\.[a-z-]*(popover|menu|dropdown|tooltip)[^{]*\{[^}]*position:\s*absolute' src/styles/global.css
# Inspect each: does its trigger live in `.app-sidebar-foot` / a bottom region? If so it must open upward.
```

## Step B-6: Deploy + skew (when shipping a fix)

`app.openwop.dev` is **two** deploys (CLAUDE.md): the Cloud Run backend and the Firebase `hosting:app` frontend. A frontend-only redeploy built from `origin/main` drags *other sessions'* merged frontend live; if it calls backend endpoints the running Cloud Run revision lacks → 500/404 skew. Before a frontend deploy, confirm the deployed backend revision is at the same `origin/main` SHA (or newer for the routes the frontend calls).

```bash
( cd apps/workflow-engine/frontend/react && npm run build )     # uses .env.production
firebase deploy --only hosting:app --project openwop-dev
# Verify live serves the new bundle + the fix is present (cache-bust the query):
H=$(curl -fsS "https://app.openwop.dev/?cb=$(date +%s)" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.css')
curl -fsS "https://app.openwop.dev/$H?cb=$(date +%s)" | grep -c ':is()'   # expect 0
```

## Step B-7: The human pass (mandatory close-out)

Because there is no headless browser here, Mode B **must** end by handing the user a click-list, in **both** light and dark (toggle in the sidebar footer):

- Sidebar shell + nav hover/active states
- Account menu (open it; hover every item — Sign out + Delete; check off-screen)
- `/keys` provider badges + add-key flow
- Workflow builder: node cards, the **minimap blips**, controls, edges
- DataTables (filters, bulk-select), toasts, skeletons, command palette (⌘K)
- Any card/menu/notice introduced by the change

State plainly: build-green + the static checks above are necessary, not sufficient — these surfaces need eyes.

## Mode B findings format

Same severity list as Step 9. Tag each with `[CSS-INTEGRITY]` / `[DARK-HOVER]` / `[WIDGET-THEME]` / `[LIGHT-FALLBACK]` / `[OVERLAY-POS]` / `[DEPLOY-SKEW]` and cite `global.css:line` or the component.

---

## Workflow Commands

| Command | Mode | Action |
|---|---|---|
| `site` / `full` | A | Run all Mode A steps (spec site) |
| `app` / `full` | B | Run all Mode B steps (demo app) |
| `build` | A | Step 1 — rebuild `site/dist/` |
| `serve` | A | Step 2 — local serve + smoke |
| `index-parity` | A | Step 3 — README doc-index drift check |
| `links` | A | Step 4 — relative-link verification |
| `schemas` | A | Step 5 — schema $id serving check |
| `previews` | A | Step 6 — OpenAPI + AsyncAPI preview build |
| `registry` | A | Step 7 — packs.openwop.dev surface check |
| `landing` | A | Step 8 — public/ landing page smoke |
| `is-check` | B | Step B-1 — build + assert 0 empty `:is()` + brace balance |
| `dark-hover` | B | Step B-2 — hover color-pin trap scan |
| `widgets` | B | Step B-3 — third-party widget dark theming |
| `light-fallbacks` | B | Step B-4 — hardcoded white/`#fff` background scan |
| `overlays` | B | Step B-5 — popover positioning scan |
| `report` | — | Generate the findings list |
| `done` | — | Complete validation |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/update-docs` | Sync README "Document index" + CHANGELOG when the site drifts (Mode A) |
| `/cleanup audit hosts` | Verify reference-host advertisements before they hit the live INTEROP-MATRIX page (Mode A) |
| `/ux-review` | Prose RFC 2119 + cross-link integrity on the corpus (Mode A); **token discipline** against `DESIGN.app.md` for the demo app — the companion to Mode B, which owns build-integrity + dark-mode rendering instead |
