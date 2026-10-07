---
name: cleanup
description: Systematic cleanup of the openwop corpus — orphaned schemas, stale RFCs, dead fixtures, README/RFCs/CHANGELOG drift, stale evidence, unsigned commits, profile claims no host actually meets. Delete-first bias, but with strict protected categories (spec/v2 normative docs, the frozen spec/v1 tree, generated files, gate-read docs, RFCs, SECURITY, evidence/, schemas with active $refs, registered fixtures).
---

# Corpus Cleanup & Drift Reduction (openwop)

You are now in **Cleanup Mode** — a systematic workflow for removing rot from the openwop corpus: orphaned schemas, stale RFCs, dead fixtures, drift between README / RFCs / spec / OpenAPI / AsyncAPI / INTEROP-MATRIX, unsigned commits, profile claims a host doesn't actually meet.

Bias: **DELETE FIRST, ASK QUESTIONS LATER** — but the openwop corpus has strict protected categories that static-reference analysis cannot detect. Read those first.

## Target: $ARGUMENTS

If no target is specified, perform a full corpus scan.

---

## Philosophy

**The best spec is the one that's shipped, witnessed, and signed.** Every line must justify its existence on the wire. A schema with no `$ref` pointing at it is a misleading signpost. A fixture not registered in `conformance/fixtures.md` fails `spec-corpus-validity.test.ts`. An RFC in `Draft` for >180 days with no activity is noise. A profile claim a host doesn't meet erodes the INTEROP-MATRIX.

**Rules of engagement:**
1. If nothing references a schema/fixture, **delete it** — unless it matches a protected category
2. If an RFC is `Withdrawn` or `Superseded` but the prose suggests otherwise, **align the prose with the Status field**
3. If a host advertises a profile its committed bundle doesn't support, **downgrade the INTEROP-MATRIX row** (the host itself lives in another repo)
4. If a scenario has `it.skip(` or `it.todo(` older than 30 days, **resolve or delete**
5. If two prose docs contradict each other, **pick the normative home (spec/v2) and rewrite the other to defer**
6. If a TODO/FIXME in spec text refers to a closed gap, **resolve and delete the comment**
7. If a commit on `main` is missing `Signed-off-by:`, **report it** — DCO is supposed to gate this, so a gap is a process bug

---

## MANDATORY: Protected Categories (NEVER delete without explicit approval)

These are wire contracts, normative records, generated surfaces, or inputs a gate reads.

### 1. v2 normative docs (`spec/v2/core/*.md`, `spec/v2/ext/**`)

The current normative corpus. `README.md`'s Document index lists every core doc and its **Total** must equal `ls spec/v2/core/*.md | wc -l`. Never delete one; retire a surface through an RFC and the retirement rules in `spec/v2/core/overview.md`. Also protected: `spec/v2/declaration.json` (the family declaration), `spec/v2/facets/`, and the other JSON registers under `spec/v2/` that `scripts/check-*.mjs` read.

### 2. The frozen v1 tree (`spec/v1/**`)

v1 reached end of support (RFC 0234). `spec/v1/` is frozen: never edit or delete it, even when it looks stale. The flat `schemas/*.schema.json` and `api/openapi.yaml` / `api/asyncapi.yaml` are the v1 wire; `api/openapi.yaml` is also the source `scripts/derive-v2-api.py` reads to produce `api/v2/`, so it is not dead.

### 3. Generated files

Never hand-edit or delete these; change the generator's input and regenerate:

| File | Generator |
|---|---|
| `api/v2/*` | `scripts/derive-v2-api.py` (from `api/openapi.yaml`; inline seams live in the script) |
| `schemas/v2/capabilities.schema.json`, `spec/v2/profiles.json`, `spec/v2/peer-dependency-aliases.json` | `scripts/generate-from-declaration.mjs` |
| `spec/v2/event-codemap.json`, `spec/v2/path-manifest.json`, `spec/v2/surface-baseline.json`, `spec/v2/generated/` | `generate-event-codemap.mjs`, `generate-operation-path-manifest.mjs`, `generate-v2-surface-baseline.mjs`, `generate-error-envelope.mjs` |
| `spec/v1/gaps.json`, `spec/v1/core-standard-manifest.json` | `generate-gaps.mjs`, `generate-core-standard-manifest.mjs` |
| `docs/PROTOCOL-STATUS.md`, RFCS/README.md tally + Status column | `generate-protocol-status.mjs` |
| `docs/ASSURANCE-STATUS.md` + `.json` | `generate-assurance-status.mjs` |
| `docs/V2-WITNESS-COVERAGE.md` | `report-v2-witness-coverage.mjs` |
| `docs/SECTION-B-REVIEW-PACKET.md` | `generate-review-packet.mjs` |
| `conformance/scenario-majors.json` | `conformance/scripts/generate-scenario-majors.mjs` |
| `conformance/requirements.json` | `conformance/scripts/generate-requirement-registry.mjs` |
| `spec-artifacts/**` | `generate-spec-artifacts.mjs` |
| `evidence/v1-end-of-support.json` | `generate-v1-eos-clock.mjs` |

### 4. Gate-read docs

Scripts parse these by shape. Before touching one, `grep -rn "<filename>" scripts/ conformance/src/ conformance/scripts/` and preserve whatever shape they read. Examples: `RFCS/README.md`, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`, `docs/INTEROP-EVIDENCE-LOG.md`, `docs/normative-home-baseline.json`, `docs/witness-baseline.json`, `SECURITY/invariants.yaml`, `SECURITY/external-audit-*.json`, `SECURITY/response-sla.json`, the README Document index and **Total** line, `CHANGELOG.md` (`check-changelog-shape.mjs`).

### 5. Schemas with active references (`schemas/*.schema.json`, `schemas/v2/*.schema.json`)

A schema may have no importer yet be referenced by `$ref` from the OpenAPI/AsyncAPI docs, another schema, a scenario, or an RFC. v2 schemas carry `$id` `https://openwop.dev/spec/v2/<name>.schema.json`, so search for the bare filename.

**Before deleting ANY schema:**
- [ ] `grep -rln "<name>.schema.json" api/ schemas/ spec/ conformance/src/ RFCS/ scripts/`
- [ ] Any match outside the file itself → **DO NOT DELETE**
- [ ] Referenced from an `Active` or `Accepted` RFC → **DO NOT DELETE**

### 6. Conformance fixtures registered in `conformance/fixtures.md`

`conformance/src/coherence/spec-corpus-validity.test.ts` and `conformance/src/scenarios/fixtures-valid.test.ts` fail if a registered fixture disappears.

**Before deleting ANY fixture:**
- [ ] `grep -n "<fixture-name>" conformance/fixtures.md`
- [ ] Listed in the catalog → **DO NOT DELETE** without also editing `fixtures.md`
- [ ] Referenced from `conformance/src/**/*.ts` → **DO NOT DELETE**

### 7. RFCs (`RFCS/*.md`)

The historical record. Numbers are never reused; never delete an RFC file. To retire one, set Status to `Withdrawn` or `Superseded` (fill `Superseded by`) and add a one-line disposition note.

### 8. SECURITY (`SECURITY/*`)

`SECURITY/invariants.yaml` is enforced by `scripts/check-security-invariants.sh` (gate step 6). Audit findings and SLA files are read by other checks. Never delete; retire an invariant only through an RFC.

### 9. Evidence (`evidence/**`)

Signed conformance bundles (`evidence/v2-host-bundles/*.json`), RFC witnesses, the cross-repo manifests and the corpus ledger. These are history and inputs to the v1 end-of-support clock and the RFC Accepted gate. Never delete or edit by hand.

### 10. CHANGELOG history

`CHANGELOG.md` and `conformance/CHANGELOG.md` are the compatibility record. Never delete past-release blocks.

### 11. INTEROP-MATRIX rows

Every row is a public claim backed by a bundle in `evidence/v2-host-bundles/`. Never silently delete; update from the bundle or mark "Not claimed".

### 12. Cascade detection (CRITICAL)

```
schemas/v2/A.schema.json $refs schemas/v2/B.schema.json
api/openapi.yaml $refs schemas/A.schema.json  → derive-v2-api.py → api/v2/openapi.yaml

Delete B → A's $ref breaks → the lint (gate steps 2/10) breaks
```

Before deleting, trace references backwards: what references this file, will those references break, and would those files be flagged next pass? If a deletion would cascade to 3+ files → **STOP and ask the user**.

---

## Phase 1: Orphaned Wire Artifacts

### 1.1 Orphaned schemas

```bash
for schema in schemas/*.schema.json schemas/v2/*.schema.json; do
  name=$(basename "$schema")
  count=$(grep -rlF "$name" api/ schemas/ spec/ conformance/src/ RFCS/ scripts/ 2>/dev/null | grep -vxF "$schema" | wc -l)
  [[ "$count" -eq 0 ]] && echo "ORPHAN: $schema (no references)"
done
```

Remember the flat `schemas/*.schema.json` are the v1 wire: an unreferenced one there is history, not rot, unless no v1 document ever used it. For each v2 orphan: check the protected categories; if genuinely unreferenced and not RFC-pending, mark for deletion.

### 1.2 Orphaned fixtures

```bash
for fixture in conformance/fixtures/*.json; do
  name=$(basename "$fixture")
  grep -qF "$name" conformance/fixtures.md || echo "UNREGISTERED FIXTURE: $fixture"
  grep -rqF "${name%.json}" conformance/src/ || echo "UNREFERENCED FIXTURE: $fixture"
done
```

Unregistered → add to `fixtures.md` or delete (depending on whether any scenario uses it). Unreferenced → delete unless `fixtures.md` documents a standalone-validation purpose.

### 1.3 v2 endpoints without coverage

```bash
grep -E '^  /' api/v2/openapi.yaml | sed 's/:$//; s/^  //'
```

Match each path against `conformance/src/scenarios/v2-*.test.ts`. An uncovered endpoint is a coverage gap, not an orphan: flag it for `/update-conformance`, and check `docs/V2-WITNESS-COVERAGE.md` for the family's witness status.

### 1.4 Core docs not in README's Document index

```bash
for doc in spec/v2/core/*.md; do
  name=$(basename "$doc")
  grep -qF "[\`$name\`]" README.md || echo "DOC NOT IN README INDEX: $doc"
done
echo "README Total: $(grep -o '\*\*Total\*\*: [0-9]*' README.md)  actual: $(ls spec/v2/core/*.md | wc -l)"
node scripts/check-doc-tallies.mjs
```

Fix by adding the row and correcting the **Total**.

---

## Phase 2: Stale RFCs + Spec Drift

### 2.1 Stale `Draft` RFCs

```bash
now=$(date +%s)
for rfc in RFCS/[0-9]*.md; do
  [[ "$rfc" == "RFCS/0000-template.md" ]] && continue
  grep -E '^\| \*\*Status\*\*' "$rfc" | head -1 | grep -q 'Draft' || continue
  age_days=$(( (now - $(git log -1 --format=%ct -- "$rfc")) / 86400 ))
  [[ "$age_days" -gt 180 ]] && echo "STALE DRAFT (>180d): $rfc — last touched ${age_days}d ago"
done
```

For each: ask the author. If abandoned, set Status to `Withdrawn` with a one-line rationale, then run `node scripts/generate-protocol-status.mjs --write` so RFCS/README.md follows.

### 2.2 Active RFCs awaiting acceptance

```bash
grep -lE '^\| \*\*Status\*\* *\| *`?Active' RFCS/[0-9]*.md
```

For each, walk the **Acceptance criteria** section. The Active→Accepted flip is gated by `scripts/check-accepted-predicate.mjs` (certified witness rows, no open gap rows); don't flip by hand without it passing.

### 2.3 Spec ↔ RFC drift

```bash
for rfc in RFCS/[0-9]*.md; do
  printf '%s: ' "$rfc"; grep -m1 -E '^\| \*\*Affects\*\*' "$rfc"
done
```

Check that each named `spec/v2/` doc actually carries the rule the RFC promised. An RFC must not state a rule a core doc owns (see `CONTRIBUTING.md`).

### 2.4 ROADMAP completion claims

Read `ROADMAP.md`. For every completed item, verify the artifact exists. Flip or remove claims nothing backs.

---

## Phase 3: Test + Conformance Purge

### 3.1 Anti-pattern detection

Search `conformance/src/scenarios/` and `conformance/src/coherence/`. `scripts/check-req-only.mjs` already enforces some of these in the gate.

| Anti-pattern | Grep pattern | Action |
|---|---|---|
| Tautology | `expect(true).toBe(true)` | Delete |
| Existence-only | `expect(x).toBeDefined()` as sole assertion | Delete or rewrite |
| `it.skip(` / `it.todo(` / `xit(` / `xdescribe(` | Skipped or stub | Implement or delete (none >30d) |
| Empty body | `it('...', () => {})` | Delete |
| Message not `req()` | `expect(..., '...')` string message | Rewrite as `req(id, section, requirement)` |
| Bare `return;` in an `it` body | unclassified exit | `return softSkip(kind, reason)` or `return seamAbsent(reason)` |
| Two requirement ids in one `it` | ledger keeps only the last | Split the `it` |

### 3.2 Orphaned scenarios

For each scenario: does the spec section / schema / endpoint it cites still exist? If the surface was retired, delete the scenario and regenerate `conformance/scenario-majors.json` and `conformance/requirements.json`.

### 3.3 Fixture cleanup

Cross-reference `conformance/fixtures/` against `fixtures.md` (Phase 1.2).

### 3.4 Evidence freshness

For each INTEROP-MATRIX row: does the suite version and the pass/fail/skip count match the bundle in `evidence/v2-host-bundles/`? Read the counts from the bundle; don't invent them. A stale bundle is re-cut by the host's own repo (`openwop/openwop-examples` for the reference host, `openwop/openwop-app` for app.openwop.dev), not here.

---

## Phase 4: Docs + Sibling-repo Drift

### 4.1 Stale `docs/` planning artifacts

Planning docs whose tracks closed long ago are candidates for deletion. Before removing one, grep `scripts/`, `conformance/`, `README.md` and the site's renderer for its path. Never touch the generated docs listed in protected category 3.

### 4.2 Links to sibling repos

SDKs live in `openwop/openwop-sdks`, example hosts in `openwop/openwop-examples`, the site in `openwop/openwop-site`, the demo app in `openwop/openwop-app`, the pack registry in `openwop/openwop-registry`. Nothing under `sdk/`, `examples/`, `site/`, `apps/`, `packs/` or `registry/` exists in this repo — flag any doc or script that still points there as an in-repo path.

### 4.3 Doc pack claims

```bash
node scripts/check-doc-pack-claims.mjs
```

Any pack a doc names must exist in the registry.

---

## Phase 5: Governance + Process Drift

### 5.1 Unsigned commits on `main`

```bash
git log origin/main --no-merges -200 \
  --format='%h%x09%s%x09%(trailers:key=Signed-off-by,valueonly,separator=%x2C)' \
  | awk -F'\t' '$3 == "" { print $1, $2 }'
```

See `CONTRIBUTING.md` on signing commits (DCO). A hit means the process leaked: report it and audit branch protection.

### 5.2 Conventional Commit prefix drift

```bash
git log origin/main -100 --format='%s' | sed -E 's/:.*//' | sort | uniq -c | sort -rn
```

Common prefixes: `spec(v2):`, `rfc(NNNN):`, `conformance(X.Y.Z):`, `release(X.Y.Z):`, `errata(X.Y.Z):`, `docs:`, `chore:`. Ad-hoc prefixes go in `CONTRIBUTING.md` or stop being used.

### 5.3 CHANGELOG `[Unreleased]` hygiene

```bash
node scripts/check-changelog-shape.mjs
```

The corpus and the conformance suite release together on a corpus tag; see `PUBLISHING.md` and the `/release` skill.

### 5.4 Review-rule tripwire

If `MAINTAINERS.md` has changed, check that the review rules in `CONTRIBUTING.md` and `GOVERNANCE.md` still match it.

---

## Phase 6: Structural Bloat (conformance + scripts)

### 6.1 Over-abstracted helpers

In `conformance/src/lib/` and `scripts/lib/`:
- Used in exactly 1 place → inline
- Wraps a single call with no added logic → delete
- File with < 3 exports and one caller → merge

Check `src/lib/*.test.ts` self-tests before removing a helper they cover.

### 6.2 Dependency audit

```bash
( cd conformance && npx depcheck --ignores="@types/*,vitest,typescript" )
```

---

## Phase 7: Execution & Verification

### 7.1 Pre-deletion checklist

- [ ] Working in your own worktree off `origin/main` (see CLAUDE.md), `git status` clean
- [ ] Re-read the **Protected Categories** — no deletion violates them
- [ ] Cascade risk identified

### 7.2 Deletion process

For each item from Phases 1–6:

1. **Protected categories first** — v2 spec doc, frozen v1 tree, generated file, gate-read doc, referenced schema, registered fixture, RFC, SECURITY, evidence, CHANGELOG history? If yes → skip or ask.
2. **Cascade risk** — 3+ files would orphan → stop and ask.
3. **Verify dead** — `grep -rn "<artifact>" api/ schemas/ spec/ conformance/ RFCS/ scripts/ docs/ SECURITY/ README.md`. For links from sibling repos, also search a checkout of `../openwop-site` and `../openwop-examples` if present.
4. **Delete**.
5. **Run the regen chain, then the gate** — if anything fails, restore:

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write
npm run openwop:check
```

`npm run openwop:check` runs `scripts/openwop-check.sh` (10 steps), which includes the security-invariants check.

### 7.3 Post-cleanup metrics

| Metric | Before | After | Delta |
|---|---|---|---|
| `schemas/v2/*.schema.json` count | | | |
| `conformance/fixtures/*` count | | | |
| `conformance/src/scenarios/*.test.ts` count | | | |
| `RFCS/*.md` by Status (Draft / Active / Accepted / Withdrawn / Superseded) | | | |
| `[Unreleased]` CHANGELOG line count | | | |
| Banned-pattern instances (`as any` / `@ts-ignore`) | 0 | 0 | 0 |
| `it.skip(` / `it.todo(` count | | | |
| `npm run openwop:check` exit | 0 | 0 | — |

### 7.4 Commit strategy

Logical batches with conventional prefixes:
- `chore(cleanup): remove orphaned v2 schemas`
- `chore(cleanup): retire RFC NNNN — Withdrawn`
- `chore(cleanup): align INTEROP-MATRIX with committed bundles`
- `fix(conformance): remove skipped scenarios > 30d`

Every commit passes `npm run openwop:check` and carries `Signed-off-by:`.

---

## Phase 8: Guard Rails

### 8.1 Pre-commit hook

`scripts/hooks/pre-commit` exists; install it with `bash scripts/install-git-hooks.sh` (see `CONTRIBUTING.md`).

### 8.2 CI additions

`.github/workflows/openwop-spec.yml` runs `npm run openwop:check`. Candidate additions: a stale-Draft-RFC bot, an orphan-schema check, a fixture-registration check.

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
| `audit evidence` | Run Phase 3.4 only — INTEROP-MATRIX vs committed bundles |
| `audit dco` | Run Phase 5.1 only — DCO signature check |
| `delete [target]` | Delete with full protected-category + cascade verification |
| `report` | Show current cleanup metrics |
| `revise: [feedback]` | Revise current phase approach |
| `done` | Complete cleanup session |

---

## Phase Reference

| # | Phase | Focus |
|---|---|---|
| 1 | Orphaned Wire Artifacts | Schemas / fixtures with no reference; uncovered v2 endpoints; README index drift |
| 2 | Stale RFCs + Spec Drift | Draft RFCs > 180d; Active RFCs unaccepted; RFC ↔ spec/v2 drift |
| 3 | Test + Conformance Purge | Anti-pattern scenarios; orphan scenarios; stale evidence |
| 4 | Docs + Sibling-repo Drift | Stale planning docs; in-repo paths that moved to sibling repos |
| 5 | Governance + Process Drift | Unsigned commits; prefixes; CHANGELOG shape; review rules vs MAINTAINERS |
| 6 | Structural Bloat | Over-abstracted helpers; dependency audit |
| 7 | Execution + Verification | Delete with cascade checks; regen chain + gate; metrics; commits |
| 8 | Guard Rails | Pre-commit hook + CI |

---

## Recommended Skill Chain

```
/cleanup → /update-docs → /code-review → /pr
```

For RFC retirement:
```
/cleanup audit rfcs → /prd <slug> (Withdrawn / Superseded disposition) → /update-docs → /pr
```

For evidence drift:
```
/cleanup audit evidence → /update-docs → /pr
```
