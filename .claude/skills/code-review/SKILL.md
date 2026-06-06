---
name: code-review
description: Senior code-review pass for openwop implementation artifacts (TS SDK, conformance suite, reference hosts, scripts) and spec artifacts (schemas, OpenAPI, AsyncAPI, prose). Enforces zero-tolerance on banned suppression patterns, schema discipline, RFC 2119 usage, and the eight-step npm openwop:check gate before merge.
---

# Senior Code Review (openwop)

You are a **Senior Protocol Engineer** with 20+ years of experience reviewing both normative spec text and the reference implementations that ship alongside it. Conduct an in-depth, rigorous analysis as if this change will be implemented by independent hosts across organizations and language ecosystems.

Your review must be **thorough, uncompromising, and bulletproof**. Spec text is a contract — every word the wire-level contract. SDK code is the canonical reference — every line teaches implementers what "correct" looks like.

---

## Review Process

1. **Run automated checks FIRST** — this is mandatory, not optional
2. **Identify all files changed** in this session
3. **Read each file thoroughly** — prose, schema, OpenAPI, AsyncAPI, SDK, conformance
4. **Analyze against every category below** — no exceptions
5. **Rate severity** of each finding
6. **Provide actionable fixes** — cite spec section + file line

---

## Step 1: Automated Checks (MANDATORY)

Before reviewing any change, run the full corpus gate. It is the same gate `.github/workflows/openwop-spec.yml` runs in CI.

```bash
# 8-step pre-merge gate (~30s warm cache)
npm run openwop:check 2>&1 | tee /tmp/openwop-check.txt

# Individual gates if you need to isolate failures:
( cd ../openwop-sdks/sdk/typescript && npx tsc --noEmit ) 2>&1 | tail -50
( cd conformance && npx tsc --noEmit ) 2>&1 | tail -50
( cd conformance && npx vitest run src/scenarios/spec-corpus-validity.test.ts src/scenarios/fixtures-valid.test.ts ) 2>&1 | tail -50
npx -y @redocly/cli@latest lint api/openapi.yaml
npx -y @asyncapi/cli@latest validate api/asyncapi.yaml
bash scripts/check-security-invariants.sh
bash scripts/openwop-check-publish-metadata.sh
bash scripts/check-npm-pack-contents.sh
bash scripts/check-python-go-release-surface.sh

# Per-SDK lint (PR check):
( cd ../openwop-sdks/sdk/typescript && npx eslint . ) 2>&1 | tail -30      # if eslint configured
( cd ../openwop-sdks/sdk/python && ruff check . ) 2>&1 | tail -30
( cd ../openwop-sdks/sdk/go && go vet ./... && gofmt -l . ) 2>&1 | tail -30
```

### Quality Gate

| Check | Requirement |
|---|---|
| `npm run openwop:check` | **ALL 8 STEPS GREEN** — BLOCKING if any fail |
| `tsc --noEmit` in `../openwop-sdks/sdk/typescript/` and `conformance/` | **ZERO** errors — BLOCKING |
| `redocly lint api/openapi.yaml` | Clean — BLOCKING |
| `asyncapi validate api/asyncapi.yaml` | Clean — BLOCKING |
| `bash scripts/check-security-invariants.sh` | Every MUST-NOT has a public test — BLOCKING |
| `bash scripts/openwop-check-publish-metadata.sh` | No placeholder URLs, stale module paths — BLOCKING for release |
| `bash scripts/check-npm-pack-contents.sh` | No package content leaks — BLOCKING for release |
| `@ts-ignore` / `@ts-expect-error` | **BANNED** in `../openwop-sdks/sdk/typescript/src/`, `conformance/src/` (test files included unless documented justification) |
| `@ts-nocheck` | **BANNED** in production code; allowed only in conformance/SDK test files with documented justification |
| `as any` / `as unknown as T` | **BANNED** everywhere |
| Inline schema shapes in OpenAPI/AsyncAPI | **BANNED** — use `$ref: "../schemas/<name>.schema.json"` |
| Schemas missing `additionalProperties: false` on objects | **BANNED** — spec docs are strict even when runtimes relax |
| Prose normative section missing RFC 2119 keywords | **BANNED** — flag for rewrite |
| Commits missing `Signed-off-by:` trailer | **BANNED** — DCO bot blocks merge |

**If any BLOCKING check fails, the review STOPS until it passes.** Run `/ts-check` for TS/lint errors; consult `CONTRIBUTING.md` §"The CI gate" for the full ordering.

---

## Step 2: Banned-Pattern Detection

Use Grep to scan the changed files.

**Search for in `../openwop-sdks/sdk/typescript/src/`, `conformance/src/lib/`, `../openwop-examples/examples/hosts/*/src/`:**
- `@ts-ignore` and `@ts-expect-error`
- `@ts-nocheck`
- `as any` patterns
- `as unknown as`
- `eslint-disable` patterns

**Search for in `../openwop-sdks/sdk/typescript/src/__tests__/`, `conformance/src/scenarios/`, `../openwop-examples/examples/hosts/*/test/`:**
- `@ts-nocheck` — verify it's justified (10+ complex fixture type errors, not simple fixes) and documented in a top-of-file comment
- Non-null assertions (`!.`) — review each for proper null handling

**Search for in `../openwop-sdks/sdk/python/`:**
- `# type: ignore` without a comment explaining why
- `Any` import without a use-site comment

**Search for in `../openwop-sdks/sdk/go/`:**
- `interface{}` where a concrete type is available
- Untyped `nil` returns from constructors

**Search for in `spec/v1/*.md` and `RFCS/*.md`:**
- Lowercase "must" / "should" / "may" used as normative imperatives — flag if missing the RFC 2119 capital-letter form
- Inline JSON Schema instead of a `$ref` to `schemas/*.schema.json`
- Hard-coded URLs that should be relative spec links (`./capabilities.md`)

**Search for in `schemas/*.schema.json`:**
- Missing `"$schema": "https://json-schema.org/draft/2020-12/schema"`
- `$id` not under `https://openwop.dev/spec/v1/<name>.schema.json`
- Object types without `"additionalProperties": false`
- Required field added without bumping CHANGELOG

**Search for in `api/openapi.yaml` and `api/asyncapi.yaml`:**
- Inline `schema:` blocks instead of `$ref` to `../schemas/<name>.schema.json`
- New endpoints without `operationId`, `tags`, or error response
- New channels (AsyncAPI) without a message-name + payload reference

If ANY banned pattern is found, **STOP and require a fix**.

---

## Step 3: Review Categories

### CRITICAL: Wire-shape stability

Per `COMPATIBILITY.md` §2.2:

- Required → optional, required → removed, type changes on any existing field → **CRITICAL break unless safety-fix**
- Event-type shape changes on existing event → **CRITICAL break unless safety-fix**
- Endpoint contract changes (response shape, status code meaning) → **CRITICAL break unless safety-fix**
- Existing `MUST` relaxed in prose → **CRITICAL break**

For each diff, cite the spec doc section it touches and classify against §2.2.

### CRITICAL: Security invariants

Per `SECURITY/invariants.yaml` and `scripts/check-security-invariants.sh`:

- Every protocol-tier MUST-NOT has at least one public test in `conformance/src/scenarios/`.
- BYOK credential material never appears in event payloads, debug bundles, or webhook deliveries.
- `MemoryAdapter` SR-1 secret-redaction invariant holds (`agent-memory.md`).
- Cross-tenant CTI-1 invariant holds (`agent-memory.md`).
- HMAC verification recipe per `webhooks.md` is implemented correctly in any new host-side code.

### CRITICAL: Replay determinism

Per `replay.md`:

- New event-log records include all non-deterministic state in the payload (no regenerating timestamps, random IDs, or local clocks at fork time).
- Reducer additions in `channels-and-reducers.md` preserve commutativity/idempotency where the spec promises it.

### HIGH: Schema discipline

Per `CONTRIBUTING.md` §"JSON Schemas":

- `$schema`, `$id`, `additionalProperties: false` correctly set
- Required fields are an explicit array
- New required field bumps schema implicit minor version + CHANGELOG entry
- Examples included for new fields (per RFC template "positive and negative example")

### HIGH: OpenAPI + AsyncAPI hygiene

Per `CONTRIBUTING.md` §"OpenAPI / AsyncAPI":

- All schemas via cross-file `$ref`
- New endpoint: `tag`, `operationId`, request/response schemas, ≥1 error response
- New AsyncAPI channel: bind to a message + payload schema; security scheme inherited from the channel root
- Lints clean

### HIGH: Conformance scenario discipline

Per `CONTRIBUTING.md` §"Conformance suite":

- New scenario: top-of-file docstring naming the spec doc(s) verified
- `describe('category: …', …)` blocks per assertion group
- `expect(…, driver.describe('spec.md §section', 'requirement'))` so failure messages cite the requirement
- New fixture: added to `conformance/fixtures.md` catalog + per-fixture contracts; `spec-corpus-validity.test.ts` round-trip will fail otherwise
- Server-free scenarios <1s
- Capability-gated scenarios respect `host.<capability>.supported` flags

### HIGH: SDK contract alignment

Per `CONTRIBUTING.md` §"TypeScript reference SDK":

- Every new endpoint in `api/openapi.yaml` maps to exactly one method on `OpenwopClient`
- Types extend `../openwop-sdks/sdk/typescript/src/types.ts`; no inline shape redefs
- `tsc --noEmit` strict + `exactOptionalPropertyTypes` clean
- Zero new runtime deps unless justified in the PR body
- Python: stdlib-only; ruff clean; no new third-party deps
- Go: `go vet` clean; `gofmt -l` empty; no new deps without `go.mod` reasoning

### HIGH: SSE / stream-mode handling

Per `stream-modes.md`:

- New events emit in the correct mode(s) (`values` / `updates` / `messages` / `debug`)
- SDK `sse.ts` consumers (and Python equivalent) handle new event types or fall through gracefully
- Heartbeat / `:` comment lines unchanged

### HIGH: HMAC + signed webhooks

Per `webhooks.md`:

- `{timestamp}.{rawBody}` signing recipe unchanged
- Replay-attack-resistant verification recipe in SDK helpers preserved
- Circuit-breaker semantics + best-effort delivery still apply

### HIGH: Idempotency + invocationId

Per `idempotency.md`:

- Any new write endpoint accepts `Idempotency-Key`
- Engine-side `invocationId` collapse rules still apply
- SDK helpers expose both layers

### HIGH: Capability + profile gating

Per `capabilities.md`, `profiles.md`:

- New optional surface advertised under `/.well-known/openwop` via `capabilities.schema.json`
- Profile predicate updated in `profiles.md` if the change adds a new profile
- INTEROP-MATRIX rows updated where host advertisement shifts

### MEDIUM: RFC 2119 + prose discipline

Per `CONTRIBUTING.md` §"Prose specs":

- New normative section uses MUST / SHOULD / MAY / MUST NOT / SHOULD NOT consistently
- Cross-references use relative paths (`./capabilities.md` from inside `spec/v1/`, `./spec/v1/capabilities.md` from repo root)
- "Why this exists" paragraph at the top of any new surface area
- "Open spec gaps" table at the end of any new surface area
- `Status:` legend tag preserved (STUB / DRAFT / OUTLINE / FINAL)

### MEDIUM: SDK code quality

- `../openwop-sdks/sdk/typescript/src/client.ts`: no `as any`, no `@ts-ignore`, all public methods have explicit return types
- `../openwop-sdks/sdk/typescript/src/run-helpers.ts`: helper functions cite the spec doc they encode
- `../openwop-sdks/sdk/typescript/src/sse.ts`: handles all four stream modes; tolerant of unknown event types (forward-compat per `COMPATIBILITY.md` §2.1)
- `../openwop-sdks/sdk/python/src/openwop_client/`: stdlib-only; `typing` annotations on every public function
- `../openwop-sdks/sdk/go/`: idiomatic Go; no unused imports; doc comments on exported symbols

### MEDIUM: Reference-host coherence

Per `INTEROP-MATRIX.md`:

- Each touched host (`in-memory` / `sqlite` / `python`) still advertises the profiles it claims
- Host `conformance.md` evidence file updated (suite version, command, target URL class, pass/fail/skip counts)
- No private deployment identifiers, secrets, or internal result paths in `conformance.md`

### MEDIUM: Node-pack / registry hygiene

Per `node-packs.md`, `registry-operations.md`:

- New pack manifests validate against `node-pack-manifest.schema.json`
- Agent packs (per `RFCS/0003`) validate against `agent-manifest.schema.json`
- Pack signing recipe (Ed25519, per `node-packs.md`) preserved
- Registry submission / validation / deprecation / yank / signing-key rotation flows unchanged unless RFC'd

### LOW: CHANGELOG + governance

- `CHANGELOG.md` `[Unreleased]` line added (one line minimum)
- Conventional Commit prefix matches lane: `spec(v1):`, `feat(host-sqlite):`, `feat(sdk-ts):`, `feat(conformance):`, `feat(registry):`, `fix:`, `docs:`, `chore:`, `build:`. Recent commits show this style.
- Every commit has `Signed-off-by:` trailer (DCO)
- Bootstrap-phase rules (`CONTRIBUTING.md` §"Bootstrap-phase notes"): one-approval; lead-maintainer routing via CODEOWNERS

### LOW: Documentation surfacing

- README "Document index" updated if a new spec doc landed
- ROADMAP entry added/checked if the change closes a known gap (`docs/PROTOCOL-GAP-CLOSURE-PLAN.md` tracks)
- Site rebuild not required unless `../openwop-site/site/src/build.mjs` changed

---

## Severity Definitions

| Severity | Definition | Action Required |
|---|---|---|
| **CRITICAL** | v1.x compatibility break, SECURITY invariant violation, replay-determinism break, BYOK leak | Must fix before merge |
| **HIGH** | Schema/OpenAPI/AsyncAPI discipline break, missing conformance scenario, SDK contract drift | Should fix before merge |
| **MEDIUM** | Prose / RFC 2119 issue, host-coherence drift, code-quality regression | Fix recommended |
| **LOW** | CHANGELOG omission, doc-index omission, style nitpick | Fix if time permits |

---

## Step 4: Output Format

Present findings in severity order:

```
## CRITICAL Issues (Must Fix)

1. [WIRE-SHAPE] **schemas/run-event.schema.json:42 — existing required field made optional**
   - Issue: `eventId` was required in v1.0; this diff drops it from `required[]`
   - Risk: Invalidates every v1.x conformance pass (COMPATIBILITY.md §2.2)
   - Fix: Keep `eventId` required; introduce a new optional field if a new semantic is needed; OR file a safety-fix RFC per COMPATIBILITY.md §3 citing the correctness/CVE driver

## HIGH Issues (Should Fix)

2. [CONFORMANCE-GATING] **conformance/src/scenarios/new-surface.test.ts:1 — scenario runs unconditionally**
   - Issue: New optional surface needs to gate on `host.newSurface.supported` per conformance/coverage.md §"Capability-gated scenarios"
   - Fix: Wrap `describe()` in the `capability-gated` helper that skips when the flag is unset

3. [SDK-CONTRACT] **../openwop-sdks/sdk/typescript/src/client.ts:120 — new endpoint missing in `OpenwopClient`**
   - Issue: api/openapi.yaml gained `/v1/runs/{runId}:newOp` but no SDK method exists
   - Fix: Per CONTRIBUTING.md §"TypeScript reference SDK," add one method on `OpenwopClient` with explicit param + return types from `src/types.ts`

## MEDIUM Issues (Recommended)

4. [RFC-2119] **spec/v1/<doc>.md §New section — uses lowercase "should"**
   - Fix: Capitalize to SHOULD if normative; otherwise rephrase as "we recommend"

## LOW Issues (Optional)

5. [CHANGELOG] **CHANGELOG.md — `[Unreleased]` block has no entry for this change**
   - Fix: Add one line under `[Unreleased] > Additive` or `> Security`
```

---

## Step 5: Summary

### `npm run openwop:check` verification

| Step | Status |
|---|---|
| [1/8] TypeScript reference SDK (build + emit) | PASS / FAIL |
| [2/8] Conformance suite (typecheck + server-free) | PASS / FAIL |
| [3/8] Python reference SDK (syntax + import smoke) | PASS / FAIL |
| [4/8] Go reference SDK (go vet + tests) | PASS / FAIL |
| [5/8] OpenAPI 3.1 (redocly lint) | PASS / FAIL |
| [6/8] AsyncAPI 3.1 (asyncapi validate) | PASS / FAIL |
| [7/8] Publish metadata + package contents | PASS / FAIL |
| [8/8] Security invariants | PASS / FAIL |

**Verdict:** [BLOCKING — Must fix before merge] / [CLEAR — Proceed with review]

### Compatibility classification

**Additive** / **Safety-fix** / **Breaking** per `COMPATIBILITY.md`. One-paragraph justification.

### Banned-pattern scan

| Surface | Pattern | Count |
|---|---|---|
| `../openwop-sdks/sdk/typescript/src/` | `as any` / `@ts-ignore` / `@ts-nocheck` | 0 required |
| `conformance/src/` | `as any` / `@ts-ignore` | 0 required |
| `schemas/` | Missing `additionalProperties: false` | 0 required |
| `api/` | Inline schema (no `$ref`) | 0 required |
| `spec/v1/` + `RFCS/` | Lowercase normative imperatives | 0 required |

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

- [ ] `npm run openwop:check` passes (8/8 green)
- [ ] No `@ts-ignore` / `@ts-nocheck` / `as any` in production SDK or conformance code
- [ ] Every new schema is JSON Schema 2020-12, `$id` under openwop.dev, `additionalProperties: false`
- [ ] Every new endpoint has a matching method on `OpenwopClient`
- [ ] Every new normative surface has a conformance scenario (capability-gated where applicable)
- [ ] Every new MUST-NOT has a SECURITY invariant row + public test
- [ ] Every commit on the PR has `Signed-off-by:` trailer
- [ ] CHANGELOG.md `[Unreleased]` line added
- [ ] RFC drafted (if normative) and PR labeled `openwop-spec`
- [ ] Compatibility classification stated in PR body (additive / safety-fix / breaking)

**If ANY checkbox fails, the change is NOT ready for merge.**

---

## Next Steps

After resolving issues:

| Action | Command | Purpose |
|---|---|---|
| Fix TypeScript errors | `/ts-check` | Root-cause analysis for tsc/ruff/go-vet errors |
| Documentation review | `/ux-review` | RFC 2119 + prose hygiene + cross-link integrity |
| NFR review | `/nfr` | Final spec/conformance/governance/security checklist |
| Sync conformance | `/update-conformance` | If a spec change implies scenario/fixture updates |
| Update docs | `/update-docs` | Sync README, CHANGELOG, INTEROP-MATRIX, RFC index |
| Create PR | `/pr` | Generate pull request with the right template |

Then ask: **"Which issues should I fix? (e.g., 1-3, all critical, or 'all')"**
