---
name: release
description: Cut a new openwop spec-corpus release — collapse `[X.Y.Z — unreleased]` into a concise release-notes block, bump TS + Python + Go + conformance + 13 example packages in lockstep, run the 9-step gate, tag-and-push the 4-artifact publish, and verify the post-publish auto-PR + the cross-host re-measurement. Implements the `PUBLISHING.md` contract end-to-end with the lessons-learned catalog that has caught real release-cycle drift modes.
---

# Cut a release (openwop)

You are now in **Release Manager Mode** for a spec-corpus release.

`PUBLISHING.md` is the contract — this skill operationalizes it as a phase-by-phase walkthrough with embedded detection commands and a lessons-learned catalog of the drift modes that have hurt past releases. Use it for the corpus-aligned `vX.Y.Z` flow (all 4 artifacts publish together); for per-package SDK patches (`openwop/v*`, `openwop-conformance/v*`, etc.) follow the per-package matrix in PUBLISHING.md §"CI automation" directly.

---

## Release target: $ARGUMENTS

If no version was passed, derive the target from the existing `[X.Y.Z — unreleased]` header in `CHANGELOG.md` and announce it before Phase 0.

---

## Scope rule (read first)

A release is a **freeze + version-bump + tag**, not a feature-development cycle. The corpus-aligned `vX.Y.Z` tag triggers a 4-artifact publish simultaneously (TS SDK + Python SDK + Go SDK + conformance suite); any one of them at the wrong version blocks the whole release. The art is keeping the 16+ version-bearing files in lockstep + collapsing the dev-detail CHANGELOG into reader-friendly release notes. Both are mechanical work; do them in the order this skill prescribes.

**Two structural invariants this skill enforces:**

1. **Version lockstep** — 13 example/host/site packages + the umbrella + the 3 SDKs + conformance MUST agree (modulo conformance's independent-minor-bump rule). `npm run openwop:check` step 8 is the hard gate.
2. **CHANGELOG release notes ≤ ~75 lines** — previous releases (1.1.3, 1.1.2, 1.1.1, 1.1.0) all sat at 10-15 bullets of 1-3 sentences each. The `[X.Y.Z — unreleased]` working block frequently grows to 5-10× that during the release cycle; collapsing it is the labor-intensive step.

---

## Phase 0 — Discovery & freeze

Establish the release-target version and scope before any file edits.

### 0.1 Detect current state

```bash
# What version is the next release? (derived from the unreleased header)
awk '/^## \[/ {print NR": "$0; if (++c == 3) exit}' CHANGELOG.md

# What versions do the 16 lockstep-bearing files currently report?
jq -r '"umbrella           " + .version' package.json
jq -r '"../openwop-sdks/sdk/typescript     " + .version' ../openwop-sdks/sdk/typescript/package.json
grep -m1 '^version' ../openwop-sdks/sdk/python/pyproject.toml
jq -r '"conformance        " + .version' conformance/package.json
for p in ../openwop-examples/examples/*/package.json ../openwop-examples/examples/hosts/*/package.json ../openwop-site/site/package.json; do
  jq -r --arg p "$p" '$p + " " + (.version // "(absent)")' "$p"
done
```

### 0.2 Decide the release-target

- **Corpus-aligned minor** (`1.1.x → 1.2.0`): wire-shape additions, multiple Active → Accepted promotions, new schemas/endpoints.
- **Corpus-aligned patch** (`1.1.3 → 1.1.4`): SDK helper additions, host-impl milestones, RFC promotions without schema changes, doc + conformance scenario additions. This is the most common cadence.
- **Spec major** (`1.x → 2.0`): breaking changes. Out of scope for this skill — needs RFC governance + 12-month overlap policy per PUBLISHING.md.

Announce the verdict in one sentence (e.g., "Target: `v1.1.4`, corpus-aligned patch") before moving on.

### 0.3 Scope freeze

- [ ] Commit the freeze SHA. Anything merged after this rolls to the next release. Announce the freeze SHA so the user can correlate against in-flight parallel-agent work.
- [ ] Verify no in-flight PRs from the parallel-agent queue carry `spec(...)` / `feat(host-...)` lanes that need this minor:
  ```bash
  gh pr list --state open --search "label:openwop-spec OR label:host"
  ```
- [ ] Confirm the corpus is internally consistent at the freeze SHA:
  ```bash
  npm run openwop:check 2>&1 | tail -5
  # → "=== openwop:check OK — spec corpus is internally consistent ==="
  ```
- [ ] If `--check` mode in step 7 complains the generated-status is stale: **split the generator-authored diff into a separate `chore(docs): regenerate PROTOCOL-STATUS` commit BEFORE the release commit** so the release narrative stays authored (the `feedback_generator_changelog_split` rule).

---

## Phase 1 — Run `/update-docs`

Sweep the 22 drift modes the `/update-docs` skill knows about. **Always run this BEFORE the CHANGELOG collapse**, because the doc-sync touches some of the same files (README banner counts, KNOWN-LIMITS rows) and a clean-doc baseline makes the collapse review-friendly.

- [ ] `/update-docs based on the contents of [X.Y.Z — unreleased]`
- [ ] Confirm the skill verified the high-risk-for-release drifts:
  - #2 (README RFC counts banner)
  - #3 (KNOWN-LIMITS row sync)
  - #6 (INTEROP-MATRIX suite version)
  - #8 (host conformance.md banners)
  - #9 (PROTOCOL-STATUS regeneration)
  - #18 (README prose-list lag — very high-risk after promotion cycles)
  - #22 (internal phasing labels in external-facing prose)
- [ ] Commit the doc sweep as `docs: sync surfaces for X.Y.Z release` BEFORE Phase 2.

---

## Phase 2 — Collapse the CHANGELOG to release-notes shape

**The labor-intensive step.** Previous releases ran ~75 lines of bullets each:

| Release | Bullets | Approx lines |
|---|---|---|
| 1.1.3 | 14 | 75 |
| 1.1.2 | 13 | 80 |
| 1.1.1 | ~12 | 60 |

The working `[X.Y.Z — unreleased]` block typically grows to 400-800 lines / 40-60 `###` sub-entries during the release cycle. Cutting it down 5-6× is the bulk of the human-readable work.

### 2.1 Read the template

Read the most recent release section verbatim before drafting:

```bash
awk '/^## \[1.1.3\]/,/^## \[1.1.2\]/' CHANGELOG.md
```

The shape:

1. `## [X.Y.Z] — YYYY-MM-DD — <short headline>` — headline is 3-8 words, describes what was unblocked, not what was edited.
2. One paragraph opener: "Closes / lands / ships ... All wire shapes additive per `COMPATIBILITY.md` §2.1."
3. ~10-15 bullets, each 1-3 sentences, **with a bolded lead**.
4. Mention SDK + Python + Go lockstep bump (one bullet).
5. Mention conformance suite version delta + scenario count (one bullet).

### 2.2 Cluster the working entries

Walk the `###` sub-entries in `[X.Y.Z — unreleased]` and cluster them by theme. Typical clusters:

- **SDK + lockstep bumps** — single bullet covering TS + Python + Go + conformance version deltas
- **RFC promotions Active → Accepted** — single bullet enumerating the promotions, with the non-steward-evidence citation (revision + commit SHA)
- **RFC promotions Draft → Active** — single bullet, similar shape
- **NEW Draft RFCs filed** — single bullet enumerating
- **Reference-host milestones** — single bullet per host (in-memory, sqlite, postgres, python)
- **Reference-app additions** — single bullet covering the plan-doc items shipped this cycle (don't enumerate each item)
- **SECURITY invariant additions** — single bullet with the count delta + names
- **Honest non-graduations / opt-outs** — single bullet (they're part of the public credibility surface)
- **Conformance suite delta** — single bullet with version + scenario count
- **Site updates** — single bullet if `../openwop-site/site/src/build.mjs` changed
- **Honest corrections** — single bullet if any retraction/revert landed this cycle

### 2.3 Rename + commit

- [ ] `## [X.Y.Z — unreleased] — <dev headline>` → `## [X.Y.Z] — YYYY-MM-DD — <released headline>`. The "unreleased" word goes away.
- [ ] Verify the final bullet count is 10-15 (or document why this release is larger).
- [ ] The dropped detail is recoverable from git history; the precedent is NOT to keep both the dev-detail and the release-notes form.
- [ ] Commit as `release(vX.Y.Z): collapse changelog + headline` on the release branch.

---

## Phase 3 — Version lockstep bump

`scripts/openwop-check-publish-metadata.sh` (which is openwop:check step 8) is the hard gate. There are **16 version-bearing files** that must agree.

### 3.1 The 16 files

```
package.json                              (umbrella)
../openwop-sdks/sdk/typescript/package.json
../openwop-sdks/sdk/python/pyproject.toml
../openwop-sdks/sdk/python/src/openwop_client/__init__.py (if __version__ is present)
conformance/package.json                  (independent-minor-bump rule — see 3.3)
../openwop-examples/examples/approval-workflow/package.json
../openwop-examples/examples/branch-fork/package.json
../openwop-examples/examples/branching-workflow/package.json
../openwop-examples/examples/idempotent-runs/package.json
../openwop-examples/examples/mcp-stdio-bridge/package.json
../openwop-examples/examples/mcp-tool/package.json
../openwop-examples/examples/node-pack-publishing/package.json
../openwop-examples/examples/streaming-client/package.json
../openwop-examples/examples/tiny-workflow/package.json
../openwop-examples/examples/hosts/in-memory/package.json
../openwop-examples/examples/hosts/postgres/package.json
../openwop-examples/examples/hosts/sqlite/package.json
../openwop-site/site/package.json
```

`../openwop-sdks/sdk/go/go.mod` carries no version field for v1.x.x — versioning is via the git tag (`../openwop-sdks/sdk/go/vX.Y.Z`).

### 3.2 Bump all-at-once

```bash
# Drive the bump with a single sed pass so a typo in one file is caught
NEW=1.1.4
for f in package.json ../openwop-sdks/sdk/typescript/package.json \
         ../openwop-examples/examples/*/package.json ../openwop-examples/examples/hosts/*/package.json ../openwop-site/site/package.json; do
  # naive but works because these manifests carry their own "version":
  node -e "const f='$f';const j=require('fs').readFileSync(f,'utf8');const o=JSON.parse(j);o.version='$NEW';require('fs').writeFileSync(f, JSON.stringify(o,null,2)+'\n');"
done
# Python:
sed -i.bak "s/^version = .*/version = \"$NEW\"/" ../openwop-sdks/sdk/python/pyproject.toml && rm ../openwop-sdks/sdk/python/pyproject.toml.bak
# Python __version__ if present:
[ -f ../openwop-sdks/sdk/python/src/openwop_client/__init__.py ] && \
  sed -i.bak "s/^__version__ = .*/__version__ = '$NEW'/" ../openwop-sdks/sdk/python/src/openwop_client/__init__.py
```

### 3.3 Conformance bump decision

Per PUBLISHING.md §"Versioning alignment", conformance has an INDEPENDENT minor-bump rule:

```bash
# How many net-new scenario files this cycle?
git log --oneline --diff-filter=A "v$(git tag | grep -E '^v[0-9]' | sort -V | tail -1 | sed 's/^v//' )..HEAD" \
  -- conformance/src/scenarios/ | wc -l
```

- **0 new scenario files** → patch bump (e.g., `1.6.1 → 1.6.2`).
- **≥1 new scenario file** → minor bump (e.g., `1.6.1 → 1.7.0`).

Bump `conformance/package.json` accordingly.

### 3.4 Verify lockstep

- [ ] Run the alignment script standalone:
  ```bash
  bash scripts/openwop-check-publish-metadata.sh 2>&1 | tail -15
  # → "=== openwop:check:publish-metadata OK — manifests are publish-ready ==="
  ```
- [ ] If it complains, the error message names the offending file + the expected vs actual version. Fix and re-run; do NOT proceed to Phase 4 until this is clean.

### 3.5 Sync `[Unreleased]` removal

Per PUBLISHING.md, the version that lands MUST match the git tag. Since you bumped to `X.Y.Z` and renamed the CHANGELOG header in Phase 2, double-check the two agree:

```bash
head -15 CHANGELOG.md | grep -E "^## \[" | head -1
# → "## [X.Y.Z] — YYYY-MM-DD — <headline>"
```

---

## Phase 4 — Pre-publish gate

PUBLISHING.md §"Pre-publish checklist" runs as a contract. CI also runs this on the tag; local-first to catch fast.

- [ ] `npm run openwop:check` → 9/9 green. Hard gate.
- [ ] TypeScript SDK build:
  ```bash
  ( cd ../openwop-sdks/sdk/typescript && npm run typecheck && npm run build )
  ```
- [ ] npm-pack contents:
  ```bash
  bash scripts/check-npm-pack-contents.sh
  # → ONLY dist/, non-test src/, README.md, package.json, LICENSE
  ```
- [ ] Conformance:
  ```bash
  ( cd conformance && npm run test && npm run build:cli )
  ```
- [ ] Python:
  ```bash
  ( cd ../openwop-sdks/sdk/python && python -m hatchling build && python -m twine check dist/* )
  ```
- [ ] Go:
  ```bash
  ( cd ../openwop-sdks/sdk/go && go vet ./... && go test ./... )
  ```
- [ ] Python+Go release-surface alignment:
  ```bash
  bash scripts/check-python-go-release-surface.sh
  ```
- [ ] `ROADMAP.md` `Last reviewed:` line bumped + any newly-closed rows flipped (easy to miss; PUBLISHING.md §"All artifacts" calls it out specifically).

---

## Phase 5 — Tag + publish

- [ ] Cut release branch + PR:
  ```bash
  git checkout -b release/vX.Y.Z origin/main
  # ... ensure the Phase 1+2+3 commits are on this branch ...
  git push -u origin release/vX.Y.Z
  gh pr create --title "release(vX.Y.Z): <headline>" --body "<release notes summary + checklist>"
  ```
- [ ] Squash-merge the release PR. Confirm `main` is at the expected SHA.
- [ ] **From the merge SHA on `main`**:
  ```bash
  git tag -s vX.Y.Z -m "openwop vX.Y.Z"
  git push origin vX.Y.Z
  ```
  This triggers the 4 publish jobs in `.github/workflows/openwop-publish.yml`.
- [ ] **Additionally tag the Go submodule** (per PUBLISHING.md §"All artifacts" — Go requires the subdir-prefix tag):
  ```bash
  git tag ../openwop-sdks/sdk/go/vX.Y.Z
  git push origin ../openwop-sdks/sdk/go/vX.Y.Z
  ```
- [ ] Watch the 4 publish jobs:
  ```bash
  gh run watch $(gh run list --workflow=openwop-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
  ```

---

## Phase 6 — Post-publish verification

- [ ] `npm view @openwop/openwop@X.Y.Z` returns the expected manifest.
- [ ] `npm view @openwop/openwop-conformance@<version>` returns the expected manifest.
- [ ] Python:
  ```bash
  python -m venv /tmp/owop-vrfy && source /tmp/owop-vrfy/bin/activate && \
    pip install openwop-client==X.Y.Z && \
    python -c "import openwop_client; print(openwop_client.__version__)"
  ```
- [ ] Go (cache warm-up ~5 min):
  ```bash
  curl -sI https://proxy.golang.org/github.com/openwop/openwop/sdk/go/@v/vX.Y.Z.info
  # → 200
  ```
- [ ] **Auto-PR check**: `.github/workflows/openwop-post-publish-bump.yml` should fire automatically after the TS SDK publish, opening a PR `chore: bump @openwop/openwop to ^X.Y.Z (post-publish)` that updates `../openwop-app/{backend/typescript,frontend/react}/package.json` + lockfiles. If it doesn't fire within ~10 min, check the one-time "Allow GitHub Actions to create and approve PRs" toggle (PUBLISHING.md §"Post-publish lockfile bump").
- [ ] Merge the auto-bump PR + redeploy per the gcloud / firebase commands in its body.

---

## Phase 7 — Public surfacing + re-measurement

- [ ] Re-measure each reference host against the new conformance suite version:
  ```bash
  for host in in-memory sqlite postgres python; do
    echo "=== $host ==="
    # Run the appropriate harness for each host — see conformance/coverage.md
    # for how each host is brought up and what target URL is passed in.
  done
  ```
- [ ] Update `INTEROP-MATRIX.md` "Conformance trajectory" table with the new numbers + the new suite version citation.
- [ ] Update each touched `../openwop-examples/examples/hosts/<name>/conformance.md` banner with the suite version, run date, pass/fail/skip counts.
- [ ] Rebuild the spec site if any new spec doc landed this cycle:
  ```bash
  git diff "v<prev>..vX.Y.Z" --name-only spec/v1/ | head
  # if non-empty:
  cd site && node src/build.mjs && firebase deploy --only hosting:docs
  ```
- [ ] Post a GitHub release:
  ```bash
  gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(awk '/^## \[X.Y.Z\]/,/^## \[/{if(/^## \[/&&!/X.Y.Z/)exit;print}' CHANGELOG.md)
  ```
- [ ] If a non-steward host's adoption drove any RFC promotion this cycle (typical for v1.x): send the round-N+1 handoff doc noting which conformance suite version to advertise against. See `docs/myndhyve-round-2-handoff.md` for the template.

---

## Lessons-learned catalog (what has gone wrong in real releases)

Walk this top-to-bottom on every release. Each row is a real drift mode that has shipped to `main` and was caught later.

| # | Drift mode | Detection | Fix |
|---|---|---|---|
| 1 | **Example pkg version lockstep skipped** — 13 example/host/site packages drift from the umbrella version, openwop:check step 8 fails after the tag is already pushed. | `bash scripts/openwop-check-publish-metadata.sh` before tag. | Run the Phase 3.2 sed pass; verify with the script. |
| 2 | **CHANGELOG release notes 5-10× too long** — the working `[X.Y.Z — unreleased]` block is 400-800 lines / 40-60 `###` sub-entries; the released form should be 10-15 bullets / ~75 lines. | `awk '/^## \[X.Y.Z/,/^## \[/{if(/^## \[/&&!/X.Y.Z/)exit;print}' CHANGELOG.md \| wc -l` — should be <100. | Do Phase 2 thoroughly. Cluster by theme; one bullet per cluster. |
| 3 | **Generator-authored CHANGELOG drift** — running `generate-protocol-status.mjs --write` during the release cycle may append a CHANGELOG line that muddles your authored release notes. | `git diff CHANGELOG.md` after `--write`. | Run `--check` first; if it complains, regenerate + split into a separate `chore(docs)` commit BEFORE Phase 2. |
| 4 | **README prose drift after promotions** — the README has the giant banner at line 66, the per-section accept/active lists, AND the document index. The auto-generated banner counts (`docs/PROTOCOL-STATUS.md`) don't update the per-section prose. | `/update-docs` drift #18 check. | Phase 1 runs this; don't skip. |
| 5 | **Missing Go submodule tag** — pushing `vX.Y.Z` alone doesn't surface the Go module; `../openwop-sdks/sdk/go/vX.Y.Z` is ALSO required for non-root-module Go consumers. | `curl -sI https://proxy.golang.org/github.com/openwop/openwop/sdk/go/@v/vX.Y.Z.info` returns 404. | Push both tags in Phase 5. |
| 6 | **Post-publish lockfile bot didn't fire** — Cloud Run / Firebase Hosting silently pin the old SDK because `npm ci` runs in lockfile-isolated mode. The 1.1.2 → 1.1.3 release burned three Cloud Run revisions before the manual bump caught up. | `gh pr list --search "post-publish"` within ~10 min of TS SDK publish; expect 1 PR. | Check the one-time "Allow GitHub Actions to create and approve PRs" toggle in *Settings → Actions → General → Workflow permissions*. |
| 7 | **Conformance independent-bump skipped** — patch-bumping conformance when scenarios were added (or minor-bumping when they weren't) confuses consumers about whether they need to re-measure. | `git log --oneline --diff-filter=A v<prev>..HEAD -- conformance/src/scenarios/` — count net-new files. | Apply the Phase 3.3 rule. |
| 8 | **`[X.Y.Z — unreleased]` header word "unreleased" left in** — published release sections in the historical record carry "unreleased" forever. | `grep "unreleased" CHANGELOG.md` after Phase 2 — should only match the NEXT `[X.Y.Z+1 — unreleased]` placeholder you may have added. | Phase 2.3 explicitly removes it. |
| 9 | **`ROADMAP.md` `Last reviewed:` lag** — releases close roadmap rows but the `Last reviewed:` header drifts months stale. | `grep "Last reviewed:" ROADMAP.md`. | Phase 4 explicitly bumps it. |
| 10 | **Suite-version retro-citation drift in INTEROP-MATRIX** — host description columns embed "Conformance close-out (date): N/M = 100%" claims with no retrospective marker. After the table above is re-measured to the new suite, the description still reads as a current claim. | `/update-docs` drift #7. | Phase 7 re-measurement updates the table; ensure the description gets a `(YYYY-MM-DD, suite vX.Y.Z)` marker. |
| 11 | **Tagging from the wrong SHA** — if you tag the release-branch HEAD instead of `main` after merge, the tag references a commit that's not on the published-history line. | `git log main..vX.Y.Z` after tag — should be empty. | Always tag from `main` after merging the release PR. |
| 12 | **Pre-publish `[Unreleased]` placeholder added too early** — adding `## [X.Y.Z+1 — unreleased]` BEFORE the tag means the release commit itself carries two `## [` headers. | `grep -c "^## \[" CHANGELOG.md` before tag — should be N (the released count); afterward, the next release cycle adds the placeholder. | Add the next placeholder in Phase 7 (after tag), not Phase 2. |
| 13 | **`@ts-ignore` / `as any` sneaks past openwop:check** — openwop:check step 1 (SDK tsc) catches type errors but NOT banned-pattern violations. Use `/code-review` independently if anything new landed under `../openwop-sdks/sdk/typescript/src/` or `conformance/src/lib/` this cycle. | `grep -rE "as any\\b\|@ts-(ignore\|nocheck\|expect-error)" ../openwop-sdks/sdk/typescript/src/ conformance/src/lib/ ../openwop-examples/examples/hosts/*/src/` | If hits exist that weren't there at the previous release, file a `chore(sdk)` patch BEFORE this release. |
| 14 | **CI publish secrets expired** — `NPM_TOKEN` / `PYPI_TOKEN` rotated since the last release and the workflow fails silently. | `gh secret list` — check `updatedAt` timestamps. | Rotate before Phase 5 if either is >90 days old. |
| 15 | **Site rebuild needed but skipped** — `../openwop-site/site/src/build.mjs` re-renders spec corpus into HTML; if any `spec/v1/*.md` changed this cycle the site goes stale even after Phase 6 succeeds. | `git diff v<prev>..vX.Y.Z --name-only spec/v1/` non-empty + `../openwop-site/site/src/build.mjs` unchanged. | Phase 7 covers this. |

---

## Workflow Commands

| Command | Action |
|---|---|
| `phase 0` | Discovery + freeze (always start here) |
| `phase 1` | Invoke `/update-docs` |
| `phase 2` | Collapse the CHANGELOG to release-notes shape |
| `phase 3` | Bump the 16 lockstep version files |
| `phase 4` | Run the pre-publish gate |
| `phase 5` | Cut release branch, tag, push |
| `phase 6` | Verify the 4 published artifacts + auto-PR |
| `phase 7` | Re-measure hosts + post the release + send the round-N+1 handoff |
| `dry run` | Walk Phase 0 → 4 without tagging; report what WOULD change |
| `version-check` | Run only the Phase 3.4 alignment script + show the 16 file states |
| `collapse-only` | Run Phase 2 in isolation (useful pre-release when planning) |
| `lockstep-audit` | Read all 16 manifests + report any disagreement |
| `lessons` | Print the lessons-learned catalog above |
| `rollback` | If something goes wrong post-tag — print the recovery recipe (`npm deprecate` / PyPI `yank` / Go retract per `PUBLISHING.md` §"Deprecation policy") |

---

## Quick Reference

| Where | What |
|---|---|
| `PUBLISHING.md` | Per-package release cadence + version axes + CI publish-workflow matrix |
| `CHANGELOG.md` | The release-notes target; previous releases are the template |
| `.github/workflows/openwop-publish.yml` | Tag-triggered publish workflow |
| `.github/workflows/openwop-post-publish-bump.yml` | Auto-PR that updates ../openwop-app lockfiles after TS SDK publish |
| `scripts/openwop-check-publish-metadata.sh` | Step-8 hard gate — version lockstep |
| `scripts/check-npm-pack-contents.sh` | Step that the published npm tarball is contents-clean |
| `scripts/check-python-go-release-surface.sh` | Python wheel + Go module-path alignment |
| `scripts/generate-protocol-status.mjs` | Generator for `docs/PROTOCOL-STATUS.md`; honor the `--check` mode |
| `ROADMAP.md` | `Last reviewed:` line is part of the release surface |
| `INTEROP-MATRIX.md` | Conformance trajectory table — re-measure per release |
| `../openwop-examples/examples/hosts/<name>/conformance.md` | Per-host evidence banner — re-measure per release |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/update-docs` | Phase 1 dependency — sync README + KNOWN-LIMITS + PROTOCOL-STATUS + INTEROP-MATRIX + per-host banners |
| `/code-review` | Run independently if anything new landed under `../openwop-sdks/sdk/typescript/src/` or `conformance/src/lib/` this cycle (lesson #13) |
| `/update-conformance` | Run BEFORE the release cycle if scenarios were added, so the Phase 3.3 conformance-bump decision is clean |
| `/ux-review` | Optional — sanity-check the released-form CHANGELOG headline + opener for prose quality |
| `/nfr` | Optional — final spec-corpus NFR sweep before tagging |
| `/pr` | Use for the Phase 5 release PR — applies the right labels |
| `/cleanup` | Pre-release — clear out stale `[Unreleased]` placeholders, dead links, dishonest INTEROP-MATRIX rows |
