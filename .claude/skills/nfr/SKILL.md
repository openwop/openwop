---
name: nfr
description: Non-functional requirements checklist for openwop changes. Verifies spec hygiene (RFC 2119, Status, schema discipline), wire-shape compatibility, capability gating, conformance coverage, governance (DCO, RFC window, CHANGELOG), SECURITY invariants, BYOK + replay invariants, and INTEROP-MATRIX honesty before merge.
---

# Non-Functional Requirements Checklist (openwop)

Use this checklist to verify a change meets every non-functional requirement before merging. Items are grouped by severity. Each item cites the spec doc that defines the requirement so failure messages can point at the contract.

---

## CRITICAL: Compatibility (per `COMPATIBILITY.md`)

- [ ] Change is classified in PR body: **additive** / **safety-fix** / **breaking**
- [ ] If additive (§2.1): new fields are optional with documented default; new event types declared as opt-in; existing clients ignore unknown event types
- [ ] If safety-fix (§3): RFC filed with 90-day public window OR embargoed-disclosure per `SECURITY.md`; ships with migration tooling; `version-negotiation.md` runbook section added; `CHANGELOG.md` `### Security` entry cites the advisory ID
- [ ] If breaking: deferred to v2; not in this PR
- [ ] No existing required field made optional, removed, or type-changed (§2.2)
- [ ] No existing event-type shape changed (§2.2)
- [ ] No existing endpoint contract changed (§2.2; additive optional fields aside)
- [ ] No existing `MUST` requirement relaxed (§2.2)
- [ ] No existing error code or HTTP status meaning changed (§2.2)

## CRITICAL: SECURITY invariants (per `SECURITY/invariants.yaml`)

- [ ] `bash scripts/check-security-invariants.sh` passes — every protocol-tier MUST-NOT has at least one matching public test
- [ ] If the change introduces a new MUST-NOT, the invariant row + at least one `conformance/src/scenarios/` test land in the same PR
- [ ] BYOK credential material never appears in event payloads, debug bundles, webhook deliveries, or RBAC-readable logs (`auth.md`, `SECURITY/threat-model-secret-leakage.md`)
- [ ] `MemoryAdapter` SR-1 secret-redaction invariant holds (`agent-memory.md`)
- [ ] Cross-tenant CTI-1 invariant holds (`agent-memory.md`)
- [ ] Threat-model docs updated where the threat surface shifts (`SECURITY/threat-model-auth-profiles.md`, `-node-packs.md`, `-prompt-injection.md`, `-provider-policy.md`, `-secret-leakage.md`)

## CRITICAL: Replay + fork safety (per `replay.md`)

- [ ] New event records include all non-deterministic state in their payload — no regenerated timestamps, IDs, or local clocks at fork time
- [ ] `POST /v1/runs/{runId}:fork` against historical checkpoints unchanged in behavior
- [ ] Reducer changes per `channels-and-reducers.md` preserve commutativity/idempotency where spec promises it

---

## HIGH: Spec corpus hygiene (per `CONTRIBUTING.md`)

### Prose specs (`spec/v1/*.md`, `RFCS/*.md`)
- [ ] `Status:` legend tag present (STUB / DRAFT / OUTLINE / FINAL)
- [ ] Draft date updated where prose changed
- [ ] RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT) used consistently — no lowercase "should" / "must" as normative imperative
- [ ] Cross-references use relative paths (from repo root: `./spec/v1/<doc>.md`; from inside `spec/v1`: peer filename)
- [ ] New surface area carries a "Why this exists" paragraph + "Open spec gaps" table
- [ ] No inline JSON Schemas — schemas live under `schemas/` with `$ref`s

### JSON Schemas (`schemas/*.schema.json`)
- [ ] `"$schema": "https://json-schema.org/draft/2020-12/schema"`
- [ ] `"$id": "https://openwop.dev/spec/v1/<name>.schema.json"`
- [ ] Every object has `"additionalProperties": false`
- [ ] Required fields listed explicitly
- [ ] New required field → schema implicit minor version bumped + CHANGELOG entry
- [ ] New optional field → marked optional; existing implementations not invalidated
- [ ] At least one positive + one negative example per RFC template requirement (where added by RFC)

### OpenAPI (`api/openapi.yaml`) + AsyncAPI (`api/asyncapi.yaml`)
- [ ] All schemas referenced via cross-file `$ref` (`../schemas/<name>.schema.json`) — never inline
- [ ] `redocly lint api/openapi.yaml` clean
- [ ] `asyncapi validate api/asyncapi.yaml` clean
- [ ] `redocly bundle` and `asyncapi bundle` succeed
- [ ] New endpoint: `tag`, `operationId`, request/response schemas, ≥1 error response
- [ ] New AsyncAPI channel: message-name + payload schema reference; security scheme inherited

## HIGH: Conformance coverage (per `CONTRIBUTING.md` §"Conformance suite")

- [ ] Each new scenario in `conformance/src/scenarios/` opens with a docstring naming the spec doc(s) verified
- [ ] `describe('category: …', …)` blocks per assertion group
- [ ] `expect(…, driver.describe('spec.md §section', 'requirement'))` so failure messages cite the requirement
- [ ] New fixtures in `conformance/fixtures/` AND added to `fixtures.md` catalog table + per-fixture contracts
- [ ] `spec-corpus-validity.test.ts` round-trip passes (`npm run openwop:check` step 2/8)
- [ ] `fixtures-valid.test.ts` round-trip passes
- [ ] Server-free scenarios run in <1s
- [ ] Capability-gated scenarios respect `host.<capability>.supported` flags per `conformance/coverage.md` §"Capability-gated scenarios"
- [ ] `conformance/coverage.md` coverage table updated

## HIGH: SDK contract alignment (per `CONTRIBUTING.md` §"TypeScript reference SDK")

- [ ] Every new endpoint in `api/openapi.yaml` maps to exactly one method on `OpenwopClient`
- [ ] Types extend `../openwop-sdks/sdk/typescript/src/types.ts`; no inline shape redefinitions
- [ ] `( cd ../openwop-sdks/sdk/typescript && npx tsc --noEmit )` clean with `strict + exactOptionalPropertyTypes`
- [ ] No `as any`, no `@ts-ignore`, no `@ts-nocheck` in `../openwop-sdks/sdk/typescript/src/`
- [ ] Zero runtime deps remains the goal — any new dep has a stated reason in the PR description
- [ ] Python SDK (`../openwop-sdks/sdk/python/`): stdlib-only port; `ruff check ../openwop-sdks/sdk/python/` clean
- [ ] Go SDK (`../openwop-sdks/sdk/go/`): `go vet ./...` clean; `gofmt -l .` produces no output

## HIGH: Capability + profile coherence

- [ ] New optional surface advertised in `/.well-known/openwop` via `capabilities.schema.json`
- [ ] `Capabilities-Etag` semantics unchanged unless RFC explicitly says otherwise (`capabilities-change-detection.md`)
- [ ] In-package vs network-superset shapes both updated where applicable (`capabilities.md`)
- [ ] If a new profile is introduced, predicate defined in `profiles.md`
- [ ] INTEROP-MATRIX rows updated for any host whose advertisement changes
- [ ] Scale-profile claim (`minimal` / `production` / `high-throughput`) still defensible (`scale-profiles.md`)
- [ ] Production-profile claim kept honest — operational evidence, not discovery-payload predicates (`production-profile.md`)

## HIGH: Stream-mode + observability coherence

- [ ] New events visible in correct stream mode(s) (`values` / `updates` / `messages` / `debug`) per `stream-modes.md`
- [ ] New spans, events, metric kinds stay under canonical `openwop.*` OTel namespace (`observability.md`, `host-extensions.md`)
- [ ] Vendor-host telemetry stays under vendor namespaces, never `openwop.*`

## HIGH: HMAC + signed webhooks (per `webhooks.md`)

- [ ] `{timestamp}.{rawBody}` HMAC signing recipe unchanged
- [ ] Replay-attack-resistant verification recipe preserved in SDK helpers
- [ ] Circuit-breaker + best-effort delivery semantics unchanged unless RFC'd

## HIGH: Idempotency (per `idempotency.md`)

- [ ] New write endpoints accept `Idempotency-Key`
- [ ] Engine-side `invocationId` collapse rules apply
- [ ] SDK helpers expose both layers

## HIGH: Version negotiation (per `version-negotiation.md`)

- [ ] Engine version axis impact named
- [ ] Per-run event-log version axis impact named
- [ ] Per-event version axis impact named
- [ ] Runtime pinning impact named
- [ ] If deploy-skew risk exists, `version-negotiation.md` runbook section added

---

## MEDIUM: Governance + bootstrap-phase compliance (per `GOVERNANCE.md`, `CONTRIBUTING.md`)

- [ ] Every commit on the PR carries `Signed-off-by:` trailer (DCO bot blocks merge otherwise)
- [ ] Conventional Commit prefix matches lane (`spec(v1):`, `feat(host-sqlite):`, `feat(sdk-ts):`, `feat(conformance):`, `feat(registry):`, `fix:`, `docs:`, `chore:`, `build:`)
- [ ] PR labeled `openwop-spec` if it touches `spec/v1/`, `api/`, `schemas/`, or `RFCS/`
- [ ] RFC comment window respected: additive = 7 days; safety-fix = 90 days or embargo; breaking = 30 days
- [ ] One-approval review (bootstrap rule); CODEOWNERS routes spec/conformance to lead maintainer
- [ ] Tripwire considered: vendor-neutral migration (`ROADMAP.md`) — has this PR moved the project closer to or further from the second-maintainer threshold?

## MEDIUM: Node-pack + agent-pack hygiene (per `node-packs.md`, `RFCS/0003`, `registry-operations.md`)

- [ ] New pack manifests validate against `node-pack-manifest.schema.json`
- [ ] Agent packs validate against `agent-manifest.schema.json`
- [ ] Pack signing recipe (Ed25519) preserved
- [ ] Registry HTTP API contract changes (if any) RFC'd
- [ ] Submission / validation / deprecation / yank / signing-key rotation flows unchanged unless RFC'd

## MEDIUM: Reference-host coherence

- [ ] Each touched host (`../openwop-examples/examples/hosts/in-memory`, `../openwop-examples/examples/hosts/sqlite`, `../openwop-examples/examples/hosts/python`) still passes the suite version it advertises
- [ ] Host `conformance.md` evidence file updated (suite version, command used, target URL class, pass/fail/skip counts) — no private deployment identifiers or secrets
- [ ] INTEROP-MATRIX row reflects the new advertised profile set honestly
- [ ] If host gained a new profile claim, evidence file confirms it; otherwise marked "Not claimed"

## MEDIUM: Multi-agent surface (RFCs 0002–0008)

- [ ] `AgentRef` wire shape unchanged unless RFC explicitly proposes it (`RFCS/0002`)
- [ ] Reasoning events (`agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`, `runOrchestrator.decided`) follow established envelope shape
- [ ] Agent packs (`RFCS/0003`) and memory layer (`RFCS/0004`) coherent
- [ ] Conversation (`RFCS/0005`), orchestrator (`RFCS/0006`), dispatch (`RFCS/0007`) integrations verified
- [ ] WASM ABI (`RFCS/0008`) — if change touches it, note Draft → Active gating

---

## LOW: Documentation surfacing

- [ ] README "Document index" table updated if a new spec doc landed
- [ ] CHANGELOG.md `[Unreleased]` line added
- [ ] ROADMAP entry added/updated if the change closes a known gap from `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`
- [ ] MAINTAINERS.md untouched unless governance change
- [ ] Site (under `../openwop-site/site/`) regenerates from spec corpus cleanly (only check if `../openwop-site/site/src/build.mjs` or templates changed)

## LOW: Release-readiness (only when bumping packages)

- [ ] `bash scripts/openwop-check-publish-metadata.sh` clean (no placeholder URLs, stale module paths)
- [ ] `bash scripts/check-npm-pack-contents.sh` clean (no package content leaks)
- [ ] `bash scripts/check-python-go-release-surface.sh` clean
- [ ] `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client` (PyPI), `github.com/openwop/openwop/sdk/go` version bumps follow `PUBLISHING.md`

---

## Quick Verification Commands

```bash
# One-shot full gate (mirrors .github/workflows/openwop-spec.yml)
npm run openwop:check

# Per-step:
( cd ../openwop-sdks/sdk/typescript && npx tsc --noEmit && npm test )
( cd conformance && npx tsc --noEmit && npx vitest run )
npx -y @redocly/cli@latest lint api/openapi.yaml
npx -y @asyncapi/cli@latest validate api/asyncapi.yaml
bash scripts/check-security-invariants.sh

# DCO check (every commit signed)
git log --no-merges -10 --format='%h %s%n%b' | grep -B1 'Signed-off-by:' | head -40

# RFC 2119 lowercase audit on changed prose
git diff --name-only | grep -E '^(spec/v1|RFCS)/.*\.md$' | xargs -I{} grep -nE '\b(must|should|may|must not|should not)\b' {} | grep -v 'MUST\|SHOULD\|MAY'
```

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/code-review` | Post-implementation technical review (banned patterns, schema/OpenAPI discipline) |
| `/architect` | Pre-implementation protocol-architect review (wire-shape, version negotiation, capability gating) |
| `/ux-review` | Prose readability + RFC 2119 + cross-link integrity |
| `/ts-check` | Root-cause analysis for tsc / ruff / go-vet errors |
| `/update-conformance` | Sync conformance scenarios / fixtures / coverage.md to a spec change |
| `/update-docs` | Sync README, CHANGELOG, INTEROP-MATRIX, RFC index |
| `/pr` | Create pull request with the right template |
