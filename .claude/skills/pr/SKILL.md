---
name: pr
description: Create a structured pull request for openwop. Detects lane (spec / RFC / schema+API / conformance / release / tooling / docs), generates the body from the actual diff, enforces DCO + Conventional Commits + CHANGELOG + the regen chain and 10-step openwop:check pre-flight, and applies the `openwop-spec` label when the spec corpus is touched.
---

# Create Pull Request (openwop)

Create a well-structured pull request for the current branch's changes against `main`.

## Optional context: $ARGUMENTS

---

## Step 1: Gather context

Work in your own worktree, branched from `origin/main` (see `CLAUDE.md`). Check you are not behind before doing anything else.

```bash
git fetch origin
git status -sb                      # "behind N" → git merge origin/main first
git branch --show-current

# All commits on this branch
git log origin/main..HEAD --oneline

# Changed files with stats
git diff origin/main...HEAD --stat

# Uncommitted changes
git status
```

**Read every changed file.** Do not write PR content from filenames alone.

This repo holds the spec corpus and the conformance suite only. SDK, reference-host, registry, site and app changes belong in their own repos (`openwop/openwop-sdks`, `openwop/openwop-examples`, `openwop/openwop-registry`, `openwop/openwop-site`, `openwop/openwop-app`); open those PRs there.

---

## Step 2: Classify the lane

The lane sets the title prefix, the body template and the label. Match the prefixes in recent history (`git log origin/main --format=%s -40`).

| Lane | Surfaces touched | Title prefix | `openwop-spec` label |
|---|---|---|---|
| **RFC** | `RFCS/NNNN-*.md`, plus its gap/risk registers | `rfc(NNNN):` | yes |
| **Spec (normative)** | `spec/v2/core/`, `spec/v2/ext/`, `spec/v2/*.json` (declaration, facets, errors, …) | `spec(<doc>):` | yes |
| **Schema / API** | `schemas/v2/`, `api/openapi.yaml` + `scripts/derive-v2-api.py` (the source of `api/v2/`), `api/v2/` | `spec(<area>):` | yes |
| **Conformance** | `conformance/` | `conformance(X.Y.Z):` | yes |
| **Errata** | a correction to published text or a scenario | `errata(X.Y.Z):` | yes |
| **Release** | the version sites + `CHANGELOG.md` collapse (see `/release`) | `release(X.Y.Z):` | yes |
| **Tooling / build** | `scripts/`, `.github/`, root `package.json` | `build:` / `chore:` | yes if a generator or gate check changed (see Step 6) |
| **Documentation** | `README.md`, `ROADMAP.md`, `INTEROP-MATRIX.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `docs/` | `docs(<area>):` | no |

`spec/v1/` is frozen (v1 reached end of support under RFC 0234). A PR that edits it needs an explicit reason, such as a migration-table correction.

For a normative change, classify compatibility (additive / safety-fix / breaking / v2 retirement) per `COMPATIBILITY.md` §2.4, §3 and §3a. The body template needs this line.

---

## Step 3: Analyze changes

| Category | Files | Summary |
|---|---|---|
| Normative prose (`spec/v2/core/`, `spec/v2/ext/`) | … | Sections and RFC 2119 keywords changed |
| Families (`spec/v2/declaration.json`, `spec/v2/facets/`) | … | Family rows / facets added or changed |
| RFC (`RFCS/`) | … | RFC NNNN — Draft / Active / Accepted |
| Schemas (`schemas/v2/`) | … | Field added / removed / type-changed |
| API (`api/openapi.yaml`, `scripts/derive-v2-api.py`, `api/v2/`) | … | Endpoint / channel diff |
| Conformance (`conformance/`) | … | Scenarios, fixtures, `scenario-majors.json` rows |
| Generated surfaces | … | Regenerated, not hand-edited |
| Tooling (`scripts/`, `.github/`) | … | Generators, gate checks, workflows |
| Documentation | … | README / ROADMAP / INTEROP-MATRIX / docs |

Determine the **primary lane** for the title and the **compatibility classification** for the body.

---

## Step 4: Pre-flight checks (mandatory)

Run the regen chain, then the same gate CI runs. A late edit re-stales a generated surface, so run the chain immediately before the gate.

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write

# The 10-step gate (scripts/openwop-check.sh)
npm run openwop:check 2>&1 | tee "${TMPDIR:-/tmp}/pr-precheck.log"

# CHANGELOG entry under [Unreleased] for any spec / schema / conformance change
git diff origin/main...HEAD -- CHANGELOG.md
node scripts/check-changelog-shape.mjs

# DCO: every commit signed?
git log origin/main..HEAD --format='%H %s' | while read -r sha subject; do
  git log -1 "$sha" --format='%b' | grep -q '^Signed-off-by:' || echo "MISSING DCO on $sha: $subject"
done
```

Commit any regenerated files the chain changed. Fix every failure before opening the PR. `npm run openwop:check` is the merge gate; `CONTRIBUTING.md` §"The CI gate" and §"Sign your commits (DCO)" state the rules, including the current steward exemption from the DCO trailer.

---

## Step 5: Generate PR content

### Title rules
- Conventional Commits prefix per the lane table
- Under 70 characters
- Describe the outcome, not the process ("Add `agent.handoff` event", not "Implement agent handoff feature")

End every PR body with the attribution lines this session's instructions give.

### Body template — spec / RFC / conformance PR

```markdown
## Summary
- <what surface this lands and why>
- <RFC reference if applicable, e.g. "Lands RFC 0237 §B">
- <host impact: what a v2 host must now do or may now advertise>

## Compatibility
**Additive** / **Safety-fix** / **Breaking** / **v2 retirement** per `COMPATIBILITY.md` §<section>.

<one-paragraph justification>

## Spec corpus changes
- [ ] `spec/v2/core/<doc>.md` or `spec/v2/ext/<doc>.md` — <section>; `Status:` legend preserved
- [ ] `spec/v2/declaration.json` / `spec/v2/facets/` — family row or facet; `schemas/v2/capabilities.schema.json` regenerated by `scripts/generate-from-declaration.mjs`, not hand-edited
- [ ] `schemas/v2/<name>.schema.json` — `$id` under `https://openwop.dev/spec/v2/`; `additionalProperties: false`
- [ ] `api/openapi.yaml` and/or `scripts/derive-v2-api.py` — `api/v2/` re-derived

## Conformance
- [ ] Scenario `conformance/src/scenarios/v2-<name>.test.ts` citing `spec/v2/core/<doc>.md §<section>`
- [ ] Assertions use `req(id, section, requirement)`; one requirement id per `it`; no bare `return` (use `softSkip`)
- [ ] `conformance/scenario-majors.json` regenerated (the new file has a row)
- [ ] Fixture (if any) in `conformance/fixtures/` and catalogued in `conformance/fixtures.md`
- [ ] `conformance/CHANGELOG.md` entry

## SECURITY invariants
- [ ] New MUST-NOT? Row in `SECURITY/invariants.yaml` + a matching public test
- [ ] Credential handling unchanged (`spec/v2/core/security-defaults.md`, `SECURITY/threat-model-secret-leakage.md`)
- [ ] Replay determinism preserved (`spec/v2/core/replay.md`)

## Host impact
- <which hosts must change; open follow-ups in openwop-examples / openwop-app / openwop-sdks as needed>
- [ ] `INTEROP-MATRIX.md` row updated if an advertisement changes

## Test plan
- [ ] Regen chain run; no uncommitted diff afterwards
- [ ] `npm run openwop:check` passes (10/10)
- [ ] `node scripts/check-changelog-shape.mjs` clean
- [ ] DCO: every commit `Signed-off-by:` (or steward exemption per `CONTRIBUTING.md`)

## Breaking changes
None / <list — and link the safety-fix RFC if this is one>

## RFC + comment window
- RFC: <RFCS/NNNN-slug.md> — Status: Draft / Active / Accepted
- Comment window: 7 days (normative addition) / 30 days (breaking) / 90 days or embargo (safety-fix), per `RFCS/README.md` and `COMPATIBILITY.md` §3
- Window opened: <date PR marked ready>
```

### Body template — tooling / docs / build PR

```markdown
## Summary
- <what's improved>
- <why>

## Surface
- [ ] `scripts/…`, `.github/…`, root config, or docs — files changed
- [ ] No normative text, schema, or conformance assertion changes

## Test plan
- [ ] `npm run openwop:check` still passes
- [ ] <tool-specific check, e.g. `bash scripts/check-npm-pack-contents.sh`>
```

---

## Step 6: Create the PR

```bash
git push -u origin HEAD

# Apply openwop-spec when the spec corpus, the suite, or a generator/gate script is touched
SPEC_TOUCHED=$(git diff --name-only origin/main...HEAD \
  | grep -E '^(spec/|RFCS/|schemas/|api/|conformance/|spec-artifacts/|SECURITY/invariants\.yaml|scripts/(generate-|derive-|check-|openwop-check))' \
  | head -1)
LABEL_ARGS=()
[[ -n "$SPEC_TOUCHED" ]] && LABEL_ARGS+=(--label openwop-spec)

gh pr create \
  --base main \
  "${LABEL_ARGS[@]}" \
  --title "<conventional-commit-prefix>: <outcome>" \
  --body "$(cat <<'EOF'
<the filled-in template from Step 5>
EOF
)"
```

Return the PR URL when complete.

---

## PR best practices

1. **Title:** Conventional Commits with the openwop scopes in use: `rfc(NNNN):`, `spec(<doc>):`, `conformance(X.Y.Z):`, `errata(X.Y.Z):`, `release(X.Y.Z):`, `docs(<area>):`. Recent history is the source of truth on phrasing.
2. **Size:** Keep PRs focused. A spec change reviews best when the prose, schema, derived API, scenario and CHANGELOG line ship together.
3. **Description:** Explain why, plus the compatibility classification. The classification is the load-bearing claim.
4. **Tests:** Conformance scenarios are the test plan for spec changes.
5. **Breaking changes:** Call them out with migration steps. A safety-fix ships with a `### Security` CHANGELOG heading.
6. **Generated surfaces:** Regenerate, never hand-merge. On a conflict in a generated file, take either side and rerun the chain.
7. **DCO:** `git commit -s` adds the trailer. Fix existing commits with `git rebase --signoff origin/main` (non-interactive).
8. **CHANGELOG:** One line under `[Unreleased]` in the shape `scripts/check-changelog-shape.mjs` enforces. Suite changes also update `conformance/CHANGELOG.md`.
9. **`openwop-spec` label:** Applied when `spec/`, `RFCS/`, `schemas/`, `api/`, `conformance/`, `spec-artifacts/`, `SECURITY/invariants.yaml`, or a generator/gate script changes. CODEOWNERS routes these to the lead maintainer.

---

## Workflow commands

| Command | Action |
|---|---|
| `create` | Create the PR with generated content |
| `draft` | Create as draft PR |
| `classify` | Re-state compatibility classification with reasoning |
| `revise: [feedback]` | Modify the PR content |
| `dco-fix` | Add `Signed-off-by:` to every commit lacking it (`git rebase --signoff origin/main`) |
| `done` | Complete |
