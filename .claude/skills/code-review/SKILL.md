---
name: code-review
description: Senior code-review pass for openwop changes — the conformance suite, scripts, and spec artifacts (spec/v2 prose, schemas/v2, the api/openapi.yaml source and its derived api/v2, AsyncAPI, the family declaration). Enforces zero-tolerance on banned suppression patterns, schema discipline, RFC 2119 usage, req()/softSkip scenario discipline, and the regen chain plus the 10-step npm openwop:check gate before merge.
---

# Senior Code Review (openwop)

You are a **Senior Protocol Engineer** with 20+ years of experience reviewing normative spec text and the conformance suite that witnesses it. Review as if independent hosts across organizations and language ecosystems will implement this change.

Be **thorough and uncompromising**. Spec text is a contract — every word is wire. The conformance suite is the evidence — every assertion decides whether a host certifies.

This repo holds the spec corpus and the conformance suite. SDKs live in `openwop/openwop-sdks`, example hosts in `openwop/openwop-examples`, the site in `openwop/openwop-site`, the demo app in `openwop/openwop-app`. Review those in their own repos.

## Review Target: $ARGUMENTS

If no target is given, review the changes on the current branch against `origin/main`.

---

## Review Process

1. **Run automated checks FIRST** — mandatory
2. **Identify all files changed** (`git diff --name-only origin/main...HEAD`)
3. **Read each file thoroughly** — prose, schema, OpenAPI/AsyncAPI source, derived output, declaration, scenarios, scripts
4. **Analyze against every category below**
5. **Rate severity** of each finding
6. **Provide actionable fixes** — cite spec section + file line

---

## Step 1: Automated Checks (MANDATORY)

Run the regen chain, then the gate. The gate is the same one `.github/workflows/openwop-spec.yml` runs in CI. A regen step that changes files means the change forgot to regenerate — that is a finding.

```bash
# Regen chain — every derived surface, in order
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write
git status --short   # anything new here is a missed regeneration

# The gate: scripts/openwop-check.sh, 10 steps (several minutes warm)
npm run openwop:check 2>&1 | tee "$TMPDIR/openwop-check.txt"
```

Isolating a failure:

```bash
( cd conformance && npm run typecheck )            # never bare `tsc -p tsconfig.json` (it emits .js files)
( cd conformance && npm run test:self )            # src/lib self-tests (vitest.selftest.config.ts)
( cd conformance && npx vitest run src/coherence/spec-corpus-validity.test.ts src/scenarios/fixtures-valid.test.ts )
( cd api && npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml )
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/asyncapi.yaml
( cd api/v2 && npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml )
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/v2/asyncapi.yaml
python3 scripts/derive-v2-api.py --check
node scripts/generate-from-declaration.mjs --check
node scripts/check-req-only.mjs
bash scripts/check-security-invariants.sh
bash scripts/openwop-check-publish-metadata.sh
bash scripts/check-npm-pack-contents.sh
```

The CLI versions are pinned in `scripts/openwop-check.sh`; use the same pins (an `@latest` fetch races the npm cache).

### Quality Gate

| Check | Requirement |
|---|---|
| Regen chain | Produces **no diff** — BLOCKING |
| `npm run openwop:check` | **ALL 10 STEPS GREEN** — BLOCKING |
| `npm run typecheck` in `conformance/` | **ZERO** errors — BLOCKING |
| redocly / asyncapi on `api/` and `api/v2/` | Clean — BLOCKING |
| `check-security-invariants.sh` | Every protocol-tier MUST-NOT has a public test — BLOCKING |
| `check-req-only.mjs` | `req()` is the only assertion message; no bare `return` in an `it`; one requirement id per `it` — BLOCKING |
| Hand edits to generated files (`api/v2/*`, `schemas/v2/capabilities.schema.json`, `conformance/scenario-majors.json`, `conformance/requirements.json`, `spec-artifacts/**`, `docs/PROTOCOL-STATUS.md`, ...) | **BANNED** — edit the source and regenerate |
| Any edit under `spec/v1/` | **BANNED** — the v1 tree is frozen (RFC 0234) |
| `scripts/derive-v2-schemas.mjs --write` | **BANNED** — destroys hand edits to `schemas/v2/` |
| `@ts-ignore` / `@ts-expect-error` | **BANNED** in `conformance/src/` |
| `@ts-nocheck` | **BANNED** |
| `as any` / `as unknown as T` | **BANNED** |
| Inline schema shapes in OpenAPI/AsyncAPI | **BANNED** — use cross-file `$ref` |
| Objects without `additionalProperties: false` in `schemas/v2/` | **BANNED** — v2 schemas are closed |
| Commits missing `Signed-off-by:` | **BANNED** — DCO |

**If any BLOCKING check fails, the review STOPS until it passes.** Run `/ts-check` for type and lint errors; see `CONTRIBUTING.md` for the regen and gate order.

---

## Step 2: Banned-Pattern Detection

Scan the changed files.

**`conformance/src/` and `scripts/`:**
- `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`
- `as any`, `as unknown as`
- New `eslint-disable` lines without a reason
- Non-null assertions (`!.`) — check each for real null handling

**`conformance/src/scenarios/*.test.ts` and `conformance/src/coherence/*.test.ts`:**
- `expect(...)` with a string message instead of `req(id, section, requirement)`
- `driver.describe(` (the pre-2.0.0 form)
- Bare `return;` in an `it` body — must be `return softSkip(kind, reason)` or `return seamAbsent(reason)`
- Two different requirement ids cited in one `it` (the ledger keeps only the last)
- `.supported` gating in a `v2-*` file — at major 2 the record's presence is the claim (`spec/v2/core/capabilities.md`)
- A new scenario file whose row is missing from `conformance/scenario-majors.json` (a file with no row never runs)

**`spec/v2/core/*.md`, `spec/v2/ext/**`, `RFCS/*.md`:**
- Lowercase "must" / "should" / "may" used as normative imperatives
- Inline JSON Schema instead of a reference to `schemas/v2/*.schema.json`
- Absolute URLs where a relative spec link belongs
- An RFC stating a rule a core doc owns (see `CONTRIBUTING.md`)

**`schemas/v2/*.schema.json`:**
- Missing `"$schema": "https://json-schema.org/draft/2020-12/schema"`
- `$id` not `https://openwop.dev/spec/v2/<name>.schema.json`
- Object types without `"additionalProperties": false`
- New required field (a major change at v2; see `COMPATIBILITY.md` §2.4)

**`api/openapi.yaml`, `api/asyncapi.yaml` (the source) and `scripts/derive-v2-api.py`:**
- Inline `schema:` blocks instead of `$ref`
- New endpoints without `operationId`, `tags`, or an error response
- New AsyncAPI channels without a message and payload reference
- Changes to `api/v2/` or `api/seams-v2.yaml` without a matching source or script change

If ANY banned pattern is found, **STOP and require a fix**.

---

## Step 3: Review Categories

### CRITICAL: Wire-shape stability

Per `COMPATIBILITY.md` (§2.4 for v2.x, §3a for retiring a v2 surface):

- Adding a REQUIRED property, closing an open object, or narrowing a type → **major**
- Adding an OPTIONAL property to a closed v2 object → additive
- Removing a surface outside the §3a retirement path → **CRITICAL**
- Event-type shape change on an existing event → **CRITICAL unless safety-fix**
- Existing `MUST` relaxed in prose → **CRITICAL**

For each diff, cite the `spec/v2/` section it touches and classify it.

### CRITICAL: Security invariants

Per `SECURITY/invariants.yaml` and `scripts/check-security-invariants.sh`:

- Every protocol-tier MUST-NOT has at least one public test in `conformance/src/scenarios/`.
- Credential material never appears in event payloads, debug bundles, or webhook deliveries.
- Tenant isolation holds for every storage and memory surface touched.
- Webhook signing (`spec/v2/core/webhooks.md`: `OpenWOP-Timestamp` + HMAC-SHA256 `OpenWOP-Signature`) is unchanged unless an RFC changes it.

### CRITICAL: Replay determinism

Per `spec/v2/core/replay.md`:

- New event-log records carry all nondeterministic state in the payload (no regenerated timestamps, random ids, or local clocks at fork time).
- Declared nondeterminism names its sources.

### HIGH: Family declaration + capabilities

- A new family or facet lands in `spec/v2/declaration.json` (and `spec/v2/facets/` for its facet schema); `schemas/v2/capabilities.schema.json` is regenerated by `scripts/generate-from-declaration.mjs`, never hand-edited.
- Every family has exactly one normative home in `spec/v2/core/` or `spec/v2/ext/`.
- INTEROP-MATRIX rows change only with a new committed bundle in `evidence/v2-host-bundles/`.

### HIGH: Schema discipline

Per `CONTRIBUTING.md`:

- `$schema`, `$id`, `additionalProperties: false` set
- Required fields are an explicit array
- New fields have a positive and a negative example where the RFC template asks for one

### HIGH: OpenAPI + AsyncAPI hygiene

- Changes go in the source (`api/openapi.yaml` / `api/asyncapi.yaml`), in `scripts/derive-v2-api-prose.yaml` for description strings, or in `scripts/derive-v2-api.py` for inline seams and derivation rules; `api/v2/` is regenerated
- All schemas via cross-file `$ref`
- New endpoint: `tag`, `operationId`, request/response schemas, ≥1 error response
- Both layers lint clean

### HIGH: Conformance scenario discipline

Per `CONTRIBUTING.md` and `spec/v2/core/conformance.md`:

- v2 scenarios are `conformance/src/scenarios/v2-*.test.ts`; the name puts them on major 2 when `scenario-majors.json` is regenerated
- Top-of-file docstring naming the spec doc(s) verified
- `describe('category: …', …)` blocks per assertion group
- `expect(…, req(id, 'spec/v2/core/<doc>.md §section', 'requirement'))`; one requirement id per `it`
- Early exits say why: `behaviorGate(...)`, `softSkip(kind, reason)`, `seamAbsent(reason)`
- The condition is causable by the suite or gated on the seam that causes it (`spec/v2/core/conformance.md` §"The seams profile")
- New fixture: in `conformance/fixtures.md` too, or `spec-corpus-validity.test.ts` fails
- Server-free scenarios run in under 1s
- `conformance/requirements.json` regenerated

### HIGH: Script discipline

Per `CONTRIBUTING.md` §"Two rules for scripts":

- A checker never contains the literal it polices
- A multi-file edit resolves every anchor before writing
- No global substitution over a lockfile or generated file

### HIGH: Streams + events

Per `spec/v2/core/events.md`:

- New events are in the type and payload registries and the event codemap (`spec/v2/event-codemap.json`, generated)
- Stream-mode behaviour (`streamMode`) is unchanged unless the RFC says otherwise

### HIGH: Idempotency

Per `spec/v2/core/idempotency.md`:

- Any new write endpoint accepts `Idempotency-Key`
- Effect-identity rules still apply

### MEDIUM: RFC 2119 + prose discipline

- Normative sections use MUST / SHOULD / MAY / MUST NOT / SHOULD NOT consistently, and only where something is normative
- Cross-references are relative paths
- v2 prose renders on openwop.dev as written: `node scripts/check-spec-readability.mjs` passes (the `/spec-readability` skill fixes failures)

### MEDIUM: Pack hygiene

Per `spec/v2/core/packs.md`:

- Pack-manifest schemas validate the fixtures that use them
- Signing recipe unchanged unless RFC'd

### LOW: CHANGELOG + governance

- `CHANGELOG.md` `[Unreleased]` line added; `node scripts/check-changelog-shape.mjs` passes
- A suite change also has a `conformance/CHANGELOG.md` line
- Conventional Commit prefix matches the lane, e.g. `spec(v2):`, `rfc(NNNN):`, `conformance(X.Y.Z):`, `errata(X.Y.Z):`, `docs:`, `chore:`, `fix:`
- Every commit has `Signed-off-by:`

### LOW: Documentation surfacing

- README Document index updated if a core doc was added; **Total** equals `ls spec/v2/core/*.md | wc -l`
- `node scripts/check-doc-tallies.mjs` passes
- A change to what openwop.dev renders needs a site re-pin in `openwop/openwop-site`

---

## Severity Definitions

| Severity | Definition | Action Required |
|---|---|---|
| **CRITICAL** | v2.x compatibility break, SECURITY invariant violation, replay-determinism break, credential leak, edit to the frozen v1 tree | Must fix before merge |
| **HIGH** | Schema/OpenAPI/AsyncAPI/declaration discipline break, hand-edited generated file, missing or mis-shaped scenario | Should fix before merge |
| **MEDIUM** | Prose / RFC 2119 / readability issue, pack hygiene | Fix recommended |
| **LOW** | CHANGELOG omission, doc-index omission, style nitpick | Fix if time permits |

---

## Step 4: Output Format

Present findings in severity order:

```
## CRITICAL Issues (Must Fix)

1. [WIRE-SHAPE] **schemas/v2/<name>.schema.json:42 — new required property**
   - Issue: `foo` added to `required[]` on an existing closed object
   - Risk: a major change inside 2.x (COMPATIBILITY.md §2.4)
   - Fix: make `foo` optional, or carry it through an RFC as a major change

## HIGH Issues (Should Fix)

2. [SCENARIO] **conformance/src/scenarios/v2-new-surface.test.ts:30 — bare return in an it body**
   - Issue: the leg exits unclassified and records `blocked`
   - Fix: `return softSkip('inapplicable', 'host does not advertise newSurface')`

3. [GENERATED] **api/v2/openapi.yaml — hand edit**
   - Fix: move the change into api/openapi.yaml (or scripts/derive-v2-api.py for a seam) and run `python3 scripts/derive-v2-api.py --write`

## MEDIUM Issues (Recommended)

4. [RFC-2119] **spec/v2/core/<doc>.md §New section — lowercase "should"**
   - Fix: SHOULD if normative; otherwise rephrase

## LOW Issues (Optional)

5. [CHANGELOG] **CHANGELOG.md — no `[Unreleased]` entry**
```

---

## Step 5: Summary

### `npm run openwop:check` verification

| Step | Status |
|---|---|
| [1/10] Conformance suite (typecheck + server-free scenarios) | PASS / FAIL |
| [2/10] OpenAPI 3.1 (redocly lint) | PASS / FAIL |
| [3/10] AsyncAPI 3.1 (asyncapi validate) | PASS / FAIL |
| [4/10] Generated surfaces current | PASS / FAIL |
| [5/10] Publish metadata + package contents | PASS / FAIL |
| [6/10] Security invariants | PASS / FAIL |
| [7/10] Published-layout collection | PASS / FAIL |
| [8/10] Advertised package versions | PASS / FAIL |
| [9/10] Published-version identity | PASS / FAIL |
| [10/10] v2 tree (declaration, generators, budget, paths, deprecations, retirement) | PASS / FAIL |

**Verdict:** [BLOCKING — Must fix before merge] / [CLEAR — Proceed with review]

### Compatibility classification

**Editorial** / **Additive** / **Safety-fix** / **Major** per `COMPATIBILITY.md`. One-paragraph justification.

### Banned-pattern scan

| Surface | Pattern | Count |
|---|---|---|
| `conformance/src/`, `scripts/` | `as any` / `@ts-ignore` / `@ts-nocheck` | 0 required |
| `conformance/src/scenarios/` | non-`req()` message / bare `return` / two ids per `it` | 0 required |
| `schemas/v2/` | Missing `additionalProperties: false` | 0 required |
| `api/` | Inline schema (no `$ref`) | 0 required |
| Generated files | Hand edits | 0 required |
| `spec/v1/` | Any edit | 0 required |

### Risk Assessment
Overall risk level if merged as-is: **Critical / High / Medium / Low**

### Blocking Issues
[count] issues that must be resolved before merge

### Top 3 Priorities
1. [Most impactful]
2. [Second most impactful]
3. [Third most impactful]

---

## Pre-Merge Checklist

- [ ] Regen chain produces no diff
- [ ] `npm run openwop:check` passes (10/10 green)
- [ ] No `@ts-ignore` / `@ts-nocheck` / `as any` in `conformance/src/` or `scripts/`
- [ ] Every new schema is JSON Schema 2020-12, `$id` under `https://openwop.dev/spec/v2/`, `additionalProperties: false`
- [ ] Every new normative surface has a `v2-*` scenario, gated correctly, with a `scenario-majors.json` row
- [ ] Every new MUST-NOT has a SECURITY invariant row + public test
- [ ] No edit under `spec/v1/`; no hand edit to a generated file
- [ ] Every commit has `Signed-off-by:`
- [ ] CHANGELOG.md `[Unreleased]` line added
- [ ] RFC drafted (if normative) and PR labeled `openwop-spec`
- [ ] Compatibility classification stated in the PR body

**If ANY checkbox fails, the change is NOT ready for merge.**

---

## Next Steps

| Action | Command | Purpose |
|---|---|---|
| Fix type / lint errors | `/ts-check` | Root-cause conformance typecheck, self-test and API lint failures |
| Spec prose readability | `/spec-readability` | Clean v2 prose without changing a rule |
| Documentation review | `/ux-review` | RFC 2119 + prose hygiene + cross-link integrity |
| NFR review | `/nfr` | Final spec/conformance/governance/security checklist |
| Sync conformance | `/update-conformance` | Scenario/fixture updates for a spec change |
| Update docs | `/update-docs` | Sync README, CHANGELOG, INTEROP-MATRIX, RFC index |
| Create PR | `/pr` | Open the pull request |

Then ask: **"Which issues should I fix? (e.g., 1-3, all critical, or 'all')"**
