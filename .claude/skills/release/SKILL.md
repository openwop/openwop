---
name: release
description: Cut an openwop release. Post-split, this repo publishes exactly ONE artifact — `@openwop/openwop-conformance`. Two tag forms: `openwop-conformance/vX.Y.Z` (suite only, fast path when a host needs corrected scenarios on npm) and `vX.Y.Z` (corpus-aligned — collapse `[Unreleased]` into release notes, plus a tracking issue in `openwop-sdks`). Covers the three-way conformance version pin, the 6-step `openwop:check` gate, tagging from `main`, and verifying the published tarball actually contains the change. SDKs release from `openwop-sdks`; examples/hosts from `openwop-examples`; the site from `openwop-site` — this skill does NOT bump them.
---

# Cut a release (openwop)

You are now in **Release Manager Mode** for a spec-corpus release.

`PUBLISHING.md` is the contract — this skill operationalizes it as a phase-by-phase walkthrough with embedded detection commands and a lessons-learned catalog of the drift modes that have hurt past releases.

> **⚠️ POST-SPLIT REALITY (corrected 2026-08-06).** This skill was written before the 2026-06 monorepo split and described a world that no longer exists: a 4-artifact simultaneous publish and a 16-file version lockstep spanning `sdk/`, `examples/`, and `site/`. **None of those directories are in this repo anymore.** Following the old Phase 3 literally would have sed-bumped manifests across three *separate* sibling repositories — including one with parallel-session branches in flight. The corrections below are verified against the live workflow and gate scripts, not inferred.
>
> **What this repo actually publishes: exactly one artifact — `@openwop/openwop-conformance`.**
> The TypeScript / Python / Go SDKs live in **`openwop-sdks`** and release from there; a corpus `v*` tag here only *announces* them and opens a best-effort tracking issue in that repo. Examples and hosts live in **`openwop-examples`**, the site in **`openwop-site`** — each with its own versions and its own CI.

---

## Release target: $ARGUMENTS

If no version was passed, derive the target from the existing `[X.Y.Z — unreleased]` header in `CHANGELOG.md` and announce it before Phase 0.

---

## Scope rule (read first)

A release is a **freeze + tag**, not a feature-development cycle. The work that remains in this repo is almost entirely (a) collapsing the dev-detail CHANGELOG into reader-friendly release notes and (b) confirming the conformance package is at the version you intend to publish.

**Two tag forms, both handled by `.github/workflows/openwop-publish.yml`:**

| Tag | Triggers | Use when |
|---|---|---|
| `openwop-conformance/vX.Y.Z` | `publish-conformance` only | You need the suite on npm — e.g. a host must install corrected scenarios. Fast, narrow, no CHANGELOG work. |
| `vX.Y.Z` | `publish-conformance` **+** `remind-sdk-release` | Corpus-aligned release: collapsed release notes, RFC status roll-up. Also opens a tracking issue in `openwop-sdks`. |

Both run `validate-tag` → `preflight` (`openwop:check`) first. The npm publish step is **skip-if-already-published**, so a `vX.Y.Z` tag after a conformance tag at the same version is a safe no-op for npm.

**The one structural invariant this skill enforces:**

1. **Conformance version pin** — `scripts/openwop-check-publish-metadata.sh` (step **5 of 6** in `openwop:check`) asserts `conformance/package.json` matches the `EXPECTED_CONFORMANCE_VERSION` constant **inside that script**, and that `scripts/check-npm-pack-contents.sh` agrees. Bumping the suite means editing **all three**: the manifest and both pinning scripts. Missing one fails the gate — this is the single most common release-adjacent break.
2. **CHANGELOG release notes ≤ ~75 lines** — previous releases (1.1.3, 1.1.2, 1.1.1, 1.1.0) all sat at 10-15 bullets of 1-3 sentences each. The `[X.Y.Z — unreleased]` working block frequently grows to 5-10× that during the release cycle; collapsing it is the labor-intensive step.

---

## Phase 0 — Discovery & freeze

Establish the release-target version and scope before any file edits.

### 0.1 Detect current state

```bash
# What version is the next release? (derived from the unreleased header)
awk '/^## \[/ {print NR": "$0; if (++c == 3) exit}' CHANGELOG.md

# The ONLY version this repo publishes:
node -e "const p=require('./conformance/package.json');console.log(p.name, p.version)"
npm view @openwop/openwop-conformance version   # what npm currently serves

# The two pins that must agree with it (lesson #1):
grep -n 'EXPECTED_CONFORMANCE_VERSION=' scripts/openwop-check-publish-metadata.sh
grep -n "conformancePack.version ===" scripts/check-npm-pack-contents.sh

# Context only — these live in SIBLING REPOS and are NOT bumped from here:
#   openwop-sdks     TS / Python / Go SDKs   (own release tags)
#   openwop-examples examples + hosts        (own CI)
#   openwop-site     the docs site           (own deploy)
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

## Phase 3 — Conformance version check (NOT a cross-repo lockstep)

> **This phase used to instruct a 16-file sed pass across `sdk/`, `examples/`, and `site/`. Those directories are not in this repo.** Doing it would edit three sibling repositories from a release branch here. Deleted.

`scripts/openwop-check-publish-metadata.sh` is the hard gate, and it checks **only the conformance package**: npm scope + name, version against its own `EXPECTED_CONFORMANCE_VERSION` constant, LICENSE presence, and production-release posture language. Nothing else in this repo is version-gated.

### 3.1 Decide whether the suite version moves

Per PUBLISHING.md §"Versioning alignment", conformance bumps on its **own** minor rule, independent of the corpus version:

```bash
LAST=$(git tag | grep '^openwop-conformance/v' | sort -V | tail -1)
git log --oneline --diff-filter=A "$LAST..HEAD" -- conformance/src/scenarios/ | wc -l
```

- **0 net-new scenario files** → patch bump, or leave it alone entirely.
- **≥1 net-new scenario file** → minor bump.

A corpus release does **not** require moving the suite version. If the suite is already published at its current version, the `vX.Y.Z` tag's publish step simply skips.

### 3.2 If you do bump it — all THREE files, together

```bash
NEW=1.63.0
node -e "const f='conformance/package.json',fs=require('fs');const o=JSON.parse(fs.readFileSync(f));o.version='$NEW';fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')"
sed -i '' "s/EXPECTED_CONFORMANCE_VERSION=\"[^\"]*\"/EXPECTED_CONFORMANCE_VERSION=\"$NEW\"/" scripts/openwop-check-publish-metadata.sh
sed -i '' "s/conformancePack.version === '[^']*'/conformancePack.version === '$NEW'/" scripts/check-npm-pack-contents.sh
( cd conformance && npm install --silent )   # refresh package-lock
```

### 3.3 Verify

```bash
bash scripts/openwop-check-publish-metadata.sh 2>&1 | tail -6
# → "=== openwop:check:publish-metadata OK — manifests are publish-ready ==="
```

Do not proceed to Phase 4 until this is clean.

### 3.4 Header/tag agreement

```bash
head -20 CHANGELOG.md | grep -E "^## \[" | head -1
# → "## [X.Y.Z] — YYYY-MM-DD — <headline>"   (must match the tag you will push)
```

## Phase 4 — Pre-publish gate

`openwop:check` is **6 steps, not 9** (the old text said 9/9). It is the gate CI itself runs in `preflight`, so a local pass is a strong predictor.

- [ ] `npm run openwop:check` → `=== openwop:check OK — spec corpus is internally consistent ===`. Hard gate.
- [ ] Conformance server-free suite:
  ```bash
  ( cd conformance && npx vitest run src/scenarios/spec-corpus-validity.test.ts \
      src/scenarios/fixtures-valid.test.ts )
  ```
  The full suite includes host-requiring scenarios that fail without `OPENWOP_BASE_URL` — that is expected and is **not** a release blocker.
- [ ] npm tarball contents: `bash scripts/check-npm-pack-contents.sh`
- [ ] `ROADMAP.md` `Last reviewed:` bumped, and any rows this cycle closed flipped (lesson #9 — easy to miss).
- [ ] Banned patterns, if anything landed under `conformance/src/` this cycle:
  ```bash
  grep -rE "as any\b|@ts-(ignore|nocheck|expect-error)" conformance/src/ | head
  ```

**Removed from this phase** — these targeted directories that are no longer here:
`sdk/typescript` build, `hatchling build` + `twine check`, `go vet ./...`, and `scripts/check-python-go-release-surface.sh` (**the script does not exist**). Those gates belong to `openwop-sdks` and run there.

## Phase 5 — Tag + publish

### 5a — Conformance-only (fast path)

No branch, no PR. From `main`, once `conformance/package.json` is at the target version and the gate is green:

```bash
git tag openwop-conformance/vX.Y.Z <main-sha>   # lightweight — matches existing convention
git push origin openwop-conformance/vX.Y.Z
```

### 5b — Corpus-aligned release

```bash
git checkout -b release/vX.Y.Z origin/main
# ... Phase 1 + 2 (+ 3 if the suite moved) commits land here ...
git push -u origin release/vX.Y.Z
gh pr create --title "release(vX.Y.Z): <headline>" --body "<release notes + checklist>"
# squash-merge, then tag FROM main:
git tag vX.Y.Z <merge-sha>
git push origin vX.Y.Z
```

- [ ] **Tag from `main` after merge, never from the release branch HEAD** (lesson #11): `git log main..vX.Y.Z` must be empty.
- [ ] Watch it:
  ```bash
  gh run list --workflow=openwop-publish.yml --limit 1
  gh run view <id> --json jobs -q '.jobs[] | "\(.conclusion // .status)  \(.name)"'
  ```
  Expect `validate-tag` ✓, `preflight` ✓, `publish-conformance` ✓, and `remind-sdk-release` ✓ on a `v*` tag / skipped on a conformance tag.

**No Go submodule tag.** The old `sdk/go/vX.Y.Z` step is deleted — the Go module lives in `openwop-sdks` and is tagged there.

## Phase 6 — Post-publish verification

**Verify the artifact, not the green checkmark.** A successful workflow is not evidence the payload is right.

- [ ] npm reports the new version:
  ```bash
  npm view @openwop/openwop-conformance version
  npm view @openwop/openwop-conformance@X.Y.Z dist.fileCount dist.unpackedSize
  ```
- [ ] **Pull the tarball and confirm the change you shipped is actually inside it:**
  ```bash
  T=$(mktemp -d) && cd "$T" && npm pack @openwop/openwop-conformance@X.Y.Z >/dev/null \
    && tar xzf *.tgz && grep -rn "<a distinctive string from this release>" package/ | head
  ```
  This has real value: it is how you distinguish "published" from "published with the fix in it".
- [ ] If a host is waiting on the suite, tell it the exact installable version.

**Removed** — `npm view @openwop/openwop`, `pip install openwop-client`, and the Go proxy warm-up all verify **`openwop-sdks`** releases, not this one. The auto-PR check pointed at `.github/workflows/openwop-post-publish-bump.yml`, **which does not exist in this repo**.

## Phase 7 — Public surfacing + re-measurement

- [ ] Re-measure reference hosts against the new suite. **The hosts live in `openwop-examples`** — bring them up per `conformance/coverage.md`; this repo has no `examples/` directory.
- [ ] `INTEROP-MATRIX.md` "Conformance trajectory" — new numbers + suite-version citation. Give superseded claims a retrospective `(YYYY-MM-DD, suite vX.Y.Z)` marker rather than deleting them (lesson #10).
- [ ] Per-host `conformance.md` evidence banners — **in `openwop-examples`**, its own PR.
- [ ] Site rebuild if any `spec/v1/*.md` changed — **in `openwop-site`**, which tracks this repo's `main`. Not `cd site && node src/build.mjs` from here; that directory is gone.
- [ ] GitHub release:
  ```bash
  gh release create vX.Y.Z --title "vX.Y.Z" \
    --notes-file <(awk '/^## \[X.Y.Z\]/,/^## \[/{if(/^## \[/&&!/X.Y.Z/)exit;print}' CHANGELOG.md)
  ```
- [ ] Add the next `## [Unreleased]` placeholder **now, after the tag** — not in Phase 2 (lesson #12).

## Lessons-learned catalog (what has gone wrong in real releases)

Walk this top-to-bottom on every release. Each row is a real drift mode that has shipped to `main` and was caught later.

| # | Drift mode | Detection | Fix |
|---|---|---|---|
| 1 | **The three-way conformance version pin** — `conformance/package.json`, `EXPECTED_CONFORMANCE_VERSION` in `openwop-check-publish-metadata.sh`, and the assertion in `check-npm-pack-contents.sh` must all agree. Bumping the manifest alone fails the gate. (Replaces the old "13 example packages drift" row — those packages are in another repo.) | `bash scripts/openwop-check-publish-metadata.sh` | Phase 3.2 edits all three together. |
| 2 | **CHANGELOG release notes 5-10× too long** — the working `[X.Y.Z — unreleased]` block is 400-800 lines / 40-60 `###` sub-entries; the released form should be 10-15 bullets / ~75 lines. | `awk '/^## \[X.Y.Z/,/^## \[/{if(/^## \[/&&!/X.Y.Z/)exit;print}' CHANGELOG.md \| wc -l` — should be <100. | Do Phase 2 thoroughly. Cluster by theme; one bullet per cluster. |
| 3 | **Generator-authored CHANGELOG drift** — running `generate-protocol-status.mjs --write` during the release cycle may append a CHANGELOG line that muddles your authored release notes. | `git diff CHANGELOG.md` after `--write`. | Run `--check` first; if it complains, regenerate + split into a separate `chore(docs)` commit BEFORE Phase 2. |
| 4 | **README prose drift after promotions** — the README has the giant banner at line 66, the per-section accept/active lists, AND the document index. The auto-generated banner counts (`docs/PROTOCOL-STATUS.md`) don't update the per-section prose. | `/update-docs` drift #18 check. | Phase 1 runs this; don't skip. |
| 7 | **Conformance independent-bump skipped** — patch-bumping conformance when scenarios were added (or minor-bumping when they weren't) confuses consumers about whether they need to re-measure. | `git log --oneline --diff-filter=A v<prev>..HEAD -- conformance/src/scenarios/` — count net-new files. | Apply the Phase 3.3 rule. |
| 8 | **`[X.Y.Z — unreleased]` header word "unreleased" left in** — published release sections in the historical record carry "unreleased" forever. | `grep "unreleased" CHANGELOG.md` after Phase 2 — should only match the NEXT `[X.Y.Z+1 — unreleased]` placeholder you may have added. | Phase 2.3 explicitly removes it. |
| 9 | **`ROADMAP.md` `Last reviewed:` lag** — releases close roadmap rows but the `Last reviewed:` header drifts months stale. | `grep "Last reviewed:" ROADMAP.md`. | Phase 4 explicitly bumps it. |
| 10 | **Suite-version retro-citation drift in INTEROP-MATRIX** — host description columns embed "Conformance close-out (date): N/M = 100%" claims with no retrospective marker. After the table above is re-measured to the new suite, the description still reads as a current claim. | `/update-docs` drift #7. | Phase 7 re-measurement updates the table; ensure the description gets a `(YYYY-MM-DD, suite vX.Y.Z)` marker. |
| 11 | **Tagging from the wrong SHA** — if you tag the release-branch HEAD instead of `main` after merge, the tag references a commit that's not on the published-history line. | `git log main..vX.Y.Z` after tag — should be empty. | Always tag from `main` after merging the release PR. |
| 12 | **Pre-publish `[Unreleased]` placeholder added too early** — adding `## [X.Y.Z+1 — unreleased]` BEFORE the tag means the release commit itself carries two `## [` headers. | `grep -c "^## \[" CHANGELOG.md` before tag — should be N (the released count); afterward, the next release cycle adds the placeholder. | Add the next placeholder in Phase 7 (after tag), not Phase 2. |
| 14 | **CI publish secrets expired** — `NPM_TOKEN` / `PYPI_TOKEN` rotated since the last release and the workflow fails silently. | `gh secret list` — check `updatedAt` timestamps. | Rotate before Phase 5 if either is >90 days old. |
| 15 | **Site rebuild needed but skipped** — `../openwop-site/site/src/build.mjs` re-renders spec corpus into HTML; if any `spec/v1/*.md` changed this cycle the site goes stale even after Phase 6 succeeds. | `git diff v<prev>..vX.Y.Z --name-only spec/v1/` non-empty + `../openwop-site/site/src/build.mjs` unchanged. | Phase 7 covers this. |
| 16 | **This skill described a repo that no longer exists** — written pre-split, it prescribed a 16-file lockstep across `sdk/` + `examples/` + `site/` and a 4-artifact publish. Following it literally would have edited three sibling repos from a release branch, one with parallel-session work in flight. | Run the Phase 0.1 detection block. If `sdk/`, `examples/`, or `site/` are absent from `ls`, the instructions predate the split. | Corrected 2026-08-06. Verify a skill's world-model against the tree before executing its mechanical steps. |
| 17 | **A green publish workflow is not proof the payload is right** — `publish-conformance` succeeding tells you npm accepted a tarball, not that your change is in it. | Phase 6's `npm pack` + `grep` for a distinctive string from this release. | Always verify the artifact, not the checkmark. |
| 18 | **Post-merge-only workflows hide breakage from PRs** — `Conformance Soak` ran 40 consecutive red on `main` for a month because it never runs on pull requests. The live-registry pack-count check has the same shape. | `gh run list --workflow="<name>" --limit 20 --json conclusion` before a release; a wall of `failure` predates you. | Check scheduled/post-merge workflow history at Phase 0, not after tagging. |

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
| `openwop-sdks` (sibling repo) | Where the TS / Python / Go SDKs actually release from |
| `scripts/openwop-check-publish-metadata.sh` | Step-8 hard gate — version lockstep |
| `scripts/check-npm-pack-contents.sh` | Step that the published npm tarball is contents-clean |
| `scripts/check-npm-pack-contents.sh` | Tarball contents + the SECOND conformance version pin |
| `scripts/generate-protocol-status.mjs` | Generator for `docs/PROTOCOL-STATUS.md`; honor the `--check` mode |
| `ROADMAP.md` | `Last reviewed:` line is part of the release surface |
| `INTEROP-MATRIX.md` | Conformance trajectory table — re-measure per release |
| `openwop-examples` (sibling repo) | Examples + reference hosts + their `conformance.md` evidence banners |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/update-docs` | Phase 1 dependency — sync README + KNOWN-LIMITS + PROTOCOL-STATUS + INTEROP-MATRIX + per-host banners |
| `/code-review` | Run independently if anything new landed under `conformance/src/` this cycle. SDK code is reviewed in `openwop-sdks`. |
| `/update-conformance` | Run BEFORE the release cycle if scenarios were added, so the Phase 3.3 conformance-bump decision is clean |
| `/ux-review` | Optional — sanity-check the released-form CHANGELOG headline + opener for prose quality |
| `/nfr` | Optional — final spec-corpus NFR sweep before tagging |
| `/pr` | Use for the Phase 5 release PR — applies the right labels |
| `/cleanup` | Pre-release — clear out stale `[Unreleased]` placeholders, dead links, dishonest INTEROP-MATRIX rows |
