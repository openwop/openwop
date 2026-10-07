---
name: plan
description: Structured Planning Mode for openwop — discovers existing spec/schema/conformance surface before proposing a change, classifies the change (editorial / additive / safety-fix / breaking), produces a phased implementation plan with explicit RFC and CHANGELOG checkpoints.
---

# Planning Mode (openwop)

You are now in **Structured Planning Mode** for: $ARGUMENTS

**Audience:** the openwop spec corpus in this repo: `spec/v2/` (normative core in `spec/v2/core/`, extensions in `spec/v2/ext/`, families in `spec/v2/declaration.json`), `RFCS/`, `schemas/v2/`, `api/`, `conformance/`, `SECURITY/`, `evidence/`. `spec/v1/` is frozen (v1 reached end of support by RFC 0234). SDKs, example hosts, the site, the demo app and the pack registry live in their own repos (`openwop/openwop-sdks`, `openwop/openwop-examples`, `openwop/openwop-site`, `openwop/openwop-app`, `openwop/openwop-registry`); a plan names the follow-up there but does not edit them.

---

## Scope Rule (read first)

You do **not** unilaterally cut scope. openwop is a wire-level protocol — most "make it smaller" advice translates to "leave a spec gap." Spec gaps cost adoption credibility for years. Instead:

1. **Audit what is already in place before claiming anything is missing.** Read `spec/v2/core/`, `spec/v2/ext/`, `spec/v2/declaration.json`, every `RFCS/NNNN-*.md`, `schemas/v2/`, `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml`, the relevant `conformance/src/scenarios/v2-*.test.ts`, and the host bundles in `evidence/v2-host-bundles/`. Most "we'd need new surface for this" assumptions collapse once the existing surface is enumerated.
2. **Treat scope as a sequencing problem, not an exit.** If the change composes from existing primitives (families, facets, profiles, interrupts, events, schemas), say so. If it needs new primitives, name them and propose a phased build order — but do not recommend deferring the goal itself.
3. **Phasing is a delivery technique, not a scope hatch.** Only call out a phase boundary when there is a specific gate: an RFC comment window, a CHANGELOG line, a CI gate (`npm run openwop:check`), a conformance fixture round-trip, a family record in `/.well-known/openwop`, a SECURITY invariant test in `SECURITY/invariants.yaml`. "It's a lot of work" is not a gate.
4. **Big scope is not a CRITICAL or Blocking issue.** It is only critical when the scale itself introduces a wire-shape, version-negotiation, BYOK, replay, or cross-host interop risk that does not exist at smaller scale.

The right output for a large proposal is a complete inventory of impact + a delivery plan, not a request to scope it down.

---

## Phase 0: Classify the change

Before touching any file, decide which lane this falls into. The rest of the plan depends on it.

| Lane | What it covers | Required artifacts |
|---|---|---|
| **Editorial** | Typos, prose clarifications, link fixes, internal docs | Direct PR; CHANGELOG optional |
| **Non-normative** | Guides, runbooks (`docs/`), examples without normative content | Direct PR + CHANGELOG line |
| **Normative — additive** | New optional field, new SHOULD recommendation, new event type that consumers can ignore, new family or facet, new profile | **RFC required** (7-day comment window) + schema/OpenAPI/AsyncAPI diff + new conformance scenario(s) + CHANGELOG line under `[Unreleased]` |
| **Normative — safety-fix** | Breaks a v2.x guarantee, justified by a CVE-class or correctness bug per `COMPATIBILITY.md` §3 | **RFC required** (90-day public window OR embargoed disclosure per `SECURITY.md`) + migration tooling + `CHANGELOG.md` `### Security` heading citing advisory ID |
| **Normative — breaking** | Anything else that invalidates an existing v2 conformance pass (a new REQUIRED property, closing an object, narrowing a type) | **RFC required** (30-day window); waits for the next major |
| **Implementation-only** | Conformance refactors that preserve assertions, `conformance/src/lib/` helpers, scripts under `scripts/` | Direct PR; CHANGELOG line if the published suite changes |

Output a one-line **Lane Verdict** before Phase 1. If you cannot decide, default to "Normative — additive" and call out the ambiguity. Never silently treat a normative change as editorial.

---

## Phase 1: Discovery & Corpus Analysis

Thoroughly explore the existing corpus before proposing any plan. Use Glob, Grep, and Read tools.

### 1.1 Existing surface

- Read `CONTRIBUTING.md` (per-artifact change rules) and `COMPATIBILITY.md` (§2.4 covers v2.x; §3a covers retiring a v2 surface).
- Read `GOVERNANCE.md` if the change touches decision-making or maintainer flow.
- Read `ROADMAP.md` to see whether the change overlaps a tracked item.
- Search `spec/v2/core/*.md` and `spec/v2/ext/` for prose that already names the concept. Cite the section heading + RFC 2119 keyword (`MUST` / `SHOULD` / `MAY`) verbatim. Find the core doc that owns the rule: an RFC never restates a rule a core doc owns.
- Search `RFCS/*.md` for any RFC that mentions the surface. Note Status: `Draft` / `Active` / `Accepted` / `Withdrawn` / `Superseded` / `Rejected`.
- Check `spec/v1/gaps.json` (the one gap namespace, generated from each RFC's companion gap register) for an open `openwop.gap.<rfc>.<n>` this closes.

### 1.2 Files that will be affected

- **Prose:** which `spec/v2/core/*.md` or `spec/v2/ext/<family>/` files need text edits? Core docs keep their `> **Status: …**` banner and must pass `scripts/check-spec-readability.mjs` and the word budget (`scripts/check-core-budget.mjs`).
- **Families:** does it add or change a row in `spec/v2/declaration.json` or a facet in `spec/v2/facets/`? `schemas/v2/capabilities.schema.json` and `spec/v2/profiles.json` are generated from them by `scripts/generate-from-declaration.mjs`.
- **Schemas:** which `schemas/v2/*.schema.json` files change? `$schema: https://json-schema.org/draft/2020-12/schema`, `$id` under `https://openwop.dev/spec/v2/<name>.schema.json`, `additionalProperties: false`.
- **OpenAPI / AsyncAPI:** `api/v2/*` is generated by `scripts/derive-v2-api.py` from `api/openapi.yaml` plus the inline seams in that script. Plan edits to the source, then regenerate.
- **Conformance:** which `conformance/src/scenarios/v2-*.test.ts` files cover the surface today? Which need new scenarios? Which `conformance/fixtures/*` need new fixtures (and corresponding `fixtures.md` entries)?
- **Downstream repos:** which SDK methods (`openwop/openwop-sdks`), example hosts (`openwop/openwop-examples`) or app behavior (`openwop/openwop-app`) follow from this? List them as follow-up issues.
- **Interop matrix:** which hosts in `INTEROP-MATRIX.md` certify a profile or family this changes? Their bundles in `evidence/v2-host-bundles/` decide what the matrix may claim.

### 1.3 Dependencies & integration points

- **Versioning.** Per `spec/v2/core/versioning.md`: new operations use unversioned paths and land in `spec/v2/path-manifest.json`; the `OpenWOP-Version` header selects only the `/.well-known/openwop` representation.
- **Capability handshake.** Does this need a new family or facet? Presence of the record is the claim (no `supported` field at v2). Discovery caching is standard `ETag` / `If-None-Match`.
- **Witness class.** Every new MUST needs a witness class (`spec/v2/core/conformance.md` §Witness class). A MUST whose only witness is `seam-gated` needs a normative observation path or must be a SHOULD.
- **Webhooks.** Any new event types that must be advertised in the subscription register? Signing recipe in `spec/v2/core/webhooks.md` unchanged?
- **Storage.** Does the change extend `spec/v2/core/storage.md` or `persistence.md`? Adapter authors must be told.
- **Packs.** Does a manifest format in `spec/v2/core/packs.md` (or a `*-packs.md` doc) need a field?
- **Security defaults.** Does the new surface need a row in the obligation table of `spec/v2/core/security-defaults.md`?
- **SECURITY invariants.** Read `SECURITY/invariants.yaml`. Every protocol-tier MUST-NOT needs a public test in conformance — `scripts/check-security-invariants.sh` enforces this. Will the change add or modify an invariant?

### 1.4 Potential conflicts

- `git fetch origin` then check `git log --oneline origin/main -20` for in-progress work touching the same files. Other sessions merge to `main` continuously.
- Check open RFCs (`RFCS/*.md` with `Status: Draft`) for overlapping scope.
- Check `INTEROP-MATRIX.md` for hosts that certify a profile the change would invalidate.
- Check `SECURITY/threat-model-*.md` to see if the change touches an existing threat surface.

Present a **Discovery Summary** before Phase 2. Include the Lane Verdict, the affected-files table, the families touched, and any conflicts.

---

## Phase 2: Implementation Plan

### Overview
[2–3 sentence summary of the approach. Reference the lane and the specific spec doc(s) it touches.]

### Wire-shape decision table

| Decision | Choice | Rationale (cite spec section) |
|---|---|---|
| e.g., Field optionality | optional | `COMPATIBILITY.md` §2.4: an OPTIONAL property on a closed v2 object is additive |
| e.g., Capability gating | new facet on family `X` | `spec/v2/core/capabilities.md` §2 "The capability record" |
| e.g., Conformance gating | new scenario gated on the family record | `conformance/coverage.md` §"Capability-gated scenarios" |

### Implementation phases

Order: **RFC + spec text → declaration/facets → schemas → OpenAPI/AsyncAPI source → conformance → regen chain + gate → CHANGELOG/INTEROP-MATRIX → downstream issues**. Spec drives implementation, never the reverse.

#### Phase 1: Spec text + RFC
**Goal:** Land the normative prose and the public RFC.

| Task | Files | Description |
|---|---|---|
| 1.1 | `RFCS/NNNN-<slug>.md` | Copy `0000-template.md`; fill every section the template asks for |
| 1.2 | `spec/v2/core/<doc>.md` or `spec/v2/ext/<family>/` | Add normative section with RFC 2119 keywords in the doc that owns the rule; keep the `Status:` banner |
| 1.3 | `CHANGELOG.md` | One short entry under `[Unreleased]` |

**Acceptance Criteria:**
- [ ] RFC follows `0000-template.md`
- [ ] RFC 2119 keywords (MUST / SHOULD / MAY) applied; each MUST has a witness class
- [ ] `node scripts/check-spec-readability.mjs` and `node scripts/check-core-budget.mjs` pass

#### Phase 2: Wire artifacts
**Goal:** Declaration, schemas, OpenAPI and AsyncAPI match the prose.

| Task | Files | Description |
|---|---|---|
| 2.1 | `spec/v2/declaration.json`, `spec/v2/facets/<key>.schema.json` | Family row and facet shape (the capabilities schema is generated from these) |
| 2.2 | `schemas/v2/<name>.schema.json` | JSON Schema 2020-12; `$id` under `https://openwop.dev/spec/v2/`; `additionalProperties: false` |
| 2.3 | `api/openapi.yaml` or the seams in `scripts/derive-v2-api.py` | Endpoint diff with `tag`, `operationId`, request/response schemas, at least one error response; `api/v2/` is regenerated, not hand-edited |
| 2.4 | `api/asyncapi.yaml` | Event channel diff with cross-file `$ref` |

**Acceptance Criteria:**
- [ ] `python3 scripts/derive-v2-api.py --check` clean after regeneration
- [ ] `node scripts/check-declaration.mjs` and `node scripts/check-v2-schemas.mjs` clean
- [ ] Redocly and AsyncAPI clean at the versions `scripts/openwop-check.sh` pins
- [ ] Every schema cross-referenced via `$ref` (no inline shapes)
- [ ] Schema additions are optional unless the RFC is a breaking change

#### Phase 3: Conformance
**Goal:** Black-box scenarios reflect the new surface.

| Task | Files | Description |
|---|---|---|
| 3.1 | `conformance/src/scenarios/v2-<area>.test.ts` | New scenario with a top-of-file docstring citing the `spec/v2` doc; assertions use `req(id, section, requirement)`; one explicit id per `it`; `return softSkip(kind, reason)` instead of a bare `return` |
| 3.2 | `conformance/fixtures/<fixture>.json` | New fixture (if needed) + `conformance/fixtures.md` catalog row |
| 3.3 | `conformance/coverage.md` | Update coverage table; if family-gated, note it under §"Capability-gated scenarios" |
| 3.4 | `SECURITY/invariants.yaml` | Row + test for any new MUST-NOT |

**Acceptance Criteria:**
- [ ] `cd conformance && npm run typecheck` clean (never bare `tsc -p tsconfig.json`)
- [ ] `spec-corpus-validity.test.ts` and `fixtures-valid.test.ts` pass
- [ ] `node scripts/check-req-only.mjs` clean
- [ ] Each new scenario runs only when its family record is advertised, OR is explicitly unconditional
- [ ] Sabotage-proved: the scenario fails against a host that breaks the rule

#### Phase 4: Regen chain + gate
**Goal:** Every generated surface is current and the gate is green.

| Task | Command | Description |
|---|---|---|
| 4.1 | regen chain (below) | Run once, immediately before the gate; a later source edit re-stales a surface |
| 4.2 | `npm run openwop:check` | The 10-step gate in `scripts/openwop-check.sh` |

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write
```

`conformance/scenario-majors.json` comes out of this chain: a `v2-*` file targets major 2 automatically; a file with no row never runs.

#### Phase 5: INTEROP-MATRIX + downstream
**Goal:** The matrix stays honest; downstream repos know what they owe.

| Task | Files | Description |
|---|---|---|
| 5.1 | `INTEROP-MATRIX.md` | Change a host row only when a committed bundle in `evidence/v2-host-bundles/` backs it |
| 5.2 | issues in `openwop/openwop-sdks`, `openwop/openwop-examples`, `openwop/openwop-app` | SDK methods, reference-host support, app behavior that follow from the change |

**Acceptance Criteria:**
- [ ] No matrix claim without a bundle behind it
- [ ] Follow-up issues filed and linked from the PR

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
- Closed v2 objects: no new REQUIRED property, no type narrowed?

If any answer is "no," the change is at minimum a safety-fix and may be breaking. State the criterion.

### Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| e.g., A host certifies the family on an older suite and the new leg reads as a regression | Medium | Medium | Gate the leg on the new facet; record the suite-version rule (`COMPATIBILITY.md` §2.3) |
| e.g., Schema change breaks Ajv2020 compile in `spec-corpus-validity.test.ts` | High | Low | Run the regen chain and `npm run openwop:check` before merge; CI gates on it |

### Project-specific concerns

- [ ] **RFC comment window:** normative addition = 7 days; breaking = 30 days; safety-fix = 90 days OR embargo. Per `RFCS/README.md`. A waiver is recorded in the RFC's `Updated` field.
- [ ] **DCO signoff:** every commit `Signed-off-by:`.
- [ ] **Capability gating:** if the change is opt-in, is it actually opt-in for clients on hosts that do not advertise the family?
- [ ] **Replay safety:** does any event-log shape change break `POST /runs/{runId}:fork` against historical checkpoints (`spec/v2/core/replay.md`)?
- [ ] **BYOK secrets:** does the change touch credential resolution? Per `spec/v2/core/identity.md` and `SECURITY/threat-model-secret-leakage.md`.
- [ ] **Namespaces:** new spans/events stay under `openwop.*`; vendor extensions under `extensions.<org>.<name>`.
- [ ] **Profile predicates:** does any profile in the declaration need a new predicate?

### Testing strategy

- **Schema validity:** Ajv2020 compile (`conformance/src/coherence/spec-corpus-validity.test.ts`)
- **Fixture validity:** new fixture validates against its schema (`conformance/src/scenarios/fixtures-valid.test.ts`)
- **Black-box conformance:** new `v2-*` scenarios in `conformance/src/scenarios/`, proved against a local v2 reference host
- **Suite self-tests:** `cd conformance && npm run test:self` for any `src/lib/` change
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
