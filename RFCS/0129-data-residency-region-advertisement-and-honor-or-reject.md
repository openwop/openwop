# RFC 0129: Data-residency — regional advertisement + honor-or-reject run constraint

| Field | Value |
| --- | --- |
| **RFC** | 0129 |
| **Title** | Data-residency — regional advertisement + honor-or-reject run constraint |
| **Status** | `Accepted` |
| **Author(s)** | openwop-app maintainers |
| **Created** | 2026-07-06 |
| **Updated** | 2026-07-06 (Draft→Active — bootstrap steward waiver, 7-day window waived; wire-shape-only additive + /architect review SOUND (admission-control is the falsifiable surface, mirrors 0127/0128 §4). §Affects/§2 amended for schema fidelity: no `run-create-request.schema.json` exists — `residency` is a new `schemas/residency.schema.json` `$ref`'d from the `POST /v1/runs` inline `allOf` in See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/capabilities.md`, `spec/v1/rest-endpoints.md` (run-creation admission), `schemas/capabilities.schema.json`, `schemas/residency.schema.json` (new) `$ref`'d from the `POST /v1/runs` request body `allOf` in `api/openapi.yaml` (there is NO `run-create-request.schema.json`), conformance `data-residency-*` scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A host that operates within one or more data-regions MAY advertise
`capabilities.dataResidency.regions[]`, and a client MAY attach an OPTIONAL
`residency: { region }` constraint to a run-creation request. A host that advertises
the capability **MUST honor-or-reject**: accept the run only if it can process it
within the requested region, otherwise reject it with a defined error — it **MUST NOT**
silently accept-and-ignore the constraint. The **observable, conformance-testable**
promise is the *admission decision* (accept iff the region is advertised; reject
otherwise), **not** the physical location of the bytes — which the wire cannot inspect
and which this RFC therefore treats as declared operator intent, not a wire `MUST`
(§4). Hosts advertise only regions they actually serve.

## Motivation

Regulated and sovereignty-sensitive deployments (GDPR, sectoral data-localization,
customer contractual pins) need to constrain where a run's processing happens. Today a
client has no wire signal for this: it cannot discover whether a host can pin a run to
a region, and — worse — a host that silently accepts a region it cannot serve leaves
the client believing data is pinned while it is processed out-of-region. That silent
failure is the exact harm a residency contract must prevent.

The honest, falsifiable contract is **admission control**, not a physical-location
assertion. A conformance run can observe whether a host *accepts or rejects* a
region-constrained run; it cannot observe where the host's storage physically lives. So
this RFC makes the admission decision the normative `MUST` and demotes the
physical-residency guarantee to declared intent backed by operator attestation — the
same honesty split RFC 0128 §4 draws for the internal-use restriction. An RFC whose
sole normative claim were "data stays in the region" would be an **unfalsifiable
`MUST`** — worse than no RFC. This RFC deliberately does not make that claim on the
wire.

## Proposal

### 1. `capabilities.dataResidency` (additive advertisement)

A host MAY advertise, in `/.well-known/openwop`:

```json
// capabilities.schema.json (additive)
+  "dataResidency": {
+    "type": "object",
+    "properties": {
+      "supported": { "const": true },
+      "regions": {
+        "type": "array",
+        "items": { "type": "string" },
+        "description": "Opaque operator region codes the host can pin a run to (e.g. \"eu\", \"us\", \"eu-west-1\"). A host MUST advertise a region here only if it can actually process a run entirely within it."
+      }
+    },
+    "required": ["supported", "regions"]
+  }
```

Region codes are **opaque operator strings** from the host's own vocabulary. This RFC
deliberately does **not** define a closed region registry: a normative global region
enum would be unfalsifiable (the wire cannot verify a code maps to a real geography) and
would fragment across operators. A shared registry is additive later if a concrete
interop gap demonstrates the need.

### 2. `residency` constraint on run-creation (additive, OPTIONAL)

A client MAY attach a top-level OPTIONAL `residency` object to a run-creation request:

```json
// schemas/residency.schema.json (new, additive) — $ref'd from the POST /v1/runs request-body allOf in api/openapi.yaml. There is NO run-create-request.schema.json; RFC 0094 §A forbids a closed additionalProperties:false branch inside that allOf, so the closed residency shape lives in this referenced file.
+  "residency": {
+    "type": "object",
+    "properties": { "region": { "type": "string" } },
+    "required": ["region"],
+    "description": "Requested processing region. The host MUST honor-or-reject per RFC 0129 §3."
+  }
```

Absent `residency` ⇒ no constraint (the host applies its default region). A single
region per run; multi-region spanning is out of scope for v1 (§Open questions).

### 3. Normative behavior — the conformance-testable core

A host that **advertises** `capabilities.dataResidency` and receives a run-creation
request carrying `residency.region = R`:

- if `R` is in the advertised `regions[]` → the host **MUST** accept the request and
  process the run within `R`;
- if `R` is **not** in the advertised `regions[]` → the host **MUST** reject the request with the canonical error `residency_unavailable` (HTTP status one-of `400`/`404`/`422` — witness asserts the `code`, not a byte-identical numeric; #815 convention) and **MUST NOT** create the run. It **MUST NOT** silently accept-and-ignore the constraint.

A host that does **not** advertise `capabilities.dataResidency`:

- MAY ignore a `residency` constraint or reject it — either is honest — but it **MUST
  NOT** report or imply that it honored a region it does not advertise. A client that
  requires a pin **MUST** check the `dataResidency` advertisement *before* relying on
  one; an unadvertised host makes no residency promise.

The **observable promise** a conformance run verifies is exactly this admission
decision — accept iff the requested region is advertised, reject with
`residency_unavailable` otherwise. This is falsifiable over the wire against any host
that advertises the capability.

### 4. Physical-residency guarantee — declared intent, NOT conformance-tested

That the run's data *physically remains* within region `R` is an operator/deployment
property. A conformance run observes only the admission decision and the run's wire
output; it cannot inspect where the host's compute or storage physically sits. This RFC
therefore treats the physical-residency guarantee as a **SHOULD** backed by operator
attestation and audit — **not** a wire `MUST`, and **not** conformance-gated. A host
advertising `dataResidency` SHOULD ensure that an accepted region-pinned run's data is
in fact confined to the advertised region; verifying that confinement is the operator's
compliance responsibility (attestation, infra controls, audit), outside the protocol.

This is the same honesty boundary RFC 0128 §4 draws: the wire enforces the observable
contract (admission control), and the unobservable guarantee (physical location) is a
declared operator intent, not a testable normative claim.

### Positive example

Host advertises `dataResidency: { supported: true, regions: ["eu", "us"] }`. Client
creates a run with `residency: { region: "eu" }` → host **accepts**, processes in `eu`.

### Negative example

Same host. Client creates a run with `residency: { region: "ap" }` (not advertised) →
host **rejects** with `residency_unavailable` (HTTP one-of 400/404/422); no run is created. A host that
instead created the run in `us` while ignoring the constraint would be **non-conformant**
(the silent-accept harm this RFC forbids).

## Conformance

Capability-gated `data-residency-*` scenarios, non-vacuous only for a host advertising
`capabilities.dataResidency`:

1. **advertised-region accept** — run-creation with an advertised `residency.region`
   succeeds and the run runs.
2. **unadvertised-region reject** — run-creation with an unadvertised `residency.region`
   fails with `residency_unavailable` (HTTP one-of 400/404/422); no run is created.
3. **no-advert honesty** — a host without the advert is not asserted to honor a pin;
   the scenario is skipped (capability-gated), so an honest-off host never fails it.

Under `OPENWOP_REQUIRE_BEHAVIOR=true`, scenarios 1–2 are required for any host that
advertises `dataResidency` — a hollow advert (advertises regions but does not reject an
unadvertised region) fails.

## Security & Compatibility

**Compatibility: additive.** A new OPTIONAL capability object and a new OPTIONAL
run-creation field. No existing required field changes; no MUST is relaxed; no
event-shape or error-code meaning changes. A host that never advertises `dataResidency`
and a client that never sends `residency` are unaffected.

**Security.** The reject path is **fail-closed**: a region the host cannot serve is
refused, never silently downgraded — preventing out-of-region processing under a false
pin. Region codes are opaque, non-PII operator strings; they carry no subject data. The
`residency_unavailable` error reveals only that the requested region is unavailable
(the advertised `regions[]` is already public), so it leaks nothing beyond the advert.

## Host implementation note (non-normative)

In the openwop-app reference host, `dataResidency` is advertised only when an operator
configures the served regions; the run-creation admission check rejects an unadvertised
region before the run is created (fail-closed at the route boundary). The physical pin
(the §4 SHOULD) is a deployment concern — a single-region Cloud Run + Cloud SQL
deployment attests its region via infra config, not via the wire. The advert stays
honest-off until the operator declares regions.

## Process note — comment window

The 7-day normative-addition comment window (`RFCS/README.md` §Process) was **waived by
the maintainer** for this RFC, consistent with the bootstrap-steward waiver applied to
RFCs 0127/0128 (single-org maintainer set; the honesty gate — advertise only the
admission behavior a conformance run can refute — is the substantive guard, and it is
satisfied by §3–§4). The register sweep (`0129-*.gaps.md` / `.risks.md`) still gates the
flip to `Accepted`.

## Resolved questions

1. **Closed region registry?** — **No.** Region codes are opaque operator strings. A
   normative global region enum would be unfalsifiable and operator-fragmenting; a shared
   registry is additive later if an interop gap demonstrates the need.
2. **Is physical residency a wire `MUST`?** — **No.** The wire cannot inspect byte
   location; a physical-residency `MUST` would be unfalsifiable. The `MUST` is on
   admission control (§3); physical confinement is a declared operator SHOULD (§4).
3. **Does an unadvertised host have to reject a `residency` constraint?** — **No.** It
   MAY ignore or reject; it MUST NOT *claim* to honor an unadvertised region. The client
   checks the advert first.

## Open questions

None blocking. Deferred (named, non-blocking):

- **Multi-region runs** (a single run spanning >1 region, or a fallback region list) —
  out of scope for v1; additive later if a concrete need appears.
- **Per-region capability variance** (a host that supports different features per region)
  — out of scope; `dataResidency` advertises admissibility only, not per-region feature
  matrices.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- `api/openapi.yaml` (RFC 0094 §A forbids a closed branch inside that allOf, so the closed shape lives in the referenced file); `residency_unavailable` HTTP status widened to one-of 400/404/422 per the #815 envelope-not-status convention.
- Accepted path: single-witness (openwop-app tier-1 admission-control gate) + tier-2 gap named)<br>2026-07-06 (`Active → Accepted` — **single-witness** graduation (bootstrap steward waiver + maintainer call), **tier-1 reference-host evidence** (openwop-app, Cloud Run rev `openwop-app-backend-00413-jcm` advertising `capabilities.dataResidency {supported:true, regions:["eu","us"]}`): both §3 admission legs **steward-curl-verified on the wire** against `POST /v1/runs` — (1) unadvertised `region:"zz-nowhere"` → **HTTP 422** + nested `{error:{code:"residency_unavailable", details:{requestedRegion, availableRegions:["eu","us"]}}}` with **no runId** (fail-closed); (2) advertised `region:"eu"` → **NOT** `residency_unavailable`, proceeds past the residency gate to workflow resolution (`workflow_not_found` on the unknown probe id) — the exact admission-decision separation §3 requires (reject-on-residency iff region∉advertised, else proceed).
- Envelope is the nested `{error:{code}}` (#815), 422 ∈ one-of {400/404/422}, `availableRegions` matches the advert.
- Conformance witness = `@openwop/openwop-conformance@1.54.0` `data-residency-admission` (capability-gated, 3 passed / 0 failed non-vacuous vs 1.54.0).
- **G4 carried forward** = the tier-2 witness is the first *second* residency-advertising host; MyndHyve lacks a genuine multi-region deployment to witness honestly (0127/0128 G4 pattern). The maintainer elected single-witness graduation with this named gap per the 2026-07-06 evidence-tier ruling).
