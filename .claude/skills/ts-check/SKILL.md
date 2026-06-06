---
name: ts-check
description: Root-cause resolution of TypeScript / ruff / go vet / gofmt / redocly / asyncapi errors across the openwop corpus (../openwop-sdks/sdk/typescript, conformance, ../openwop-examples/examples/hosts, ../openwop-sdks/sdk/python, ../openwop-sdks/sdk/go, api/). Zero-tolerance on `as any` / `@ts-ignore` / `@ts-nocheck` in production code; iterates until npm run openwop:check is fully green.
---

# Cross-Language Error Resolution — Root Cause Analysis (openwop)

You are a **Senior Protocol-Reference-Implementation Architect** conducting a systematic, context-aware review and resolution of static-analysis errors across openwop's reference surfaces: TypeScript SDK + conformance suite, Python SDK, Go SDK, OpenAPI/AsyncAPI lint, and the example hosts.

Your mission is to **understand the architecture and intent**, then fix errors at their root cause — never with superficial patches like `as any`, `as unknown as T`, `@ts-ignore`, or `# type: ignore`.

---

## Pragmatic Error Resolution Standards

### Production code (`../openwop-sdks/sdk/typescript/src/`, `conformance/src/lib/`, `../openwop-examples/examples/hosts/*/src/`) — zero tolerance

| Practice | Status | Why |
|---|---|---|
| `@ts-ignore` | BANNED | Hides type errors instead of fixing them |
| `@ts-expect-error` | BANNED | Same — different name |
| `@ts-nocheck` | BANNED in production | Disables type checking for entire file |
| `eslint-disable` family | BANNED | Hides code quality issues |
| `as any` | BANNED | Bypasses type safety |
| `as unknown as T` | BANNED | Type laundering — equally dangerous |
| Python `# type: ignore` | BANNED in production | Hides type errors |
| Go `interface{}` where concrete type available | BANNED | Loses type safety; openwop SDKs aim for strict typing |

`../openwop-sdks/sdk/typescript/` runs with `strict + exactOptionalPropertyTypes` (`tsconfig.json`). The `CONTRIBUTING.md` §"TypeScript reference SDK" rule is explicit: "No `as any`, no `@ts-ignore`."

### Test code (`../openwop-sdks/sdk/typescript/src/__tests__/`, `conformance/src/scenarios/`, `../openwop-examples/examples/hosts/*/test/`) — pragmatic

`@ts-nocheck` allowed when **all** apply:
- 10+ complex type incompatibilities originating from fixture/mock plumbing (not business logic)
- Fixing would require extensive type gymnastics with no safety benefit
- Simple issues (unused vars, missing annotations, banned patterns) have already been fixed first
- A top-of-file comment documents the suppression and links the underlying issue

Conformance scenarios should almost never use `@ts-nocheck` — they're the canonical spec assertions and serve as implementer reference.

### Minimal fix approach

| Pattern | Fix |
|---|---|
| Unused variable | Prefix with `_` (`const _unused = value`) |
| Unused import | Prefix with `_` (`import { Unused as _Unused } from 'mod'`) |
| Unused parameter | Prefix with `_` (`(item, _index) => item.name`) |
| Unused type import | Prefix with `_` (`import type { T as _T }`) |
| Genuinely dead | Remove entirely |

---

## Core Principles

1. **Understand before fixing.** Read surrounding code, related schemas, related spec docs. A TypeScript error in `../openwop-sdks/sdk/typescript/src/types.ts` usually means a schema in `schemas/*.schema.json` changed — find the schema, then derive the right type.
2. **Root cause over symptoms.** Errors point at a type mismatch; the cause is usually upstream (spec doc, schema, OpenAPI yaml, fixture).
3. **Preserve intent.** Don't widen a type to make an error vanish — narrow the producer or fix the consumer.
4. **Spec is source of truth.** When SDK types diverge from `api/openapi.yaml` or `schemas/*.schema.json`, update the SDK, not the schema.
5. **Cross-check across SDKs.** TypeScript, Python, and Go SDKs should track the same wire shape. A type fix in one often implies a port to the others.

---

## Systematic Process

### Step 1: Gather errors across the corpus

Run each check **individually and non-blocking** to keep context manageable. Wait for each to finish before starting the next.

#### Check 1: TypeScript SDK build (`../openwop-sdks/sdk/typescript/`)

```bash
( cd ../openwop-sdks/sdk/typescript && npx tsc --noEmit 2>&1 | tee /tmp/openwop-ts-sdk.txt; echo "EXIT:$?" )
```

#### Check 2: Conformance suite typecheck

```bash
( cd conformance && npx tsc --noEmit 2>&1 | tee /tmp/openwop-conformance-tsc.txt; echo "EXIT:$?" )
```

#### Check 3: TypeScript SDK build emit

```bash
( cd ../openwop-sdks/sdk/typescript && rm -rf dist && npx tsc -p tsconfig.build.json 2>&1 | tee /tmp/openwop-ts-sdk-build.txt; echo "EXIT:$?" )
```

#### Check 4: Conformance server-free scenarios

```bash
( cd conformance && npx vitest run src/scenarios/spec-corpus-validity.test.ts src/scenarios/fixtures-valid.test.ts 2>&1 | tee /tmp/openwop-conformance-vitest.txt; echo "EXIT:$?" )
```

#### Check 5: Python SDK (`../openwop-sdks/sdk/python/`)

```bash
( cd ../openwop-sdks/sdk/python && ruff check . 2>&1 | tee /tmp/openwop-py-ruff.txt; echo "EXIT:$?" )
( cd ../openwop-sdks/sdk/python && python3 -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print(openwop_client.__version__)" 2>&1 | tee /tmp/openwop-py-import.txt; echo "EXIT:$?" )
```

#### Check 6: Go SDK (`../openwop-sdks/sdk/go/`)

```bash
( cd ../openwop-sdks/sdk/go && go vet ./... 2>&1 | tee /tmp/openwop-go-vet.txt; echo "EXIT:$?" )
( cd ../openwop-sdks/sdk/go && gofmt -l . 2>&1 | tee /tmp/openwop-go-fmt.txt; echo "EXIT:$?" )
( cd ../openwop-sdks/sdk/go && go test ./... 2>&1 | tee /tmp/openwop-go-test.txt; echo "EXIT:$?" )
```

#### Check 7: OpenAPI + AsyncAPI lint

```bash
npx -y @redocly/cli@latest lint api/openapi.yaml 2>&1 | tee /tmp/openwop-redocly.txt; echo "EXIT:$?"
npx -y @asyncapi/cli@latest validate api/asyncapi.yaml 2>&1 | tee /tmp/openwop-asyncapi.txt; echo "EXIT:$?"
```

#### Check 8: Reference hosts (`../openwop-examples/examples/hosts/`)

```bash
for host in in-memory sqlite; do
  ( cd "../openwop-examples/examples/hosts/$host" && npx tsc --noEmit 2>&1 | tee "/tmp/openwop-host-${host}.txt"; echo "EXIT:$?" )
done
( cd ../openwop-examples/examples/hosts/python && python3 -c "import sys; sys.path.insert(0, 'src'); print('python host imports OK')" )
```

#### Combine results

```bash
ERROR_FILE="/tmp/openwop-errors-$(date +%Y%m%d_%H%M%S).txt"
{
  echo "=== openwop Static-Analysis Error Report ==="
  echo "Generated: $(date)"
  echo
  for f in /tmp/openwop-ts-sdk.txt /tmp/openwop-conformance-tsc.txt \
           /tmp/openwop-ts-sdk-build.txt /tmp/openwop-conformance-vitest.txt \
           /tmp/openwop-py-ruff.txt /tmp/openwop-py-import.txt \
           /tmp/openwop-go-vet.txt /tmp/openwop-go-fmt.txt /tmp/openwop-go-test.txt \
           /tmp/openwop-redocly.txt /tmp/openwop-asyncapi.txt \
           /tmp/openwop-host-in-memory.txt /tmp/openwop-host-sqlite.txt; do
    echo "=== $f ==="
    cat "$f" 2>/dev/null || echo "(missing)"
    echo
  done
} > "$ERROR_FILE"
echo "Errors captured to: $ERROR_FILE"
wc -l "$ERROR_FILE"
```

**Why per-check?** The full corpus has ~50 spec docs, ~21 schemas, 3 SDKs, 3 reference hosts, and an OpenAPI/AsyncAPI pair. Running everything in one blocking call risks timeouts and obscures which surface failed.

**What each check catches:**

| Check | Surface | Catches |
|---|---|---|
| `tsc --noEmit` (SDK) | `../openwop-sdks/sdk/typescript/src/` | Strict + `exactOptionalPropertyTypes` violations |
| `tsc --noEmit` (conformance) | `conformance/src/` | Scenario / driver / fixture loader type errors |
| `tsc -p tsconfig.build.json` | SDK emit | Module resolution, declaration emit issues |
| Conformance vitest | `spec-corpus-validity.test.ts`, `fixtures-valid.test.ts` | Ajv2020 compile failures + fixture validation gaps |
| `ruff check` | `../openwop-sdks/sdk/python/` | Python style + unused imports + obvious type issues |
| `go vet` + `gofmt -l` | `../openwop-sdks/sdk/go/` | Go vet warnings + formatting drift |
| `redocly lint` | `api/openapi.yaml` | OpenAPI 3.1 violations |
| `asyncapi validate` | `api/asyncapi.yaml` | AsyncAPI 3.1 violations |
| Host `tsc --noEmit` | `../openwop-examples/examples/hosts/{in-memory,sqlite}/` | Host TypeScript errors |

**After capturing, read the full report and proceed to Step 2.**

**Iteration loop:** after fixing a batch (Steps 2–7), re-run all checks from this step. Repeat until every check is zero-error. Only proceed to Step 8 (final verification) when everything is clean.

---

### Step 2: Categorize & Prioritize

Group errors by surface and root cause.

#### CRITICAL (Fix First)

- **Ajv2020 compile failures** in `conformance/src/scenarios/spec-corpus-validity.test.ts` — a schema is malformed; fixture round-trip impossible
- **Fixture validation failures** in `fixtures-valid.test.ts` — a fixture violates `workflow-definition.schema.json`
- **OpenAPI / AsyncAPI lint failures** — wire contract is rejected by spec tooling
- **`scripts/check-security-invariants.sh` failure** — a protocol MUST-NOT has no public test
- **Type errors on `OpenwopClient` public methods or `types.ts` exported shapes** — SDK contract drift from spec

#### HIGH (Fix Next)

- **SDK type errors in non-public files** that break consumers transitively
- **Conformance suite TypeScript errors** — scenarios cannot run
- **Reference-host TypeScript errors** — `../openwop-examples/examples/hosts/*` cannot start
- **Python `ruff` errors in `../openwop-sdks/sdk/python/src/openwop_client/`** — published SDK surface
- **Go `vet` warnings in exported symbols** — published SDK surface

#### MEDIUM (Fix After High)

- **Unused variables / imports** — `_` prefix or remove
- **Test file type errors** — annotate or fix fixture types
- **`gofmt -l` formatting drift** — `gofmt -w .` from `../openwop-sdks/sdk/go/`
- **Python import smoke failures** — version mismatch or missing export

#### LOW (Fix Last)

- **`ruff` style warnings** that aren't ergonomically meaningful
- **Doc-string nitpicks** in Go or Python

---

### Step 3: Context Discovery (per error)

For each error:

#### 3.1 Read the error location
- Open the file the error points at
- Read the surrounding function / type / scenario / endpoint
- Understand the intended behavior

#### 3.2 Trace to the wire contract
- Where does this type come from? Imported? Declared locally? Inferred?
- Is the source of truth `schemas/*.schema.json`? `api/openapi.yaml`? `api/asyncapi.yaml`?
- Per `CONTRIBUTING.md` §"TypeScript reference SDK": "Types come from the spec — extend `src/types.ts` rather than redefining shapes inline."

#### 3.3 Cross-check the other SDKs
- If TS SDK has the field, do Python (`../openwop-sdks/sdk/python/src/openwop_client/`) and Go (`../openwop-sdks/sdk/go/`) also have it?
- A missing field in one SDK is usually a port-the-fix opportunity, not a "loosen the type" excuse.

#### 3.4 Cross-check conformance
- Does any scenario in `conformance/src/scenarios/` test the surface? If yes, the scenario is the canonical assertion.
- If the scenario uses a fixture, the fixture is in `conformance/fixtures/` and registered in `conformance/fixtures.md`.

---

### Step 4: Fix patterns

#### Pattern 1: SDK type drifts from schema
**Symptom:** `tsc` error on `../openwop-sdks/sdk/typescript/src/types.ts` where a property is `undefined`-typed but the schema marks it required.
**Fix:** Update `src/types.ts` to match the schema. Run `npx vitest run src/scenarios/spec-corpus-validity.test.ts` from `conformance/` to verify the schema is still valid.

#### Pattern 2: Schema bumps required field
**Symptom:** A schema gained a required field. SDK types and existing fixtures now invalid.
**Fix:**
1. Decide compatibility classification (`COMPATIBILITY.md`): is this safety-fix or breaking?
2. If additive (field is optional), revert the required flag in the schema.
3. If genuinely required, the field must be in every fixture in `conformance/fixtures/` and every type in every SDK. This is a wave-of-edits situation. Use `/architect` to scope.

#### Pattern 3: OpenAPI references a missing schema
**Symptom:** `redocly lint` fails with "$ref not found."
**Fix:** Confirm the schema file exists at `schemas/<name>.schema.json` and is reachable via the relative path used in `api/openapi.yaml`. Per `CONTRIBUTING.md` §"OpenAPI / AsyncAPI": "Reference JSON Schemas via cross-file `$ref` (`../schemas/<name>.schema.json`); never inline."

#### Pattern 4: AsyncAPI channel missing payload schema
**Symptom:** `asyncapi validate` fails with "message has no payload."
**Fix:** Bind the message to a payload schema via `$ref` to `../schemas/<event-payload>.schema.json`. Recent additions cover this — `run-orchestrator-decided-event.schema.json` is the most recent example.

#### Pattern 5: Ajv2020 cannot compile a schema
**Symptom:** `conformance/src/scenarios/spec-corpus-validity.test.ts` fails on schema compile.
**Fix:** Run the test in isolation. The error names the schema. Most common: `additionalProperties: false` collides with a nested `oneOf` / `anyOf` that introduces unanticipated keys. Refactor the schema to use `allOf` + named branches.

#### Pattern 6: Fixture invalidates against `workflow-definition.schema.json`
**Symptom:** `fixtures-valid.test.ts` fails.
**Fix:** Update the fixture to match the schema, OR if the schema changed unintentionally, revert the schema. Decision criterion: does this RFC actually want the schema change?

#### Pattern 7: Banned `as any` / `as unknown as T`
**Symptom:** Grep finds the pattern in `../openwop-sdks/sdk/typescript/src/` or `conformance/src/lib/`.
**Fix:** Type the producer. If a third-party library has a weak type, use a typed wrapper instead of asserting. If the value comes from `JSON.parse`, use a typed schema validator (Ajv) and narrow with a type guard.

#### Pattern 8: Go SDK has `interface{}`
**Symptom:** `go vet` does not warn, but reviewer flags. The Go SDK targets idiomatic Go with concrete types.
**Fix:** Replace `interface{}` with the concrete type from `../openwop-sdks/sdk/go/types.go` (or add the type if absent). Wire-shape source of truth is `schemas/`.

#### Pattern 9: Python SDK uses `Any` lazily
**Symptom:** `ruff check` may not flag it, but the SDK is intended to be stdlib + typed.
**Fix:** Replace `Any` with `TypedDict` / `dataclass` / explicit Union. Reference `../openwop-sdks/sdk/python/src/openwop_client/types.py`.

#### Pattern 10: Reference host drifts from spec
**Symptom:** A host advertises a profile in its `conformance.md` but a new scenario fails.
**Fix:** Either implement the missing surface in the host OR downgrade the host's advertised profile in `INTEROP-MATRIX.md` and `../openwop-examples/examples/hosts/<host>/conformance.md`. Honesty is the goal.

---

### Step 5: Apply the fix

For each error category, apply the matching fix pattern. Prefer one-error-at-a-time over batch edits when types are intricate — type errors often cascade.

After each fix:
- Re-run the matching check (`tsc --noEmit` from the affected workspace, or the matching `npx vitest run <scenario>`)
- Re-run any SDK that depends on the type (TS → Python → Go cross-port if applicable)

### Step 6: Cross-port the fix

When a TypeScript fix encodes a new invariant (e.g., a stricter type guard, a new field), check:
- `../openwop-sdks/sdk/python/src/openwop_client/` — does the equivalent type exist?
- `../openwop-sdks/sdk/go/` — same
- `conformance/src/scenarios/` — is there a scenario that asserts the invariant on the wire?

A wire invariant that lives in only one SDK is a future cross-host bug.

### Step 7: Iterate

Re-run Step 1's full battery. Continue until **every check exits 0**. Do not skip ahead.

### Step 8: Final verification

```bash
# The published merge gate
npm run openwop:check

# Each step should be GREEN. The output ends with:
# === openwop:check OK — spec corpus is internally consistent ===
```

If any of the 8 steps fail, return to Step 1.

---

## Verification + Reporting

After all checks green, report:

| Surface | Errors before | Errors after | Fix summary |
|---|---|---|---|
| `../openwop-sdks/sdk/typescript/` `tsc --noEmit` | N | 0 | … |
| `conformance/` `tsc --noEmit` | N | 0 | … |
| `conformance/` vitest server-free | N | 0 | … |
| `../openwop-sdks/sdk/python/` ruff | N | 0 | … |
| `../openwop-sdks/sdk/go/` vet + gofmt | N | 0 | … |
| `api/openapi.yaml` redocly | N | 0 | … |
| `api/asyncapi.yaml` asyncapi | N | 0 | … |
| `../openwop-examples/examples/hosts/*/` tsc | N | 0 | … |
| Banned patterns (`as any` / `@ts-ignore` / `@ts-nocheck`) | N | 0 | … |

| Banned-pattern surface | Count |
|---|---|
| `../openwop-sdks/sdk/typescript/src/` `as any` / `@ts-ignore` / `@ts-nocheck` | 0 required |
| `conformance/src/lib/` `as any` / `@ts-ignore` | 0 required |
| `../openwop-sdks/sdk/python/` `# type: ignore` without comment | 0 required |
| `../openwop-sdks/sdk/go/` `interface{}` in exported symbols | 0 expected |

---

## Common openwop-Specific Patterns

### Stream-mode event union narrowing

`../openwop-sdks/sdk/typescript/src/sse.ts` exposes events for four modes (`values`, `updates`, `messages`, `debug`). Adding a new event type requires:
1. Type in `../openwop-sdks/sdk/typescript/src/types.ts` (extend the event union)
2. Discriminated `switch` in `../openwop-sdks/sdk/typescript/src/sse.ts` — TypeScript will surface a missing case as an error
3. Equivalent in `../openwop-sdks/sdk/python/` and `../openwop-sdks/sdk/go/`
4. AsyncAPI channel + payload schema
5. Conformance scenario

### Schema $ref resolver path

The TS SDK doesn't ship the schemas at runtime, but the conformance suite does. Schema $ref paths use relative URLs at spec authoring time, but Ajv2020 in the conformance suite resolves them against a local registry. If you add a new schema and Ajv can't find it, ensure it is referenced in `conformance/src/lib/schema-registry.ts` (or equivalent loader).

### Capability flag enforcement

A conformance scenario added without capability gating per `conformance/coverage.md` §"Capability-gated scenarios" will pass `tsc` but break implementer hosts that don't advertise the new flag. There's no automated gate against this; the only check is reading `coverage.md` and confirming the new scenario is in the capability-gated section.

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Run Step 1's full error battery |
| `triage` | Re-categorize errors by surface and priority (Step 2) |
| `fix [error-id]` | Apply the matching fix pattern from Step 4 |
| `cross-port` | Cross-port the most recent fix to Python and Go SDKs |
| `iterate` | Re-run Step 1 and continue Steps 2–7 |
| `verify` | Run Step 8 (`npm run openwop:check`) |
| `report` | Generate the surface-by-surface fix summary |
| `done` | Complete (only when all 8 steps green) |
