---
name: browser
description: Validate the openwop spec site (site/, public/, registry/, registry/v1/, openwop.dev). Build, serve locally, verify the doc index renders, schema JSONs are served with correct MIME types, redocly/asyncapi previews succeed, registry pack pages resolve, and no broken cross-doc links. Lightweight — most openwop surface is non-UI, but the site is a credibility surface.
---

# Spec Site Validation (openwop)

The openwop spec site is the public credibility surface — `openwop.dev`, the registry under `packs.openwop.dev`, and the doc landing pages. It is regenerated from the corpus by `site/src/build.mjs`. Drift between the site and the corpus erodes trust, even when the corpus itself is correct.

This skill validates the static site, the registry surface, and the public-facing doc renders. It is lightweight by openwop standards — most validation is `npm run openwop:check` (the wire side); this skill checks the human-facing side.

## Target: $ARGUMENTS

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
- [ ] `firebase deploy --only hosting` (when ready) — but only after the prior items pass

---

## Workflow Commands

| Command | Action |
|---|---|
| `build` | Run Step 1 — rebuild `site/dist/` |
| `serve` | Run Step 2 — local serve + smoke |
| `index-parity` | Run Step 3 — README doc-index drift check |
| `links` | Run Step 4 — relative-link verification |
| `schemas` | Run Step 5 — schema $id serving check |
| `previews` | Run Step 6 — OpenAPI + AsyncAPI preview build |
| `registry` | Run Step 7 — packs.openwop.dev surface check |
| `landing` | Run Step 8 — public/ landing page smoke |
| `report` | Generate the findings list |
| `done` | Complete site validation |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/update-docs` | Sync README "Document index" + CHANGELOG when the site drifts |
| `/cleanup audit hosts` | Verify reference-host advertisements before they hit the live INTEROP-MATRIX page |
| `/ux-review` | Prose-level RFC 2119 + cross-link integrity on the corpus the site renders |
