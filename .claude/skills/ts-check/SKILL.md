---
name: ts-check
description: Root-cause resolution of type, test and lint errors in this repo — the conformance suite typecheck, its server-free scenarios, coherence tests and src/lib self-tests, scripts, and the redocly / asyncapi lint of api/ and api/v2/. Zero-tolerance on `as any` / `@ts-ignore` / `@ts-nocheck`; iterates until npm run openwop:check is fully green. SDK linting lives in openwop/openwop-sdks.
---

# Error Resolution — Root Cause Analysis (openwop)

You are a **Senior Protocol Engineer** resolving static-analysis and test errors in the openwop spec corpus: the conformance suite (`conformance/`), the scripts that generate and check the corpus (`scripts/`, `conformance/scripts/`), and the OpenAPI/AsyncAPI documents (`api/`, `api/v2/`).

Fix errors at their root cause — never with `as any`, `as unknown as T`, `@ts-ignore`, or a skipped test.

SDK typecheck and lint (TypeScript, Python ruff, Go vet/gofmt) run in `openwop/openwop-sdks` (`scripts/sdks-check.sh` there); host builds run in `openwop/openwop-examples` and `openwop/openwop-app`. This skill does not cover them.

## Target: $ARGUMENTS

If no target is given, run the full battery in Step 1.

---

## Error Resolution Standards

### `conformance/src/` and `scripts/` — zero tolerance

| Practice | Status | Why |
|---|---|---|
| `@ts-ignore` / `@ts-expect-error` | BANNED | Hides type errors |
| `@ts-nocheck` | BANNED | Disables type checking for a whole file |
| `as any` | BANNED | Bypasses type safety |
| `as unknown as T` | BANNED | Type laundering |
| New `eslint-disable` without a reason | BANNED | Hides the problem |
| `it.skip` / bare `return` to get past a failure | BANNED | A scenario that doesn't run is a lie in the ledger |

`conformance/tsconfig.json` is `strict` with `exactOptionalPropertyTypes`, `noUnusedLocals` and `noUnusedParameters`.

### Minimal fix approach

| Pattern | Fix |
|---|---|
| Unused parameter | Prefix with `_` (`(item, _index) => item.name`) |
| Unused variable / import | Remove it |
| Genuinely dead code | Remove entirely |

---

## Core Principles

1. **Understand before fixing.** Read the surrounding code, the schema, and the spec doc. A type error in a scenario usually means a schema in `schemas/v2/` or a spec rule in `spec/v2/core/` changed.
2. **Root cause over symptoms.** The cause is usually upstream: a spec doc, a schema, the `api/openapi.yaml` source, the family declaration, or a fixture.
3. **Preserve intent.** Don't widen a type to make an error vanish — narrow the producer or fix the consumer.
4. **The spec is the source of truth.** Normative text is in `spec/v2/core/` and `spec/v2/ext/`; wire shapes in `schemas/v2/` and `api/v2/`. When a scenario disagrees with them, fix the scenario. `spec/v1/` is frozen — never edit it to make a check pass.
5. **Generated files are never hand-fixed.** `api/v2/*`, `schemas/v2/capabilities.schema.json`, `conformance/scenario-majors.json`, `conformance/requirements.json`, `spec-artifacts/**` and the status docs come from generators. Fix the input and regenerate.

---

## Systematic Process

### Step 1: Gather errors

Run each check and capture its output. Use `$TMPDIR` (or a scratch directory), not the repo.

#### Check 1: Conformance typecheck

```bash
( cd conformance && npm run typecheck ) 2>&1 | tee "$TMPDIR/tc.txt"
```

`npm run typecheck` is `tsc --noEmit`. Never run a bare `tsc -p tsconfig.json` in `conformance/` — it emits hundreds of `.js` files that shadow the sources.

#### Check 2: Server-free scenarios (gate step 1)

```bash
( cd conformance && npx vitest run src/scenarios/fixtures-valid.test.ts ) 2>&1 | tail -40
( cd conformance && env -u OPENWOP_BASE_URL -u OPENWOP_API_KEY npx vitest run $(node scripts/list-host-free-scenarios.mjs --check) ) 2>&1 | tail -60
```

#### Check 3: Coherence tests

```bash
( cd conformance && npm run test:coherence ) 2>&1 | tail -60
```

These live in `conformance/src/coherence/` (spec-corpus-validity and friends).

#### Check 4: Suite self-tests

```bash
( cd conformance && npm run test:self ) 2>&1 | tail -60
```

`src/lib/**/*.test.ts`, run under `vitest.selftest.config.ts`.

#### Check 5: Scenario discipline

```bash
node scripts/check-req-only.mjs
node scripts/check-softskip-after-assert.mjs
```

`req(id, section, requirement)` is the only assertion message; a bare `return` in an `it` body must be `return softSkip(kind, reason)` or `return seamAbsent(reason)`; one `it` cites one requirement id.

#### Check 6: OpenAPI + AsyncAPI lint

Same pinned versions as `scripts/openwop-check.sh` (an `@latest` fetch races the npm cache):

```bash
( cd api && npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml )
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/asyncapi.yaml
( cd api/v2 && npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml )
npx -y -p @redocly/cli@2.31.4 redocly lint api/seams-v2.yaml --config api/v2/redocly.yaml
npx -y -p @asyncapi/cli@4.1.1 asyncapi validate api/v2/asyncapi.yaml
python3 scripts/derive-v2-api.py --check
```

#### Combine results

| Check | Surface | What it catches |
|---|---|---|
| `npm run typecheck` | `conformance/src/` | TypeScript errors |
| Server-free scenarios | `conformance/src/scenarios/` | Fixture and shape failures that need no host |
| `test:coherence` | `conformance/src/coherence/` | Schema compile, corpus cross-references |
| `test:self` | `conformance/src/lib/` | Helper regressions |
| `check-req-only.mjs` | scenarios + coherence | Assertion-message and early-return discipline |
| redocly / asyncapi | `api/`, `api/v2/`, `api/seams-v2.yaml` | OpenAPI 3.1 / AsyncAPI 3.1 violations |
| `derive-v2-api.py --check` | `api/v2/` | Derived API out of date with its source |

**Iteration loop:** after fixing a batch (Steps 2–6), re-run every check. Repeat until all are clean, then go to Step 7.

---

### Step 2: Categorize & Prioritize

#### CRITICAL (Fix First)

- **Schema compile failures** in `src/coherence/spec-corpus-validity.test.ts` — a schema is malformed
- **Fixture validation failures** in `fixtures-valid.test.ts`
- **OpenAPI / AsyncAPI lint failures** — the wire contract is rejected by spec tooling
- **`scripts/check-security-invariants.sh` failure** — a protocol MUST-NOT has no public test

#### HIGH (Fix Next)

- **Conformance typecheck errors** — scenarios cannot run
- **Self-test failures** in `src/lib/` — every scenario using the helper is suspect
- **`check-req-only.mjs` failures** — a requirement gets no row, or a leg records `blocked`

#### MEDIUM

- **Unused variables / parameters**
- **Script errors** in `scripts/*.mjs` that only fire on `--check`

#### LOW

- Style nits in comments and docstrings

---

### Step 3: Context Discovery (per error)

#### 3.1 Read the error location
Open the file, read the surrounding function / scenario, understand the intended behaviour.

#### 3.2 Trace to the wire contract
- Where does the type come from? `schemas/v2/*.schema.json`? `api/v2/openapi.yaml` (derived from `api/openapi.yaml` by `scripts/derive-v2-api.py`)? `spec/v2/declaration.json` (which generates `schemas/v2/capabilities.schema.json`)?
- Which `spec/v2/core/` section states the rule the scenario asserts?

#### 3.3 Check the scenario's major
- `v2-*.test.ts` files target major 2; others target major 1 unless listed in `BOTH_MAJORS` in `conformance/scripts/generate-scenario-majors.mjs`.
- At major 2, a capability record's presence is the claim — there is no `.supported` field. A `v2-*` scenario gating on `.supported` reports `inapplicable` forever.

---

### Step 4: Fix patterns

#### Pattern 1: Scenario type drifts from a v2 schema
**Symptom:** `tsc` error where a scenario reads a property the schema renamed or made optional.
**Fix:** Update the scenario's local type to match `schemas/v2/<name>.schema.json`. Re-run `npm run test:coherence`.

#### Pattern 2: A schema gained a required field
**Fix:**
1. Classify per `COMPATIBILITY.md` §2.4: a new required property on an existing closed v2 object is a major change.
2. If the intent was additive, make the field optional.
3. If genuinely required, it needs an RFC; every fixture in `conformance/fixtures/` that uses the object must carry it. Use `/architect` to scope.

#### Pattern 3: OpenAPI references a missing schema
**Symptom:** `redocly lint` fails with "$ref not found".
**Fix:** Confirm the schema exists at the relative path used in `api/openapi.yaml` (the source). For `api/v2/`, fix the source or the `$ref` rewrite in `scripts/derive-v2-api.py`, then `python3 scripts/derive-v2-api.py --write`. Never edit `api/v2/` by hand.

#### Pattern 4: AsyncAPI message missing a payload schema
**Fix:** Bind the message to a payload schema by `$ref` in `api/asyncapi.yaml`, then regenerate `api/v2/asyncapi.yaml`.

#### Pattern 5: Ajv cannot compile a schema
**Symptom:** a coherence test fails on schema compile.
**Fix:** Run that test alone; the error names the schema. Common cause: `additionalProperties: false` colliding with a nested `oneOf` / `anyOf` that introduces keys. Restructure with `allOf` + named branches.

#### Pattern 6: Fixture fails validation
**Fix:** Update the fixture to match the schema, or revert an unintended schema change. Decide by asking whether the RFC wants the schema change. A new fixture also needs a row in `conformance/fixtures.md`.

#### Pattern 7: Banned `as any` / `as unknown as T`
**Fix:** Type the producer. For `JSON.parse` output, validate with Ajv and narrow with a type guard.

#### Pattern 8: A generated file is out of date
**Symptom:** a `--check` in gate step 4 or 10 fails.
**Fix:** Run the regen chain (Step 7) rather than editing the output.

---

### Step 5: Apply the fix

One error at a time when types are intricate — type errors cascade. After each fix, re-run the matching check.

### Step 6: Check the wire evidence

When a fix encodes a new invariant (a stricter guard, a new field), check that a scenario in `conformance/src/scenarios/` asserts it on the wire, with `req()` citing the `spec/v2/core/` section.

### Step 7: Final verification

Run the regen chain, then the gate:

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write
npm run openwop:check
# ends with: === openwop:check OK — spec corpus is internally consistent ===
```

`npm run openwop:check` runs `scripts/openwop-check.sh`, 10 steps. If any step fails, return to Step 1.

---

## Verification + Reporting

| Surface | Errors before | Errors after | Fix summary |
|---|---|---|---|
| `conformance/` `npm run typecheck` | N | 0 | … |
| Server-free scenarios | N | 0 | … |
| `test:coherence` | N | 0 | … |
| `test:self` | N | 0 | … |
| `check-req-only.mjs` | N | 0 | … |
| `api/` + `api/v2/` redocly | N | 0 | … |
| `api/` + `api/v2/` asyncapi | N | 0 | … |
| Banned patterns (`as any` / `@ts-ignore` / `@ts-nocheck`) | N | 0 | … |

---

## Common openwop-Specific Patterns

### Event union narrowing

A new v2 event type needs: the payload schema in `schemas/v2/`, the registry entries described in `spec/v2/core/events.md`, the AsyncAPI message in `api/asyncapi.yaml` (regenerated into `api/v2/`), the event codemap (`spec/v2/event-codemap.json`, generated), and a `v2-*` scenario.

### Capability gating

A `v2-*` scenario gates on the family record's presence in discovery (read at the document root) and reports `softSkip('inapplicable', …)` when it is absent. `tsc` cannot catch a wrong gate; read `spec/v2/core/capabilities.md` and `spec/v2/core/conformance.md` §"The seams profile" for seam-gated legs.

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Run Step 1's full battery |
| `triage` | Re-categorize errors (Step 2) |
| `fix [error-id]` | Apply the matching pattern from Step 4 |
| `iterate` | Re-run Step 1 and continue Steps 2–6 |
| `verify` | Run Step 7 (regen chain + `npm run openwop:check`) |
| `report` | Generate the surface-by-surface fix summary |
| `done` | Complete (only when all 10 gate steps are green) |
