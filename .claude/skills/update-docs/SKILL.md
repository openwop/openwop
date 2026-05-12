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

Run these checks before marking docs complete:

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
| `index-parity` | Run the doc-index drift check |
| `evidence-refresh <host>` | Update `examples/hosts/<host>/conformance.md` after a rerun |
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
