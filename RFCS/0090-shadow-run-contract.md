# RFC 0090: Shadow-run contract — prove an agentic workflow against a baseline before cut-over

| Field | Value |
|---|---|
| **RFC** | 0090 |
| **Title** | Shadow-run contract — prove an agentic workflow against a baseline before cut-over |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-06 |
| **Updated** | 2026-06-06 |
| **Affects** | new `spec/v1/shadow-run.md` (DRAFT); `schemas/capabilities.schema.json`, `schemas/run-snapshot.schema.json`, `schemas/run-event.schema.json`, `schemas/create-run-request.schema.json`; `api/openapi.yaml`, `api/asyncapi.yaml`; `conformance/`; composes with `spec/v1/replay.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A host MAY run a workflow in **shadow mode**: it executes the agentic workflow while materializing a **baseline** (a pinned prior workflow version via the existing replay/fork surface, or an externally-supplied legacy outcome), then emits a **deterministic comparison** — agreement rate, override rate, and per-key divergences — so a team can *prove* the agentic workflow against the process it replaces before cutting over production responsibility. The comparison is content-free (digests + metrics, never raw output values), discoverable via `capabilities.shadow`, and entirely optional.

## Motivation

Migrating a human/legacy process to an agentic workflow needs a **prove-it step** between "built" and "in production." Today the protocol has no surface for *run-alongside-and-compare*:

- **Replay/fork** (`replay.md`) re-executes a workflow and compares it to *its own* prior run (divergence-from-self for time-travel debugging). It does **not** compare the agentic workflow to an independent baseline, and emits no agreement/override metric.
- Teams therefore prove migrations out-of-band (spreadsheets, manual spot-checks) with no portable contract, no conformance, and no governable audit trail.

This is the "Shadow & Prove" stage of a workflow migration: run the new agent cluster in shadow over real inputs, measure how often it agrees with the baseline and how often a human would override it, and only graduate to production once the evidence clears a bar. The spec is the right place because the *comparison* must be portable across hosts and auditable — a host-private implementation gives no cross-host guarantee that "we proved it" means the same thing.

## Proposal

New DRAFT doc `spec/v1/shadow-run.md`. All additions are optional and gated on `capabilities.shadow`.

### A. Capability advertisement

```jsonc
// capabilities.schema.json — additive optional top-level block
"shadow": {
  "supported": true,
  "baselineModes": ["replay", "external"],   // which baseline sources the host materializes
  "comparison": { "strategies": ["exact", "keyed"] }
}
```

A host that does not advertise `capabilities.shadow` (or advertises `supported: false`) MUST reject a shadow run with `error.code: "capability_not_provided"`. Hosts that do not advertise it remain v1-compliant.

### B. Starting a shadow run

Additive optional `shadow` field on the run-creation request (`create-run-request.schema.json` / `RunOptions`):

```jsonc
{
  "workflowId": "invoice-exception",
  "inputs": { /* … */ },
  "shadow": {
    "baseline": { "mode": "replay", "fromRunId": "run_..." },
    // …or: { "mode": "external", "outcome": { "<key>": "<digest-or-value>" } }
    "comparison": { "outputKeys": ["decision", "amount"], "strategy": "exact" }
  }
}
```

- The agentic workflow executes normally. The host MAY ALSO materialize the baseline: in `replay` mode by replaying `fromRunId` (per `replay.md`); in `external` mode from the caller-supplied `outcome`.
- The baseline leg MUST be **observe-only**: it MUST NOT perform production side-effects (no external writes, no irreversible tool calls). A `replay`-mode baseline reuses the replay idempotency guarantees (`replay.md §Determinism`).
- The host MUST refuse a `replay` baseline whose `fromRunId` belongs to another tenant (`error.code: "forbidden_tenant"`) — CTI-1.

### C. Events (new `RunEventType` members — additive, per-event version axis per `version-negotiation.md`)

| Event | Payload (content-free) |
|---|---|
| `shadow.baseline.recorded` | `{ baselineMode, baselineRunId? }` |
| `shadow.compared` | `{ agreementRate, overrideRate, divergenceCount, comparedKeys }` |
| `shadow.diverged` | `{ key, agentOutcomeDigest, baselineOutcomeDigest }` — emitted per diverging key |

`shadow.diverged` MUST carry **digests** (e.g., SHA-256 of the canonicalized value) of the compared values, NOT the raw values — see Security. The metrics on `shadow.compared` are derived, content-free numbers.

### D. Comparison result (the EV-4 "proof" report)

Additive optional `RunSnapshot.shadow` AND a read endpoint:

```
GET /v1/runs/{runId}/shadow   →   200 ShadowComparison
```

```jsonc
// ShadowComparison
{
  "status": "agree" | "diverge" | "pending",
  "baseline": { "mode": "replay", "runId": "run_..." },
  "agreementRate": 0.94,
  "overrideRate": 0.03,
  "divergences": [ { "key": "amount", "agentDigest": "sha256:…", "baselineDigest": "sha256:…" } ]
}
```

### E. Determinism (normative)

The comparison MUST be **deterministic** given the same observable agent outputs and the same baseline: comparing the same run twice MUST yield the same `ShadowComparison`. Comparison is performed only over the declared `comparison.outputKeys`, using the declared `strategy` (`exact` = canonical-byte equality of the keyed value; `keyed` = equality of the value at each output key path). This reuses the observable-output-sequence determinism contract (`replay.md §C`) — the agentic leg's observable outputs are the comparison subject, not its internal tool-call bytes.

### F. RFC 2119 prose (sketch)

- A host that advertises `capabilities.shadow.supported: true` MUST accept a `shadow` block on run creation and MUST emit `shadow.compared` on completion of a shadow run.
- A shadow run's baseline leg MUST NOT perform production side-effects.
- `shadow.diverged` and `shadow.compared` payloads MUST NOT contain raw output values; they MUST carry only digests and derived metrics (SR-1).
- A host MUST refuse a cross-tenant `replay` baseline (CTI-1).
- The comparison MUST be deterministic over the declared `outputKeys` (§E).
- A host that does not advertise the capability MUST reject a `shadow` block with `capability_not_provided` and otherwise ignore the (absent) surface.

### Open spec gaps (this RFC does NOT cover)

| Gap | Why deferred |
|---|---|
| Semantic/fuzzy comparison for free-text NL outputs | The invoice-exception pilot uses structured decisions (`exact`/`keyed`); NL comparison needs a separate strategy + a non-deterministic-output pilot. |
| External-baseline *callback* ingestion (push-after-the-fact) | v1 takes the external outcome at run-creation time; a callback shape waits for a pilot that needs it. |
| HITL *inside* the shadow leg | Whether the agentic leg's interrupts pause the comparison is left to a follow-up. |
| Aggregation across many shadow runs (fleet-level proof) | This RFC is per-run; fleet roll-up is a host-extension/telemetry concern (see the demo app's workforce telemetry). |

## Compatibility

**Additive** per `COMPATIBILITY.md §2.2`:

- New **optional** capability block (`shadow`) — absent ⇒ unsupported; existing hosts unaffected.
- New **optional** `shadow` field on run creation — absent ⇒ an ordinary run; existing clients never send it, existing servers ignore the absent field.
- New **event types** — additively introduced on the per-event version axis (`version-negotiation.md`); an honest v1 client tolerates unknown event types (forward-compat), so emitting them does not break existing consumers.
- New **optional** `RunSnapshot.shadow` (default absent) + a new **optional** endpoint — readers tolerate absence.

No required field becomes optional/removed/type-changed; no event-type *shape* changes; no endpoint contract changes; no `MUST` is relaxed; no error-code meaning changes. Forward-compat guarantee: every addition is optional with an absent/`null` default; existing clients ignore it, existing servers don't emit it.

## Conformance

Existing adjacent coverage: `conformance/src/scenarios/replay-*.test.ts` (fork/replay), capability-discovery scenarios. New scenarios, **gated on `capabilities.shadow.supported`**:

1. `shadow-run-emits-comparison` — a shadow run emits `shadow.compared` with `agreementRate`/`overrideRate`/`divergenceCount` (`shadow-run.md §C/§D`).
2. `shadow-comparison-content-free` — `shadow.diverged` + `shadow.compared` carry digests/metrics, never raw output values (`shadow-run.md §Security`; enforces the new invariant).
3. `shadow-comparison-deterministic` — comparing the same run twice yields an identical `ShadowComparison` (`shadow-run.md §E`).
4. `shadow-baseline-no-side-effects` — the baseline leg performs no production writes (`shadow-run.md §B`).
5. `shadow-cross-tenant-baseline-refused` — a `replay` baseline from another tenant → `forbidden_tenant` (CTI-1).

Fixtures (new, under `conformance/fixtures/`, catalogued in `fixtures.md`): a `shadow-config` request + an expected `ShadowComparison`.

## Alternatives considered

1. **Do nothing.** Teams prove migrations out-of-band. Rejected: no portable contract, no conformance, no governable audit trail — "we proved it" is unverifiable across hosts.
2. **Reuse replay/fork only.** Replay compares a workflow to *its own* prior run (divergence-from-self), not to an independent baseline, and yields no agreement/override metric. Rejected: it answers "did I re-execute deterministically", not "does the agent match the process it replaces."
3. **Client-side comparison.** The client diffs agent output vs a baseline it holds. Rejected: not portable, not conformance-testable, no on-the-wire audit trail, and every client reinvents the comparison semantics.

## Unresolved questions

1. External-baseline ingestion: at-creation `outcome` only (this RFC), or also a post-hoc callback? The invoice-exception pilot should inform.
2. Comparison strategies beyond `exact`/`keyed` (semantic/fuzzy for NL) — needed before a non-deterministic-output pilot.
3. Does the agentic leg's HITL (interrupts) pause/annotate the comparison, or is shadow strictly non-interactive?
4. `overrideRate` semantics when there is no human in the shadow loop — is "override" only meaningful with a HITL baseline, or derived from a policy boundary?
5. Canonical read surface: `RunSnapshot.shadow`, the `GET …/shadow` endpoint, or both (and which is authoritative)?
6. Interplay with RFC 0041 §C (replay determinism under non-deterministic models) for the `replay`-mode baseline leg.

## Implementation notes (non-normative)

- Sequence: spec DRAFT → schema/OpenAPI/AsyncAPI → capability-gated conformance scenarios → reference-host (deferred; see Acceptance). No `CC-N` impl-plan coordination needed — additive, no breaking impl assumptions.
- The openwop demo app's "Shadow & Prove" migration stage (MG-5) and its EV-4 comparison report are the intended first consumer; the pilot there will exercise §B/§D/§E and feed the Unresolved questions before this RFC advances to `Active`. Per the steward ruling, freeze only what that pilot has exercised.
- Estimated effort: medium (one new spec doc + 4 schema touches + 5 scenarios). Reference-host implementation is explicitly deferred to a follow-up once the pilot stabilizes the shapes.

## Acceptance criteria

- [ ] `spec/v1/shadow-run.md` merged (Status: DRAFT)
- [ ] `capabilities`, `create-run-request`, `run-event`, `run-snapshot` schemas updated; OpenAPI (`GET …/shadow`) + AsyncAPI (3 events) updated; `redocly` + `asyncapi validate` clean
- [ ] ≥1 capability-gated conformance scenario covering the new surface (target: all 5 sketched)
- [ ] `SECURITY/invariants.yaml` row for "shadow comparison payloads MUST NOT carry raw output values" + its enforcing scenario
- [ ] `CHANGELOG.md` `[Unreleased]` entry under additive
- [ ] Reference host implements + passes the scenarios, OR this RFC explicitly defers reference-host implementation to a follow-up (default: defer until the demo pilot stabilizes the shapes)

## References

- `spec/v1/replay.md` — replay/fork surface this composes with (baseline `replay` mode; §C observable-output determinism)
- `spec/v1/version-negotiation.md` — per-event version axis (additive event introduction)
- `SECURITY/threat-model-secret-leakage.md`, `agent-memory.md` (SR-1, CTI-1)
- Prior art: Temporal "shadowing" (worker versioning side-by-side); LangSmith/eval "online evaluation"; canary/shadow-traffic deployment patterns; A/B + shadow-deploy in service meshes
- Demo app: "Shadow & Prove" migration stage (MG-5) + EV-4 comparison report (consumer)
