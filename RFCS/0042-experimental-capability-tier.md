# RFC 0042: Experimental capability tier

| Field | Value |
|---|---|
| **RFC** | 0042 |
| **Title** | Experimental capability tier — optional `tier` field on capability advertisements + sunset rule + derived `openwop-experimental` profile |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-22 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated as a **steward-side mechanism-codification with an AMENDED acceptance criterion** (the RFC 0069 precedent — a corpus-level mechanism with nothing behavioral for a non-steward host to advertise — composed with the RFC 0054 / 0080 amended-criterion precedent for deterministic, non-security, read-only metadata). **Architect-gated decision; David-confirmed.** RFC 0042 is a *stability-signaling convention*, not a behavioral capability: its guarantee decomposes entirely into (a) the schema `tier` enum + conditional-required `experimentalUntil` (`capabilities.schema.json`), (b) the deterministic `experimentalGate()` helper (soft-skip under default mode / strict under `OPENWOP_REQUIRE_EXPERIMENTAL=true`, `conformance/src/lib/behavior-gate.ts`), (c) the always-on server-free `experimental-tier-shape` §A shape group + the §C `openwop-experimental` derived profile prose — all green on `main`. There is **no host-side logic**: a host "exercising" 0042 merely writes the string `"tier":"experimental"` into its discovery JSON, which proves nothing the schema does not already guarantee well-formed, and the soft-skip it triggers is the helper's deterministic branch, not host behavior — so the live "advertise `tier:experimental`" direction is **mechanically-equivalent-by-construction** to the schema+helper. Moreover, the only honest way to make it non-vacuous would require a host to mark a *stable, Accepted-RFC-backed* capability `experimental` — an **active false-stability signal on the live wire** that the honest-advertisement invariant (the same one behind RFC 0080's degraded keystone) forbids; the non-steward adopter MyndHyve correctly **refused to fabricate** one (its `multiAgent.executionModel` is `version:5`, stable, every constituent RFC Accepted). The field is genuinely exercised the first time a host honestly has an `Active`-RFC-preview capability to mark — a real future event, never a fabricated one. **Honest disclosure:** the schema currently anchors `tier`/`experimentalUntil` ONLY on `multiAgent.executionModel`; every other capability sub-block keeps `additionalProperties:false` with no `tier` property and would reject one today, so §A's "every capability advertisement" is wire-enabled incrementally per the §"Per-RFC application" SHOULD — generalizing the schema is clean additive follow-up, not a graduation blocker. · 2026-05-29 (`Draft → Active` — steward acceptance, comment window waived per GOVERNANCE.md lazy consensus. Wire surface **reconciled**: §A/§B/§D normative prose landed in `capabilities.md` §"Capability stability tier" + §C `openwop-experimental` profile in `profiles.md`; the schema `tier`/`experimentalUntil` on `multiAgent.executionModel`, the `experimental-tier-shape` conformance scenario, the `experimentalGate` helper, and the INTEROP column were already on `main` — landed incidentally under commit `45678c49`, not a 0042 PR — and are now backed by prose. Extending `tier` to the other §"Per-RFC application" sub-blocks is a per-host follow-on SHOULD, not a graduation blocker.) |
| **Affects** | `spec/v1/capabilities.md` · `spec/v1/profiles.md` · `schemas/capabilities.schema.json` (optional `tier` enum on each capability sub-block) · `conformance/src/scenarios/experimental-tier-shape.test.ts` (new) · `INTEROP-MATRIX.md` (new column) · `CHANGELOG.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — new optional field with default `"stable"` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds an optional `tier ∈ {"stable", "experimental"}` field to every capability advertisement under `/.well-known/openwop`. When a host advertises a capability as `tier: "experimental"`, the host MUST also advertise an `experimentalUntil` ISO-8601 date no more than 12 months in the future. Conformance scenarios for a capability MUST honor the host's declared tier — under default mode, an `experimental` capability is exercised as a soft-skip with a one-line note; under `OPENWOP_REQUIRE_EXPERIMENTAL=true`, experimental scenarios run as hard assertions. The change creates a public, machine-readable "I am advertising this but I am not promising stability yet" signal for `Active`-RFC capability surfaces that cannot graduate to `Accepted` until an external implementer adopts them.

## Motivation

The 2026-05-22 standards-readiness review flagged a structural problem: openwop currently has a binary RFC status (`Accepted` = stable / `Active` = "may shift compatibly within v1.x until promotion"), but the conformance suite gates `Active`-RFC scenarios only by capability advertisement, not by stability claim. A non-steward implementer reading the discovery payload cannot tell whether `capabilities.multiAgent.executionModel.supported: true` represents (a) a stable wire surface they can build against, or (b) an `Active` RFC that may amend before next minor. The audit's recommended fix was: *"Active RFC surfaces either promoted to Accepted or explicitly carved out as experimental profiles."* Per-RFC promotion requires cross-host evidence which can take 3–9 months (the canonical example: RFC 0035 sandbox execution contract is `Active` with 8 conformance scenarios shipped, but cannot graduate until a first sandbox-executing host wires the behavioral probes — see commit `5864a2f` for the cost of premature graduation).

This RFC creates the experimental carve-out: a host advertising `multiAgent.executionModel.{supported: true, tier: "experimental", experimentalUntil: "2027-05-22"}` makes the stability claim explicit on the wire. Conformance suites and downstream clients can route around the experimental surface; auditors can read the discovery payload and form an opinion in 30 seconds.

## Proposal

### §A — Optional `tier` field on capability sub-blocks

Every object value under `capabilities.*` MAY carry an additional `tier` property:

```diff
 {
   "type": "object",
   "properties": {
     "supported": { "type": "boolean" },
     "version": { "type": "integer" },
+    "tier": {
+      "type": "string",
+      "enum": ["stable", "experimental"],
+      "default": "stable",
+      "description": "Stability claim for this capability advertisement. `stable` (the default when absent) means the host commits to the wire shape across v1.x minors. `experimental` means the host advertises the surface as a preview; the wire shape MAY shift compatibly without notice until the corresponding RFC graduates to `Accepted` and the host re-advertises as `stable`. Hosts MUST omit the field for capabilities whose underlying RFC is already `Accepted`."
+    },
+    "experimentalUntil": {
+      "type": "string",
+      "format": "date",
+      "description": "Required when `tier` is `experimental`. ISO-8601 `YYYY-MM-DD` no more than 12 months past the discovery response date. Reaching this date without graduating the underlying RFC to `Accepted` MUST result in the host either flipping tier to `stable` OR retracting the capability advertisement."
+    }
-  }
+  },
+  "if": {
+    "properties": { "tier": { "const": "experimental" } },
+    "required": ["tier"]
+  },
+  "then": {
+    "required": ["experimentalUntil"]
+  }
 }
```

The `if`/`then` block at the bottom of the diff is the load-bearing conformance enforcement for §B's "MUST also advertise `experimentalUntil`" rule. Without it, the §F negative example ("`tier: 'experimental'` without `experimentalUntil` MUST fail schema validation") would be prose-only — the exact pattern the 2026-05-22 audit flagged as "MUST in prose, not in schema." Note: `if`/`then` is a JSON Schema 2020-12 feature, supported by Ajv2020 (which `spec-corpus-validity.test.ts` uses); it is NOT inside the Tier-1 envelope subset specified by `spec/v1/structured-output-subset.md` (Gemini drops it), but `capabilities.schema.json` is a host-advertisement schema, not an LLM-emission envelope — the Tier-1 subset constraints do not apply.

Hosts MUST NOT advertise `tier: "experimental"` on a capability whose RFC is already `Accepted`. The `tier` field on capabilities whose underlying RFC is `Active` SHOULD be `"experimental"` until the RFC promotes.

### §B — Sunset rule (the audit's key concern)

The audit's risk was: "an experimental tier becomes a permanent dumping ground for `Active` RFCs (defeats the audit's intent)." The sunset rule addresses this:

A host advertising `tier: "experimental"` MUST also advertise `experimentalUntil: "<YYYY-MM-DD>"` ≤ 12 months out. Reaching the date without graduating the underlying RFC to `Accepted` triggers one of three host actions:

1. **Flip to stable.** Wire shape has not changed; commit to the contract. Re-advertise as `tier: "stable"`.
2. **Extend.** Re-advertise with `tier: "experimental"` and a new `experimentalUntil` ≤ 12 months out. The deprecation RFC MUST be open before the second extension to justify why the surface is still in flux.
3. **Retract.** Remove the capability advertisement. Existing clients receive `capability_not_provided` per `capabilities.md` §"Unsupported capability — refusal contract".

Sub-block 2 ("Extend") is the audit's escape valve: it is allowed, but every extension is publicly visible (the date is in `/.well-known/openwop`) and the second extension requires an open RFC. The audit's "permanent dumping ground" concern is mechanically discouraged.

### §C — Derived profile `openwop-experimental`

The capabilities-derived profile machinery in `spec/v1/profiles.md` gains a new derived profile:

- **Name:** `openwop-experimental`
- **Predicate:** any capability sub-block advertises `tier: "experimental"`.
- **Semantics:** a host advertising `openwop-experimental` is signaling that at least one of its capability claims is preview-grade. Downstream clients that require stable-only contracts can filter on the negation (`!profile.openwop-experimental`).

### §D — Conformance suite changes

Conformance scenarios gated on a capability MUST consult the capability's `tier` field:

- **Default mode (`OPENWOP_REQUIRE_BEHAVIOR=false`):** scenarios for `tier: "experimental"` capabilities **soft-skip** with the message `[experimental capability: <name>] host advertises tier='experimental' until <experimentalUntil>; scenario skipped under default mode`. The scenario does NOT count toward "Failed" or "Skipped (capability-gated)" in the four-bucket taxonomy; a new fifth bucket `Skipped (experimental)` SHOULD be tallied.
- **Strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`):** experimental scenarios remain soft-skipped unless `OPENWOP_REQUIRE_EXPERIMENTAL=true` is ALSO set. With both flags, experimental scenarios run as hard assertions.
- **Default-mode soft-skip ergonomics:** the new `behavior-gate.ts` helper `experimentalGate(profileName, advertised, tier)` accepts the tier and routes accordingly.

### §E — `INTEROP-MATRIX.md` advertisement column

The host row gains a new column: **"Experimental capabilities advertised"** — comma-separated list of every capability sub-block carrying `tier: "experimental"`, plus their `experimentalUntil` dates. This is the auditor's read-at-a-glance contract surface.

### §F — Example

A workflow-engine host running the multi-agent execution model Phase 4 advertises:

```json
{
  "capabilities": {
    "multiAgent": {
      "executionModel": {
        "supported": true,
        "version": 4,
        "tier": "experimental",
        "experimentalUntil": "2027-05-22",
        "confidenceEscalationFloor": 0.5
      }
    }
  }
}
```

A consuming client that needs only stable surfaces inspects the response, sees `tier: "experimental"`, and treats the multi-agent surface as preview. A conformance suite running against this host soft-skips the 12 multi-agent Phase 2–4 scenarios by default and runs them under `OPENWOP_REQUIRE_EXPERIMENTAL=true` for the host author's pre-flight check.

Negative example — invalid advertisement (`tier: "experimental"` without `experimentalUntil`):

```json
{
  "capabilities": {
    "multiAgent": { "executionModel": { "supported": true, "version": 4, "tier": "experimental" } }
  }
}
```

This MUST fail schema validation; `experimentalUntil` is required when `tier: "experimental"`.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- `tier` is a new optional field, default `"stable"` when omitted. Existing clients ignore unknown fields per the JSON Schema 2020-12 `additionalProperties: false` posture (hosts already validate); existing servers may omit `tier` indefinitely and remain conforming.
- No existing wire surface changes.
- No existing event type, error code, or HTTP status changes.
- No existing `MUST` requirement is relaxed; one new `MUST` (`experimentalUntil` is required when `tier: "experimental"`) is added.
- Existing v1 conformance passes are unaffected.

The conformance-suite-side change is also additive: a host that does not advertise `tier` continues to be evaluated as `stable` (the prior behavior); a host that does advertise it gets the soft-skip routing for free.

## Conformance

### Existing scenarios that cover this surface

- `discovery.test.ts` covers the structural discovery shape (Ajv2020 compile + `additionalProperties: false`). The new `tier` field will be validated automatically as soon as the schema lands.

### New scenarios

`conformance/src/scenarios/experimental-tier-shape.test.ts` — three describe blocks:

1. **Schema shape:** when a host advertises any capability with `tier: "experimental"`, the host MUST also advertise `experimentalUntil` matching `^\d{4}-\d{2}-\d{2}$`, the date MUST be in the future, and the date MUST be no more than 365 days past the discovery response timestamp.
2. **Behavior gating:** at least one experimental capability advertised by the host MUST cause the corresponding scenario file's `experimentalGate(profileName, advertised, tier)` to soft-skip under default mode. (Validated by examining a list of known-experimental capability sub-blocks and probing the gate.)
3. **Sunset detection:** a host advertising `experimentalUntil` in the past MUST fail discovery validation with `error: "validation_error"` + `details.field: "capabilities.<path>.experimentalUntil"` + `details.reason: "experimentalUntil_in_past"`.

### Per-RFC application of the experimental tier

Per the audit's "Active RFC → carve-out" recommendation, the following capability sub-blocks SHOULD adopt `tier: "experimental"` in the reference workflow-engine when this RFC reaches `Active`:

| Capability sub-block | Underlying RFC | Suggested `experimentalUntil` |
|---|---|---|
| `multiAgent.executionModel.{supported, version}` | 0037 / 0039 / 0040 / 0041 | 2027-05-22 |
| `envelopes.reliability.*` | 0032 | 2027-05-22 |
| `envelopes.completion.distinguishesTruncation` | 0033 | 2027-05-22 |
| `modelCapabilities.{substitutionSupported, advertised}` | 0031 | 2027-05-22 |
| `idempotency.multiRegion.*` + `eventLog.crossEngineOrdering.*` | 0036 | 2027-05-22 |
| `sandbox.*` | 0035 | 2027-05-22 (post the 5864a2f revert) |
| `observability.otel.collectorSeam.*` | 0034 | 2027-05-22 |
| `prompts.{supported, endpointsSupported, mutableLibrary, agentBindings}` | 0027 / 0028 / 0029 | 2027-02-22 (3-month window — Active 7-day comment already closed 2026-05-27) |

> **Footnote on dates:** the `experimentalUntil` values above are anchored to RFC 0042's filing date (2026-05-22) plus 12 months. If the 7-day comment window slips and RFC 0042 reaches `Active` later than 2026-05-29, hosts adopting the experimental tier SHOULD re-anchor the dates to the actual Active-promotion date so the host doesn't burn a third of its sunset budget before the advertisement is even legal to land. The working group (or lead maintainer, pre-WG) will publish the canonical re-anchored dates in `INTEROP-MATRIX.md` when RFC 0042 promotes.

Note: `tier` adoption is per-capability, not per-host. A single host MAY advertise some capabilities as `stable` and others as `experimental`. The Postgres reference host's `production` capability stays `stable`; its `multiAgent.executionModel` capability becomes `experimental`.

## Alternatives considered

1. **Do nothing — keep the binary Active/Accepted distinction.** Rejected because the audit's structural objection is correct: a non-steward implementer cannot read the discovery payload and form an opinion about stability. The Active-RFC promotion gate (cross-host evidence) takes months for some surfaces; that latency without a wire-level signal is the credibility risk.
2. **Use `x-experimental` prefix on capability names.** Rejected because it requires a wire-shape rename when a capability graduates — exactly the kind of compatible-shift cost we're trying to avoid. The optional `tier` field is purely additive: graduation removes the field, no rename.
3. **Use the `profile` derivation alone (no `tier` field), with `openwop-experimental` derived purely from RFC status.** Rejected because RFC status is server-side metadata the discovery response does not carry; clients would have to fetch `RFCS/*.md` to interpret the profile. The audit's specific request was "machine-readable" — `tier` on the wire is the minimum-bandwidth fix.
4. **Use a separate top-level `experimentalCapabilities` block.** Rejected because it splits the discovery payload across two locations and breaks the `additionalProperties: false` discipline for the existing `capabilities.*` sub-blocks. Adding an optional field to existing sub-blocks is cleaner.

## Unresolved questions

1. **What is the right default `experimentalUntil` window?** The proposal says ≤ 12 months. The audit didn't specify; 12 months matches the bootstrap-phase governance cycle. Maintainers should confirm.
2. **Should `OPENWOP_REQUIRE_EXPERIMENTAL=true` be the default in CI gates for `Active` RFCs?** Today RFC 0037–0041 scenarios soft-skip unless `OPENWOP_REQUIRE_BEHAVIOR=true` is also set. Adding a third axis to strict-mode is opt-in friction; maintainers should decide whether the reference workflow-engine CI runs `OPENWOP_REQUIRE_EXPERIMENTAL=true` by default once this RFC ships.
3. **Should the sunset rule require the deprecation RFC be open BEFORE the first `experimentalUntil` date passes (i.e., proactively), or only at the time of second extension?** Proactive is stricter; reactive is the current §B language.
4. **`openwop-experimental` derived profile — should it be a single profile, or one per experimental capability sub-block (e.g., `openwop-multi-agent-experimental`)?** Single profile (the current proposal) is simpler; per-sub-block profiles would mirror the existing `capabilities.X` granularity.

## Implementation notes (non-normative)

- **Schema landing:** `schemas/capabilities.schema.json` is the single source of truth; once the optional fields land, `spec-corpus-validity.test.ts` will compile-test them automatically.
- **Helper extraction:** add `experimentalGate(profileName, advertised, tier)` to `conformance/src/lib/behavior-gate.ts` alongside the existing `behaviorGate` helper. The default-mode soft-skip path emits the new `Skipped (experimental)` log line.
- **Reference workflow-engine wiring:** the `getCapabilities` route at `apps/workflow-engine/backend/typescript/src/routes/discovery.ts` reads the experimental advertisements from `hostConfig.experimentalCapabilities[]` and stamps `tier` + `experimentalUntil` into each matching sub-block.
- **Effort estimate:** 1–2 days (schema + helper + 1 conformance scenario + reference host wiring + per-RFC tier flip).
- **Reference impl can land BEFORE the 7-day comment window closes.** Per `CONTRIBUTING.md` §"Bootstrap-phase notes", single-steward additive RFCs may co-land schema + impl + RFC. The 7-day window runs alongside.

## Acceptance criteria

**Amended 2026-06-01 (architect-gated, David-confirmed) — the RFC 0080 precedent.** RFC 0042 is a *stability-signaling metadata convention*, not a behavioral capability: it has no host-side logic, so the live "advertise `tier:"experimental"`" direction is mechanically-equivalent-by-construction to the schema + the deterministic `experimentalGate()` helper, AND the only honest way to make it non-vacuous would require a host to mark a *stable* capability `experimental` — a false-stability signal the honest-advertisement invariant forbids (the same wall as RFC 0080's degraded keystone). The two original criteria that can only be met by fabrication — *"Reference workflow-engine advertises at least one capability sub-block with `tier: "experimental"`"* and *"At least one non-steward implementer signals adoption"* — are therefore **struck**; the deliverable is the mechanism itself, and the field is exercised the first time a host honestly holds an `Active`-RFC-preview capability to mark.

- [x] Spec text merged into `spec/v1/capabilities.md` + `spec/v1/profiles.md`.
- [x] Schema diff merged into `schemas/capabilities.schema.json` (`tier` enum + conditional-required `experimentalUntil` on `multiAgent.executionModel`); `spec-corpus-validity.test.ts` passes.
- [x] `conformance/src/scenarios/experimental-tier-shape.test.ts` lands with 3 describe blocks (always-on §A shape group green; §B/§D gated legs honor `experimentalGate()`).
- [x] `INTEROP-MATRIX.md` gains "Experimental capabilities advertised" column.
- [x] CHANGELOG entry under `[1.1.6 — unreleased]` referencing this RFC.
- [x] **AMENDED (was: reference engine advertises `tier:"experimental"`):** the `experimentalGate()` helper is implemented + its soft-skip/strict routing is deterministic and green; a live `tier:"experimental"` advertisement is **not required** — it is mechanically-equivalent-by-construction to the schema+helper and would be a false-stability signal on any host whose capability is genuinely stable.
- [x] 7-day public comment window closed (steward acceptance, lazy consensus per `GOVERNANCE.md`).
- [x] **AMENDED (was: non-steward implementer signals adoption):** graduated as a steward-side mechanism-codification (the RFC 0069 + 0054/0080 amended-criterion precedent); the non-steward adopter MyndHyve confirmed the honest-advertisement posture — it correctly does NOT mark its stable `executionModel` experimental.
- [ ] **Follow-up (additive, non-blocking):** generalize the schema so `tier`/`experimentalUntil` is permitted on every capability sub-block (currently only `multiAgent.executionModel`), making §A's "every capability advertisement" fully wire-deliverable.

## References

- Audit document: 2026-05-22 standards-readiness review (`docs/AUDIT-RESPONSE-2026-05.md`).
- `COMPATIBILITY.md` §2.1 — additive-only rule for v1.x.
- `spec/v1/capabilities.md` §"in-package vs network-superset shapes".
- `spec/v1/profiles.md` §"Profile derivation from capabilities".
- `RFCS/0001-rfc-process.md` §"Promotion to Accepted" — the cross-host evidence gate the experimental tier is designed to coexist with.
- Commit `5864a2f` — the 2026-05-22 sandbox-graduation revert that demonstrates why "Active = production-ready" is not a safe assumption.
- W3C TAG "Designing Reusable Web Features" §"Mark experimental features with a clear opt-in" — prior art for in-payload experimental signaling.
