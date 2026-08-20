# RFC 0056: Run feedback & annotation event (`run.annotated`)

| Field | Value |
| --- | --- |
| **RFC** | 0056 |
| **Title** | An optional `host.feedback` capability + a per-run annotation store exposed via `POST/GET /v1/runs/{runId}/annotations` + a live `run.annotated` SSE notification, so a human (or supervisor agent) can attach a portable quality signal — rating / correction / label / flag — to a run, event, or node, feeding analytics, the HITL inbox, and review. Annotations are a side-resource, **not** replayable run-event-log entries. |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-29 (`Active → Accepted`: the surface is implemented end-to-end on **three reference hosts** — in-memory (`#165`/`#168`), Postgres + SQLite (`4288d6fa`) — each advertising `capabilities.feedback.{supported: true, targets: ["run"], signals: ["rating","correction","label","flag"]}`, serving `POST/GET /v1/runs/{runId}/annotations` over a per-run side-store (never a `RunEvent`), and SR-1-redacting `signal.correction`/`signal.label`/`note` before persistence. See [Amendment record](#amendment-record). |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.feedback` block) · new `schemas/annotation.schema.json` · `api/openapi.yaml` (two new capability-gated operations) · `api/asyncapi.yaml` (`run.annotated` stream message) · `spec/v1/observability.md` (annotation as a quality-signal surface) · `spec/v1/replay.md` + `spec/v1/debug-bundle.md` (fork/export semantics) · `SECURITY/invariants.yaml` (cross-tenant + redaction invariants) · new conformance scenarios. **`run.annotated` is a live SSE notification only — it is NOT added to `schemas/run-event.schema.json`'s replayable `RunEventType` enum (see §B/§D).** |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

OpenWOP can observe _what an agent did_ (reasoning events, cost, interrupts) but has no portable way to record _whether a human judged it good_ — a thumbs-up/down, a correction, a label, a "flag for review." This RFC adds an optional `host.feedback` capability, a **per-run annotation store** exposed via two capability-gated endpoints (record + list), and a **live `run.annotated` SSE notification** so dashboards update in real time. Annotations are a **side-resource — deliberately NOT entries in the replayable run event log** — so they never collide with fork/replay semantics (a fork copies source events `< fromSeq` per `replay.md`, which would otherwise contradict §D "not copied into a fork"; see §B/§D). Because the shape is portable, a debugger / analytics consumer / HITL inbox on one host can read feedback captured by another — turning per-app, throwaway thumbs-up buttons into a portable quality signal that feeds analytics (intervention rate, correction rate) and review queues. Everything is advertisement-gated and the stream message is ignorable by existing consumers.

## Motivation

The reference app — and any serious agent UI — wants three things OpenWOP can't currently express portably:

1. **A quality loop.** A user reads an agent's output and wants to rate it or correct it. Today that signal, if captured at all, lives in app-private storage and never reaches the run's event log, so it can't be replayed, exported, or read by another tool.
2. **Real analytics.** The PRD's "agent analytics" (accuracy, intervention rate) need a signal. _Intervention rate_ is partly derivable from interrupt events, but _correction rate_ and _quality rating_ are not emitted anywhere. Without a standard event, every host computes different, incomparable numbers.
3. **A review trail.** A HITL reviewer wants to flag a run for follow-up or label a node's output ("hallucinated", "off-brand"). That belongs next to the run, durably, and should survive fork/replay so the reviewer's note travels with the artifact being debugged.

This is squarely an **observability + HITL** concern — both core OpenWOP domains (`observability.md`, `interrupt.md`). The interop argument is the same one that justified the canonical `interrupt` shape: a feedback signal is only useful if any consumer can read it the same way. A host-private feedback table fails that test; a `run.annotated` event passes it. This is distinct from an `interrupt` (which _blocks_ a run awaiting a decision) — an annotation is **non-blocking** and may be attached during or after a run, including to a terminal run.

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

### §B — `Annotation` shape + `run.annotated` stream notification (additive)

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
      "properties": { "principalRef": { "type": "string", "description": "Opaque principal identifier — a principal per RFC 0048 (Draft, referenced non-normatively) or an AgentRef per RFC 0002 when a supervisor agent annotates. Typed as a plain string so this RFC does NOT depend on RFC 0048 reaching Accepted." } }
    },
    "note": { "type": "string", "description": "Optional free-text note. Untrusted user content." },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

Annotations persist in a **per-run side-store keyed by `runId`** (the `POST/GET .../annotations` endpoints in §C are its read/write surface). When one is recorded, the host emits a **`run.annotated` SSE notification** carrying the `Annotation` in its payload, on the `updates` + `debug` stream modes, so live consumers (the HITL inbox, a dashboard) update in real time.

`run.annotated` is a **live stream message, NOT a persisted `RunEvent`** — it is deliberately **not** added to `run-event.schema.json`'s `RunEventType` enum and never enters the replayable event log. This is the load-bearing design choice: a fork copies source event-log entries for sequences `< fromSeq` (`replay.md`), so a replayable annotation event would be copied into forks — directly contradicting §D — and would also mean appending events to a _terminal_ run's immutable log. Keeping annotations off the event log resolves both. (Producer-side: an AsyncAPI `RunAnnotated` message references `annotation.schema.json`.)

### §C — Endpoints (capability-gated on `host.feedback.supported`)

- `POST /v1/runs/{runId}/annotations` — record an annotation. Validates against `annotation.schema.json`, enforces tenant scope, emits `run.annotated`, returns the persisted `Annotation`. MUST accept annotations on a **terminal** run (feedback is frequently post-hoc).
- `GET /v1/runs/{runId}/annotations` — list annotations for a run, tenant-scoped.

Hosts that don't advertise `host.feedback.supported` MUST return `501 capability_not_provided` (the honest signal, per `capabilities.md`), not a 404.

### §D — Fork / replay / export semantics

Because annotations live in a per-run side-store (§B), they sit cleanly outside fork/replay:

- **Fork** (`replay.md`): a fork replays/copies source _event-log_ entries for sequences `< fromSeq`. Annotations are not event-log entries, so a fork inherently starts with **zero** annotations (a fork is a new run with no human judgments yet). A fork MAY carry a back-reference to the source so a reviewer can navigate to "the feedback that motivated this fork."
- **Replay**: there is nothing to replay — `run.annotated` is a live SSE notification, not a persisted event, so it never appears in a replayed event stream and triggers no node execution. This avoids both appending to a terminal run's immutable log and the §D-vs-fork contradiction a replayable annotation event would create.
- **Debug bundle** (`debug-bundle.md`): the host reads the annotation side-store and includes a run's annotations in the export, so a flagged run travels with its reviewer notes.

### §E — Security (additive invariants)

- `annotation-cross-tenant-isolation` (protocol-tier) — an annotation is visible only within its run's tenant; a cross-tenant `GET` MUST NOT return it. Mirrors CTI-1.
- `annotation-content-redaction` (protocol-tier) — `signal.correction` and `note` are **untrusted user content**: they are wrapped per the prompt-injection trust discipline if ever fed back into a prompt, and any secret-shaped material is redacted under SR-1 before persistence/export.
- Recording an annotation is **audit-logged** (`auth.md`) with the acting principal.

## Compatibility

**Additive.** New optional capability block; a new **SSE stream message** (`run.annotated`) consumers ignore if unrecognized (additive stream messages are backward-safe per `COMPATIBILITY.md` §2.1) — deliberately **not** added to the replayable `RunEventType` enum, so the event-log wire shape and fork/replay semantics are untouched; two new endpoints that only exist behind the advertised capability and otherwise return the spec'd `501`; one new side-resource schema (`annotation.schema.json`). No change to any existing event, endpoint, or schema. A host that doesn't advertise `host.feedback` is bit-for-bit unchanged and keeps its existing conformance pass. The two new SECURITY invariants are additive (they constrain a new surface, not an existing one).

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
4. **Bundle this into RFC 0054 (run-diff).** Rejected — run-diff _compares_ runs; it doesn't _capture_ human judgment. They compose (diff two runs, then annotate which is better) but are orthogonal surfaces.

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
- [ ] `host.feedback` in `capabilities.schema.json`; `run.annotated` `RunAnnotated` message in `api/asyncapi.yaml` (NOT in `run-event.schema.json`'s `RunEventType` enum); new `annotation.schema.json`; per-run annotation side-store.
- [ ] Two operations in `api/openapi.yaml` with `501` documented for the unadvertised case.
- [ ] Two SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`) with public conformance tests.
- [ ] Seven conformance scenarios.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A host advertises `host.feedback` and passes record/list + cross-tenant + redaction + terminal-run + fork-not-copied.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- All seven `feedback-*.test.ts` conformance scenarios pass against the live SQLite host (verified non-vacuously: a real `conformance-noop` run seeded → `POST` returns `201` with `annotationId` → `GET` lists it, `count: 1`; `feedback-fork-not-copied` confirms a fork starts with zero annotations per §D).
- The two new SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`) each have a matching public test.
- Per RFC 0001 §3, `Accepted` requires implementation landed + conformance updated — both satisfied; this RFC sets no explicit non-steward bar, mirroring the 0059/0060/0062/0063/0064 reference-host graduation path.
- A future non-steward host advertising `host.feedback` (MyndHyve adoption in flight on the `myndhyve-rfc-acceptance` channel) would strengthen, not gate, this status.).

## References

- [`spec/v1/observability.md`](../spec/v1/observability.md) — the quality-signal surface this extends.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) — the blocking-HITL primitive this is deliberately distinct from.
- [`spec/v1/replay.md`](../spec/v1/replay.md) + [`spec/v1/debug-bundle.md`](../spec/v1/debug-bundle.md) — fork/export semantics.
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the `principalRef` actor identity (Draft).
- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) — confidence semantics for agent-authored annotations (OQ#2).
- [`RFCS/0054-run-diff-and-execution-comparison.md`](./0054-run-diff-and-execution-comparison.md) — the orthogonal run-comparison surface it composes with (Draft).
- `plans/app-ux-enhancements.md` — the reference-app UX work this unblocks.
