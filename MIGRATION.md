# Migration: extract the public site into `openwop-site`

**Status:** ✅ complete — `openwop.dev` is served from `openwop/openwop-site`;
this repo is protocol-only (decommission merged in #617). See §11.
**Goal:** move the marketing/spec website out of `openwop/openwop` into a new
`openwop-site` repo, leaving `openwop/openwop` as a clean, protocol-only source
of truth that gains nothing and owes nothing to the website.

> **Update (post-cutover).** Two things below were superseded during execution and
> are kept as written for the historical record:
> - **Pin model.** The plan pins to a *release tag* (`v1.1.7`). The shipped model
>   **tracks openwop `main`**, pinned to an exact commit SHA (advanced daily by the
>   `pin-bump` workflow) — because `openwop.dev` has always rendered latest `main`,
>   and pinning to the last release would have regressed the live site by 100
>   commits. The canonicity gate + `openwop-ref.lock` are unchanged; only the ref
>   advanced from a tag to a SHA.
> - **Provisioning.** `provision-corpus.sh` fetches by exact ref
>   (`git fetch --depth 1 origin <sha>`), not `git clone --branch`, so SHA pins work.
> - **White-label zip** is fetched from the *latest release* asset (it tracks
>   `apps/`, not the spec pin), not from the pinned ref's release.

This document was the authoritative plan; the mechanics in §6–§8 were proven
locally against the `v1.1.7` pin (see §9 — Evidence) before it was written.

---

## 1. What `public/` actually is

`public/` is **not** a self-contained website. It is a *hybrid*: a small set of
hand-authored marketing files plus the **committed build output** of a generator
(`site/src/build.mjs`) that reads the spec corpus from across the monorepo.

Of **271** git-tracked files in `public/`, **252 are regenerated/copied** by
`scripts/build-site.sh` on every deploy, and only **19 are hand-authored source**.

The generator (`site/`) renders `spec/v1/`, `RFCS/`, schemas, API contracts and a
dozen root-level normative `.md` files into HTML; `build-site.sh` merges that
output into `public/`, preserving the hand-authored marketing files, then
`firebase deploy --only hosting:docs` ships `public/`.

**Why this matters for the protocol:** `openwop.dev` *publishes wire-facing
artifacts* — 56+ JSON Schemas whose `$id` is
`https://openwop.dev/spec/v1/<name>.schema.json`, the OpenAPI/AsyncAPI/proto
contracts (OpenAPI resolves schemas via relative `../schemas/` refs), and
conformance badges. A repo split must guarantee these keep serving
**byte-identical content at the same paths**, pinned to a known spec version.
The instant a served URL moves or lags its source it is a *de-facto breaking
change* even with a clean `git diff`. That guarantee is the spine of this plan.

---

## 2. Decisions (criterion: keep `openwop/openwop` as clean as possible)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Input via pin-file + sparse shallow checkout**, not a git submodule | Sparse checkout fetches only the allowlisted spec paths (not the whole monorepo), the allowlist *is* an explicit dependency manifest, and there are no submodule footguns. Content-addressing is recovered via `openwop-ref.lock` (resolved SHA + per-artifact hashes) + the deploy gate. |
| 2 | **Pull-based; no `repository_dispatch` from openwop** | openwop carries zero website coupling. `openwop-site` owns the pin bump (manual on release, or a scheduled "new openwop release?" PR). Bumping `OPENWOP_REF` *is* the deliberate publish action. **Trade-off:** generator-input fail-fast feedback moves downstream — a spec change that breaks the generator is caught by the `openwop-site` pin-bump PR (which never reaches the live site), not at openwop merge time. Accepted for cleanliness. |
| 3 | **White-label zip = openwop release asset; `openwop-site` downloads it** | The zip is built from `apps/workflow-engine` (stays in openwop). Publishing it as a versioned release asset keeps `apps/` out of the site's sparse checkout and co-locates zip-building with app source. `scripts/build-whitelabel-zip.sh` already exists; only its publish destination changes. |

**Net effect:** the split is **pure subtraction** for openwop (see §10).

---

## 3. The 19 hand-authored source files (the real "move-list")

Everything else under `public/` is generated/copied and should be **gitignored**
in `openwop-site` (built fresh from the pin), not committed.

```
public/index.html
public/main.js
public/styles.css
public/site-nav.js
public/manifest.webmanifest
public/robots.txt
public/404.html
public/assets/OpenWOP-Screenshot.png
public/assets/OpenWOP.svg
public/assets/apple-touch-icon.png
public/assets/icon-192.png
public/assets/icon-512.png
public/assets/og-cover.png
public/assets/og-cover.svg
public/assets/redoc.standalone.js
public/assets/workflow-canvas-800.webp
public/assets/workflow-canvas-1200.png
public/assets/workflow-canvas-1200.webp
public/assets/workflow-canvas-1600.webp
```

> Note: `favicon.svg`, `assets/style.css`, `assets/spec-toc.js`,
> `assets/og-default.{png,svg}`, and `sitemap.xml` are **generated** (copied from
> `site/dist/`), not hand-authored — do not commit them in `openwop-site`.

---

## 4. Dependency allowlist (the sparse-checkout manifest)

The generator + `build-site.sh` read exactly this surface from openwop. This list
lives in `openwop-site` and is the entire contract between the two repos:

```
spec/                          # spec/v1/*.md + profiles.md
RFCS/                          # 0000-*.md … rendered to /rfcs/
schemas/                       # 56+ JSON Schemas → /schemas/ (wire artifacts)
api/                           # openapi.yaml, asyncapi.yaml, grpc/openwop.proto
examples/hosts/**/conformance.md   # per-host run logs → leaderboard + badges
README.md  INTEROP-MATRIX.md  CHANGELOG.md  ROADMAP.md  COMPATIBILITY.md
SECURITY.md  CONTRIBUTING.md  GOVERNANCE.md  MAINTAINERS.md  QUICKSTART.md
```

Sparse-checkout (cone mode pulls these dirs + all root `.md` files; tighten with
`--no-cone` globs if `examples/hosts/` host code should be excluded):

```bash
git clone --no-checkout --depth 1 --branch "$OPENWOP_REF" \
  https://github.com/openwop/openwop vendor/openwop
git -C vendor/openwop sparse-checkout init --cone
git -C vendor/openwop sparse-checkout set spec RFCS schemas api examples/hosts
git -C vendor/openwop checkout
```

---

## 5. `openwop-site` repo layout

```
openwop-site/
  public/              # the 19 hand-authored files ONLY (generated dirs gitignored)
  site/                # the generator, moved verbatim from openwop
  scripts/
    build-site.sh            # parameterized (see §6)
    generate-og-cover.mjs
    openwop-pin.mjs          # NEW — writes openwop-ref.lock (see §7)
    check-published-surface.mjs  # NEW — the deploy gate (see §7)
  vendor/openwop/      # sparse, shallow, pinned checkout (gitignored)
  OPENWOP_REF          # e.g. "v1.1.7" — the human-readable pin
  openwop-ref.lock     # resolved SHA + per-artifact sha256 (committed)
  firebase.json        # the "docs" hosting block only
  .firebaserc          # the "docs" target only
  .gitignore           # vendor/openwop, public/<generated dirs>, public/downloads
```

---

## 6. The only generator code change: parameterize `ROOT`

`site/src/build.mjs` currently hardcodes the monorepo root. One env-overridable
constant decouples it (proven working in §9):

```diff
 const __dirname = dirname(fileURLToPath(import.meta.url));
-const ROOT = resolve(__dirname, '..', '..');
+// ROOT is the openwop spec corpus. In openwop-site it is a pinned input under
+// vendor/openwop; OPENWOP_ROOT overrides it (CI sets it to the checkout).
+const ROOT = process.env.OPENWOP_ROOT
+  ? resolve(process.env.OPENWOP_ROOT)
+  : resolve(__dirname, '..', '..', 'vendor', 'openwop');
 const SITE_DIR = resolve(__dirname, '..');
```

`scripts/build-site.sh` gains a `CORPUS` var (default `vendor/openwop`, overridden
by `OPENWOP_ROOT`), exports it so the generator inherits it, repoints the `api/`
and `schemas/` copies at `$CORPUS`, and gates the white-label step behind
`SKIP_WHITELABEL` (Decision 3 relocates zip-building):

```diff
 ROOT="$(cd "$(dirname "$0")/.." && pwd)"
 SITE="$ROOT/site"
 PUBLIC="$ROOT/public"
+CORPUS="${OPENWOP_ROOT:-$ROOT/vendor/openwop}"
+export OPENWOP_ROOT="$CORPUS"
+[[ -d "$CORPUS" ]] || { echo "[build-site] FATAL: corpus $CORPUS not found." >&2; exit 1; }
 ...
-cp "$ROOT/api/openapi.yaml"  "$PUBLIC/api/openapi.yaml"
-cp "$ROOT/api/asyncapi.yaml" "$PUBLIC/api/asyncapi.yaml"
-cp "$ROOT/api/grpc/openwop.proto" "$PUBLIC/api/grpc/openwop.proto"
-cp -R "$ROOT/schemas" "$PUBLIC/schemas"
+cp "$CORPUS/api/openapi.yaml"  "$PUBLIC/api/openapi.yaml"
+cp "$CORPUS/api/asyncapi.yaml" "$PUBLIC/api/asyncapi.yaml"
+cp "$CORPUS/api/grpc/openwop.proto" "$PUBLIC/api/grpc/openwop.proto"
+cp -R "$CORPUS/schemas" "$PUBLIC/schemas"
 ...
-echo "[build-site] building white-label demo-app zip"
-bash "$ROOT/scripts/build-whitelabel-zip.sh"
+if [[ "${SKIP_WHITELABEL:-}" != "1" ]]; then
+  # Decision 3: prefer fetching the openwop release asset; this path is the fallback.
+  curl -fsSL -o "$PUBLIC/downloads/openwop-demo-app.zip" "$WHITELABEL_ZIP_URL"
+fi
```

---

## 7. The canonicity + geometry gates (architect findings #1, #2)

Two small, zero-dependency node scripts enforce the §1 guarantee.

**`scripts/openwop-pin.mjs`** — run at pin-bump time. Resolves `vendor/openwop` to
an immutable SHA and writes `openwop-ref.lock` with a `sha256` of every wire
artifact (the 56+ schemas + OpenAPI/AsyncAPI/proto).

**`scripts/check-published-surface.mjs`** — the **deploy gate**, run after
`build-site.sh`, before `firebase deploy`. Fails if:
- **#1 canonicity:** any served `public/schemas/*` or `public/api/*` byte differs
  from `openwop-ref.lock`.
- **#2 geometry:** a locked artifact is missing from `public/`, or an expected
  generated top-level dir (`spec`, `rfcs`, `conformance`, `badge`, …) is absent.

The OpenAPI/AsyncAPI `$ref`-resolution lint runs as a separate CI step against the
same deployed layout:

```bash
npx -y @redocly/cli@latest lint public/api/openapi.yaml
npx -y @asyncapi/cli@latest validate public/api/asyncapi.yaml
```

(Full source of both scripts is staged in the local proof workspace; they move
into `openwop-site/scripts/` at repo-creation time.)

---

## 8. Phased execution plan

| Phase | Work | Externally visible? |
|---|---|---|
| 0 | Decisions (this doc) | no |
| 1 | Create `openwop-site`; sparse-clone corpus at `OPENWOP_REF`; generate `openwop-ref.lock` | no |
| 2 | `git filter-repo` carve of `public/` + `site/` + scripts (history preserved); parameterize `ROOT`; commit only the 19 source files | no |
| 3 | Wire `check-published-surface.mjs` + redocly/asyncapi lint; prove byte-parity vs pin | no |
| 4 | CI: build-verify on PR; deploy on `main`; scheduled pin-bump PR job | preview only |
| 5 | Split `firebase.json`: `docs` block → `openwop-site`; openwop keeps `app` + `packs` | no (preview) |
| **6** | **Cutover:** deploy `docs` from `openwop-site` to preview → byte-parity diff vs live → promote → disable openwop `docs` deploy | **yes — single atomic Firebase release; `firebase hosting:rollback` reverts** |
| 7 | Decommission in openwop (§10); doc sync (`DEPLOY.md`, `MAINTAINERS.md`, `DESIGN.md`, `CLAUDE.md`, the `.claude/skills/{ux-review,browser,publish-whitelabel}` path refs); fix or document the `$id`-vs-served-path mismatch (finding #6) | no |

Phases 0–5 are reversible repo plumbing. The first externally-visible change is
Phase 6.

---

## 9. Evidence (proven locally against the `v1.1.7` pin)

- **Sparse checkout** of `{spec, RFCS, schemas, api, examples/hosts}` + root `.md`
  files materialized the needed surface; `sdk/`, `conformance/`, `cli/`, `apps/`,
  `site/`, `packs/`, `registry/` were **absent** — minimal dependency surface.
- **`ROOT` parameterization** ran `build-site.sh` clean against the external
  corpus (`OPENWOP_ROOT=vendor/openwop`), generating 182 files.
- **Canonicity (#1):** all 56 schemas + `openapi.yaml` + `asyncapi.yaml` +
  `openwop.proto` were **byte-identical** to the pin (generator does a pure copy,
  zero transform).
- **Lockfile:** recorded 65 wire-artifact hashes at SHA `ac3aa05a…`.
- **Deploy gate:** PASSED on a clean build; **FAILED on a one-byte tamper** of a
  served schema (negative test — the gate is real, not vacuous); restored green.

---

## 10. `openwop/openwop` after the split — pure deletion, nothing added

```
DELETE:
  public/                              271 files (19 source + 252 committed build output)
  site/                                the generator
  scripts/build-site.sh
  scripts/generate-og-cover.mjs
  scripts/check-branding.sh            (if site-only; verify no other callers)
  scripts/build-whitelabel-zip.sh      KEEP iff release flow still builds the zip asset (Decision 3)
  .github/workflows/site.yml
  package.json:   site:build, site:deploy, og-cover:build
  firebase.json:  the "docs" hosting block   (keep "app" + "packs")
  .firebaserc:    the "docs" target          (keep "app" + "packs")

ADD:
  (nothing)
```

openwop ends as the upstream source of truth — spec, schemas, app, registry,
packs — with no knowledge that a website renders it.

### Decommission checklist
- [ ] Confirm no remaining caller of the deleted scripts (`grep -rn build-site\|generate-og-cover\|check-branding`)
- [ ] `firebase.json` retains valid `app` + `packs` targets; `firebase deploy --only hosting:app,packs` works
- [ ] `.firebaserc` retains `app` + `packs`
- [ ] `npm run openwop:check` green without the removed `package.json` scripts
- [ ] Decision 3: openwop release flow uploads the white-label zip as a versioned asset (or `build-whitelabel-zip.sh` is fully removed)
- [ ] Doc sync complete (DEPLOY.md, MAINTAINERS.md, DESIGN.md, CLAUDE.md two-repo deploy note, skill path refs)
- [ ] `openwop.dev` live + verified serving the same `assets/*` hashes post-cutover

---

## 11. Progress

**Done (Phases 0–4):**
- `openwop/openwop-site` created (public); `public/`+`site/`+scripts carved with
  full history preserved (1537→108 commits).
- Generator decoupled (`ROOT`/`CORPUS` → pinned `vendor/openwop`); only the 19
  hand-authored files committed; generated output gitignored + rebuilt from the pin.
- `OPENWOP_REF=v1.1.7` + `openwop-ref.lock`; canonicity + geometry gate.
- CI: `build.yml` (gate), `deploy.yml` (WIF, gated on `ALLOW_DEPLOY`),
  `pin-bump.yml` (pull-based).

**Remaining:**
- **Operator setup** before deploys run: extend the WIF SA binding to
  `openwop/openwop-site` and set repo var `ALLOW_DEPLOY=1` (commands in
  `openwop-site/.github/workflows/deploy.yml`).
- **White-label zip** wiring (Decision 3) — builds currently pass `SKIP_WHITELABEL=1`.
- **Phase 6 cutover** — deploy `docs` from `openwop-site` → byte-parity diff vs
  live → promote → disable openwop's `docs` deploy.
- **Phase 7 decommission** in `openwop/openwop` (this repo) per §10.

---

## Appendix A — proven gate scripts (move into `openwop-site/scripts/`)

These ran green against the `v1.1.7` pin and the negative tamper test (§9).

### `scripts/openwop-pin.mjs`

```js
#!/usr/bin/env node
/**
 * openwop-pin — record the content-address of the pinned spec corpus.
 *
 * Run at pin-bump time (when OPENWOP_REF advances). Resolves the vendored
 * corpus checkout to an immutable SHA and hashes every wire-facing artifact
 * (the 56 JSON Schemas + the OpenAPI / AsyncAPI / proto contracts), writing
 * `openwop-ref.lock`. The deploy gate (`check-published-surface.mjs`) later
 * verifies the *served* bytes match these hashes — so a stale or tampered
 * publish is caught before it reaches openwop.dev.
 *
 * Usage:
 *   OPENWOP_REF=v1.1.7 OPENWOP_ROOT=vendor/openwop node scripts/openwop-pin.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const CORPUS = process.env.OPENWOP_ROOT ?? 'vendor/openwop';
const REF = process.env.OPENWOP_REF ?? 'unknown';

const sha256 = (p) => 'sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex');

// Recursively collect wire artifacts under a dir matching a predicate.
function walk(dir, pred, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

const wire = [
  ...walk(join(CORPUS, 'schemas'), (p) => p.endsWith('.schema.json')),
  join(CORPUS, 'api', 'openapi.yaml'),
  join(CORPUS, 'api', 'asyncapi.yaml'),
  join(CORPUS, 'api', 'grpc', 'openwop.proto'),
].sort();

const artifacts = {};
for (const p of wire) artifacts[relative(CORPUS, p)] = sha256(p);

let sha = 'unresolved';
try { sha = execSync(`git -C "${CORPUS}" rev-parse HEAD`).toString().trim(); } catch {}

const lock = { ref: REF, sha, artifactCount: wire.length, artifacts };
writeFileSync('openwop-ref.lock', JSON.stringify(lock, null, 2) + '\n');
console.log(`[openwop-pin] ref=${REF} sha=${sha.slice(0, 12)} artifacts=${wire.length} → openwop-ref.lock`);
```

### `scripts/check-published-surface.mjs`

```js
#!/usr/bin/env node
/**
 * check-published-surface — the deploy gate (architect findings #1 + #2).
 *
 * Runs after `build-site.sh`, before `firebase deploy`. Fails the build if:
 *   #1 CANONICITY — any wire artifact served from public/ differs, byte for
 *      byte, from the pin recorded in openwop-ref.lock. openwop.dev must never
 *      serve a schema whose $id claims canonicity while its content has drifted.
 *   #2 URL-GEOMETRY — the served path layout drifts: a wire artifact recorded
 *      in the lock is missing from public/, or an expected generated top-level
 *      directory is absent. The relative geometry (/api/openapi.yaml resolving
 *      ../schemas/*) is load-bearing for every external $ref resolver.
 *
 * Pure node stdlib. The OpenAPI/AsyncAPI $ref-resolution lint
 * (redocly / asyncapi) runs as a separate CI step against this same layout.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const PUBLIC = process.env.PUBLIC_DIR ?? 'public';
const lock = JSON.parse(readFileSync('openwop-ref.lock', 'utf8'));
const sha256 = (p) => 'sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex');

const fail = [];

// --- #1 + part of #2: every locked wire artifact is served byte-identical ---
// schemas/* serve at /schemas/*; api/* serve at /api/*.
for (const [rel, want] of Object.entries(lock.artifacts)) {
  const served = join(PUBLIC, rel); // rel already begins schemas/ or api/
  if (!existsSync(served)) { fail.push(`MISSING served artifact: /${rel}`); continue; }
  const got = sha256(served);
  if (got !== want) fail.push(`HASH MISMATCH /${rel}\n    pin:    ${want}\n    served: ${got}`);
}

// --- #2: expected generated top-level directories present ---
const EXPECTED_DIRS = [
  'spec', 'rfcs', 'conformance', 'profiles', 'badge', 'schemas',
  'api', 'changelog', 'roadmap', 'governance',
];
for (const d of EXPECTED_DIRS) {
  const p = join(PUBLIC, d);
  if (!existsSync(p) || !statSync(p).isDirectory()) fail.push(`MISSING served directory: /${d}/`);
}

// --- report ---
if (fail.length) {
  console.error(`[check-published-surface] FAIL (${fail.length}) — pin ${lock.ref} (${lock.sha.slice(0, 12)})`);
  for (const f of fail) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`[check-published-surface] OK — ${lock.artifactCount} wire artifacts byte-identical to pin ${lock.ref} (${lock.sha.slice(0, 12)}); geometry intact`);
```
