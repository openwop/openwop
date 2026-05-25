# RFC 0056: Run feedback & annotation event (`run.annotated`)

| Field | Value |
|---|---|
| **RFC** | 0056 |
| **Title** | An optional `host.feedback` capability + additive `run.annotated` RunEvent + capability-gated `POST/GET /v1/runs/{runId}/annotations`, so a human (or supervisor agent) can attach a portable quality signal — rating / correction / label / flag — to a run, event, or node, feeding analytics, the HITL inbox, and replay |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.feedback` block) · `schemas/run-event.schema.json` (additive `run.annotated` event type) · new `schemas/annotation.schema.json` · `api/openapi.yaml` (two new capability-gated operations) · `spec/v1/observability.md` (annotation as a quality-signal surface) · `spec/v1/replay.md` + `spec/v1/debug-bundle.md` (fork/export semantics) · `SECURITY/invariants.yaml` (cross-tenant + redaction invariants) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

OpenWOP can observe *what an agent did* (reasoning events, cost, interrupts) but has no portable way to record *whether a human judged it good* — a thumbs-up/down, a correction, a label, a "flag for review." This RFC adds an optional `host.feedback` capability, an additive `run.annotated` RunEvent, and two capability-gated endpoints to record and list annotations bound to a run, a specific event, or a node. Because the signal lives on the wire as a standard event, a debugger / analytics consumer / HITL inbox on one host can read feedback captured by another — turning per-app, throwaway thumbs-up buttons into a portable quality signal that feeds analytics (intervention rate, correction rate), replay ("show me corrected runs"), and review queues. Everything is advertisement-gated and the event type is ignorable by existing consumers.

## Motivation

The reference app — and any serious agent UI — wants three things OpenWOP can't currently express portably:

1. **A quality loop.** A user reads an agent's output and wants to rate it or correct it. Today that signal, if captured at all, lives in app-private storage and never reaches the run's event log, so it can't be replayed, exported, or read by another tool.
2. **Real analytics.** The PRD's "agent analytics" (accuracy, intervention rate) need a signal. *Intervention rate* is partly derivable from interrupt events, but *correction rate* and *quality rating* are not emitted anywhere. Without a standard event, every host computes different, incomparable numbers.
3. **A review trail.** A HITL reviewer wants to flag a run for follow-up or label a node's output ("hallucinated", "off-brand"). That belongs next to the run, durably, and should survive fork/replay so the reviewer's note travels with the artifact being debugged.

This is squarely an **observability + HITL** concern — both core OpenWOP domains (`observability.md`, `interrupt.md`). The interop argument is the same one that justified the canonical `interrupt` shape: a feedback signal is only useful if any consumer can read it the same way. A host-private feedback table fails that test; a `run.annotated` event passes it. This is distinct from an `interrupt` (which *blocks* a run awaiting a decision) — an annotation is **non-blocking** and may be attached during or after a run, including to a terminal run.

## Proposal

### §A — `host.feedback` capability block (additive)

```diff
   "host": {
     "properties": {
+      "feedback": {
+        "type": "object",
+        "description": "RFC 0056. Non-blocking human/agent quality signals attached to a run, event, or node.",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "targets": {
+            "type": "array",
+            "items": { "type": "string", "enum": ["run", "event", "node"] },
+            "description": "Which granularities a feedback signal may target."
+          },
+          "signals": {
+            "type": "array",
+            "items": { "type": "string", "enum": ["rating", "correction", "label", "flag"] },
+            "description": "Which signal kinds the host accepts."
+          }
+        },
+        "required": ["supported"],
+        "additionalProperties": false
+      }
     }
   }
```

### §B — `Annotation` shape + `run.annotated` RunEvent (additive)

New `schemas/annotation.schema.json`:

```json
{
  "type": "object",
  "required": ["annotationId", "target", "signal", "actor", "createdAt"],
  "properties": {
    "annotationId": { "type": "string" },
    "target": {
      "type": "object",
      "required": ["runId"],
      "properties": {
        "runId":   { "type": "string" },
        "eventId": { "type": "string", "description": "Optional — anchors the annotation to one RunEvent." },
        "nodeId":  { "type": "string", "description": "Optional — anchors the annotation to one node." }
      },
      "additionalProperties": false
    },
    "signal": {
      "type": "object",
      "required": ["kind"],
      "properties": {
        "kind":   { "type": "string", "enum": ["rating", "correction", "label", "flag"] },
        "rating": { "type": "integer", "minimum": 1, "maximum": 5, "description": "Required iff kind=rating." },
        "label":  { "type": "string", "description": "Required iff kind=label." },
        "correction": { "type": "string", "description": "Corrected text/value iff kind=correction. Treated as untrusted user content." }
      },
      "additionalProperties": false
    },
    "actor": {
      "type": "object",
      "required": ["principalRef"],
      "properties": { "principalRef": { "type": "string", "description": "RFC 0048 principal, or an AgentRef (RFC 0002) when a supervisor agent annotates." } }
    },
    "note": { "type": "string", "description": "Optional free-text note. Untrusted user content." },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

A `run.annotated` RunEvent carries one `Annotation` in its payload. It is emitted onto the run's event stream when an annotation is recorded, so SSE consumers (the HITL inbox, a live dashboard) see it in real time and replay consumers see it in order.

### §C — Endpoints (capability-gated on `host.feedback.supported`)

- `POST /v1/runs/{runId}/annotations` — record an annotation. Validates against `annotation.schema.json`, enforces tenant scope, emits `run.annotated`, returns the persisted `Annotation`. MUST accept annotations on a **terminal** run (feedback is frequently post-hoc).
- `GET /v1/runs/{runId}/annotations` — list annotations for a run, tenant-scoped.

Hosts that don't advertise `host.feedback.supported` MUST return `501 capability_not_provided` (the honest signal, per `capabilities.md`), not a 404.

### §D — Fork / replay / export semantics

- **Fork** (`replay.md`): annotations attach to the **source** run and are **not** copied into a fork (a fork is a new run with no human judgments yet). A fork MAY carry a back-reference to the source so a reviewer can navigate to "the feedback that motivated this fork."
- **Replay**: `run.annotated` events replay in order like any event; they are inert on replay (they record a past human action and trigger no node execution).
- **Debug bundle** (`debug-bundle.md`): a run's annotations are included in the export so a flagged run travels with its reviewer notes.

### §E — Security (additive invariants)

- `annotation-cross-tenant-isolation` (protocol-tier) — an annotation is visible only within its run's tenant; a cross-tenant `GET` MUST NOT return it. Mirrors CTI-1.
- `annotation-content-redaction` (protocol-tier) — `signal.correction` and `note` are **untrusted user content**: they are wrapped per the prompt-injection trust discipline if ever fed back into a prompt, and any secret-shaped material is redacted under SR-1 before persistence/export.
- Recording an annotation is **audit-logged** (`auth.md`) with the acting principal.

## Compatibility

**Additive.** New optional capability block; a new RunEvent type that consumers ignore if unrecognized (additive event types are explicitly backward-safe per `COMPATIBILITY.md` §2.1); two new endpoints that only exist behind the advertised capability and otherwise return the spec'd `501`. No change to any existing event, endpoint, or schema. A host that doesn't advertise `host.feedback` is bit-for-bit unchanged and keeps its existing conformance pass. The two new SECURITY invariants are additive (they constrain a new surface, not an existing one).

## Conformance

- **`feedback-capability-shape.test.ts`** — the `host.feedback` block validates; `targets`/`signals` are subsets of the enums. (Always runs.)
- **`feedback-record-and-list.test.ts`** — `POST` an annotation, observe a `run.annotated` event on the stream, `GET` it back. (Gated on `host.feedback.supported`.)
- **`feedback-on-terminal-run.test.ts`** — an annotation on a completed run is accepted (proves non-blocking, post-hoc). (Gated.)
- **`feedback-cross-tenant-isolation.test.ts`** — tenant B cannot read tenant A's annotations (`annotation-cross-tenant-isolation`). (Gated.)
- **`feedback-correction-redaction.test.ts`** — a `correction`/`note` containing a secret-shaped token is redacted in persistence + debug-bundle export (`annotation-content-redaction`). (Gated.)
- **`feedback-fork-not-copied.test.ts`** — forking an annotated run yields a fork with zero annotations + an optional source back-reference. (Gated on `host.feedback` + `replay`.)
- **`feedback-unsupported-501.test.ts`** — a host not advertising `host.feedback` returns `501 capability_not_provided` on `POST .../annotations`. (Always runs.)

## Alternatives considered

1. **Model feedback as a fifth `interrupt` kind.** Rejected — interrupts **block** a run awaiting a decision and have a signed-token resume contract. Feedback is non-blocking, frequently post-terminal, and may be attached to a run that has long since finished. Overloading `interrupt` would muddy a clean, locked primitive.
2. **Leave feedback to each app (do nothing).** Rejected — app-private feedback can't be replayed, exported, cross-read by a debugger, or aggregated into comparable analytics across hosts. The whole value is portability; a private table has none.
3. **A generic `metadata` write on the run.** Rejected — `run-options.md` metadata is author-time configuration, not an ordered, actor-attributed, audited event stream. Quality signals need provenance (who), ordering (when, on the event timeline), and a typed signal vocabulary so analytics can aggregate them — none of which free-form metadata gives.
4. **Bundle this into RFC 0054 (run-diff).** Rejected — run-diff *compares* runs; it doesn't *capture* human judgment. They compose (diff two runs, then annotate which is better) but are orthogonal surfaces.

## Unresolved questions

1. **Annotation mutability.** Can a rating be changed or retracted, or are annotations append-only with a superseding annotation? Append-only is simpler and audit-honest; confirm before Active.
2. **Agent-authored annotations.** §B allows an `AgentRef` actor so a supervisor/judge agent can annotate a worker's output (LLM-as-judge). Should agent-authored annotations carry a `confidence` field tying into RFC 0039's confidence semantics? Likely yes; decide before Active.
3. **Aggregation surface.** Should the host expose an aggregate (`GET /v1/feedback/summary?workflowId=…`) or is per-run listing enough, with aggregation left to consumers? Defer the aggregate until an analytics adopter needs server-side rollups.

## Implementation notes (non-normative)

- Schema additions (§A, §B) + endpoints (§C) land on `Active` promotion with the conformance scenarios.
- Reference-app payoff (drives `plans/app-ux-enhancements.md`): thumbs-up/down + "suggest a correction" on chat bubbles and run-detail nodes; the HITL inbox gains a "flagged" filter; the run analytics panel computes correction-rate / mean-rating / flag-rate from `run.annotated` events instead of inventing app-local state.
- Reference-host target: `examples/hosts/postgres` persists annotations in a tenant-scoped table; the in-memory demo host persists them in the run doc (wiped on restart, acceptable for the sample).

## Acceptance criteria

- [ ] Spec text merged (this file + `observability.md` §"Quality signals" + replay/debug-bundle clauses).
- [ ] `host.feedback` in `capabilities.schema.json`; `run.annotated` in `run-event.schema.json`; new `annotation.schema.json`.
- [ ] Two operations in `api/openapi.yaml` with `501` documented for the unadvertised case.
- [ ] Two SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`) with public conformance tests.
- [ ] Seven conformance scenarios.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A host advertises `host.feedback` and passes record/list + cross-tenant + redaction + terminal-run + fork-not-copied.

## References

- [`spec/v1/observability.md`](../spec/v1/observability.md) — the quality-signal surface this extends.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) — the blocking-HITL primitive this is deliberately distinct from.
- [`spec/v1/replay.md`](../spec/v1/replay.md) + [`spec/v1/debug-bundle.md`](../spec/v1/debug-bundle.md) — fork/export semantics.
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the `principalRef` actor identity (Draft).
- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) — confidence semantics for agent-authored annotations (OQ#2).
- [`RFCS/0054-run-diff-and-execution-comparison.md`](./0054-run-diff-and-execution-comparison.md) — the orthogonal run-comparison surface it composes with (Draft).
- [`plans/app-ux-enhancements.md`](../plans/app-ux-enhancements.md) — the reference-app UX work this unblocks.
