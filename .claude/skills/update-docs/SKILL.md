---
name: update-docs
description: Sync openwop's user-facing and contributor-facing docs after a change lands. Covers README (status, RFC-status banner, Published artifacts line, the spec/v2/core Document index and its Total), CHANGELOG ([Unreleased] hygiene), INTEROP-MATRIX (host rows read from evidence/v2-host-bundles), ROADMAP, KNOWN-LIMITS, RFCS/README, QUICKSTART, PUBLISHING, MAINTAINERS, and the openwop-site build. Distinguishes the doc surfaces openwop actually has from app-style docs (no canvases / hyves / dashboards exist here).
---

# Update Documentation (openwop)

You are now in **Docs Sync Mode**. Update openwop's documentation surfaces to reflect the changes made in the current session.

## Feature/Changes to document: $ARGUMENTS

openwop is a **wire-level spec project**. Its docs are contributor and implementer reference material plus the public credibility surface. The current major is v2; `spec/v1/` is a frozen tree (v1 reached end of support on 2026-10-04, RFC 0234) and is never edited.

| Surface | Purpose | Audience |
|---|---|---|
| `README.md` | Status, RFC-status banner, Published artifacts, v2 Document index | First-time visitors, evaluators |
| `CHANGELOG.md` | One short entry per corpus release, `[Unreleased]` on top | Implementers tracking releases |
| `conformance/CHANGELOG.md` | One heading per suite release cycle | Host authors running the suite |
| `INTEROP-MATRIX.md` | Host rows; counts read from `evidence/v2-host-bundles/*.json` | Integrators evaluating hosts |
| `ROADMAP.md` | Planned work | Contributors, observers |
| `docs/KNOWN-LIMITS.md` | What the protocol does not yet prove, incl. §"RFCs not yet `Accepted`" | Evaluators |
| `RFCS/README.md` + `RFCS/NNNN-*.md` | Design record; each RFC carries its Status | RFC reviewers |
| `CONTRIBUTING.md` | Per-artifact change rules, CI gate, DCO | Contributors |
| `COMPATIBILITY.md` | Additive vs safety-fix vs breaking | Implementers, RFC authors |
| `GOVERNANCE.md`, `MAINTAINERS.md` | Decision rules, maintainer set | Maintainers |
| `SECURITY.md` + `SECURITY/` | Threat models, `invariants.yaml`, response SLA | Security reviewers |
| `PUBLISHING.md` | The two npm packages and the release procedure | Maintainers cutting a release |
| `QUICKSTART.md`, `QUICKSTART-10MIN.md`, `docs/IMPLEMENT-CORE.md` | Onboarding | New host authors |
| `docs/runbooks/` | Operational runbooks (key rotation, incident response, ...) | Operators |
| `conformance/coverage.md`, `conformance/fixtures.md` | Coverage map, fixture catalog | Scenario authors |
| `../openwop-site` | Builds `openwop.dev` from this corpus (`scripts/build-site.sh`) | Public visitors |

Generated files — never hand-edit, regenerate: `docs/PROTOCOL-STATUS.md`, `docs/ASSURANCE-STATUS.*`, `docs/V2-WITNESS-COVERAGE.md`, `docs/SECTION-B-REVIEW-PACKET.md`, `spec-artifacts/**`, `conformance/requirements.json`, `conformance/scenario-majors.json`, `api/v2/*`, `schemas/v2/capabilities.schema.json`, `evidence/v1-end-of-support.json`.

SDK docs and changelogs live in `openwop/openwop-sdks`; host evidence and examples in `openwop/openwop-examples`. This repo has no `sdk/`, `examples/`, `site/`, `apps/`, `packs/`, or `registry/` directory.

---

## Phase 1: Audit session changes

```bash
git fetch origin -q
git diff --name-only origin/main...HEAD
git status -sb

git diff --name-only origin/main...HEAD | awk '
  /^spec\/v2\// { print "spec-v2:", $0; next }
  /^spec\/v1\// { print "spec-v1 (FROZEN — should not change):", $0; next }
  /^RFCS\// { print "rfc:", $0; next }
  /^schemas\// { print "schema:", $0; next }
  /^api\// { print "api:", $0; next }
  /^conformance\// { print "conformance:", $0; next }
  /^SECURITY\// { print "security:", $0; next }
  /^evidence\// { print "evidence:", $0; next }
  /^scripts\// { print "script:", $0; next }
  /\.md$/ { print "doc:", $0; next }
  { print "other:", $0 }
' | sort
```

Categorize:
- **New or changed normative surface** (`spec/v2/core`, `spec/v2/ext`, `spec/v2/declaration.json`) → README Document index, CHANGELOG
- **Conformance scenarios or fixtures** → `conformance/coverage.md`, `conformance/fixtures.md`, `conformance/CHANGELOG.md`
- **Host evidence** (`evidence/v2-host-bundles/`) → `INTEROP-MATRIX.md` row
- **RFC status change** → README RFC-status banner, `docs/KNOWN-LIMITS.md`, regenerate `docs/PROTOCOL-STATUS.md`
- **Governance or process** → `MAINTAINERS.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`
- **Security invariant or threat model** → `SECURITY.md`, `SECURITY/`

Present a summary table of what needs updating before proceeding.

---

## Phase 2: Map each change to a doc edit

| Change | Update |
|---|---|
| New `spec/v2/core/<doc>.md` | README Document index row and **Total** (see Phase 3) |
| New `spec/v2/ext/<doc>.md` | `spec/v2/README.md` if it lists extensions |
| New RFC at Draft | CHANGELOG `[Unreleased]` line |
| RFC Draft → Active or Active → Accepted | RFC Status field; CHANGELOG line; README RFC-status banner (counts and the enumerated Active/Draft ids); `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`"; regenerate `docs/PROTOCOL-STATUS.md` |
| New schema under `schemas/v2/` | Cited by the spec doc it backs |
| New v2 endpoint or event | Cited in the owning `spec/v2/core` doc; coverage.md row |
| New scenario `conformance/src/scenarios/v2-*.test.ts` | coverage.md row; fixtures.md if a fixture was added |
| New fixture | `conformance/fixtures.md` catalog + per-fixture contract |
| New or re-cut host bundle | `INTEROP-MATRIX.md` row (counts from the bundle) |
| New SECURITY invariant | `SECURITY/invariants.yaml`; tallies in SECURITY.md §8 and the README banner |
| Release cut | `/release` owns the version sites and the CHANGELOG roll |
| New maintainer | `MAINTAINERS.md`; follow `GOVERNANCE.md` |
| Revert of an announced feature | Every doc that called it live |

---

## Phase 3: Apply the doc edits

### README.md

**Document index.** The table under `## Document index` lists every `spec/v2/core/*.md` exactly once, two columns: link and a one-line summary.

```markdown
| [`<doc>.md`](./spec/v2/core/<doc>.md) | <one-line summary> |
```

The line after the table is `**Total**: N docs.` and N MUST equal `ls spec/v2/core/*.md | wc -l`. `conformance/src/coherence/spec-corpus-validity.test.ts` enforces both rules.

**RFC-status banner.** The `> **RFC status (N RFCs excluding template):**` line states the Accepted / Active / Draft counts and enumerates the Active and Draft ids. `--write` does not rewrite it; edit it by hand, then confirm with `node scripts/generate-protocol-status.mjs --check`.

**Published artifacts.** The `> **Published artifacts.**` line names the conformance version three times. `/release` bumps it; don't change it in a docs sync.

### CHANGELOG.md

The top heading is `## [Unreleased]`. Add one short bullet per change: what changed and why a reader cares, no development narrative. Released versions read `## [X.Y.Z] — YYYY-MM-DD — <title>`. Check the shape with `node scripts/check-changelog-shape.mjs`.

Suite changes go in `conformance/CHANGELOG.md` under the open cycle's heading.

### INTEROP-MATRIX.md

Each host row cites its bundle in `evidence/v2-host-bundles/`. Read the counts from the bundle; never type them from memory. A host that downgrades a claim says so in its row.

### docs/KNOWN-LIMITS.md

When an RFC changes status, update §"RFCs not yet `Accepted`": promoted RFCs leave the table, newly Active or Draft RFCs join it. A row naming several RFCs is split, not removed, when only some of them are promoted.

### conformance/coverage.md and fixtures.md

Add a row to §"Coverage by protocol surface" for each new scenario, and a family row under §"Capability-gated scenarios: shape vs behavior" for gated ones. Add every new fixture to `fixtures.md`.

### MAINTAINERS.md and governance docs

Only when a maintainer is added or removed, or an RFC changes governance (`RFCS/0001-rfc-process.md`).

### QUICKSTART

Only when a documented command stops working or a new starting path opens.

### Spec site (`../openwop-site`)

The site renders `spec/v2/` and publishes schemas at their `$id`: `schemas/v2/` and the `spec/v2/*.json` registries under `/spec/v2/`, v1 schemas under `/spec/v1/`. It deploys from `openwop/openwop-site`, not from this repo. If `schemas/` or `api/` changed, build the site and confirm every declared `$id` is served:

```bash
SITE=../openwop-site
CORPUS="$(pwd)"
( cd "$SITE" && OPENWOP_ROOT="$CORPUS" bash scripts/build-site.sh >/dev/null 2>&1 )
for f in $(find schemas/v2 spec/v2 -name '*.schema.json'); do
  u=$(grep -oE '"\$id": *"https://openwop.dev/spec/v2/[^"]+' "$f" | grep -oE 'https://[^"]+' | head -1)
  [ -z "$u" ] && continue
  [ -f "$SITE/public${u#https://openwop.dev}" ] || echo "UNSERVED $u ($f)"
done
```

Never "fix" an unserved schema by changing its `$id`; fix the site build.

---

## Phase 4: Drift verification

Run these before declaring the sync done. Reproduce any failure on a fresh `origin/main` worktree first: the shared checkout drifts behind `origin/main` and carries other sessions' uncommitted edits, so a failure there may not be a repo bug.

```bash
git fetch origin -q
git worktree add ../owp-verify origin/main --detach
( cd ../owp-verify && node scripts/generate-protocol-status.mjs --check )
git worktree remove ../owp-verify --force
```

### 1. Generated status and RFC banner

```bash
node scripts/generate-protocol-status.mjs --check
```

Covers the README RFC-status banner (counts and enumerated ids) and `docs/PROTOCOL-STATUS.md`. If the generated file is stale, regenerate it through the regen chain (see the end of this phase).

### 2. Hand-typed tallies

```bash
node scripts/check-doc-tallies.mjs
```

Covers `SECURITY/invariants.yaml` counts in SECURITY.md §8 and the README banner, the scenario-file count in `conformance/README.md`, and the response-SLA numbers in SECURITY.md and GOVERNANCE.md.

### 3. Document index and Total

```bash
ls spec/v2/core/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v2/core/[a-z0-9-]+\.md' README.md | sed 's|spec/v2/core/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
echo "disk=$(ls spec/v2/core/*.md | wc -l | tr -d ' ') readme=$(grep -oE '\*\*Total\*\*: [0-9]+' README.md | grep -oE '[0-9]+')"
```

### 4. KNOWN-LIMITS open-RFC table

```bash
KL_OPEN=$(awk '/^## RFCs not yet `Accepted`/{flag=1;next} /^## /{flag=0} flag' docs/KNOWN-LIMITS.md)
for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  case "$(basename "$f")" in 0000-template.md|*.*.md) continue;; esac
  id=$(basename "$f" | grep -oE '^[0-9]+')
  s=$(grep -m1 -oE '`Draft`|`Active`|`Accepted`|`Withdrawn`|`Superseded`' "$f")
  hit=$(echo "$KL_OPEN" | grep -E "^\|[^|]*(^| )0*${id}([, )]|$)" | head -1)
  if [ "$s" = '`Accepted`' ] && [ -n "$hit" ]; then echo "RFC $id is Accepted but still in the open table"; fi
  if { [ "$s" = '`Active`' ] || [ "$s" = '`Draft`' ]; } && [ -z "$hit" ]; then echo "RFC $id ($s) missing from the open table"; fi
done
```

### 5. INTEROP-MATRIX evidence links

```bash
grep -oE '\./evidence/v2-host-bundles/[^)]+\.json' INTEROP-MATRIX.md | sort -u | while read p; do
  [ -f "$p" ] || echo "MISSING EVIDENCE FILE: $p"
done
```

Compare each row's pass / fail / skip counts against its bundle's per-requirement `result` values.

### 6. Version pins

```bash
cur=$(jq -r .version conformance/package.json)
a=$(grep -oE 'EXPECTED_CONFORMANCE_VERSION="[0-9.]+"' scripts/openwop-check-publish-metadata.sh | grep -oE '[0-9.]+')
b=$(grep -oE "conformancePack.version === '[0-9.]+'" scripts/check-npm-pack-contents.sh | grep -oE '[0-9.]+')
echo "pkg=$cur metadata=$a packcontents=$b"
```

A mismatch means a version bump was partial; `/release` lists every version site.

### 7. Paths cited in changed docs exist

```bash
for f in $(git diff --name-only origin/main...HEAD | grep '\.md$'); do
  [ -f "$f" ] || continue
  grep -oE '\]\(\.?\.?/?[^)#: ]+' "$f" | sed 's/^](//' | sort -u | while read p; do
    [ -e "$(dirname "$f")/$p" ] || [ -e "$p" ] || echo "$f: MISSING $p"
  done
done
```

Inspect each hit before fixing; links to sibling repos (`../openwop-examples/...`) resolve only when that checkout exists.

### 8. Vacuous gated scenarios

A gated scenario may skip only before the host has opted in (family not advertised, seam absent). After the host has opted in, missing evidence is a failure. Look for evidence assertions hidden behind a guard:

```bash
grep -rnE 'if \([a-zA-Z]+Q?\.(ok|events\.length|status)\b' conformance/src/scenarios/v2-*.test.ts | grep -v 'return softSkip'
grep -rnE '\.length <= 1|\.length > 0\)' conformance/src/scenarios/v2-*.test.ts
```

### 9. Unpinned validators

```bash
grep -nE "npx -y[^@]*@latest" scripts/openwop-check.sh .github/workflows/*.yml
```

The gate pins `@redocly/cli@2.31.4` and `@asyncapi/cli@4.1.1`. Any `@latest` is a regression.

### 10. Internal labels and stale version talk in public prose

```bash
grep -rnE "Phase [0-9A-Z]\b|Track #[0-9]" --include='*.md' README.md QUICKSTART*.md docs/*.md | head -20
grep -rnE "spec/v1/" README.md QUICKSTART*.md docs/IMPLEMENT-CORE.md | head -20
```

Internal sequencing labels mean nothing to an outside reader; replace with the feature name and RFC number. Never rename a wire field or env var that carries the label. A `spec/v1/` link in a current-state doc should usually point at the v2 home instead.

### Meta-lesson: prove a guard bites

A check written as `if (match && match !== actual) fail()` passes silently the moment its regex stops matching. After fixing any count, re-introduce the stale value once, run the check, and confirm it fails.

### Regenerate, then gate

If any generated file needs refreshing, run the whole regen chain, in order, immediately before the gate:

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && \
node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && \
node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && \
node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && \
node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && \
node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write
npm run openwop:check
```

### Final visual check

Recommend the user view:
- `README.md` rendered on GitHub
- `openwop.dev` after the site redeploys from `openwop/openwop-site`
- Any new RFC rendered
- The touched `spec/v2/core/<doc>.md`, to confirm the normative voice is unchanged

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` / `next` | Move to the next phase |
| `back` | Go to the previous phase |
| `skip to phase N` | Jump to phase N |
| `audit only` | Run Phase 1 only |
| `drift sweep` | Run every Phase 4 check and report hits before fixing |
| `index-parity` | Run check 3 |
| `rfc-status-sync` | Compare each RFC's Status to the README banner, KNOWN-LIMITS, and PROTOCOL-STATUS |
| `verify` | Run Phase 4 |
| `done` | Complete the documentation update |

---

## Quick Reference

| What | Where |
|---|---|
| Spec doc index | `README.md` § "Document index" |
| Normative spec | `spec/v2/core/*.md`, `spec/v2/ext/`, `spec/v2/declaration.json` |
| Frozen v1 | `spec/v1/` |
| RFC archive | `RFCS/` |
| Release record | `CHANGELOG.md`, `conformance/CHANGELOG.md` |
| Host evidence | `evidence/v2-host-bundles/*.json`, summarized in `INTEROP-MATRIX.md` |
| Known limits | `docs/KNOWN-LIMITS.md` |
| Generated status | `docs/PROTOCOL-STATUS.md` (`scripts/generate-protocol-status.mjs`) |
| Change rules | `CONTRIBUTING.md` |
| Compatibility | `COMPATIBILITY.md` |
| Governance | `GOVERNANCE.md`, `MAINTAINERS.md` |
| Security | `SECURITY.md`, `SECURITY/` |
| Release procedure | `PUBLISHING.md` |
| Onboarding | `QUICKSTART.md`, `QUICKSTART-10MIN.md`, `docs/IMPLEMENT-CORE.md` |
| Coverage map, fixtures | `conformance/coverage.md`, `conformance/fixtures.md` |
| Site build | `../openwop-site/scripts/build-site.sh` |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/ux-review` | Readability, RFC 2119, and link integrity on touched docs |
| `/spec-readability` | Rewrite v2 spec prose for readability without changing a rule |
| `/update-conformance` | Sync scenarios, fixtures, coverage.md, fixtures.md |
| `/release` | Version sites, CHANGELOG roll, publish |
| `/cleanup` | Stale entries, dead links, dishonest INTEROP-MATRIX claims |
| `/pr` | Create the PR — applies the `openwop-spec` label when the corpus is touched |
