# RFC 0034: OTel collector test seam + secret-leakage invariant promotion

| Field | Value |
|---|---|
| **RFC** | 0034 |
| **Title** | OTel collector test seam + secret-leakage invariant promotion |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-21 |
| **Updated** | 2026-05-21 (Draft → Active same-day: schema additions to `capabilities.observability.testSeams` landed; spec/v1/observability.md §"OTel collector test seam" added; SECURITY/invariants.yaml graduates `secret-leakage-otel-attribute` + `secret-leakage-debug-bundle-otel` from `reference-impl` to `protocol` tier; conformance scenario `envelope-reasoning-secret-redaction.test.ts` tightens soft-skip to capability-gating. Path to `Accepted`: reference workflow-engine advertises the two seams + the scenario passes against it. The two SECURITY rows' `tests:` field now points at the live scenario; `check-security-invariants.sh` enforces non-empty test coverage on every protocol-tier row.) |
| **Affects** | `spec/v1/observability.md` (adds §"OTel collector test seam") · `schemas/capabilities.schema.json` (adds `capabilities.observability.testSeams`) · `SECURITY/invariants.yaml` (promotes `secret-leakage-otel-attribute` + `secret-leakage-debug-bundle-otel` from `reference-impl` to `protocol` tier) · `conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts` (drops soft-skip on HTTP 404; gates on the new capability instead) · reference hosts (`examples/hosts/postgres/`) · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Define a normative host-extension test seam — `POST /v1/host/sample/test/otel/spans` and `POST /v1/host/sample/test/debug-bundle/export` — so cross-host conformance scenarios can mechanically verify that BYOK canaries don't leak into OTel span attributes or debug-bundle exports. Today the two corresponding `SECURITY/invariants.yaml` rows (`secret-leakage-otel-attribute`, `secret-leakage-debug-bundle-otel`) carry `tier: reference-impl` with `non_testability_rationale` because no cross-host seam exists; this RFC closes that gap and graduates both invariants to `tier: protocol`.

## Motivation

Per `docs/KNOWN-LIMITS.md:30-31` and the external standards-readiness review of 2026-05-21, "the conformance OTel collector seam doesn't yet inspect span attributes; a host could pass conformance while leaking BYOK material on telemetry exports." This is a real production-scale credibility gap — every production deployment ships OTel telemetry, and the spec's `SR-1 secret-redaction invariant` (`agent-memory.md` §"SR-1") + `envelope-reasoning-secret-redaction` invariant cannot be cross-host verified without an introspection seam.

The envelope-reasoning-secret-redaction conformance scenario already exists (`conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts`) with live behavioral OTel + debug-bundle assertions — but they soft-skip on HTTP 404 because the seams are not normatively specified. This RFC formalizes the seams so the soft-skip becomes capability-gated (hosts that advertise opt in; hosts that don't are honest about not implementing).

## Proposal

### §A — `capabilities.observability.testSeams` block (normative)

Add to `schemas/capabilities.schema.json` under `capabilities.observability`:

```diff
   "observability": {
     "type": "object",
+    "properties": {
+      "testSeams": {
+        "type": "object",
+        "additionalProperties": false,
+        "properties": {
+          "otelScrape": {
+            "type": "boolean",
+            "description": "Host exposes POST /v1/host/sample/test/otel/spans returning the host's accumulated OTel span buffer scoped to a runId. Conformance scenarios use this to verify span attributes don't carry BYOK canaries. The endpoint is conformance-only (host-extension namespace); production deployments SHOULD return 404 or 403."
+          },
+          "debugBundleExport": {
+            "type": "boolean",
+            "description": "Host exposes POST /v1/host/sample/test/debug-bundle/export returning the host's debug-bundle for a runId. Conformance scenarios use this to verify the bundle's serialized form doesn't carry BYOK canaries. Conformance-only."
+          }
+        }
+      }
+    }
   }
```

### §B — Seam contract (normative)

`GET /v1/host/sample/test/otel/spans?runId=<id>` MUST return `200 OK` with a JSON body `{ spans: Array<{ name, attributes, events }> }`. The spans array MUST include every OTel span produced by the host's instrumentation for the named run, including any `openwop.*`-prefixed attributes added to span context. Hosts MAY redact span content using the canonical `[REDACTED:<secretId>]` marker per `agent-memory.md` §SR-1 — that's the contract being tested. The seam additionally accepts optional `envelopeId` and `name` query parameters for narrower introspection; hosts that implement the seam MAY honor these filters but MUST honor the `runId` scope at minimum.

`POST /v1/host/sample/test/debug-bundle/export` MUST return `200 OK` with body `{ bundle: { runId, events, spans, exportedAt } }` mirroring the payload of `GET /v1/runs/{runId}/debug-bundle` per `spec/v1/debug-bundle.md` (the wrapping `bundle` envelope makes the seam-versus-real-endpoint origin explicit). The request body MUST be `{ runId: string }`; the seam returns `400 invalid_argument` when `runId` is absent or empty. The seam exists to give conformance scenarios a synchronous endpoint they can hit without first triggering an interrupt → debug bundle workflow.

Both seams live under the `host-extensions.md` canonical-prefix `/v1/host/sample/test/*` and are NOT part of the v1 wire surface. Production hosts SHOULD return 404 or 403 from the seam unless `OPENWOP_TEST_OTEL_SCRAPE=true` (or equivalent env-gate) is set.

### §C — SECURITY invariant promotion

`SECURITY/invariants.yaml` flips two rows from `tier: reference-impl` to `tier: protocol`:

- `secret-leakage-otel-attribute` — paired with `envelope-reasoning-secret-redaction.test.ts` §"OTel-attribute scrape" assertion. Public test glob: `conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts`.
- `secret-leakage-debug-bundle-otel` — paired with the same scenario's §"debug-bundle export" assertion.

Remove the `non_testability_rationale` field from both rows; populate the existing `tests:` field with the scenario file path glob (the `tests:` key is the canonical home for public-test references per `SECURITY/invariants.yaml`'s schema — 95 existing occurrences across protocol-tier and reference-impl-tier rows).

### §D — Conformance scenario tightening

`conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts` — the two `it()` blocks inside the `describe('envelope-reasoning-secret-redaction: downstream-projection paths (RFC 0030 §E)', …)` block (the OTel-attribute scrape assertion and the debug-bundle-export assertion) currently soft-skip on `spansRes.status === 404` / `bundleRes.status === 404`. With this RFC, the soft-skip becomes capability-gated:

```diff
-    if (spansRes.status === 404) return; // host doesn't expose the OTel scrape seam
+    // Gate on capability — if host advertises otelScrape but the seam returns 404, that's a failure.
+    if (!capabilities.observability?.testSeams?.otelScrape) return;
+    expect(spansRes.status, 'host advertising otelScrape MUST serve the seam').toBe(200);
```

Hosts that don't advertise the seam continue to soft-skip honestly (the existing posture). Hosts that DO advertise it MUST serve a valid response.

## Compatibility

**Additive.** No existing endpoint changes; no required fields added to any existing schema. The new `capabilities.observability.testSeams` block is optional; hosts that omit it advertise no test-seam claim and conformance scenarios soft-skip exactly as today.

The SECURITY invariant tier-promotion is technically a strengthening of conformance requirements — but only for hosts that advertise the new capability. Hosts that don't advertise remain in their current "reference-impl-tier passes via host CI" posture.

## Conformance

- Existing scenario `envelope-reasoning-secret-redaction.test.ts` graduates 2 soft-skip blocks to capability-gated assertions.
- No new scenarios needed.
- `npm run openwop:check`'s `check-security-invariants` step continues to enforce the public-test-glob requirement for every protocol-tier invariant; the two newly-promoted rows must include the glob.

## Alternatives considered

1. **Don't promote the invariants.** Rejected — leaves the standards-readiness gap open. The reviewer's specific framing was "a host could pass conformance while leaking BYOK material on telemetry exports."
2. **Add a generic `/v1/test/otel` seam at the v1 wire surface.** Rejected — test seams don't belong in the protocol wire surface per `host-extensions.md` §"Canonical prefixes." The `host-extension` namespace is the right home.
3. **Standardize OTel collector configuration (e.g., a normative `OPENWOP_OTEL_EXPORTER_*` env-var set).** Rejected — overlaps OpenTelemetry's own spec authority; OpenWOP shouldn't normate how hosts wire their collector.

## Unresolved questions

1. **Should the seams support `streamId`-scoped queries?** Per-stream isolation would let conformance scenarios verify cross-stream isolation. Deferred — the runId scope is sufficient for SR-1; cross-stream isolation belongs in a separate `STD-X` track.
2. **Should debug-bundle export carry a freshness gate?** A host that returns stale buffers could mask leakage windows. Recommend an `as-of: <ISO 8601 ts>` field; deferred until reference-host implementation exposes a natural freshness signal.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `schemas/capabilities.schema.json` updated with the `observability.testSeams` block per §A.
- [ ] `spec/v1/observability.md` updated with a new §"OTel collector test seam" section citing this RFC.
- [ ] `SECURITY/invariants.yaml` updated per §C; both rows pass the `check-security-invariants` glob check.
- [ ] `conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts` tightened per §D.
- [ ] At least one reference host (Postgres, in-memory, or new) implements both seams + advertises the capability.
- [ ] `INTEROP-MATRIX.md` updated with the new advertisement on that host's row.
- [ ] CHANGELOG entry under `[Unreleased]`.

Path to `Active → Accepted`: a non-steward host advertises the new capability and the scenario passes against it. Per RFCs/0001 §"Promotion to Accepted."

## References

- `docs/KNOWN-LIMITS.md` §"Behavior tests too coarse to fully prove an invariant" (the two invariants this RFC graduates)
- `spec/v1/agent-memory.md` §"SR-1 secret-redaction invariant"
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` §E (envelope-reasoning-secret-redaction invariant)
- `spec/v1/observability.md` (the doc this RFC extends)
- `spec/v1/host-extensions.md` §"Canonical prefixes" (the namespace home for the new seams)
- `spec/v1/debug-bundle.md` (the parent shape of the debug-bundle export)
- External standards-readiness review 2026-05-21 — finding (5) "Security posture insufficient — no telemetry redaction conformance"
