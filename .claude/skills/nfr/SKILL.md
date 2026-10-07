---
name: nfr
description: Non-functional requirements checklist for openwop changes. Verifies spec hygiene (RFC 2119, Status, schema discipline), wire-shape compatibility, capability gating, conformance coverage, governance (DCO, RFC window, CHANGELOG), SECURITY invariants, BYOK + replay invariants, and INTEROP-MATRIX honesty before merge.
---

# Non-Functional Requirements Checklist (openwop)

Use this checklist to verify a change meets every non-functional requirement before merging. Items are grouped by severity. Each item cites the spec doc that defines the requirement so failure messages can point at the contract.

---

## CRITICAL: Compatibility (per `COMPATIBILITY.md`)

- [ ] Change is classified in PR body: **additive** / **safety-fix** / **breaking**
- [ ] If additive (§2.1, §2.4): new fields are optional; adding an OPTIONAL property to a closed v2 object is additive; new event types declared as opt-in
- [ ] If safety-fix (§3): RFC filed with 90-day public window OR embargoed disclosure per `SECURITY.md`; ships with migration tooling; `CHANGELOG.md` `### Security` entry cites the advisory ID
- [ ] If breaking (a new REQUIRED property, opening/closing an object, narrowing a type): waits for the next major; not in this PR
- [ ] No existing required field made optional, removed, or type-changed (§2.2)
- [ ] No existing event-type shape changed (§2.2)
- [ ] No existing endpoint contract changed (§2.2; additive optional fields aside)
- [ ] No existing `MUST` requirement relaxed (§2.2)
- [ ] No existing error code or HTTP status meaning changed (§2.2)
- [ ] Any v2 surface retirement follows `COMPATIBILITY.md` §3a and `spec/v2/core/overview.md` §0a
- [ ] `spec/v1/` untouched (frozen tree; v1 reached end of support by RFC 0234)

## CRITICAL: SECURITY invariants (per `SECURITY/invariants.yaml`)

- [ ] `bash scripts/check-security-invariants.sh` passes — every protocol-tier MUST-NOT has at least one matching public test
- [ ] If the change introduces a new MUST-NOT, the invariant row (with a `witness` class) + at least one `conformance/src/scenarios/` test land in the same PR
- [ ] BYOK credential material never appears in event payloads, debug bundles, webhook deliveries, or RBAC-readable logs (`spec/v2/core/identity.md`, `spec/v2/core/security-defaults.md`, `SECURITY/threat-model-secret-leakage.md`)
- [ ] Cross-tenant isolation holds (`spec/v2/core/storage.md`, `spec/v2/core/persistence.md`)
- [ ] New surface covered by the obligation table in `spec/v2/core/security-defaults.md`
- [ ] Threat-model docs updated where the threat surface shifts (`SECURITY/threat-model-*.md`)

## CRITICAL: Replay + fork safety (per `spec/v2/core/replay.md`)

- [ ] New event records include all non-deterministic state in their payload — no regenerated timestamps, IDs, or local clocks at fork time
- [ ] `POST /runs/{runId}:fork` against historical checkpoints unchanged in behavior
- [ ] New side effects are suppressed on a replay fork, not re-fired

---

## HIGH: Spec corpus hygiene (per `CONTRIBUTING.md`)

### Prose specs (`spec/v2/core/*.md`, `spec/v2/ext/`, `RFCS/*.md`)
- [ ] Core docs carry the `> **Status: …**` banner and a "Why this exists" section
- [ ] RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT) used consistently — no lowercase "should" / "must" as normative imperative
- [ ] Every new MUST has a witness class and a requirement id (`spec/v2/core/conformance.md`)
- [ ] The rule lives in the core doc that owns it; an RFC does not restate it
- [ ] Cross-references use relative paths that resolve
- [ ] `node scripts/check-spec-readability.mjs` and `node scripts/check-core-budget.mjs` pass (v2 prose renders verbatim on openwop.dev)
- [ ] No inline JSON Schemas — schemas live under `schemas/v2/` with `$ref`s

### JSON Schemas (`schemas/v2/*.schema.json`)
- [ ] `"$schema": "https://json-schema.org/draft/2020-12/schema"`
- [ ] `"$id": "https://openwop.dev/spec/v2/<name>.schema.json"`
- [ ] Every object has `"additionalProperties": false`
- [ ] Required fields listed explicitly
- [ ] `schemas/v2/capabilities.schema.json` not hand-edited — it is generated from `spec/v2/declaration.json` + `spec/v2/facets/` by `scripts/generate-from-declaration.mjs`
- [ ] `node scripts/check-v2-schemas.mjs` and `node scripts/derive-v2-schemas.mjs --check` pass (never run `derive-v2-schemas.mjs --write`)
- [ ] At least one positive + one negative example per RFC template requirement (where added by RFC)

### OpenAPI + AsyncAPI
- [ ] Edits made to the source (`api/openapi.yaml`, or the inline seams in `scripts/derive-v2-api.py`), then `api/v2/` regenerated — never a hand edit to `api/v2/openapi.yaml` / `api/v2/asyncapi.yaml`
- [ ] `python3 scripts/derive-v2-api.py --check` clean
- [ ] Redocly and AsyncAPI clean at the versions `scripts/openwop-check.sh` pins (`@redocly/cli@2.31.4`, `@asyncapi/cli@4.1.1`)
- [ ] `node scripts/check-path-parity.mjs` clean; new operations appear in `spec/v2/path-manifest.json`
- [ ] New endpoint: `tag`, `operationId`, request/response schemas, ≥1 error response
- [ ] New AsyncAPI channel: message-name + payload schema reference; security scheme inherited

## HIGH: Conformance coverage (per `conformance/coverage.md`)

- [ ] Each new v2 scenario is `conformance/src/scenarios/v2-*.test.ts` and opens with a docstring naming the `spec/v2` doc(s) verified
- [ ] `conformance/scenario-majors.json` regenerated (`node conformance/scripts/generate-scenario-majors.mjs --write`); a file with no row never runs
- [ ] Assertions use `req(id, section, requirement)` as the message; one explicit requirement id per `it` (`node scripts/check-req-only.mjs`)
- [ ] No bare `return` in an `it` body — `return softSkip(kind, reason)`
- [ ] New fixtures in `conformance/fixtures/` AND added to `fixtures.md` catalog table + per-fixture contracts
- [ ] `src/coherence/spec-corpus-validity.test.ts` and `fixtures-valid.test.ts` pass
- [ ] Family-gated scenarios gate on the record's presence (no `.supported` seat at v2) per `conformance/coverage.md` §"Capability-gated scenarios"
- [ ] `conformance/coverage.md` coverage table updated

## HIGH: SDK impact

- [ ] SDKs live in `openwop/openwop-sdks`. If the change adds an endpoint, event or type to `api/v2/`, the PR says so and an issue is filed there

## HIGH: Capability + profile coherence

- [ ] New optional surface is a family row in `spec/v2/declaration.json` with its facet in `spec/v2/facets/`, and carries a `witness` class
- [ ] Discovery caching stays standard `ETag` / `If-None-Match` (`spec/v2/core/capabilities.md` §1.1)
- [ ] If a new profile is introduced, its predicate is in the declaration (`spec/v2/profiles.json` is generated)
- [ ] INTEROP-MATRIX rows updated for any host whose certified claim changes
- [ ] Production-profile claim kept honest — operational evidence, not discovery-payload predicates (`spec/v2/core/conformance.md` §"Production profile")

## HIGH: Observability coherence

- [ ] New spans, events, metric kinds stay under the canonical `openwop.*` namespace
- [ ] Vendor-host extensions stay under `extensions.<org>.<name>`, never `openwop.*`

## HIGH: Signed webhooks (per `spec/v2/core/webhooks.md`)

- [ ] `OpenWOP-Timestamp` / `OpenWOP-Signature` HMAC-SHA256 signing recipe unchanged
- [ ] Durable delivery and circuit-breaker semantics unchanged unless RFC'd

## HIGH: Idempotency (per `spec/v2/core/idempotency.md`)

- [ ] New write endpoints accept `Idempotency-Key`
- [ ] Effect-identity collapse rules apply

## HIGH: Versioning (per `spec/v2/core/versioning.md`)

- [ ] New operations use unversioned paths (no `/v1/`, no `/v2/` path space)
- [ ] `OpenWOP-Version` header handling unchanged (it selects the major of the `/.well-known/openwop` representation)

---

## MEDIUM: Governance (per `GOVERNANCE.md`, `CONTRIBUTING.md`, `RFCS/README.md`)

- [ ] Every commit on the PR carries `Signed-off-by:` trailer (DCO bot blocks merge otherwise)
- [ ] Conventional Commit prefix matches the lane (`spec(X.Y.Z):`, `rfc(NNNN):`, `conformance(X.Y.Z):`, `errata(<doc or X.Y.Z>):`, `release(X.Y.Z):`, `fix:`, `docs(<area>):`, `chore:`, `build:`)
- [ ] PR labeled `openwop-spec` if it touches `spec/`, `api/`, `schemas/`, or `RFCS/`
- [ ] RFC comment window respected: normative addition = 7 days; breaking = 30 days; safety-fix = 90 days or embargo; any waiver recorded in the RFC's `Updated` field
- [ ] CODEOWNERS review obtained

## MEDIUM: Pack hygiene (per `spec/v2/core/packs.md`)

- [ ] New pack manifests validate against their manifest schema
- [ ] Pack signing recipe (Ed25519) preserved
- [ ] Registry contract changes (if any) RFC'd; the registry itself lives in `openwop/openwop-registry`

## MEDIUM: Host evidence honesty

- [ ] Committed bundles in `evidence/v2-host-bundles/` still back every INTEROP-MATRIX claim the change affects
- [ ] A changed claim gets a re-cut bundle or a downgraded row — never an edited count

---

## LOW: Documentation surfacing

- [ ] README "Document index" table updated if a new core doc landed
- [ ] CHANGELOG.md `[Unreleased]` line added (one short entry per change; `node scripts/check-changelog-shape.mjs`)
- [ ] ROADMAP updated if the change closes a tracked gap
- [ ] MAINTAINERS.md untouched unless governance change

## LOW: Release-readiness (only when bumping packages)

- [ ] `bash scripts/openwop-check-publish-metadata.sh` clean
- [ ] `bash scripts/check-npm-pack-contents.sh` clean
- [ ] `@openwop/openwop-conformance` and `@openwop/spec-artifacts` bumped together per `PUBLISHING.md` (the `/release` skill lists every version site)

---

## Quick Verification Commands

```bash
# Regen chain — run once, immediately before the gate, whenever a source of a generated surface changed
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write

# Full gate (scripts/openwop-check.sh, 10 steps; mirrors .github/workflows/openwop-spec.yml)
npm run openwop:check

# Fast pieces:
( cd conformance && npm run typecheck && npm run test:self )
node scripts/check-req-only.mjs
bash scripts/check-security-invariants.sh

# DCO check (every commit signed)
git log --no-merges -10 --format='%h %s%n%b' | grep -B1 'Signed-off-by:' | head -40

# RFC 2119 lowercase audit on changed prose
git diff --name-only | grep -E '^(spec/v2|RFCS)/.*\.md$' | xargs -I{} grep -nE '\b(must|should|may|must not|should not)\b' {} | grep -v 'MUST\|SHOULD\|MAY'
```

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/code-review` | Post-implementation technical review (banned patterns, schema/OpenAPI discipline) |
| `/architect` | Pre-implementation protocol-architect review (wire-shape, version negotiation, capability gating) |
| `/ux-review` | Prose readability + RFC 2119 + cross-link integrity |
| `/ts-check` | Root-cause analysis for typecheck and lint errors in this repo |
| `/update-conformance` | Sync conformance scenarios / fixtures / coverage.md to a spec change |
| `/update-docs` | Sync README, CHANGELOG, INTEROP-MATRIX, RFC index |
| `/pr` | Create pull request with the right template |
