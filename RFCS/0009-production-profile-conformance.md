# RFC 0009: Production-Profile Conformance

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0009                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Title**         | Production-Profile Conformance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Created**       | 2026-05-11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Updated**       | 2026-05-12 (Active → Accepted: all 9 acceptance-criteria items satisfied — `capabilities.production` block landed in `schemas/capabilities.schema.json`, both new scenarios (`production-backpressure.test.ts` + `production-retention-expiry.test.ts`) land capability-gated, the four §D scenarios carry `production-profile.md` co-citations in their docstrings, `conformance/coverage.md` §"Capability-gated scenarios" lists all seven scenarios under `openwop-production`, Postgres reference host advertises `capabilities.production.supported: true` since 2026-05-11 and passes both new scenarios under `OPENWOP_REQUIRE_BEHAVIOR=true`, `INTEROP-MATRIX.md` Postgres row includes `openwop-production` in the compatibility-profile claim, and CHANGELOG records the Active landing. The four unresolved questions in §"Unresolved questions" remain open as documented and may be revisited as additive sub-RFCs without breaking v1 wire compatibility — their unresolved state is captured in `conformance/coverage.md`'s `A−` rating, not a blocker to acceptance.) |
| **Affects**       | `spec/v1/production-profile.md`, `schemas/capabilities.schema.json`, `conformance/src/scenarios/` (2 new + 4 re-labeled), `conformance/coverage.md`, `INTEROP-MATRIX.md`, `examples/hosts/postgres/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Summary

Convert `spec/v1/production-profile.md` from a host-side prose checklist into a mechanically verified set of conformance scenarios. Add a top-level `capabilities.production` advertisement block so hosts can opt into the suite, define two new conformance scenarios (`production-backpressure` and `production-retention-expiry`) for the predicates not yet covered, and re-label four existing scenarios so their assertions cite `production-profile.md` alongside their current spec references. `INTEROP-MATRIX.md` gains an `openwop-production` profile claim distinct from the existing operational "Claimed" prose so claims become falsifiable from CI alone.

## Motivation

`production-profile.md` lists six MUSTs (durability, backpressure, retry/idempotency, event retention, debug-bundle behavior, observability) and ends with a "Conformance gaps to close" table. As of 2026-05-11:

- The Postgres reference host advertises the profile (`INTEROP-MATRIX.md:15`: "Claimed (since 2026-05-11)") but no public scenario verifies the claim — the evidence is prose in `examples/hosts/postgres/conformance-full.md` plus host-internal `examples/hosts/postgres/test/backpressure.test.ts`. A second-host claimant would have nothing reproducible to point at.
- Three of the six predicates already have conformance scenarios that _don't_ cite `production-profile.md`: `restart-during-run.test.ts` cites `scale-profiles.md` / `storage-adapters.md`; `staleClaim.test.ts` likewise; `debug-bundle-truncation.test.ts` cites `debug-bundle.md`. They satisfy the predicates de facto but a future reviewer scanning for "production-profile coverage" finds nothing.
- Two predicates — the backpressure 503 envelope and event-retention expiry — have no public conformance coverage at all.

The cost of leaving this gap is concrete: the next external host (per `docs/recruitment/external-host.md`) cannot demonstrate a production-profile pass mechanically; the steward-published claim stays steward-published; the governance tripwire for vendor-neutral migration depends on third-party adoption of a claim that has no public verification path. This RFC closes the loop.

## Proposal

### §A Capability advertisement

Add a top-level `production` block to `capabilities.schema.json`. The block is optional in v1; absence means "host does not claim the production profile." When present, `supported: true` is the master switch; the four sub-blocks declare which sub-predicates the host has implemented well enough to be tested.

Schema diff (relative to `schemas/capabilities.schema.json`):

```diff
   "properties": {
     ...
     "compliance": { ... },
+    "production": {
+      "type": "object",
+      "description": "Production-profile advertisement (see production-profile.md). Optional in v1; absence means the host does not claim the profile. When `supported: true`, the host claims every MUST in production-profile.md and conformance scenarios gated on this block MUST run.",
+      "required": ["supported"],
+      "properties": {
+        "supported": {
+          "type": "boolean",
+          "description": "Host claims the openwop-production profile end-to-end."
+        },
+        "backpressure": {
+          "type": "object",
+          "description": "Backpressure envelope advertisement (production-profile.md §Backpressure).",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "inflightCap": {
+              "type": "integer",
+              "minimum": 1,
+              "description": "Optional host-side cap the conformance suite can saturate. When advertised, the suite issues `inflightCap + 1` concurrent long-lived requests to deterministically force a 503. When absent, the backpressure scenario soft-skips the saturation assertion (envelope assertion still runs if 503 happens to fire)."
+            },
+            "retryAfterSeconds": {
+              "type": "integer",
+              "minimum": 0,
+              "description": "Optional advertised Retry-After value (seconds) the host returns. When present, MUST equal the `Retry-After` header and `details.retryAfter` body field on emitted 503s."
+            }
+          },
+          "additionalProperties": false
+        },
+        "retention": {
+          "type": "object",
+          "description": "Event-retention advertisement (production-profile.md §\"Event retention\").",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "minWindowSeconds": {
+              "type": "integer",
+              "minimum": 604800,
+              "description": "Documented minimum retention window in seconds. Per production-profile.md §Event retention, MUST be ≥ 604800 (7 days) for public hosts."
+            },
+            "testForceExpire": {
+              "type": "boolean",
+              "description": "Host exposes a test-only force-expire hook (e.g., `POST /v1/admin/test/expire` gated on a test API key) the conformance suite can call. When `false`, the retention-expiry scenario asserts only the 410/404 envelope shape if expiry is reachable; otherwise it soft-skips."
+            }
+          },
+          "additionalProperties": false
+        },
+        "debugBundle": {
+          "type": "object",
+          "description": "Debug-bundle truncation advertisement (production-profile.md §\"Debug bundle behavior\"). When omitted, falls through to the existing `capabilities.debugBundle.supported` check from debug-bundle.md.",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "truncationMetadata": {
+              "type": "boolean",
+              "description": "Host MUST surface `truncated: true` + non-empty `truncatedReason` per debug-bundle.md §\"Bundle size limits\"."
+            }
+          },
+          "additionalProperties": false
+        }
+      },
+      "additionalProperties": false
+    }
   }
```

Positive example (Postgres reference host after this RFC lands):

```json
"production": {
  "supported": true,
  "backpressure": { "supported": true, "inflightCap": 2, "retryAfterSeconds": 1 },
  "retention": { "supported": true, "minWindowSeconds": 604800, "testForceExpire": true },
  "debugBundle": { "supported": true, "truncationMetadata": true }
}
```

Negative example (in-memory reference host — does not claim the profile, block absent entirely; production scenarios skip with `behaviorGate('openwop-production', false)`).

### §B New scenario: `production-backpressure.test.ts`

Asserts the `503` envelope contract from `production-profile.md` §Backpressure. Pattern follows `audit-log-integrity.test.ts`.

- **Gating:** `behaviorGate('openwop-production', capabilities.production?.supported === true && capabilities.production?.backpressure?.supported === true)`.
- **Forcing 503:** when `capabilities.production.backpressure.inflightCap` is advertised, the suite issues `inflightCap + 1` concurrent long-lived requests (SSE streams against in-flight runs, matching the Postgres host's internal test pattern). When absent, the suite skips the saturation step and runs only opportunistic-503 envelope checks.
- **Assertions when 503 fires:**
  - Status code `503`.
  - `Retry-After` header present, non-empty.
  - Body matches `{error: "service_unavailable", message: string, details: {retryAfter: <integer seconds>}}`.
  - `details.retryAfter` equals the `Retry-After` header (per `production-profile.md` line 50).
  - When `capabilities.production.backpressure.retryAfterSeconds` is advertised, both equal that advertised value.
- **Discovery exemption:** the scenario also verifies `GET /.well-known/openwop` returns `200` while inflight is saturated (the Postgres host's internal test demonstrates this is a real production requirement — health probes MUST NOT be subject to the cap).

### §C New scenario: `production-retention-expiry.test.ts`

Asserts the `410`/`404` envelope contract from `production-profile.md` §"Event retention".

- **Gating:** `behaviorGate('openwop-production', capabilities.production?.supported === true && capabilities.production?.retention?.supported === true)`.
- **Forcing expiry:** when `capabilities.production.retention.testForceExpire === true`, the suite POSTs to a host-defined force-expire test endpoint to evict a recently-created run. When absent, the scenario soft-skips the active-expiry path and asserts only the envelope shape _if_ an already-expired runId is supplied via `OPENWOP_TEST_EXPIRED_RUN_ID`.
- **Assertions:**
  - `GET /v1/runs/{expiredRunId}` returns `404` or `410` (host's choice per spec; `410` SHOULD be preferred when expiry is known and intentional).
  - Response body matches the canonical error envelope: `{error: string, message: string, details?: object}`.
  - When `410`, `details.expiredAt` is RECOMMENDED but not required.
- **No test endpoint contract is normated by this RFC** — the force-expire hook is host-private. The capability bit advertises that the hook exists; the suite reads its URL/method from `OPENWOP_TEST_FORCE_EXPIRE_URL` / `OPENWOP_TEST_FORCE_EXPIRE_METHOD` env vars supplied by the operator. This keeps the wire contract clean while letting hosts opt in.

### §D Re-labeling: existing scenarios cite `production-profile.md`

Five existing scenarios already exercise production-profile predicates. They keep their current spec citations and add `production-profile.md` as a co-citation:

| Scenario                          | Current citation                                                                     | Add citation                                     |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `restart-during-run.test.ts`      | `scale-profiles.md` §"Replay semantics" + `storage-adapters.md` §"Claim acquisition" | `production-profile.md` §Durability              |
| `staleClaim.test.ts`              | `storage-adapters.md` §"Claim acquisition"                                           | `production-profile.md` §Durability              |
| `debug-bundle-truncation.test.ts` | `debug-bundle.md` §"Bundle size limits"                                              | `production-profile.md` §"Debug bundle behavior" |
| `idempotency.test.ts`             | `idempotency.md` §"Layer 1"                                                          | `production-profile.md` §"Retry and idempotency" |
| `idempotencyRetry.test.ts`        | `idempotency.md`                                                                     | `production-profile.md` §"Retry and idempotency" |

This is a pure docstring + `driver.describe(...)` argument update — no behavioral change.

### §E Coverage table

`conformance/coverage.md` §"Capability-gated scenarios" gains a row for `openwop-production` listing the seven scenarios (2 new + 5 re-labeled) and their gating predicates.

### §F INTEROP-MATRIX claim

`INTEROP-MATRIX.md` gains an `openwop-production` profile entry in the Postgres row's "Compatibility profile claim" column once the new scenarios pass. The existing "Production profile claim" column ("Claimed (since 2026-05-11)") keeps its operational-readiness meaning; the new profile entry is the mechanical conformance pass.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- New `capabilities.production` block is optional; absence preserves v1.0 behavior. Existing required fields unchanged.
- New scenarios are capability-gated; v1.0 hosts that don't advertise the profile skip cleanly.
- Re-labeled scenarios add citations without changing assertion semantics — existing v1.0 conformance passes remain valid.
- No new error codes; the `503` envelope and `410 Gone` are already-normated v1 wire shapes (`production-profile.md` §Backpressure and §"Event retention").

## Conformance

Existing scenarios that cover this surface (de facto): `restart-during-run.test.ts`, `staleClaim.test.ts`, `debug-bundle-truncation.test.ts`, `idempotency.test.ts`, `idempotencyRetry.test.ts`.

New scenarios required by this RFC:

1. `conformance/src/scenarios/production-backpressure.test.ts` — §B above.
2. `conformance/src/scenarios/production-retention-expiry.test.ts` — §C above.

Both new scenarios are capability-gated on `capabilities.production.supported === true`. Behavior-required mode (`OPENWOP_REQUIRE_BEHAVIOR=true`) converts capability-shape-only skips into hard failures, per the existing `audit-log-integrity` precedent.

## Alternatives considered

1. **Bake the predicates into each area's existing capability block** (e.g., `capabilities.storage.retention.*`, `capabilities.debugBundle.truncationMetadata`). Rejected: the production-profile claim becomes scattered across six blocks. Operators auditing a host can no longer answer "does this host claim production?" with a single field read. A single `capabilities.production.supported` boolean is the operator-facing UX win.

2. **Wait for a second host implementation before defining the capability shape.** Rejected: chicken-and-egg with the recruitment goal in `docs/recruitment/external-host.md`. External candidates need a mechanically verifiable target before they invest in implementing the profile. The Postgres reference host's existing in-process test (`examples/hosts/postgres/test/backpressure.test.ts`) already validates the envelope shape; lifting it into a conformance scenario costs little.

3. **Make production scenarios unconditional.** Rejected: the in-memory reference host (`examples/hosts/in-memory/`) cannot satisfy `production-profile.md` §Durability by design (it claims `minimal` scale, no durability). Forcing unconditional scenarios breaks `openwop-core` for minimal hosts. Capability gating is the established precedent (`audit-log-integrity`, all four interrupt-profile scenarios, every `cap.*` test).

4. **Do nothing.** Rejected: the `INTEROP-MATRIX.md` Postgres row already advertises "Claimed (since 2026-05-11)" with no public scenario. Each day this gap stays open, the protocol's production claim is steward-attested rather than CI-attested.

## Unresolved questions

All four open questions resolved 2026-05-12 (Phase B close-out). Resolutions ratified by steward decision per `CONTRIBUTING.md` §"Bootstrap-phase notes"; future maintainers MAY re-open via amendment RFC.

1. **Force-expire hook normation.** ✅ **RESOLVED: stay host-private, env-var driven.** The §C "host-private + env-var" pattern is the canonical opt-in for invasive test hooks across the conformance suite (`OPENWOP_RUN_RESTART_DURING_RUN`, `OPENWOP_TEST_MTLS`, `OPENWOP_TEST_OAUTH_ISSUER_TRUSTED`). Normating a `/v1/admin/test/expire/{runId}` endpoint would force every host to either expose a destructive operation in production (auth-gating fixable but adds attack surface) or implement a build-time flag (which is what the env-var pattern already encodes more flexibly). Operators wire `OPENWOP_TEST_FORCE_EXPIRE_URL` to whatever endpoint their host exposes; the suite emits no normative requirement on the endpoint shape. Recorded in `production-retention-expiry.test.ts` §"Active expiry path".

2. **Retry-After value range.** ✅ **RESOLVED: cap at 86400 seconds (24h).** `Retry-After` values above 24h are operationally indistinguishable from "permanently denied" — clients treat them as failures rather than retry hints. Cap added to `production-profile.md` §Backpressure: "When the host advertises `retryAfterSeconds` on the production block, the value MUST be in `[0, 86400]`. Hosts that legitimately need longer holds SHOULD return `503` with NO `Retry-After` header — the absence signals 'unknown, retry per client policy'." Schema-level enforcement: `production.backpressure.retryAfterSeconds.maximum: 86400` in `capabilities.schema.json`.

3. **Inflight cap discoverability vs. probing.** ✅ **RESOLVED: advertised cap is normative; probing is OPTIONAL fallback.** Per `production-backpressure.test.ts`, the suite reads `capabilities.production.backpressure.inflightCap` and saturates accordingly. Hosts that don't advertise the cap soft-skip the saturation assertion; clients SHOULD NOT probe via Little's Law against production hosts (resource-burning, brittle). Hosts that genuinely have no fixed cap (autoscaled deployments) MAY omit `inflightCap` and the saturation test soft-skips. The §A schema's `inflightCap` field stays optional; recommended for hosts wanting CI-verifiable backpressure claims.

4. **Postgres host advertisement update.** ✅ **RESOLVED: same-commit policy.** The host advertisement (`production.supported: true`) and the conformance scenario landing MUST be in the same release. This was followed for the Postgres reference host (`feat(host-postgres): RFC 0009 Active + production-profile behavior-mode pass`, 2026-05-11). General rule for future profile-claimant hosts: discovery payload + INTEROP-MATRIX row + conformance evidence land in one PR. Standalone advertisement-without-conformance is the over-claim anti-pattern that the Phase A senior-review pass surfaced and remediated.

## Implementation notes (non-normative)

- Suite version bump: `@openwop/openwop-conformance` `1.X.0` (next available minor after current `1.0`). Per `ROADMAP.md` line 24, conformance minors do not modify the wire contract; this RFC strictly adds optional capability fields.
- No SDK changes required — none of the wire shapes in §A–§C are SDK-side; the schema diff is server-advertised.
- `examples/hosts/postgres/` will need:
  - `/.well-known/openwop` to emit the new `production` block (≤ 20 LOC).
  - Optional test force-expire endpoint (if §C ships with `testForceExpire: true`).
- `examples/hosts/in-memory/` and `examples/hosts/sqlite/` need no change — they don't advertise the profile and the new scenarios skip.
- `INTEROP-MATRIX.md` update happens after the scenarios land and the Postgres host passes them.

## Acceptance criteria

- [ ] `RFCS/0009-production-profile-conformance.md` merged at `Status: Active` after the 7-day comment window.
- [ ] `schemas/capabilities.schema.json` includes the `production` block per §A.
- [ ] `conformance/src/scenarios/production-backpressure.test.ts` lands and is capability-gated.
- [ ] `conformance/src/scenarios/production-retention-expiry.test.ts` lands and is capability-gated.
- [ ] The four scenarios in §D add `production-profile.md` co-citations.
- [ ] `conformance/coverage.md` §"Capability-gated scenarios" lists the seven scenarios under `openwop-production`.
- [ ] Postgres reference host advertises `production.supported: true` and passes both new scenarios under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- [ ] `INTEROP-MATRIX.md` Postgres row's compatibility-profile column includes `openwop-production`.
- [ ] `CHANGELOG.md` entry under the relevant version.

## References

- `spec/v1/production-profile.md` — the prose this RFC mechanizes.
- `spec/v1/auth-profiles.md` §"Audit-log integrity" — the worked-example pattern (`profiles[]` + behavior block + `behaviorGate`).
- `conformance/src/scenarios/audit-log-integrity.test.ts` — capability-shape + behavior-mode reference.
- `examples/hosts/postgres/test/backpressure.test.ts` — host-internal precedent for the 503 envelope.
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 8 — the planning context.
- `ROADMAP.md` v1.X protocol gap closure queue — the delivery context.
