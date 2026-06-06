---
name: plan
description: Structured Planning Mode for openwop — discovers existing spec/schema/conformance surface before proposing a change, classifies the change (editorial / additive / safety-fix / breaking), produces a phased implementation plan with explicit RFC and CHANGELOG checkpoints.
---

# Planning Mode (openwop)

You are now in **Structured Planning Mode** for: $ARGUMENTS

**Audience:** the openwop spec corpus (`spec/v1/`, `RFCS/`, `schemas/`, `api/`, `conformance/`, `sdk/`, `../openwop-examples/examples/hosts/`, `../openwop-registry/packs/`, `../openwop-registry/registry/`, `../openwop-site/site/`, `SECURITY/`).

---

## Scope Rule (read first)

You do **not** unilaterally cut scope. openwop is a wire-level protocol — most "make it smaller" advice translates to "leave a spec gap." Spec gaps cost adoption credibility for years. Instead:

1. **Audit what is already in place before claiming anything is missing.** Read `spec/v1/`, every `RFCS/NNNN-*.md`, `schemas/`, `api/openapi.yaml`, `api/asyncapi.yaml`, the relevant `conformance/src/scenarios/*.test.ts`, and the three reference hosts under `../openwop-examples/examples/hosts/`. Most "we'd need new surface for this" assumptions collapse once the existing surface is enumerated.
2. **Treat scope as a sequencing problem, not an exit.** If the change composes from existing primitives (capability flags, profiles, channels, interrupts, events, schemas), say so. If it needs new primitives, name them and propose a phased build order — but do not recommend deferring the goal itself.
3. **Phasing is a delivery technique, not a scope hatch.** Only call out a phase boundary when there is a specific gate: an RFC comment window, a CHANGELOG line, a CI gate (`npm run openwop:check`), a conformance fixture round-trip, a capability flip in `/.well-known/openwop`, a SECURITY invariant test in `SECURITY/invariants.yaml`. "It's a lot of work" is not a gate.
4. **Big scope is not a CRITICAL or Blocking issue.** It is only critical when the scale itself introduces a wire-shape, version-negotiation, BYOK, replay, or cross-host interop risk that does not exist at smaller scale.

The right output for a large proposal is a complete inventory of impact + a delivery plan, not a request to scope it down.

---

## Phase 0: Classify the change

Before touching any file, decide which lane this falls into. The rest of the plan depends on it.

| Lane | What it covers | Required artifacts |
|---|---|---|
| **Editorial** | Typos, prose clarifications, link fixes, internal docs, examples without normative content | Direct PR; CHANGELOG optional |
| **Non-normative** | New examples, optional reference notes, host-side docs (`../openwop-examples/examples/hosts/*/README.md`, `docs/runbooks/`) | Direct PR + CHANGELOG line |
| **Normative — additive** | New optional field, new SHOULD recommendation, new event type that consumers can ignore, new capability flag, new profile, new SDK method that wraps existing endpoint | **RFC required** (7-day comment window) + schema/OpenAPI/AsyncAPI diff + new conformance scenario(s) + CHANGELOG line under `[Unreleased]` |
| **Normative — safety-fix** | Breaks v1.x but justified by a CVE-class or correctness bug per `COMPATIBILITY.md` §3 | **RFC required** (90-day public window OR embargoed disclosure per `SECURITY.md`) + migration tooling + `version-negotiation.md` runbook + `CHANGELOG.md` `### Security` heading citing advisory ID |
| **Normative — breaking** | Anything else that invalidates an existing v1 conformance pass | **RFC required** (30-day window) + v2 plan; should not land in v1.x |
| **Implementation-only** | TS/Python/Go SDK changes, host changes under `../openwop-examples/examples/hosts/`, conformance scenario refactors that preserve assertions, scripts under `scripts/`, site changes under `../openwop-site/site/` | Direct PR; SDK CHANGELOG line; coordination with `WORKFLOW-PROTOCOL-openwop-PLAN.md` for cross-cuts (CC-N) |

Output a one-line **Lane Verdict** before Phase 1. If you cannot decide, default to "Normative — additive" and call out the ambiguity. Never silently treat a normative change as editorial.

---

## Phase 1: Discovery & Corpus Analysis

Thoroughly explore the existing corpus before proposing any plan. Use Glob, Grep, and Read tools.

### 1.1 Existing surface

- Read `CONTRIBUTING.md` (per-artifact change rules) and `COMPATIBILITY.md` (additive vs safety-fix vs breaking).
- Read `GOVERNANCE.md` if the change touches decision-making, maintainer flow, or the bootstrap-phase amendment.
- Read `ROADMAP.md` to see whether the change overlaps a tripwire (vendor-neutral migration, hosted registry, third-party hosts, OTel verification harness).
- Search `spec/v1/*.md` for prose that already names the concept. Cite the section heading + RFC 2119 keyword (`MUST` / `SHOULD` / `MAY`) verbatim.
- Search `RFCS/*.md` for any open or accepted RFC that mentions the surface. Note Status: `Draft` / `Active` / `Accepted` / `Withdrawn` / `Superseded`.
- Read `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` — it tracks the 1–9 known-gap tracks. State which track this lands in.

### 1.2 Files that will be affected

- **Prose:** which `spec/v1/*.md` files need text edits? Which keep their `Status: FINAL v1` tag, which need a date update?
- **Schemas:** which `schemas/*.schema.json` files change? Confirm `$schema: https://json-schema.org/draft/2020-12/schema`, `$id` under `https://openwop.dev/spec/v1/<name>.schema.json`, `additionalProperties: false`.
- **OpenAPI:** which endpoints in `api/openapi.yaml` change? Cross-file `$ref` to schemas — never inline.
- **AsyncAPI:** which event channels in `api/asyncapi.yaml` change? Cross-file `$ref` only.
- **Conformance:** which `conformance/src/scenarios/*.test.ts` files cover the surface today? Which need new scenarios? Which `conformance/fixtures/*` need new fixtures (and corresponding `fixtures.md` entries)?
- **SDK:** which methods on `OpenwopClient` (`../openwop-sdks/sdk/typescript/src/client.ts`), Python (`../openwop-sdks/sdk/python/src/openwop_client/`), Go (`../openwop-sdks/sdk/go/`) change? Reminder: per `CONTRIBUTING.md`, every endpoint maps to one method on `OpenwopClient`.
- **Reference hosts:** which of `../openwop-examples/examples/hosts/{in-memory,sqlite,python}/` implement this? Which will need updates to remain in the **INTEROP-MATRIX.md** with their advertised profile set?
- **Capabilities:** does this add a new capability surface? It must extend `/.well-known/openwop` per `capabilities.md` and `host-capabilities.md`, advertise via `capabilities.schema.json`, and gate any new conformance scenario.
- **Profiles:** does it add a new compatibility profile per `profiles.md`? Update the profile predicate list in `INTEROP-MATRIX.md`.
- **Site:** any prose surfacing on `openwop.dev` via `../openwop-site/site/`? It re-renders from the spec corpus, so site changes are usually automatic — but check `../openwop-site/site/src/build.mjs` if the structure changes.

### 1.3 Dependencies & integration points

- **Version negotiation.** Per `version-negotiation.md`, does the change affect engine version, per-run event-log version, per-event version, or runtime pinning? If yes, name which axis.
- **Capability handshake.** Does this need a new entry in `capabilities.schema.json`? Does `Capabilities-Etag` semantics change?
- **Webhooks.** Any new event types that must be advertised in the subscription register? HMAC signing recipe unchanged?
- **Storage adapters.** Does the change extend `RunEventLogIO` or `SuspendIO` contracts in `storage-adapters.md`? Adapter authors must be told.
- **Node packs / agent packs.** Does the manifest format (`node-pack-manifest.schema.json`, `agent-manifest.schema.json`) need a field?
- **Memory layer.** If touching agent state, does the `MemoryAdapter` host-interface contract in `agent-memory.md` change? Confirm CTI-1 (cross-tenant invariant) and SR-1 (secret-redaction invariant) still hold.
- **Observability.** Any new spans, events, or metric kinds in `observability.md`'s canonical `openwop.*` OTel namespace?
- **SECURITY invariants.** Read `SECURITY/invariants.yaml`. Every protocol-tier MUST-NOT needs a public test in conformance — `scripts/check-security-invariants.sh` enforces this. Will the change add or modify an invariant?

### 1.4 Potential conflicts

- Check `git status` / `git log --oneline -20` for in-progress work touching the same files.
- Check open RFCs (`RFCS/*.md` with `Status: Draft`) for overlapping scope.
- Check `INTEROP-MATRIX.md` for hosts that advertise a profile the change would invalidate.
- Check `SECURITY/` threat-model docs to see if the change touches an existing threat surface (auth-profiles, node-packs, prompt-injection, provider-policy, secret-leakage).

Present a **Discovery Summary** before Phase 2. Include the Lane Verdict, the affected-files table, the version-negotiation axis, and any conflicts.

---

## Phase 2: Implementation Plan

### Overview
[2–3 sentence summary of the approach. Reference the lane and the specific spec doc(s) it touches.]

### Wire-shape decision table

| Decision | Choice | Rationale (cite spec section) |
|---|---|---|
| e.g., Field optionality | optional, default `null` | `COMPATIBILITY.md` §2.1: additive-only within v1.x |
| e.g., Capability gating | new flag `host.capabilityName` | `capabilities.md` §"in-package vs network-superset shapes" |
| e.g., Conformance gating | new scenario gated on capability | `conformance/coverage.md` §"Capability-gated scenarios" |

### Implementation phases

Order: **spec text → schema → OpenAPI/AsyncAPI → conformance → SDKs → reference hosts → CHANGELOG/INTEROP-MATRIX**. Spec drives implementation, never the reverse.

#### Phase 1: Spec text + RFC
**Goal:** Land the normative prose and the public RFC.

| Task | Files | Description |
|---|---|---|
| 1.1 | `RFCS/NNNN-<slug>.md` | Copy `0000-template.md`, populate Summary/Motivation/Proposal/Compatibility/Conformance/Alternatives/Unresolved/Acceptance |
| 1.2 | `spec/v1/<doc>.md` | Add normative section with RFC 2119 keywords; preserve `Status:` header; bump draft date |
| 1.3 | `CHANGELOG.md` | One-line entry under `[Unreleased]` |

**Acceptance Criteria:**
- [ ] RFC follows `0000-template.md` exactly
- [ ] RFC 2119 keywords (MUST / SHOULD / MAY) applied
- [ ] "Why this exists" paragraph in any new spec section
- [ ] Spec doc retains `Status:` legend tag per `CONTRIBUTING.md`

#### Phase 2: Wire artifacts
**Goal:** Schemas + OpenAPI + AsyncAPI match the prose.

| Task | Files | Description |
|---|---|---|
| 2.1 | `schemas/<name>.schema.json` | JSON Schema 2020-12; `$id` under `openwop.dev/spec/v1/`; `additionalProperties: false` |
| 2.2 | `api/openapi.yaml` | Endpoint diff with `tag`, `operationId`, request/response schemas, at least one error response |
| 2.3 | `api/asyncapi.yaml` | Event channel diff with cross-file `$ref` |

**Acceptance Criteria:**
- [ ] `redocly lint api/openapi.yaml` clean
- [ ] `asyncapi validate api/asyncapi.yaml` clean
- [ ] Every schema cross-referenced via `$ref` (no inline shapes)
- [ ] Schema additions are optional unless the RFC is a breaking change

#### Phase 3: Conformance
**Goal:** Black-box scenarios reflect the new surface.

| Task | Files | Description |
|---|---|---|
| 3.1 | `conformance/src/scenarios/<area>.test.ts` | New scenario with top-of-file docstring citing the spec doc, `expect(…, driver.describe('spec.md §section', 'requirement'))` |
| 3.2 | `conformance/fixtures/<fixture>.json` | New fixture (if needed) + `conformance/fixtures.md` catalog row |
| 3.3 | `conformance/coverage.md` | Update coverage table; if capability-gated, note it under §"Capability-gated scenarios" |

**Acceptance Criteria:**
- [ ] `conformance/dist/cli.js --offline` server-free subset passes
- [ ] `spec-corpus-validity.test.ts` and `fixtures-valid.test.ts` round-trip pass
- [ ] Server-free scenarios run in <1s (CI gate)
- [ ] Each new scenario runs only when its capability flag is advertised, OR is explicitly marked unconditional

#### Phase 4: SDKs
**Goal:** TypeScript / Python / Go reference SDKs implement the surface.

| Task | Files | Description |
|---|---|---|
| 4.1 | `../openwop-sdks/sdk/typescript/src/client.ts` + `src/types.ts` | New method on `OpenwopClient`; types extend `src/types.ts` |
| 4.2 | `../openwop-sdks/sdk/python/src/openwop_client/` | Method addition; Python 3.11 stdlib-only port stays stdlib-only |
| 4.3 | `../openwop-sdks/sdk/go/` | Method addition; `go vet ./...` and `gofmt -l .` clean |

**Acceptance Criteria:**
- [ ] TS: `tsc --noEmit` clean with `strict + exactOptionalPropertyTypes`; no `as any`, no `@ts-ignore`
- [ ] Python: `ruff check ../openwop-sdks/sdk/python/` clean
- [ ] Go: `go vet ./...` clean, `gofmt -l .` produces no output

#### Phase 5: Reference hosts + INTEROP-MATRIX
**Goal:** At least one reference host demonstrates the surface; matrix is honest.

| Task | Files | Description |
|---|---|---|
| 5.1 | `../openwop-examples/examples/hosts/{in-memory\|sqlite\|python}/` | Implement the new surface in whichever host is most appropriate; update its `conformance.md` |
| 5.2 | `INTEROP-MATRIX.md` | Update host row's profile list with new capability/profile if advertised |

**Acceptance Criteria:**
- [ ] Host's `conformance.md` records pass/fail/skip counts against the suite version
- [ ] If a host advertised a now-stricter profile, validate it still passes the existing scenarios
- [ ] Honest "Not claimed" for production-profile fields the host does not actually meet

---

## Phase 3: Risk Assessment

### Compatibility classification

State explicitly: this RFC is **additive** / **safety-fix** / **breaking** per `COMPATIBILITY.md`. Justify in one sentence each:

- Existing required fields: unchanged?
- Existing optional fields: type unchanged?
- Existing event types: shape unchanged?
- Existing endpoints: contract unchanged (additive optional fields aside)?
- Existing `MUST` requirements: not relaxed?
- Existing error codes / HTTP statuses: meaning unchanged?

If any answer is "no," the change is at minimum a safety-fix and may be breaking. State the criterion.

### Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| e.g., Cross-host drift if a host adopts the new event but its conformance test stays at suite `1.x.0` | Medium | Medium | New scenario gated on capability; host updates suite version when it advertises |
| e.g., Schema bump breaks Ajv2020 compile in `spec-corpus-validity.test.ts` | High | Low | Run `npm run openwop:check` before merge; CI gates on it |

### Cross-cuts

Per `CONTRIBUTING.md` §"Coordination with the impl plan":

- **Cosmetic / additive:** the spec PR can merge independently; impl catches up.
- **Breaking impl assumptions:** add a `CC-N` entry to `WORKFLOW-PROTOCOL-openwop-PLAN.md` "Cross-cuts to impl plan" section. Impl plan owner approves before merge.

State which applies. If `CC-N` is needed, draft the entry.

### Project-specific concerns

- [ ] **RFC comment window:** additive = 7 days; safety-fix = 90 days OR embargo; breaking = 30 days. Per `RFCS/README.md`.
- [ ] **DCO signoff:** every commit `Signed-off-by:` per `CONTRIBUTING.md` §"Sign your commits."
- [ ] **Capability gating:** if the change is opt-in, is it actually opt-in for clients running on old hosts?
- [ ] **Version negotiation:** is there a `version-negotiation.md` runbook section needed?
- [ ] **Replay safety:** does any event-log shape change break `POST /v1/runs/{runId}:fork` against historical checkpoints?
- [ ] **BYOK secrets:** does the change touch credential resolution? Per `auth.md` and `SECURITY/threat-model-secret-leakage.md`.
- [ ] **OTel taxonomy:** new spans/events stay under `openwop.*` namespace per `host-extensions.md`?
- [ ] **Profile predicates:** does any profile in `profiles.md` need a new predicate?
- [ ] **Bootstrap-phase rules:** per `CONTRIBUTING.md` §"Bootstrap-phase notes" — one-approval review remains until `MAINTAINERS.md` lists a non-steward maintainer.

### Testing strategy

- **Schema validity:** Ajv2020 compile (existing `spec-corpus-validity.test.ts`)
- **Fixture validity:** new fixture validates against `workflow-definition.schema.json` (existing `fixtures-valid.test.ts`)
- **Black-box conformance:** new scenarios in `conformance/src/scenarios/`
- **SDK unit tests:** `../openwop-sdks/sdk/typescript/src/__tests__/`, `../openwop-sdks/sdk/python/tests/`, `../openwop-sdks/sdk/go/`
- **Host smoke:** `../openwop-examples/examples/hosts/{in-memory\|sqlite\|python}/test/`
- **Security invariants:** if the RFC introduces a MUST-NOT, add an invariant row in `SECURITY/invariants.yaml` AND a public test, per `scripts/check-security-invariants.sh`

---

## Phase 4: Next Steps

After you approve this plan:

| Action | Command | Purpose |
|---|---|---|
| Architecture review | `/architect` | Wire-shape stability, version negotiation, capability gating, cross-host interop, SECURITY invariants |
| RFC drafting | `/prd <slug>` | Walk through the five-architect pass and land `RFCS/NNNN-<slug>.md` |
| Start implementation | Say "proceed" | Begin Phase 1 of the implementation plan |
| Adjust plan | Say "revise: [feedback]" | Modify specific parts of the plan |

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` / `next` | Move to next phase |
| `back` | Go to previous phase |
| `skip to phase N` | Jump to phase N |
| `revise: [feedback]` | Revise current phase based on feedback |
| `expand phase N` | Add more detail to a specific phase |
| `show risks` | Display risk assessment |
| `lane` | Re-evaluate the lane verdict |
| `done` | Finalize plan |
