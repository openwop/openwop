---
name: update-docs
description: Sync openwop's user-facing and contributor-facing docs after a change lands. Covers README (Document index, status banners), CHANGELOG ([Unreleased] hygiene), INTEROP-MATRIX (host advertisements), ROADMAP (gap-closure tracks), RFCS/README (status table), QUICKSTART, PUBLISHING, MAINTAINERS, and the spec site templates. Distinguishes the doc surfaces openwop actually has from app-style docs (no canvases / hyves / dashboards exist here).
---

# Update Documentation (openwop)

You are now in **Docs Sync Mode**. Your task is to update openwop's documentation surfaces to reflect the changes made in the current session.

## Feature/Changes to document: $ARGUMENTS

openwop is a **wire-level spec project**. The "docs" surface here is not user-facing app help; it is contributor + implementer reference material plus the public credibility surface. The doc landscape:

| Surface | Purpose | Audience |
|---|---|---|
| `README.md` | Protocol overview + Document index table + status banners + publish-ready artifacts | First-time visitor, evaluators, decision-makers |
| `CHANGELOG.md` | Version-by-version compatibility record | Implementers tracking releases |
| `INTEROP-MATRIX.md` | Reference + third-party host advertisements | Implementers + integrators evaluating compatibility |
| `ROADMAP.md` | Planned work + closure tracks + vendor-neutral tripwire | Contributors, prospective maintainers, observers |
| `RFCS/README.md` + each `RFCS/NNNN-*.md` | Public design record + Status table | RFC reviewers, contributors |
| `CONTRIBUTING.md` | Per-artifact change rules + CI gate + DCO | Contributors |
| `COMPATIBILITY.md` | Additive vs safety-fix vs breaking commitment | Implementers + RFC authors |
| `GOVERNANCE.md` | Decision rules + maintainer roles | Maintainers, governance observers |
| `MAINTAINERS.md` | Current maintainer set | Everyone (tripwire surface) |
| `SECURITY.md` + `SECURITY/*.md` | Threat models, invariants, audit engagement | Security reviewers, threat-model consumers |
| `PUBLISHING.md` | Per-package release cadence + version axes | Maintainers when cutting a release |
| `QUICKSTART.md` + `QUICKSTART-10MIN.md` | Onboarding for first-time implementers | New host authors |
| `CODE_OF_CONDUCT.md` | Community baseline | Everyone |
| `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` | Internal track grading (A–C) | Maintainer planning |
| `docs/runbooks/` | Operational runbooks (e.g., signing-key rotation, embargoed disclosure) | Operators |
| `examples/hosts/{name}/conformance.md` | Public evidence file for each reference host | Implementers comparing hosts |
| `conformance/coverage.md` + `fixtures.md` | Coverage map + fixture catalog | Scenario authors |
| `site/templates/` + `public/` | Spec-site frontend (Firebase Hosting target) | Public visitors to `openwop.dev` |

There is **no** `src/components/docs/`, no canvas types, no design-token system. Don't write docs for those surfaces — they don't exist here.

---

## Drift patterns we've hit before (catalog)

This skill exists in large part because openwop's docs hold up multiple parallel claims about the same facts — RFC statuses, invariant counts, conformance pass rates, host capability claims — and those claims drift independently. Below is the historical-precedent catalog: each row is a real drift mode that has shipped to `main` and was caught later, with the mechanical detection command. **Always run these before declaring a docs-sync done.**

| # | Drift surface | Failure mode | Detection command |
|---|---|---|---|
| 1 | **README invariant counts ↔ `SECURITY/invariants.yaml`** | README claims "N protocol-tier / M reference-impl" but the YAML's `tier:` field counts differ — usually because invariants graduated tier and the README banner wasn't bumped. Caught by `scripts/openwop-check.sh` step 7, but worth knowing the manual recipe. | `diff <(grep -cE '^    tier: protocol$' SECURITY/invariants.yaml) <(echo $(grep -oE '[0-9]+ protocol-tier' README.md \| head -1 \| grep -oE '^[0-9]+'))` |
| 2 | **README RFC counts ↔ `RFCS/[0-9]+-*.md` Status:** | README banner says "N Accepted / M Active / K Draft" but new RFC files landed without updating the banner. Same for `41 RFCs excluding template` ↔ actual file count. | `bash scripts/openwop-check.sh` step 7 reports `claims "N" Draft RFCs but actual is M`. Manual: `grep -lE '^\\| \\*\\*Status\\*\\* \\| \`Draft\`' RFCS/[0-9]*.md \| wc -l` |
| 3 | **`docs/KNOWN-LIMITS.md` "RFCs not yet Accepted" table ↔ actual RFC Status fields** | KNOWN-LIMITS rows still list RFCs as `Active` after they were promoted to `Accepted` (or as `Draft` after promotion to `Active`). The PROTOCOL-STATUS.md generated table is authoritative; KNOWN-LIMITS is hand-maintained and lags. | `for rfc in 0025 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043; do f=RFCS/${rfc}-*.md; if ls $f &>/dev/null; then s=$(grep -oE '\`Draft\`\|\`Active\`\|\`Accepted\`\|\`Withdrawn\`' $f \| head -1); k=$(grep -oE "$rfc [^\|]*\| \`[A-Z][a-z]+\`" docs/KNOWN-LIMITS.md \| head -1); [ -n "$k" ] && echo "RFC $rfc actual=$s known-limits=$k"; fi; done` |
| 4 | **`conformance/coverage.md` "Updated YYYY-MM-DD" header stale** | The body of coverage.md gets line-edited but the top-of-file date stays at a months-old timestamp, signaling staleness even when content is fresh. | `grep -E 'Updated 20[0-9]{2}-[0-9]{2}-[0-9]{2}' conformance/coverage.md \| head -1` — compare against `git log -1 --format=%ai conformance/coverage.md`. |
| 5 | **`conformance/coverage.md` operation rows claim "endpoint surface in spec only" while host has impl** | When a reference host wires an endpoint, coverage.md often lags. Hit this on prompt endpoints — RFC 0028 promoted Draft → Active and the workflow-engine implemented all 6 `/v1/prompts*` routes, but coverage.md rows still said "reference host hasn't implemented the route yet." | `for op in createPromptTemplate updatePromptTemplate deletePromptTemplate; do  if grep -l "$op" apps/workflow-engine/backend/typescript/src/routes/*.ts examples/hosts/*/src/routes/*.ts 2>/dev/null; then echo "$op: implemented"; if grep -E "\`$op\` \\\| None.*endpoint surface in spec only" conformance/coverage.md; then echo "  but coverage.md still claims unimplemented"; fi; fi; done` |
| 6 | **`INTEROP-MATRIX.md` pass-rate table measured against an older suite version** | The "Conformance trajectory" / pass-rate table cites suite `vX.Y.Z` but `conformance/package.json` has bumped past it. New scenarios in the newer suite shift the totals significantly (e.g., +700 tests v1.1.0 → v1.4.0). | `cur=$(jq -r .version conformance/package.json); cited=$(grep -oE 'suite v[0-9]+\\.[0-9]+\\.[0-9]+' INTEROP-MATRIX.md \| head -1); echo "current=$cur cited=$cited"` |
| 7 | **`INTEROP-MATRIX.md` host-description columns carry pass-rate claims that read as current but are historical** | Host row description columns embed claims like "Conformance close-out 2026-05-12: 700/788 = 100% of applicable tests pass; zero failures" with no retrospective marker. After the table above the description is re-measured to v1.4.0, the description still reads as a current claim and conflicts with the table. | `grep -E 'Conformance close-out [0-9]{4}\|^[\| ]+Conformance posture' INTEROP-MATRIX.md \| grep -v 'suite v'` — any line that quotes a pass-rate without a `(YYYY-MM-DD, suite vX.Y.Z)` retrospective marker is suspect. |
| 8 | **`examples/hosts/<name>/conformance.md` banner stale relative to suite** | The first 5 lines of the host evidence file cite a specific suite version + run date; if these lag conformance/package.json, the evidence reads as fresh when it's not. | `cur=$(jq -r .version conformance/package.json); for h in in-memory sqlite postgres python; do f=examples/hosts/$h/conformance*.md; cited=$(grep -oE '@openwop/openwop-conformance@[0-9.]+' $f \| head -1); echo "$h: cited=$cited current=$cur"; done` |
| 9 | **`docs/PROTOCOL-STATUS.md` not regenerated after sources moved** | This file is generated by `scripts/generate-protocol-status.mjs --write`. Whenever `INTEROP-MATRIX.md` pass-rates / `SECURITY/invariants.yaml` tier counts / RFC files / SDK helper counts / registry counts change, the generator must re-run. Caught by `--check` mode in step 7. | `node scripts/generate-protocol-status.mjs --check` exits non-zero if stale. |
| 10 | **Cross-doc file paths cited in new docs don't exist** | New explanatory docs (e.g., progress trackers, audit responses) cite paths like `apps/workflow-engine/backend/typescript/src/host/mockAiProvider.ts` that aren't on disk. Erodes credibility of the very doc trying to demonstrate accountability. | `for f in docs/*.md RFCS/0042*.md RFCS/0043*.md docs/AUDIT-RESPONSE-2026-05.md docs/PHASE-4-PROGRESS.md; do [ -f "$f" ] && grep -oE '[a-z][a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+)+\.(ts\|mjs\|js\|json\|yaml\|md\|py\|go\|sh)' "$f" \| sort -u \| while read p; do [ -e "$p" ] \|\| echo "$f: MISSING $p"; done; done` |
| 11 | **Reverted feature still claimed as live** | When a commit reverts a feature (e.g., commit `5864a2f` reverted 7 sandbox SECURITY tier graduations), prose docs that mentioned the now-reverted graduation as fact (`docs/KNOWN-LIMITS.md`, `README.md` parenthetical, RFC follow-up status) need to be re-aligned. | `git log --grep='revert\|undo\|fix.*revert' --oneline -5` then scan named files. |
| 12 | **`CHANGELOG.md` `[Unreleased]` empty after a doc-only session** | Doc-sync sessions that don't add a CHANGELOG line make the next release cut surprise the reader. | `awk '/^## \\[Unreleased/,/^## \\[/' CHANGELOG.md \| grep -cE '^- \|^  - '` |

When auditing a session, walk this table from #1 to #12 and flag any row whose detection command surfaces a hit. If you find one, the corresponding row in the **Phase 4** drift-verification section below has the fix recipe.

---

## Phase 1: Audit session changes

```bash
# What changed in this session
git diff --name-only origin/main..HEAD
git status

# Group by surface
git diff --name-only origin/main..HEAD | awk '
  /^spec\/v1\// { print "spec:", $0; next }
  /^RFCS\// { print "rfc:", $0; next }
  /^schemas\// { print "schema:", $0; next }
  /^api\// { print "api:", $0; next }
  /^conformance\// { print "conformance:", $0; next }
  /^sdk\/typescript\// { print "sdk-ts:", $0; next }
  /^sdk\/python\// { print "sdk-py:", $0; next }
  /^sdk\/go\// { print "sdk-go:", $0; next }
  /^examples\/hosts\// { print "host:", $0; next }
  /^packs\// { print "pack:", $0; next }
  /^registry\// { print "registry:", $0; next }
  /^site\// { print "site:", $0; next }
  /^public\// { print "public:", $0; next }
  /^SECURITY\// { print "security:", $0; next }
  /\.md$/ { print "doc:", $0; next }
  { print "other:", $0 }
' | sort
```

Categorize changes:
- **New / changed normative surface** → README Document index, RFCs index, CHANGELOG
- **New / changed conformance scenarios + fixtures** → conformance/coverage.md, conformance/fixtures.md, conformance/CHANGELOG.md
- **New / changed SDK methods** → sdk/<lang>/CHANGELOG.md
- **Reference host advertisement change** → INTEROP-MATRIX.md row + examples/hosts/<name>/conformance.md evidence
- **Gap closed in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`** → README status banner + ROADMAP entry
- **Governance / maintainer / process change** → MAINTAINERS.md, GOVERNANCE.md, CONTRIBUTING.md
- **Security invariant or threat-model change** → SECURITY.md, SECURITY/*.md, SECURITY/invariants.yaml

Present a summary table of what needs updating before proceeding.

---

## Phase 2: Map each change to a doc edit

| Change | Update |
|---|---|
| New `spec/v1/<doc>.md` | README "Document index" — add a row with `Status: <legend>`, `Words: ~N`, `Covers: <one-line>` |
| Status promotion (STUB → DRAFT → FINAL) | README "Document index" row + README status banner if v1 FINAL change |
| New `RFCS/NNNN-<slug>.md` at Draft | `RFCS/README.md` — no edit needed (number is implicit); CHANGELOG.md `[Unreleased]` line |
| RFC Draft → Active | `RFCS/<file>.md` Status field; CHANGELOG line; if it lands a normative spec section, README Document index updated |
| RFC Active → Accepted | `RFCS/<file>.md` Status field with date; CHANGELOG line under the version block |
| New schema `schemas/<name>.schema.json` | If publicly relevant, add to `schemas/README.md` (catalog); also mentioned in the spec doc it backs |
| New endpoint in `api/openapi.yaml` | Cited in the relevant `spec/v1/<area>.md` + `rest-endpoints.md` catalog row; conformance/coverage.md scenario row |
| New event in `api/asyncapi.yaml` | Cited in `spec/v1/<area>.md` + `stream-modes.md` if stream-mode-visible; webhooks subscription register if eligible |
| New `conformance/src/scenarios/<area>.test.ts` | `conformance/coverage.md` row + `conformance/fixtures.md` row (if fixture added) |
| New fixture in `conformance/fixtures/` | `conformance/fixtures.md` catalog table + per-fixture contracts |
| `INTEROP-MATRIX.md` row change (host profile claim) | Update matrix row + `examples/hosts/<name>/conformance.md` evidence |
| SDK method addition | `sdk/<lang>/CHANGELOG.md` + `sdk/<lang>/README.md` if public-facing usage example |
| Closure of a gap in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` | Update the track grade; mark items DONE with date; if it closes a known credibility gap, update README + ROADMAP |
| New maintainer added | `MAINTAINERS.md`; if first non-steward maintainer → trip the vendor-neutral migration tripwire per `ROADMAP.md` + update `CONTRIBUTING.md` §"Bootstrap-phase notes" |
| New SECURITY invariant | `SECURITY/invariants.yaml`; mention in `SECURITY.md` if user-facing |
| New publishing artifact | `PUBLISHING.md` per-package section + README publish-ready artifacts list |
| Release cut | CHANGELOG `[Unreleased]` → dated version block; PUBLISHING.md release cadence notes |
| RFC Status field changed (Draft → Active or Active → Accepted) | Re-scan `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" — promoted RFCs leave the table; new Active/Draft RFCs join. Run `node scripts/generate-protocol-status.mjs --write` because the README banner counts will drift otherwise. |
| Conformance suite minor/major bump (`conformance/package.json` version) | Trigger a re-measurement pass against all reference hosts. Update `INTEROP-MATRIX.md` pass-rate table + each `examples/hosts/<h>/conformance*.md` banner. Publish a `docs/CONFORMANCE-RUNS-YYYY-MM.md` failure-topic taxonomy doc if the suite scenario count grew meaningfully. |
| Commit reverts a previously-announced feature (`git log --grep=revert`) | Walk every doc that mentioned the feature as live + retract or prefix with `**Reverted <sha> (YYYY-MM-DD):**`. Specifically check: `docs/KNOWN-LIMITS.md`, `README.md` status banner parentheticals, any RFC follow-up status sections, host evidence files. |
| External-audit-style review request | Treat the request itself as a drift trigger — drift modes #1, #3, #4, #6, #7 are almost always live when an external reviewer arrives. Run the full Phase 4 drift sweep before responding; publish a public `docs/AUDIT-RESPONSE-YYYY-MM.md` if the review is on the record. |

---

## Phase 3: Apply the doc edits

### README.md updates

**Document index table:** the canonical list of public spec docs. Every change to `spec/v1/` requires checking this table.

```bash
# Compare disk vs README
ls spec/v1/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sed 's|spec/v1/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
```

For each new doc, add a row:

```markdown
| [`<filename>`](./spec/v1/<filename>) | <STUB \| DRAFT \| OUTLINE \| FINAL v1> | ~N | <One-line "Covers" summary; if a post-v1 addition, append "(post-v1 addition, YYYY-MM-DD)"> |
```

**Status banner:** if FINAL v1 landed a new RFC track or closed a previously-flagged gap, update the `> **Status:** ...` block at the top. Use absolute dates.

**Publish-ready artifacts list:** if a package version bumps, update:

```markdown
> **v1.0 publish-ready artifacts.** [`@openwop/openwop`](...) · [`@openwop/openwop-conformance`](...) · [`openwop-client`](...) · [...]
```

### CHANGELOG.md updates

Top of file should have:

```markdown
## [Unreleased]

### Added
- <one-line for each additive change>

### Changed
- <one-line for each backward-compat change>

### Deprecated
- <one-line>

### Removed
- <one-line>

### Fixed
- <one-line>

### Security
- <advisory ID + one-line for safety-fix changes>
```

When cutting a release, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` and add a new empty `[Unreleased]` block on top.

For multi-package releases (suite + SDKs ship separately), each package has its own CHANGELOG (`conformance/CHANGELOG.md`, `sdk/typescript/CHANGELOG.md`). Update the right one.

### INTEROP-MATRIX.md updates

Update the host row when:
- A reference host advertises a new profile (e.g., `openwop-interrupt-quorum`)
- A reference host re-runs the suite and counts change
- A reference host downgrades a claim (honestly, never silently)

```markdown
| **<Host>** | <Use case> | `<path>` | `<profile-1>` · `<profile-2>` · `<profile-3>` | `<scale-tier>` | <Production-profile claim or "Not claimed"> | `<path-to-evidence>` |
```

Cross-update `examples/hosts/<name>/conformance.md` with:
- Suite version (e.g., `@openwop/openwop-conformance@1.0.0`)
- Command run (e.g., `OPENWOP_BASE_URL=http://localhost:3000 npx openwop-conformance`)
- Target URL class
- Pass / fail / skip counts
- Date of run

### ROADMAP.md updates

If the session closed a gap from `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`:
- Mark the gap as closed in the plan with a date
- Update the track grade (A–C)
- Cross-reference from `ROADMAP.md` if the closure changes the public roadmap timing

Vendor-neutral migration tripwire (per `MAINTAINERS.md`): if a non-steward maintainer is added, file an RFC to flip bootstrap-phase rules and announce in `ROADMAP.md`.

### RFCS/README.md updates

Add no rows (the directory is the source of truth). If the RFC process itself changes (rare), update `RFCS/README.md` §Process and reference the RFC that proposed the change.

### conformance/coverage.md updates

For each new scenario:

```markdown
| `<spec-doc>.md §<section>` | `conformance/src/scenarios/<area>.test.ts` → `<describe block>` | Covered |
```

For capability-gated scenarios, also add a row under §"Capability-gated scenarios":

```markdown
| <Capability name> | `host.<flag>.supported` | `<area>.test.ts` |
```

### conformance/fixtures.md updates

For each new fixture:

```markdown
| `<filename>.json` | `schemas/<name>.schema.json` | <one-line purpose> | `conformance/src/scenarios/<area>.test.ts` |
```

### MAINTAINERS.md + governance docs

Only edit when:
- A maintainer is added or removed (rare; high-impact)
- Governance procedure changes via an RFC (per `RFCS/0001-rfc-process.md`)
- Bootstrap-phase rules flip (per `CONTRIBUTING.md` §"Bootstrap-phase notes" — first non-steward maintainer)

### QUICKSTART updates

Only edit when:
- A documented quickstart command stops working
- A new "hello world" path opens (e.g., a new reference host)
- The 10-minute version drifts substantially from the longer version

### Spec site (`site/` + `public/`)

If the change adds a new spec doc, the site regeneration picks it up automatically — `site/src/build.mjs` reads `spec/v1/` at build time. But:
- If `site/templates/` references a doc by name (rare), update the template
- If `public/index.html` carries a version/status banner that drifts, update it (gitStatus shows `public/index.html` and `public/styles.css` are currently modified)
- Run `( cd site && node src/build.mjs )` to confirm clean build

---

## Phase 4: Spec-corpus drift verification

Run these checks before marking docs complete. Each section corresponds to a numbered drift mode in the catalog at the top of this skill — use that table to triage the failure, then apply the fix recipe here.

### Drift #1, #2, #9 — generated-status gate (the catch-all)

```bash
bash scripts/openwop-check.sh 2>&1 | grep -A20 '\[7/9\] Generated protocol status'
# OR isolated:
node scripts/generate-protocol-status.mjs --check
```

Any non-zero exit means one of:
- README claimed `N protocol-tier` invariants but YAML has different count → fix the README banner.
- README claimed `N` Draft RFCs but actual count differs → fix the README banner (new RFCs landed without bumping it).
- `docs/PROTOCOL-STATUS.md` is stale → run `node scripts/generate-protocol-status.mjs --write` and commit. Per the memory note `feedback_generator_changelog_split`: if the regen also writes CHANGELOG, split into a `chore(docs)` commit first so generator-authored entries don't muddle authored narrative.

### Drift #3 — `docs/KNOWN-LIMITS.md` RFC status table

The "RFCs not yet Accepted" table at the bottom of KNOWN-LIMITS hand-curates per-RFC commentary on why each open RFC is still open. It lags reality after RFC promotions.

```bash
# Walk every Active+Draft RFC and confirm KNOWN-LIMITS lists it correctly
for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  id=$(basename "$f" | grep -oE '^[0-9]+')
  s=$(grep -oE '`Draft`|`Active`|`Accepted`|`Withdrawn`|`Superseded`' "$f" | head -1)
  [ "$s" = '`Accepted`' ] && continue  # Accepted shouldn't appear in KNOWN-LIMITS open table
  k=$(grep -E "^\| ($id|0*$id)[^|]*\|" docs/KNOWN-LIMITS.md | head -1)
  if [ -z "$k" ]; then
    echo "RFC $id ($s) — MISSING from docs/KNOWN-LIMITS.md open RFC table"
  fi
done
```

Fix recipe: open `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" and either add the missing row (with status + "Why open" cell) or remove rows for RFCs that have since been promoted.

### Drift #4 — `conformance/coverage.md` "Updated" header

```bash
header_date=$(grep -oE 'Updated 20[0-9]{2}-[0-9]{2}-[0-9]{2}' conformance/coverage.md | head -1 | grep -oE '[0-9-]+$')
last_edit=$(git log -1 --format=%ad --date=short conformance/coverage.md)
echo "header=$header_date  last-edit=$last_edit"
```

If `header_date < last_edit` by more than ~14 days, bump the header to today's date during this docs-sync.

### Drift #5 — `conformance/coverage.md` "endpoint surface in spec only" rows

When a host wires a previously-spec-only endpoint, the corresponding `/v1/operation` row in coverage.md's REST surface table must move from "None — endpoint surface in spec only" → a scenario citation.

```bash
# Heuristic — find operation names that coverage.md still calls unimplemented
grep -E '^\| `[a-z][a-zA-Z]+` \| None' conformance/coverage.md | grep -oE '`[a-z][a-zA-Z]+`' | sort -u | while read op; do
  clean=${op//\`/}
  if grep -rln "$clean" apps/workflow-engine/backend/typescript/src/routes/ examples/hosts/*/src/routes/ 2>/dev/null | head -1 >/dev/null; then
    echo "$op: coverage.md says unimplemented but found impl in: "
    grep -rln "$clean" apps/workflow-engine/backend/typescript/src/routes/ examples/hosts/*/src/routes/ 2>/dev/null | head -3
  fi
done
```

Fix recipe: rewrite each row to cite the implementing host + the conformance scenario that covers it.

### Drift #6 — INTEROP-MATRIX pass-rate vs current suite version

```bash
cur=$(jq -r .version conformance/package.json)
cited=$(grep -oE 'against suite v[0-9]+\.[0-9]+\.[0-9]+' INTEROP-MATRIX.md | head -1 | grep -oE '[0-9.]+')
echo "current=$cur cited=$cited"
[ "$cur" != "$cited" ] && echo "STALE — re-measure all 4 hosts against suite $cur and update INTEROP-MATRIX + per-host conformance.md banners + run \`node scripts/generate-protocol-status.mjs --write\`"
```

Fix recipe: run the conformance suite against each reference host (in-memory / sqlite / postgres-pglite / python) and re-record the four-bucket counts (pass / fail / skip / todo) in INTEROP-MATRIX. Publish a per-failure-topic taxonomy doc (`docs/CONFORMANCE-RUNS-YYYY-MM.md`) per the `audit-response-2026-05` precedent.

### Drift #7 — INTEROP-MATRIX host-description columns with unqualified historical pass-rates

```bash
grep -nE 'Conformance close-out [0-9]{4}|Conformance posture' INTEROP-MATRIX.md | grep -vE 'suite v[0-9]+\.[0-9]+\.[0-9]+' | head -10
```

Each hit is a host-row description that quotes a pass-rate without a `(YYYY-MM-DD, suite vX.Y.Z)` retrospective marker. Fix recipe — prefix the claim:

```diff
- **Conformance close-out 2026-05-12:** 700/788 = **100% of applicable tests pass; zero failures**
+ **Conformance close-out (2026-05-12, suite v1.1.0):** 700/788 = **100% of applicable tests pass; zero failures** — retained for historical context; see the pass-rate table below for the current suite version.
```

### Drift #8 — Per-host conformance.md banner ↔ current suite

```bash
cur=$(jq -r .version conformance/package.json)
for h in in-memory sqlite postgres python; do
  for f in examples/hosts/$h/conformance.md examples/hosts/$h/conformance-full.md; do
    [ -f "$f" ] || continue
    cited=$(grep -oE '@openwop/openwop-conformance@[0-9.]+' "$f" | head -1 | grep -oE '[0-9.]+')
    if [ "$cited" != "$cur" ]; then
      echo "$f: cited=$cited current=$cur — re-measure or add a 'Latest measurement' banner"
    fi
  done
done
```

Fix recipe: either re-run the suite for that host and update the banner, or — if the prior measurement is still the most recent — prefix the existing banner with a retrospective date + suite-version marker (same pattern as Drift #7).

### Drift #10 — Cross-doc file paths cited in new docs don't exist

```bash
for f in docs/*.md RFCS/[0-9]*.md $(git diff --name-only origin/main..HEAD | grep '\.md$'); do
  [ -f "$f" ] || continue
  grep -oE '[a-z][a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+){1,}\.(ts|mjs|js|json|yaml|md|py|go|sh)' "$f" \
    | sort -u | while read p; do
    [ -e "$p" ] || echo "$f: MISSING $p"
  done
done | grep -v 'examples/packs\|node_modules' | head -30
```

Each MISSING hit is a doc that promises a file path that doesn't resolve on disk. Fix recipe: either correct the cited path or move the cited claim from a path reference to a prose description (e.g., "the mock-AI provider, currently in `aiProviders/aiProvidersHost.ts`, gains …").

### Drift #11 — Reverted features still claimed as live in prose

```bash
# Walk recent revert commits and check whether docs still cite the reverted feature as live
git log --grep='revert\|undo\|fix.*revert' --oneline -10 | while read sha _ rest; do
  echo "=== $sha $rest ==="
  git show "$sha" --stat | head -20
done
```

For each revert, manually scan: did `docs/KNOWN-LIMITS.md`, `README.md`, RFC follow-up sections, or related host evidence files still say the reverted feature is in effect? If so, prefix with a `**Reverted 5864a2f (YYYY-MM-DD):**` marker or remove the stale claim.

### Drift #12 — `CHANGELOG.md` `[Unreleased]` empty after a non-trivial session

```bash
sed -n '/^## \[Unreleased\]/,/^## \[/p' CHANGELOG.md | tail -n +2 | head -40
```

If the section is empty or contains only the next-version-header, and the current session shipped anything more than a typo fix, add a one-line entry. Use existing house-style: multi-paragraph descriptive blocks are normal in this repo (the Conventional Commits style is in the commit message, not the CHANGELOG).

### Doc index parity

```bash
ls spec/v1/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sed 's|spec/v1/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
```

### Word count drift in README rows

```bash
for row in $(grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sort -u); do
  if [[ -f "$row" ]]; then
    actual=$(wc -w "$row" | awk '{print $1}')
    claimed=$(grep -E "\[\`$(basename $row)\`\]" README.md | head -1)
    echo "$row: actual=$actual claimed=\"$claimed\""
  fi
done | head -20
```

Round word counts to nearest 50 in README.

### CHANGELOG `[Unreleased]` non-empty

```bash
sed -n '/^## \[Unreleased\]/,/^## \[/p' CHANGELOG.md | head -40
```

A non-trivial change SHOULD add at least one line. If the line is missing, add it.

### INTEROP-MATRIX honesty

```bash
# Each row's evidence file exists
grep -E '^\| \*\*' INTEROP-MATRIX.md | awk -F '|' '{print $7}' | sed 's/^ //; s/ $//' | while read evidence; do
  [[ -z "$evidence" || "$evidence" == "evidence" ]] && continue
  [[ -f "$evidence" ]] || echo "MISSING EVIDENCE FILE: $evidence"
done
```

### Reference-host evidence file freshness

```bash
for host in in-memory sqlite python; do
  evidence="examples/hosts/$host/conformance.md"
  [[ -f "$evidence" ]] || continue
  echo "=== $evidence ==="
  grep -E "Suite version|date|run on" "$evidence" | head -3
done
```

If suite version cited is older than current `conformance/package.json` version, flag for `/update-conformance`.

### TypeScript build (when README claims publish-ready artifacts)

```bash
( cd sdk/typescript && npx tsc --noEmit )
( cd conformance && npx tsc --noEmit )
```

### Final visual verification

Recommend the user view:
- `README.md` rendered on GitHub
- `openwop.dev` (after `firebase deploy --only hosting` if site changed)
- `RFCS/<any new RFC>.md` rendered
- The relevant `spec/v1/<doc>.md` to confirm normative voice unchanged

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` / `next` | Move to next phase |
| `back` | Go to previous phase |
| `skip to phase N` | Jump to phase N |
| `audit only` | Run Phase 1 only — report what needs updating |
| `drift sweep` | Run the 12-mode drift catalog from top of skill — report every hit before fixing anything |
| `index-parity` | Run the doc-index drift check |
| `evidence-refresh <host>` | Update `examples/hosts/<host>/conformance.md` after a rerun |
| `re-measure all hosts` | Run the conformance suite against in-memory + sqlite + postgres-pglite + python; update INTEROP-MATRIX + per-host banners; regen PROTOCOL-STATUS |
| `rfc-status-sync` | Walk every RFCS/NNNN-*.md, compare its `Status:` field to `docs/KNOWN-LIMITS.md` open-RFC table + `docs/PROTOCOL-STATUS.md` RFC table + `README.md` banner counts; report mismatches |
| `changelog <package>` | Show or edit a per-package CHANGELOG |
| `verify` | Run Phase 4 verification |
| `done` | Complete documentation update |

---

## Quick Reference

| What | Where |
|---|---|
| Spec doc index | `README.md` § "Document index" |
| Spec docs themselves | `spec/v1/*.md` |
| RFC archive | `RFCS/` (each `NNNN-<slug>.md` carries Status) |
| Version-by-version compat record | `CHANGELOG.md` (root) + `conformance/CHANGELOG.md` + `sdk/typescript/CHANGELOG.md` |
| Host advertisement matrix | `INTEROP-MATRIX.md` + per-host `conformance.md` |
| Planned work + tripwires | `ROADMAP.md` |
| Internal gap tracking | `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` |
| Per-artifact change rules | `CONTRIBUTING.md` |
| Compatibility commitment | `COMPATIBILITY.md` |
| Governance + maintainers | `GOVERNANCE.md` + `MAINTAINERS.md` |
| Security policy + threat models | `SECURITY.md` + `SECURITY/*` |
| Release cadence + packages | `PUBLISHING.md` |
| Onboarding | `QUICKSTART.md`, `QUICKSTART-10MIN.md` |
| Coverage map | `conformance/coverage.md` |
| Fixture catalog | `conformance/fixtures.md` |
| Spec site frontend | `site/templates/`, `public/index.html`, `public/styles.css` |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/ux-review` | Prose readability + RFC 2119 + cross-link integrity on touched docs |
| `/update-conformance` | Sync conformance/ scenarios, fixtures, coverage.md, fixtures.md |
| `/browser` | Validate site renders the updated corpus correctly |
| `/cleanup` | Address stale CHANGELOG entries, dead links, dishonest INTEROP-MATRIX claims |
| `/pr` | Create the PR — applies `openwop-spec` label when the doc edit touches the corpus |
