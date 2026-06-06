---
name: cleanup
description: Systematic cleanup of the openwop corpus — orphaned schemas, stale RFCs, dead fixtures, README/RFCs/CHANGELOG drift, deprecated examples, unsigned commits, profile claims no host actually meets. Delete-first bias, but with strict protected categories (spec/v1/, schemas with active $refs, conformance fixtures referenced from scenarios, normative RFCs, security invariants).
---

# Corpus Cleanup & Drift Reduction (openwop)

You are now in **Cleanup Mode** — a systematic workflow for removing rot from the openwop corpus: orphaned schemas, stale RFCs, dead fixtures, drift between README / RFCs / spec / OpenAPI / AsyncAPI / INTEROP-MATRIX, dead examples, unsigned commits, profile claims a host doesn't actually meet.

Bias: **DELETE FIRST, ASK QUESTIONS LATER** — but the openwop corpus has strict protected categories that are NOT static-import-detectable. Read those first.

## Target: $ARGUMENTS

If no target is specified, perform a full corpus scan.

---

## Philosophy

**The best spec is the spec that's actually shipped, conforming, and signed.** Every line that exists must justify its existence on the wire. A schema with no `$ref` pointing at it is a misleading signpost. A fixture not registered in `fixtures.md` will fail `spec-corpus-validity.test.ts`. An RFC in `Draft` for >180 days with no PR activity is noise to maintainers and intimidating to contributors. A profile claim a host doesn't actually meet erodes the INTEROP-MATRIX credibility everyone relies on.

**Rules of engagement:**
1. If nothing references a schema/fixture/example, **delete it** — unless it matches a protected category
2. If an RFC is `Withdrawn` or `Superseded` but the prose suggests otherwise, **align the prose with the Status field**
3. If a host advertises a profile it doesn't pass on the current suite, **downgrade the advertisement OR fix the host**
4. If a scenario has a `it.skip(` or `it.todo(` older than 30 days, **resolve or delete**
5. If CHANGELOG.md `[Unreleased]` has been there >90 days without a release, **cut a release OR move entries to a real version block**
6. If two prose docs say contradictory things, **pick one source of truth and rewrite the other to defer**
7. If a TODO/FIXME in spec text refers to a closed gap, **resolve and delete the comment**
8. If `docs/` planning files refer to "Phase X — DONE" tracks that closed >90 days ago, **archive them**
9. If a commit on `main` is missing `Signed-off-by:`, **document the gap in CHANGELOG** (DCO is supposed to gate this — gaps are bugs in process)

---

## MANDATORY: Protected Categories (NEVER delete without explicit approval)

These categories are exempt from the "delete first" bias. They serve as wire contracts, normative records, or invariants that static-reference analysis cannot detect.

### 1. Normative spec docs (`spec/v1/*.md`)

Every `spec/v1/<doc>.md` with `Status: FINAL v1` is part of the locked v1 contract. **Never delete these.** If a doc is genuinely obsolete:
- File an RFC marking it `Withdrawn` or `Superseded by RFC NNNN`
- Update the prose to a thin redirect: "This document is superseded by …"
- Keep the file (for stable URLs) — never remove

### 2. Schemas referenced from OpenAPI / AsyncAPI / conformance / RFCs (`schemas/*.schema.json`)

A schema may have NO direct importer in SDK code but BE referenced via cross-file `$ref` from `api/openapi.yaml`, `api/asyncapi.yaml`, another schema, or a conformance scenario.

**Before deleting ANY `schemas/*.schema.json`:**
- [ ] `grep -rn "<name>.schema.json" api/ schemas/ conformance/src/ RFCS/ spec/v1/`
- [ ] If any match outside the file itself → **DO NOT DELETE**
- [ ] If the schema is referenced from an `Active` or `Accepted` RFC → **DO NOT DELETE** even if not yet wired into OpenAPI

### 3. Conformance fixtures registered in `fixtures.md`

A fixture in `conformance/fixtures/` is part of the spec corpus' round-trip surface. `conformance/src/scenarios/spec-corpus-validity.test.ts` and `fixtures-valid.test.ts` will fail if a registered fixture disappears.

**Before deleting ANY fixture:**
- [ ] `grep -n "<fixture-name>" conformance/fixtures.md`
- [ ] If listed in the catalog → **DO NOT DELETE** without also editing `fixtures.md`
- [ ] If referenced from `conformance/src/scenarios/*.test.ts` → **DO NOT DELETE**

### 4. RFCs (`RFCS/*.md`)

RFCs are **the historical record**. Per `RFCS/README.md`: "Numbers are not reused; a withdrawn RFC keeps its number." Never delete an RFC file. To retire one:
- Update Status to `Withdrawn` or `Superseded` (and fill `Superseded by`)
- Add a one-line note in the body explaining the disposition
- Keep the file

### 5. SECURITY invariants + threat models (`SECURITY/*`)

`SECURITY/invariants.yaml` is enforced by `scripts/check-security-invariants.sh`. Threat-model docs (`threat-model-*.md`) anchor RFC acceptance gates.

**Before deleting any `SECURITY/*` file:**
- [ ] Check if the invariant is still referenced from `conformance/src/scenarios/`
- [ ] Check if the threat-model is referenced from any RFC
- [ ] If either, **DO NOT DELETE**

### 6. CHANGELOG.md history

The CHANGELOG is the canonical compatibility record. Older entries may look stale but they document the wire contract's evolution. **Never delete past-release blocks.** Only consolidate within `[Unreleased]` when the same artifact has multiple line entries.

### 7. Reference-host evidence files (`../openwop-examples/examples/hosts/*/conformance.md`)

These are the public conformance evidence for each reference host. Don't delete; update with current suite version, command, target URL class, pass/fail/skip counts when re-running the suite.

### 8. INTEROP-MATRIX rows

Even when no third-party hosts exist, the steward-maintained host rows (`in-memory`, `sqlite`, `python`) are public claims. Never silently delete; update or mark "Not claimed" honestly.

### 9. Cascade detection (CRITICAL)

When deleting a schema, scenario, or example, check if its removal would orphan other files:

```
schemas/A.schema.json $refs schemas/B.schema.json
api/openapi.yaml $refs schemas/A.schema.json

If you delete schemas/B.schema.json → A.schema.json's $ref breaks → openapi.yaml's lint breaks
```

**Before deleting, trace the $ref / import chain backwards:**
1. What references this file?
2. If removed, will those references break?
3. Would those files then be flagged in a subsequent pass?

If a deletion would trigger a cascade of 3+ files → **STOP and ask the user**.

---

## Phase 1: Orphaned Wire Artifacts

### 1.1 Orphaned schemas

For each `schemas/*.schema.json`:

```bash
for schema in schemas/*.schema.json; do
  name=$(basename "$schema")
  count=$(grep -rln "$name" api/ schemas/ conformance/src/ RFCS/ spec/v1/ sdk/ ../openwop-examples/examples/ scripts/ 2>/dev/null | grep -v "^$schema$" | wc -l)
  if [[ "$count" -eq 0 ]]; then
    echo "ORPHAN: $schema (no $refs found)"
  fi
done
```

For each orphan: confirm against the protected-categories list. If genuinely unreferenced AND not RFC-pending → mark for deletion. After deletion, run `npm run openwop:check` and revert if anything breaks.

### 1.2 Orphaned fixtures

```bash
for fixture in conformance/fixtures/*.json; do
  name=$(basename "$fixture")
  if ! grep -qF "$name" conformance/fixtures.md; then
    echo "UNREGISTERED FIXTURE: $fixture"
  fi
  if ! grep -qF "$(basename "$name" .json)" conformance/src/scenarios/*.test.ts 2>/dev/null; then
    echo "UNREFERENCED FIXTURE: $fixture"
  fi
done
```

For each finding:
- Unregistered → either add to `fixtures.md` OR delete (decide based on whether any scenario uses it)
- Unreferenced → delete unless `fixtures.md` documents an intentional standalone-validation purpose

### 1.3 OpenAPI / AsyncAPI orphan endpoints

Find endpoints in `api/openapi.yaml` with no corresponding scenario in `conformance/src/scenarios/`:

```bash
# Extract endpoint paths from openapi.yaml (rough — grep, not yaml-parse)
grep -E "^  /v1/" api/openapi.yaml | sed 's/:$//; s/^  //'
```

Match each against scenario coverage. Endpoints without any scenario coverage are not "orphans" to delete — they're coverage gaps. Flag for `/update-conformance`, not for deletion.

### 1.4 Spec docs not in README's Document index

```bash
for doc in spec/v1/*.md; do
  name=$(basename "$doc")
  if ! grep -qF "[\`$name\`]" README.md; then
    echo "DOC NOT IN README INDEX: $doc"
  fi
done
```

Fix by adding the row to README's "Document index" table.

### 1.5 Schemas not advertised on the spec site

If `../openwop-site/site/src/build.mjs` generates a schema catalog from `schemas/`, confirm every schema is included. Mismatches indicate site regeneration didn't run after recent additions.

---

## Phase 2: Stale RFCs + Spec Drift

### 2.1 Stale `Draft` RFCs

```bash
for rfc in RFCS/*.md; do
  [[ "$rfc" == "RFCS/0000-template.md" || "$rfc" == "RFCS/README.md" ]] && continue
  status=$(grep -E "^\| \*\*Status\*\* \|" "$rfc" | head -1)
  last_commit=$(git log -1 --format=%ct -- "$rfc")
  now=$(date +%s)
  age_days=$(( (now - last_commit) / 86400 ))
  if echo "$status" | grep -q "Draft" && [[ "$age_days" -gt 180 ]]; then
    echo "STALE DRAFT (>180d): $rfc — last touched ${age_days}d ago"
  fi
done
```

For each stale Draft: ping the author. If abandoned, change Status to `Withdrawn` with a one-line rationale.

### 2.2 Active RFCs awaiting implementation

```bash
for rfc in RFCS/*.md; do
  status=$(grep -E "^\| \*\*Status\*\* \|" "$rfc" | head -1)
  if echo "$status" | grep -q "Active"; then
    # Check if the RFC's Acceptance Criteria are met
    echo "ACTIVE: $rfc — verify Acceptance Criteria"
  fi
done
```

For each `Active` RFC: walk the Acceptance Criteria checklist. If all boxes tick, flip Status to `Accepted` and add a date. If not, file an implementation issue.

### 2.3 Spec ↔ RFC drift

For every spec section that lands per an RFC, the RFC's "Affects" field should name the doc. Cross-check:

```bash
for rfc in RFCS/*.md; do
  affects=$(grep -A1 "^\| \*\*Affects\*\*" "$rfc" | tail -1)
  echo "$rfc affects: $affects"
done
```

Manually check that each named spec doc actually contains the prose the RFC promised.

### 2.4 README "Document index" drift

The README documents every spec doc with Status + word count + summary. After spec edits, the word count drifts. Recompute and flag stale rows:

```bash
for row in $(grep -oE 'spec/v1/[a-z-]+\.md' README.md | sort -u); do
  if [[ -f "$row" ]]; then
    actual=$(wc -w "$row" | awk '{print $1}')
    echo "$row: $actual words (check against README claim)"
  fi
done
```

Update the README rows to match.

### 2.5 ROADMAP completion claims

Read `ROADMAP.md`. For every "DONE" or completed-quarter item, verify the artifact exists. Common drift: ROADMAP claims `packs.openwop.dev` is live but no third-party host has used it. Either flip the claim to "Live but untested by third parties" or remove.

---

## Phase 3: Test + Conformance Purge

**Conformance scenarios must prove wire conformance. Tests that prove nothing erode the suite's authority.**

### 3.1 Anti-pattern detection

Search `conformance/src/scenarios/` and `../openwop-sdks/sdk/typescript/src/__tests__/`:

| Anti-pattern | Grep pattern | Action |
|---|---|---|
| Tautology | `expect(true).toBe(true)` | Delete |
| Existence-only | `expect(x).toBeDefined()` as sole assertion | Delete or rewrite |
| `it.skip(` / `it.todo(` / `xit(` / `xdescribe(` | Skipped or stub | Implement or delete (no >30d olds) |
| Empty body | `it('...', () => {})` | Delete |
| Mock-validation-only | Only checks a mock was called | Rewrite to assert wire behavior |
| Missing `driver.describe()` framing | Assertion lacks spec-section citation | Rewrite to include the citation |

### 3.2 Orphaned tests

For each test file: does the spec doc / schema / endpoint it covers still exist? If the underlying surface was removed (e.g., via a `Superseded` RFC), delete the orphaned scenario.

### 3.3 Test fixture cleanup

Cross-reference `conformance/fixtures/` against `conformance/fixtures.md` (per Phase 1.2). Remove unregistered, unused fixtures.

### 3.4 Reference-host evidence freshness

For each `../openwop-examples/examples/hosts/{in-memory,sqlite,python}/conformance.md`:
- Suite version cited — is it the current `@openwop/openwop-conformance` version?
- Pass/fail/skip counts — recent?
- Profile advertisements honest against the rerun?

Outdated evidence → re-run the suite, update the evidence file.

---

## Phase 4: Implementation Artifact Cleanup

### 4.1 SDK dead exports

For each export in `../openwop-sdks/sdk/typescript/src/index.ts`, `../openwop-sdks/sdk/python/src/openwop_client/__init__.py`, `../openwop-sdks/sdk/go/`:
- Is it covered by at least one method on `OpenwopClient` or equivalent?
- Is there a corresponding endpoint in `api/openapi.yaml` (for clients) or schema in `schemas/` (for types)?

Dead exports here mean SDK drift from spec; remove or align.

### 4.2 Example host parity

Each `../openwop-examples/examples/hosts/{in-memory,sqlite,python}/` should advertise a profile set in its `conformance.md`. If a profile is advertised but the host's code clearly doesn't implement it (e.g., it returns 501 on the gated endpoint), either:
- Implement the missing surface, OR
- Downgrade the advertised profile in INTEROP-MATRIX and `conformance.md`

### 4.3 Stale `docs/` planning artifacts

`docs/PROTOCOL-GAP-CLOSURE-PLAN.md` tracks 1–9. Items marked DONE >90 days ago can be archived. `docs/MULTI-AGENT-INTEGRATION-GAPS.md` is noted as "archived" in the README — confirm.

### 4.4 Site regeneration drift

If `../openwop-site/site/` content lags behind `spec/v1/` or `RFCS/`, run `../openwop-site/site/src/build.mjs` and commit the updated `../openwop-site/site/dist/`. If `../openwop-site/site/templates/` references a doc that no longer exists, fix the template.

### 4.5 Pack ecosystem cleanup

`../openwop-registry/packs/` contains community + vendor packs. For each pack directory:
- Is `manifest.json` valid against `node-pack-manifest.schema.json`?
- For agent packs, valid against `agent-manifest.schema.json`?
- Is the pack referenced from `../openwop-registry/registry/v1/` index?
- Signature present per `node-packs.md`?

Unsigned or unreferenced packs are noise; remove or fix.

---

## Phase 5: Governance + Process Drift

### 5.1 Unsigned commits on `main`

```bash
git log --no-merges -200 --format='%H %s%n%b' | awk -v RS= '
  /^Signed-off-by:/ { signed=1 } 
  { if (!signed) print $0; signed=0 }
'
```

Per `CONTRIBUTING.md` §"Sign your commits": DCO bot blocks merge. Gaps mean process leaked. If found, document in CHANGELOG under a "Process" line and audit branch protection.

### 5.2 Conventional Commit prefix drift

Recent commits use `spec(v1):`, `feat(host-sqlite):`, `build:`. Scan for ad-hoc prefixes that aren't in the convention:

```bash
git log -100 --format='%s' | awk -F':' '{print $1}' | sort | uniq -c | sort -rn
```

Non-conventional prefixes should be documented in `CONTRIBUTING.md` or migrated.

### 5.3 CHANGELOG `[Unreleased]` block age

If `[Unreleased]` has entries older than 90 days without a release, either cut a release or move entries to a dated block. Spec corpus + conformance + SDK packages each have their own version stream — `PUBLISHING.md` documents the release cadence.

### 5.4 Bootstrap-phase tripwire status

Per `ROADMAP.md` and `CONTRIBUTING.md` §"Bootstrap-phase notes": one-approval review remains until `MAINTAINERS.md` lists a non-steward maintainer. If `MAINTAINERS.md` has grown but the bootstrap rules in `CONTRIBUTING.md` weren't updated → flag.

---

## Phase 6: Structural Bloat Reduction

### 6.1 Over-abstracted SDK helpers

Find helper functions in `../openwop-sdks/sdk/typescript/src/run-helpers.ts` or similar:
- Used in exactly 1 place → inline
- Wrap a single SDK call with no added logic → delete, use direct method
- "Helper" files with < 3 exports → merge or delete

### 6.2 Redundant types

Find types/interfaces that:
- Duplicate a schema's TypedDict equivalent in `../openwop-sdks/sdk/typescript/src/types.ts`
- Extend a schema-derived type without adding fields
- Are identical to another type already exported

### 6.3 Barrel file cleanup (`../openwop-sdks/sdk/typescript/src/index.ts`)

List re-exports. Verify each is consumed by external code (`@openwop/openwop` users — check `package.json` `files` field). Remove unused re-exports.

### 6.4 Dependency audit

```bash
( cd ../openwop-sdks/sdk/typescript && npx depcheck --ignores="@types/*,vitest,typescript" )
( cd conformance && npx depcheck --ignores="@types/*,vitest,typescript" )
```

Zero runtime deps remains the SDK goal per `CONTRIBUTING.md`. Conformance has Ajv + Vitest only.

---

## Phase 7: Execution & Verification

### 7.1 Pre-deletion checklist

Before any deletion:
- [ ] `git status` is clean (commit current work first)
- [ ] Create a `cleanup/...` branch for the session
- [ ] Read the **Protected Categories** section (Phase header) — none of the deletions violate those rules
- [ ] Identify cascade risk (Phase 1 §Cascade detection)

### 7.2 Deletion process

For each item identified in Phases 1–6:

1. **Check protected categories FIRST** — spec doc? Schema with active `$ref`? Registered fixture? RFC? SECURITY invariant? CHANGELOG history? If yes → skip or ask.
2. **Check cascade risk** — would deleting orphan other files? If 3+ would orphan → stop and ask.
3. **Verify dead** — `grep -rn "<artifact>" api/ schemas/ conformance/ RFCS/ spec/v1/ sdk/ ../openwop-examples/examples/ scripts/ ../openwop-site/site/ ../openwop-registry/packs/ ../openwop-registry/registry/ docs/`.
4. **Delete**.
5. **Run `npm run openwop:check`** — if it fails, restore immediately.
6. **Run `bash scripts/check-security-invariants.sh`** — if it fails, restore immediately.

### 7.3 Post-cleanup metrics

After each session, report:

| Metric | Before | After | Delta |
|---|---|---|---|
| `schemas/*.schema.json` count | | | |
| `conformance/fixtures/*` count | | | |
| `conformance/src/scenarios/*.test.ts` count | | | |
| `RFCS/*.md` count (Draft / Active / Accepted / Withdrawn / Superseded breakdown) | | | |
| `[Unreleased]` CHANGELOG line count | | | |
| Banned-pattern instances (`as any` / `@ts-ignore`) | 0 | 0 | 0 |
| `it.skip(` / `it.todo(` count | | | |
| `npm run openwop:check` exit | 0 | 0 | — |

### 7.4 Commit strategy

Commit in logical batches with conventional prefixes:
- `chore(cleanup): remove orphaned schemas`
- `chore(cleanup): retire RFC NNNN — Withdrawn`
- `chore(cleanup): update INTEROP-MATRIX honesty`
- `chore(cleanup): rerun conformance evidence for sqlite host`
- `fix(conformance): remove skipped scenarios > 30d`
- `docs(cleanup): consolidate CHANGELOG [Unreleased]`

Each commit must pass `npm run openwop:check`. Each commit must carry `Signed-off-by:`.

---

## Phase 8: Guard Rails

### 8.1 Pre-commit hook for cleanup invariants

Consider adding `.git/hooks/pre-commit` (or a `scripts/pre-commit.sh` documented in `CONTRIBUTING.md`) that runs:

```bash
bash scripts/openwop-check.sh
bash scripts/check-security-invariants.sh
git log --no-merges -1 --format='%b' | grep -q '^Signed-off-by:' || { echo "DCO trailer missing"; exit 1; }
```

### 8.2 CI additions

`.github/workflows/openwop-spec.yml` already runs `openwop-check.sh`. Consider adding:
- Stale-`Draft`-RFC bot that comments on RFCs >180 days idle
- Orphan-schema check
- Fixture-registration check (every file in `conformance/fixtures/` appears in `fixtures.md`)

### 8.3 Don't-recreate hook

Per the original myndhyve practice: when a deletion is intentional and shouldn't be undone, add it to `scripts/prevent-deleted-features.sh` (create this file if it doesn't exist). Example: a withdrawn RFC's schema, a removed example.

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` / `next` | Move to next phase |
| `back` | Go to previous phase |
| `skip to phase N` | Jump to phase N |
| `scan [target]` | Scan a specific directory or category for drift |
| `audit schemas` | Run Phase 1.1 only |
| `audit fixtures` | Run Phase 1.2 only |
| `audit rfcs` | Run Phase 2.1–2.2 only |
| `audit hosts` | Run Phase 4.2 only — reference-host parity |
| `audit dco` | Run Phase 5.1 only — DCO signature check |
| `delete [target]` | Delete with full protected-category + cascade verification |
| `report` | Show current cleanup metrics |
| `revise: [feedback]` | Revise current phase approach |
| `done` | Complete cleanup session |

---

## Phase Reference

| # | Phase | Focus |
|---|---|---|
| 1 | Orphaned Wire Artifacts | Schemas / fixtures / endpoints with no $ref / scenario |
| 2 | Stale RFCs + Spec Drift | Draft RFCs > 180d; Active RFCs unaccepted; README drift |
| 3 | Test + Conformance Purge | Anti-pattern scenarios; orphan tests; stale evidence files |
| 4 | Implementation Artifact Cleanup | SDK dead exports; host parity; site regeneration; pack hygiene |
| 5 | Governance + Process Drift | Unsigned commits; non-conventional prefixes; CHANGELOG age; bootstrap-phase rules |
| 6 | Structural Bloat | Over-abstracted helpers; redundant types; barrel cleanup; dep audit |
| 7 | Execution + Verification | Delete with cascade checks; metrics; commit strategy |
| 8 | Guard Rails | Pre-commit + CI + don't-recreate hooks |

---

## Recommended Skill Chain

```
/cleanup → /update-docs → /code-review → /pr
```

For RFC retirement specifically:
```
/cleanup audit rfcs → /prd <slug> (with Withdrawn / Superseded disposition) → /update-docs → /pr
```

For reference-host evidence refresh:
```
/cleanup audit hosts → /update-conformance → /code-review → /pr
```
