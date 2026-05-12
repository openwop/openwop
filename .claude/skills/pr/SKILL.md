---
name: pr
description: Create a structured pull request for openwop. Detects lane (spec / SDK / conformance / host / registry / docs), generates body from actual diff, enforces DCO + Conventional Commits + CHANGELOG + 8-step openwop:check pre-flight, applies `openwop-spec` label when spec corpus is touched.
---

# Create Pull Request (openwop)

Create a well-structured pull request for the current branch's changes against `main`.

## Optional context: $ARGUMENTS

---

## Step 1: Gather Context

Analyze the current branch and all its changes:

```bash
# Detect base branch (openwop uses main)
BASE_BRANCH=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||' || echo "main")

# All commits on this branch
git log ${BASE_BRANCH}..HEAD --oneline

# DCO trailer check on every commit (BLOCKING if missing)
git log ${BASE_BRANCH}..HEAD --format='%H %s%n%b' | grep -E '^(commit |Signed-off-by:|$)' | awk '
  /^commit / { sha=$2; signed=0 }
  /^Signed-off-by:/ { signed=1 }
  /^$/ { if (sha && !signed) print "MISSING DCO:", sha; sha="" }
'

# Changed files with stats
git diff ${BASE_BRANCH} --stat

# Any uncommitted changes
git status
```

**Read every changed file** with the Read tool. Do not generate PR content from filenames alone — analyze the actual diff.

---

## Step 2: Classify the Lane

Decide which kind of PR this is. Lane drives the title prefix, the body template, the labels, and the required pre-flight gates.

| Lane | Surfaces touched | Title prefix | Required label | Reviewer routing |
|---|---|---|---|---|
| **Spec corpus (normative)** | `spec/v1/`, `RFCS/`, `schemas/`, `api/` | `spec(v1):` or `feat(spec):` | `openwop-spec` | Lead maintainer via CODEOWNERS |
| **Spec corpus (editorial)** | `spec/v1/`, `RFCS/`, `schemas/`, `api/` — prose-only fixes | `docs(spec):` | `openwop-spec` | Lead maintainer via CODEOWNERS |
| **Conformance** | `conformance/` | `feat(conformance):` / `fix(conformance):` | `openwop-spec` (suite is part of corpus) | Lead maintainer via CODEOWNERS |
| **TS SDK** | `sdk/typescript/` | `feat(sdk-ts):` / `fix(sdk-ts):` | — | Standard review |
| **Python SDK** | `sdk/python/` | `feat(sdk-py):` / `fix(sdk-py):` | — | Standard review |
| **Go SDK** | `sdk/go/` | `feat(sdk-go):` / `fix(sdk-go):` | — | Standard review |
| **Reference host** | `examples/hosts/{in-memory,sqlite,python}/` | `feat(host-<name>):` / `fix(host-<name>):` | — | Standard review |
| **Pack / registry** | `packs/`, `registry/`, `examples/packs/` | `feat(packs):` / `feat(registry):` | — | Standard review |
| **Site** | `site/`, `public/` | `chore(site):` / `feat(site):` | — | Standard review |
| **Tooling / build** | `scripts/`, `.github/`, root `package.json` | `build:` / `chore:` | — | Standard review |
| **Documentation** | `README.md`, `CHANGELOG.md`, `INTEROP-MATRIX.md`, `ROADMAP.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `docs/` | `docs:` | — | Standard review |

Recent commits show this convention in use: `build:`, `spec(v1):`, `feat(host-sqlite):`. Match the format.

If the change is a normative spec edit, classify compatibility (additive / safety-fix / breaking) per `COMPATIBILITY.md` — the body template requires this line.

---

## Step 3: Analyze Changes

For each changed file, categorize:

| Category | Files | Summary |
|---|---|---|
| Prose spec (`spec/v1/`) | … | What sections/keywords changed |
| RFC (`RFCS/`) | … | RFC NNNN — Draft / Active / Accepted |
| Schemas (`schemas/`) | … | Field added / removed / type-changed |
| API contracts (`api/`) | … | Endpoint / channel diff |
| Conformance (`conformance/`) | … | Scenarios + fixtures added |
| SDKs (`sdk/{typescript,python,go}/`) | … | Methods added / types updated |
| Reference hosts (`examples/hosts/`) | … | Profile coverage delta |
| Tests | … | What's covered |
| Documentation | … | README / CHANGELOG / INTEROP-MATRIX / ROADMAP |
| Config / build | … | scripts, workflows |

Determine the **primary lane** for the title prefix and the **compatibility classification** for the body.

---

## Step 4: Pre-Flight Checks (MANDATORY)

Run the same 8-step gate CI will run:

```bash
# Full corpus gate
npm run openwop:check 2>&1 | tee /tmp/pr-precheck.log

# Per-SDK lint (PR check):
( cd sdk/python && ruff check . ) 2>&1 | tail -10
( cd sdk/go && go vet ./... && gofmt -l . ) 2>&1 | tail -10

# DCO: every commit signed?
git log origin/main..HEAD --format='%H %s' | while read sha subject; do
  if ! git log -1 "$sha" --format='%b' | grep -q '^Signed-off-by:'; then
    echo "MISSING DCO on $sha: $subject"
  fi
done

# CHANGELOG entry under [Unreleased] for any spec/SDK/conformance change?
git diff origin/main..HEAD -- CHANGELOG.md
```

If any of these fail, **fix before opening the PR**. The DCO bot blocks merge until every commit is signed. `npm run openwop:check` is the published merge gate (`CONTRIBUTING.md` §"The CI gate").

---

## Step 5: Generate PR Content

### Title rules
- Conventional Commits prefix per lane table above
- Under 70 characters
- Describe the outcome, not the process ("Add `agent.handoff` event" not "Implement agent handoff feature")

### Body template — Spec / RFC PR

```markdown
## Summary
- <bullet 1 — what surface this lands and why>
- <bullet 2 — RFC reference if applicable, e.g., "Lands RFC 0007 dispatch §3"
- <bullet 3 — host/SDK impact>

## Compatibility
**Additive** / **Safety-fix** / **Breaking** per `COMPATIBILITY.md` §<section>.

<one-paragraph justification — cite §2.2 list items if claiming additive>

## Spec corpus changes
- [ ] `spec/v1/<doc>.md` — <section> added/edited; `Status:` legend preserved
- [ ] `schemas/<name>.schema.json` — new field <name>; `additionalProperties: false`; $id under openwop.dev
- [ ] `api/openapi.yaml` — endpoint <path> added with operationId, tags, response schemas
- [ ] `api/asyncapi.yaml` — channel <name> added with message + payload schema

## Conformance
- [ ] New scenario: `conformance/src/scenarios/<file>.test.ts` covering `spec/v1/<doc>.md §<section>`
- [ ] New fixture (if applicable): `conformance/fixtures/<name>.json` registered in `fixtures.md`
- [ ] Capability-gated on `host.<flag>.supported` per `conformance/coverage.md` §"Capability-gated scenarios"
- [ ] `conformance/coverage.md` updated

## SDK + reference host
- [ ] `sdk/typescript/src/client.ts` — new method on `OpenwopClient` (if endpoint added)
- [ ] `sdk/typescript/src/types.ts` — types extended from spec
- [ ] `sdk/python/src/openwop_client/` — Python method addition (stdlib-only)
- [ ] `sdk/go/` — Go method addition; `go vet` + `gofmt` clean
- [ ] `examples/hosts/<name>/` — reference host implements + advertises in `conformance.md`
- [ ] `INTEROP-MATRIX.md` — row updated if advertisement changes

## SECURITY invariants
- [ ] New MUST-NOT? Added row in `SECURITY/invariants.yaml` + matching public test
- [ ] BYOK credential handling unchanged (`auth.md`, `SECURITY/threat-model-secret-leakage.md`)
- [ ] Replay determinism preserved (`replay.md`)

## Test plan
- [ ] `npm run openwop:check` passes (8/8 green)
- [ ] `( cd sdk/typescript && npx tsc --noEmit )` clean
- [ ] `( cd conformance && npx vitest run )` server-free subset green
- [ ] `redocly lint api/openapi.yaml` clean
- [ ] `asyncapi validate api/asyncapi.yaml` clean
- [ ] `bash scripts/check-security-invariants.sh` clean
- [ ] `bash scripts/openwop-check-publish-metadata.sh` clean
- [ ] DCO: every commit `Signed-off-by:` (DCO bot will verify)

## Breaking changes
None / <list — and link the safety-fix RFC if this is one>

## RFC + comment window
- RFC: <RFCS/NNNN-slug.md> — Status: Draft / Active
- Comment window: <7 days for additive / 90 days for safety-fix / 30 days for breaking>
- Window opened: <date PR marked ready>

---
Signed-off-by: David Tufts <email@davidtufts.me>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Body template — SDK or reference-host PR (no spec corpus changes)

```markdown
## Summary
- <bullet 1 — what's added or fixed in the SDK/host>
- <bullet 2 — which spec doc it tracks>
- <bullet 3 — reference-host advertisement impact>

## Surface
- [ ] `sdk/<lang>/...` — files changed
- [ ] No spec corpus changes (`spec/v1/`, `api/`, `schemas/`, `RFCS/` untouched)

## Test plan
- [ ] TS: `( cd sdk/typescript && npx tsc --noEmit && npm test )`
- [ ] Python: `ruff check sdk/python/` + `python -m unittest discover sdk/python/tests`
- [ ] Go: `( cd sdk/go && go vet ./... && go test ./... && gofmt -l . )`
- [ ] Conformance run against affected host (if applicable)
- [ ] `INTEROP-MATRIX.md` row updated (if advertisement changes)

## CHANGELOG
- [ ] `sdk/typescript/CHANGELOG.md` or `conformance/CHANGELOG.md` line added (if package version will bump)

---
Signed-off-by: David Tufts <email@davidtufts.me>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Body template — Tooling / docs / build PR

```markdown
## Summary
- <bullet 1 — what's improved>
- <bullet 2 — why>

## Surface
- [ ] `scripts/...`, `.github/...`, root config — files changed
- [ ] No spec corpus, SDK runtime, or conformance assertion changes

## Test plan
- [ ] `npm run openwop:check` still passes
- [ ] <tool-specific verification — e.g., `bash scripts/check-npm-pack-contents.sh` clean>

---
Signed-off-by: David Tufts <email@davidtufts.me>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Step 6: Create the PR

```bash
BASE_BRANCH=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||' || echo "main")

# Push if needed
git push -u origin HEAD

# Create the PR — apply openwop-spec label when spec corpus is touched
SPEC_TOUCHED=$(git diff --name-only "${BASE_BRANCH}"..HEAD | grep -E '^(spec/v1|RFCS|schemas|api|conformance)/' | head -1)
LABEL_ARGS=()
[[ -n "$SPEC_TOUCHED" ]] && LABEL_ARGS+=(--label openwop-spec)

gh pr create \
  --base "${BASE_BRANCH}" \
  "${LABEL_ARGS[@]}" \
  --title "<conventional-commit-prefix>: <outcome>" \
  --body "$(cat <<'EOF'
<paste the appropriate template from Step 5, filled in>
EOF
)"
```

Return the PR URL when complete.

---

## PR Best Practices

1. **Title:** Conventional Commits with openwop scope — `spec(v1):`, `feat(host-sqlite):`, `feat(conformance):`, `feat(sdk-ts):`, etc. Recent commit history is the source of truth on phrasing.
2. **Size:** Keep PRs focused. Spec changes are easier to review when the schema diff, OpenAPI diff, conformance scenario, and CHANGELOG line ship in one PR — but separate SDK rollouts from spec landings when they would force a third-party host into a coordinated release.
3. **Description:** Explain WHY plus the compatibility classification. The classification is the load-bearing claim.
4. **Tests:** Conformance scenarios are the canonical test plan for spec changes. SDK PRs cite vitest / unittest / go test.
5. **Breaking changes:** Call out explicitly with migration steps; safety-fix changes ship with a `version-negotiation.md` runbook section + `### Security` CHANGELOG heading.
6. **DCO:** Every commit `Signed-off-by:`. Use `git commit -s` to add automatically; `git rebase --signoff -i HEAD~N` to fix existing commits.
7. **CHANGELOG:** A one-line entry under `[Unreleased]` is the floor. SDK/conformance PRs that bump package versions also update the per-package CHANGELOG.
8. **`openwop-spec` label:** Apply when `spec/v1/`, `api/`, `schemas/`, `RFCS/`, or `conformance/` is touched. Routes to lead maintainer via CODEOWNERS.

---

## Workflow Commands

| Command | Action |
|---|---|
| `create` | Create the PR with generated content |
| `draft` | Create as draft PR |
| `classify` | Re-state compatibility classification with reasoning |
| `revise: [feedback]` | Modify the PR content |
| `dco-fix` | Add `Signed-off-by:` to every commit lacking it (`git rebase --signoff -i HEAD~N`) |
| `done` | Complete |
