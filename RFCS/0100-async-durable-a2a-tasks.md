# RFC 0100: Async / Durable A2A Tasks — durable task persistence, streaming + push for cross-host handoffs

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**         | Async / Durable A2A Tasks — extend the A2A composition surface (`a2a-integration.md` + the existing sync `message/send` → `tasks/get` round-trip) with a durable Task lifecycle, `tasks/resubscribe` streaming, and push-notification config, advertised via a new `a2a` capability slot, so an OpenWOP-host-as-A2A-agent runs cross-host handoffs asynchronously instead of synchronously                                                                                                                       |
| **RFC**           | 0100                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Status**        | `Active`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Created**       | 2026-06-13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Updated**       | 2026-06-13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Affects**       | `spec/v1/a2a-integration.md` (NEW §"Async / durable Tasks": the durable Task lifecycle ↔ run-status projection under async, `tasks/get` after disconnect, `tasks/resubscribe`, push-config; closes the doc's "Add an `a2a` capability slot" + "codify `metadata.openwop.*`" Future-work items) · NEW `schemas/a2a-task-state.schema.json` (the projected durable Task record openwop persists per backing run) · `schemas/capabilities.schema.json` (NEW additive `a2a` capability block) · `api/openapi.yaml` (additive `GET /v1/a2a/tasks/{taskId}` host-side durable-task read seam, non-normative-name host-extension surface) · `CHANGELOG.md` · `INTEROP-MATRIX.md` (the "Composition partners" A2A row gains an async/durable column) · new conformance subtests in `a2a-task-roundtrip.test.ts` |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Summary

`a2a-integration.md` (`FINAL`) specifies how an OpenWOP run projects to an A2A `Task`, and the live `a2a-task-roundtrip.test.ts` exercises it **synchronously**: `message/send` then poll `tasks/get` straight through `SUBMITTED → WORKING → COMPLETED`. That works for a short skill, but a cross-host agent handoff that backs a *long-running, HITL-gated, resumable* OpenWOP run cannot be held open synchronously — the calling host disconnects, the backing run pauses at an approval gate for hours, and there is **no normative contract for the durable side**: how an OpenWOP host persists the projected Task so `tasks/get` returns the live state after a disconnect, how a client re-attaches to the event stream (`tasks/resubscribe`) without re-sending, and how the host pushes a terminal/INPUT_REQUIRED transition (A2A `push_notifications`) instead of requiring a poll. The doc itself files exactly this as Future work ("Add an `a2a` capability slot to `/.well-known/openwop` discovery"). This RFC closes it **additively**: a NEW `a2a` capability block advertising `{ supported, agentCardUrl, streaming, pushNotifications, durableTasks }`, a NEW `A2ATaskState` projection record openwop persists per backing run (durable across the run's whole lifecycle, surviving caller disconnect), the normative async lifecycle (the existing §"State projection" mapping made durable + resumable), and `tasks/resubscribe` + push-config bindings to A2A v0.3. Nothing about the sync round-trip changes; this is the durable/async leg of the same composition.

## Motivation

The motivating host is the OpenWOP reference app's **work-twin agent suite** ([openwop-app ADR 0033 — "Work-twin connector reachability + day-1 capability-honesty matrix"](https://github.com/openwop/openwop-app/blob/main/docs/adr/0033-work-twin-connector-reachability.md)), which explicitly **defers async A2A**: _"Deferred items (external-event triggers, async A2A) would each need an upstream OpenWOP RFC — explicitly out of scope here."_ The work twins hand work to each other and to external A2A agents; an OpenWOP-backed A2A agent's Task is a *whole OpenWOP run* — which may run for minutes-to-hours, pause at HITL gates, and resume. The sync round-trip the spec ships today can't carry that:

1. **No durable Task after disconnect.** `a2a-task-roundtrip.test.ts` holds the connection and polls `tasks/get` to `COMPLETED`. But A2A's whole point is that a Task is durable and re-queryable: a caller that disconnects must be able to `tasks/get` later and see `WORKING` / `INPUT_REQUIRED` / `COMPLETED`. `a2a-integration.md` projects run-status → TaskState (§"State projection") but never says the projection is **persisted** — so "query the Task an hour after the handoff" has no normative answer. The projection is computed on-the-fly from a run snapshot; nothing persists it as an A2A-shaped record with a stable `taskId` ↔ `runId` binding.

2. **No streaming re-attach (`tasks/resubscribe`).** A2A v0.3 lets a client re-subscribe to a Task's update stream after a disconnect (`tasks/resubscribe`) without re-sending the originating message. `a2a-integration.md` §3 shows `TaskStatusUpdateEvent`s flowing "A2A-direction" but never binds them to A2A's resubscribe — so a caller that drops the SSE/stream mid-run cannot re-attach; it can only re-poll. For an hours-long HITL run that is the difference between "push me when the approval clears" and "poll every N seconds forever."

3. **No push-notification config.** A2A `capabilities.push_notifications` lets a Task push a status change to a caller-registered webhook. The spec's `a2a-integration.md` §"What openwop does NOT specify" defers the *HMAC details* to A2A — correct — but never says how an OpenWOP host **registers** a push config for a Task or **which run transitions fire a push**. Without it, the only async pattern is poll, which doesn't scale to a roster of twins each holding several long-running cross-host handoffs.

4. **No `a2a` capability slot.** Discovery has no `a2a` block (the only `a2a` token in `capabilities.schema.json` is the `["rest","mcp","a2a","grpc"]` transport enum). A host can't honestly advertise "I expose myself as an A2A agent with durable/async tasks," so a cross-host caller can't feature-detect it. `a2a-integration.md` §Future-work lists adding this slot.

The spec is the right place because **cross-host async handoff is the canonical interop concern**: a twin on host A handing a long-running task to a twin on host B needs one agreed durable-Task + resubscribe + push contract, or every pair of hosts negotiates it bilaterally. This is **not** re-specifying A2A (openwop "is not in the agent-to-agent message-exchange business" — `a2a-integration.md` TL;DR); it is specifying the **OpenWOP side** of the composition under async: which run states persist as which durable TaskStates, how the run's event stream binds to `tasks/resubscribe`, and how a push fires. It is additive over the `FINAL` `a2a-integration.md` projection table, which it makes durable rather than changing.

## Proposal

### §1 — The `a2a` capability block (additive, `capabilities.schema.json`)

```jsonc
"a2a": {
  "supported": true,
  "agentCardUrl": "https://example.com/.well-known/agent-card.json",  // the A2A 0.3 well-known card
  "streaming": true,         // host supports message/stream + tasks/resubscribe (A2A capabilities.streaming)
  "pushNotifications": true,  // host supports push-notification config (A2A capabilities.push_notifications)
  "durableTasks": true        // NEW — host PERSISTS the projected Task; tasks/get returns live state after disconnect (§2)
}
```

Shape: `{ supported: boolean, agentCardUrl: string(uri), streaming?: boolean, pushNotifications?: boolean, durableTasks?: boolean }`, `additionalProperties: false`. This is the `a2a` slot `a2a-integration.md` Future-work names. `supported: true` with `durableTasks` absent/`false` ⇒ the host exposes A2A but only the **synchronous** round-trip already specified (today's behavior — no regression). `durableTasks: true` is the opt-in this RFC gates: the host MUST persist the projected Task per §2 and honor `tasks/get` / `tasks/resubscribe` / push per §3–§4.

### §2 — The durable Task projection record (`a2a-task-state.schema.json`, NEW)

When `durableTasks: true`, the host persists an **`A2ATaskState`** per backing run, durable for the run's whole lifecycle (surviving caller disconnect, host restart within the run's retention, and HITL pauses). It is the persisted form of the `a2a-integration.md` §"State projection" forward mapping — content-free of run internals beyond what A2A needs:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/a2a-task-state.schema.json",
  "title": "A2ATaskState",
  "type": "object",
  "additionalProperties": false,
  "required": ["taskId", "runId", "state", "updatedAt"],
  "properties": {
    "taskId":    { "type": "string", "minLength": 1, "description": "The A2A Task.id. MUST equal the backing OpenWOP `runId` (a2a-integration.md §2 — 'the returned runId becomes the A2A Task.id')." },
    "runId":     { "type": "string", "minLength": 1, "description": "The backing OpenWOP run. Bound 1:1 to `taskId`." },
    "contextId": { "type": "string", "description": "The A2A context_id (carried as the run tag `a2a:ctx_*` per a2a-integration.md §2)." },
    "state":     {
      "type": "string",
      "enum": ["submitted","working","input-required","auth-required","completed","failed","canceled","rejected"],
      "description": "The A2A v0.3 JSON-RPC wire form (lowercase-hyphen — a2a-integration.md §'Wire-shape spelling drift'). Projected from `run.status` per a2a-integration.md §'State projection (forward)': pending→submitted, running→working, paused→working, waiting-approval/waiting-input→input-required, completed→completed, failed→failed, cancelled→canceled."
    },
    "interruptKind": { "type": "string", "enum": ["approval","clarification"], "description": "Present iff `state == 'input-required'`. Disambiguates a2a-integration.md drift point #2 (both approval + clarification project to INPUT_REQUIRED) — carried in `Task.metadata.openwop.interrupt.kind`, the `metadata.openwop.*` shape the doc's Future-work asks to codify." },
    "updatedAt": { "type": "string", "format": "date-time" },
    "pushConfig": { "$ref": "#/$defs/PushConfig" }
  },
  "$defs": {
    "PushConfig": {
      "type": "object",
      "additionalProperties": false,
      "required": ["url"],
      "properties": {
        "url":            { "type": "string", "format": "uri", "description": "Caller-registered push target. The host MUST validate it through the RFC 0093 webhook-egress SSRF guard before any push (no private/loopback target)." },
        "tokenFingerprint": { "type": "string", "maxLength": 32, "description": "MAY — a truncated/salted digest of the caller's push-auth token (NEVER the raw token; same SR-1 rule as RFC 0083's `secretFingerprint`). The A2A push HMAC details (A2A §4.3.3) stay inside the A2A layer per a2a-integration.md." }
      }
    }
  }
}
```

The projection MUST follow the **existing** `a2a-integration.md` §"State projection (forward)" table verbatim (this RFC adds no new mapping — it persists the one already `FINAL`). The `interruptKind` field is the codified `metadata.openwop.*` carrier the doc's Future-work asks for (disambiguating drift point #2 durably). The record carries **no** run inputs/outputs/artifacts/credential material on this surface — artifacts project to A2A `Artifact`s over the A2A transport (`a2a-integration.md` §3), not into this persisted state record.

### §3 — Async lifecycle: `tasks/get` after disconnect + `tasks/resubscribe`

When `durableTasks: true`:

- **`tasks/get` MUST return live state after disconnect.** After the caller's `message/send` returns (or its stream drops), the caller MAY `tasks/get { id: taskId }` at any later time within the run's retention window; the host MUST return the current `A2ATaskState`-projected Task (the live `run.status`-derived `state`, including a paused-at-HITL `input-required`). The host MUST NOT require the caller to hold the original connection.
- **`tasks/resubscribe` MUST re-attach the update stream without re-sending.** When `streaming: true`, a caller that dropped the `message/stream` SSE MAY `tasks/resubscribe { id: taskId }` to re-attach to the `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent` stream (`a2a-integration.md` §3) from the current state forward. The host MUST NOT re-execute the run or re-accept the originating message on resubscribe; resubscribe is read-only re-attachment. Replay determinism is unaffected — the run's own RFC 0006 §C cache governs its execution; resubscribe only re-attaches an observer to the live event stream.
- **Resume across the boundary is unchanged.** An A2A Message reply into an `input-required` Task resolves the HITL interrupt exactly as `a2a-integration.md` §4 already specifies (the 5-action approval vocabulary). This RFC does not change resume; it makes the *waiting* durable + re-attachable.

### §4 — Push-notification config

When `pushNotifications: true`, a caller MAY register an A2A push config (`PushConfig`, §2) for a Task; the host MUST:

- **Validate the push `url` through the RFC 0093 webhook-egress SSRF guard** before any delivery (no private/loopback/link-local target) — a caller-supplied push URL is an SSRF surface identical to a webhook.
- **Fire a push on each durable TaskState transition** the caller subscribed to — at minimum on the transitions to `input-required`, `completed`, `failed`, `canceled` (the states a caller most needs without polling). The push body is an A2A `TaskStatusUpdateEvent` (composed per `a2a-integration.md` §3); its HMAC/signing follows A2A §4.3.3 (openwop defers the HMAC details per `a2a-integration.md` §"What openwop does NOT specify" — unchanged).
- **Never include run-internal content** in the push beyond the projected Task state + the A2A artifact references (SR-1 / `a2a-integration.md` trust-boundary — the push carries the same content-free projection as the persisted record).

### §5 — Trust boundary + replay (unchanged, restated for the async path)

The `a2a-integration.md` §"Trust boundary" and §"Operational mapping table" rows hold under async unchanged: A2A messages reaching run state stay `contentTrust: 'untrusted'`; an external A2A agent's result MUST NOT advance a HITL gate; a bridge node MUST cache an external A2A peer's response in the event-log payload and replace it from cache at replay (RFC 0006 §C). Async adds no new trust surface — a durable Task is the same projection, persisted; `tasks/resubscribe` is a read-only observer; a push is an outbound projection, SSRF-guarded.

### Examples

**Positive.** A host advertises `a2a: { supported:true, agentCardUrl, streaming:true, pushNotifications:true, durableTasks:true }`. An A2A client `message/send` → `Task{ id:"run_x", state:"working" }`; the client disconnects. The backing run pauses at an approval gate. The host persists `A2ATaskState{ taskId:"run_x", runId:"run_x", state:"input-required", interruptKind:"approval", updatedAt }` and fires a push to the caller's registered `pushConfig.url` (SSRF-validated). An hour later the client `tasks/get { id:"run_x" }` → `Task{ state:"input-required", metadata:{ openwop:{ interrupt:{ kind:"approval" } } } }`; it `tasks/resubscribe { id:"run_x" }`, re-attaches the stream, sends an approval Message reply (`a2a-integration.md` §4), and watches the run drive to `Task{ state:"completed" }` — all without re-sending the original message.

**Negative (sync host, no regression).** A host advertising `a2a: { supported:true, durableTasks:false }` exposes only the synchronous round-trip already specified; `tasks/get` after disconnect MAY return only the terminal/last-known state — exactly today's behavior. The async conformance subtests soft-skip.

**Negative (SSRF).** A `pushConfig.url` of `http://10.0.0.5/...` is rejected by the RFC 0093 webhook-egress guard before any push.

**Negative (schema).** An `A2ATaskState.state` of `WORKING` (UPPERCASE) fails — the persisted/wire form is the A2A v0.3 lowercase-hyphen variant (`a2a-integration.md` spelling-drift note). An `A2ATaskState` carrying run inputs/artifacts inline fails `additionalProperties:false`. A `PushConfig` carrying a raw push token (not a truncated fingerprint) violates SR-1.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). One NEW optional `a2a` capability block (absent ⇒ no A2A advertisement, today's behavior; `supported:true` + `durableTasks` absent ⇒ the synchronous round-trip already specified — explicitly unchanged). One NEW schema (`a2a-task-state.schema.json`) referenced by no existing required field. The async behavior is gated on `a2a.durableTasks` / `a2a.streaming` / `a2a.pushNotifications` — a host that doesn't advertise them is not measured against §3/§4. The run-status → TaskState projection is **unchanged** — this RFC persists the `FINAL` `a2a-integration.md` §"State projection" table, it does not edit the mapping. The host-side durable-task read seam (`GET /v1/a2a/tasks/{taskId}`) is a host-extension surface (a convenience read of the persisted projection); the *normative* A2A surface stays the A2A `tasks/get` JSON-RPC method per A2A v0.3 — no new openwop wire event, no `eventLogSchemaVersion` change. The `metadata.openwop.interrupt.kind` carrier codifies the `metadata.openwop.*` shape `a2a-integration.md` Future-work invited (additive — A2A clients ignore unknown metadata). No conformance pass is invalidated; the existing sync `a2a-task-roundtrip.test.ts` round-trip is untouched.

## Conformance

- **New subtests in `a2a-task-roundtrip.test.ts`** (the existing scenario, extended — keeps the fake-peer + real-peer modes):
  - **Capability shape (always-on, server-free):** the `a2a` block validates (`supported`, `agentCardUrl` uri, the three optional booleans); `A2ATaskState` validates with the lowercase-hyphen `state` enum and `taskId == runId`; a `state:"input-required"` record requires `interruptKind`; a `PushConfig` requires `url` and rejects a raw token; an UPPERCASE `state` fails.
  - **Durable `tasks/get` (gated on `a2a.durableTasks` via `describe.runIf`):** drive a backing run to a paused HITL state, *disconnect*, then `tasks/get` later returns the live `input-required` projection (not a stale `working`) with `metadata.openwop.interrupt.kind`.
  - **`tasks/resubscribe` (gated on `a2a.streaming`):** drop the stream mid-run, `tasks/resubscribe`, assert re-attachment delivers the next `TaskStatusUpdateEvent` from current state forward without the run re-executing (assert the backing `runId` is unchanged and no duplicate `run.started`).
  - **Push config SSRF (gated on `a2a.pushNotifications`):** registering a `pushConfig.url` at a private address is refused (reuses the RFC 0093 webhook-egress-guard fixture posture).
  - The two existing drift-point subtests (#3 AUTH_REQUIRED, #4 REJECTED) are unchanged.
- **Capability gating** per `capabilities.md` + `coverage.md`: every new subtest soft-skips when its sub-capability is unadvertised. The sync round-trip subtests stay always-on.
- **Reference host.** Deferred to `Active → Accepted` (file lands at `Draft`). The openwop-app work-twin suite (ADR 0033's deferred async-A2A item) is the intended evidence host; the host wiring is gated on this RFC reaching at least `Active`.

## Alternatives considered

1. **Specify a brand-new openwop async-handoff primitive (not A2A).** Rejected — openwop "is not in the agent-to-agent message-exchange business" (`a2a-integration.md` TL;DR / `positioning.md`); A2A *is* the cross-host async-handoff protocol and already has durable Tasks, `tasks/resubscribe`, and push. Inventing a parallel openwop primitive would duplicate A2A and fork the ecosystem. This RFC specifies only the OpenWOP *side* of the existing composition.
2. **Carry the full A2A Task object on a new openwop `run.*` event.** Rejected — it would re-specify A2A's wire on openwop's event log (an SR-1 + content-bloat surface) and couple `eventLogSchemaVersion` to A2A's schema. The projection is persisted as a host-side record (`A2ATaskState`) read via the A2A `tasks/get` method; the openwop event log is unchanged.
3. **Require synchronous-only A2A (status quo) + tell hosts to "just hold the connection."** Rejected — an hours-long HITL-gated run cannot hold a synchronous connection; this is the concrete gap the work-twin suite hits (a cross-host handoff that pauses for approval). The `a2a-integration.md` operational table already flags long-running + HITL edges the sync round-trip doesn't exercise.
4. **Make `durableTasks` mandatory whenever `a2a.supported` (no separate flag).** Rejected — a host may legitimately expose only short synchronous skills via A2A (the round-trip already shipped); forcing durable persistence on it is a breaking expansion of the existing sync contract. `durableTasks` is the additive opt-in, mirroring RFC 0083's `webhooks.durable` opt-in precedent.
5. **Do nothing.** Rejected — async cross-host handoff is exactly what an agent-platform host (openwop-app ADR 0033's ten twins) needs and the spec's own `a2a-integration.md` Future-work names the missing `a2a` capability slot; without a durable-Task + resubscribe + push contract, every host pair negotiates async bilaterally and "async A2A" can't be advertised honestly.

## Unresolved questions

1. **Durable-Task retention window.** How long must `tasks/get` return a Task after the backing run terminates — tie to the run-retention / RFC 0053 dead-letter `retentionDays`, or a separate `a2a.taskRetentionDays`? Proposed: reuse the run-retention window (a Task is a projection of a run; it lives as long as the run record); confirm against `rest-endpoints.md` run retention.
2. **Push transition set.** §4 floors the push on `input-required`/`completed`/`failed`/`canceled`. Should `working`-progress pushes (artifact produced) be in scope, or left to A2A `tasks/resubscribe` streaming? Proposed: floor on the four terminal/blocking transitions for push; leave progress streaming to resubscribe (a push per artifact is noisy + an egress-cost surface). Confirm.
3. **Multiple resubscribers.** May several A2A clients `tasks/resubscribe` the same Task concurrently (a twin handing off to a fan-out)? Proposed: yes — resubscribe is read-only observation, so N observers are safe (mirrors openwop's own SSE multi-observer model); confirm no per-Task single-subscriber assumption in A2A v0.3.
4. **`auth-required` projection under durable Tasks.** `a2a-integration.md` drift point #3 has openwop v1 with no native `auth-required` interrupt — the persisted `A2ATaskState.state` enum includes `auth-required` (the A2A value) for the *reverse* direction (consuming an external A2A agent), but the *forward* projection never emits it (openwop has no such run-status). Proposed: keep `auth-required` in the enum for reverse-direction fidelity; document that forward projection never sets it until a future v1.x adds an `auth` interrupt kind (the standing drift-point-#3 deferral). Confirm the enum carries both directions cleanly.

## Implementation notes (non-normative)

- **Sequencing.** Pure extension of `a2a-integration.md` (`FINAL`) + RFC 0093 (`Active` — the webhook-egress SSRF guard the push reuses) + RFC 0006 §C (replay cache, unchanged). No existing primitive changes; the run-status → TaskState mapping is persisted, not edited. Adds one capability block + one schema + the durable-task read seam + new conformance subtests.
- **Reference host.** The openwop-app work-twin suite (ADR 0033) is the intended evidence host: it would persist an `A2ATaskState` per A2A-backed run, serve durable `tasks/get`, wire `tasks/resubscribe` onto its existing run SSE stream (the run event stream already exists — resubscribe is a re-attach), and fire SSRF-guarded pushes on the four transitions. The host wiring is **gated on this RFC reaching at least `Active`**.
- **A2A version pin.** `a2a-integration.md` is pinned to A2A v1 / v0.3 JSON-RPC (`tasks/get`, `tasks/resubscribe`, `message/stream`, push-notification config per A2A §4.3.3). This RFC binds to those existing A2A methods — it adds no A2A method, only the OpenWOP-side persistence + advertisement.
- **Expected effort:** S for the capability block + `A2ATaskState` schema + shape conformance; M for the durable-task persistence + resubscribe re-attach + SSRF-guarded push on the reference host (much of which the run SSE stream + RFC 0093 egress guard already provide).

## Acceptance criteria

Checklist for `Active → Accepted` (file lands at `Draft`):

- [ ] `spec/v1/a2a-integration.md` §"Async / durable Tasks": durable lifecycle, `tasks/get`-after-disconnect, `tasks/resubscribe`, push-config; closes the doc's `a2a`-capability-slot + `metadata.openwop.*` Future-work items.
- [ ] `a2a-task-state.schema.json`; additive `a2a` block on `capabilities.schema.json`.
- [ ] Durable-task read seam in `openapi.yaml` (host-extension-named, ≥1 error response); the normative surface stays the A2A `tasks/get` JSON-RPC method.
- [ ] Conformance: the four new subtests in `a2a-task-roundtrip.test.ts` (capability-shape always-on; durable-get / resubscribe / push-SSRF gated) + `coverage.md`.
- [ ] CHANGELOG entry + INTEROP-MATRIX "Composition partners" async/durable column.
- [ ] All four Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host persists durable Tasks + passes the gated subtests, OR the RFC explicitly defers reference-host implementation.

## References

- [`spec/v1/a2a-integration.md`](../spec/v1/a2a-integration.md) — the A2A composition this RFC extends: the run-status ↔ TaskState projection (§"State projection", persisted unchanged), the status-updates-flow + resume sections (§3/§4), the lowercase-hyphen JSON-RPC wire form, the trust boundary + operational mapping table, and the Future-work items this RFC closes (`a2a` capability slot, `metadata.openwop.*` shape).
- [`conformance/src/scenarios/a2a-task-roundtrip.test.ts`](../conformance/src/scenarios/a2a-task-roundtrip.test.ts) — the existing sync round-trip (`message/send` → poll `tasks/get` → COMPLETED) the new async subtests extend; the fake-peer + real-peer modes are reused.
- [`RFCS/0093-protocol-hardening-webhooks-tokens-idempotency.md`](./0093-protocol-hardening-webhooks-tokens-idempotency.md) — the webhook-delivery-egress SSRF guard the §4 push-notification `url` validation reuses.
- [`RFCS/0083-durable-trigger-and-channel-bridge-profile.md`](./0083-durable-trigger-and-channel-bridge-profile.md) — the `webhooks.durable` opt-in precedent the `a2a.durableTasks` opt-in mirrors (additive durability behind a flag, the sync/best-effort default preserved).
- [`RFCS/0040-multi-agent-cross-host-causation.md`](./0040-multi-agent-cross-host-causation.md) — cross-host causation across the A2A boundary (`a2a-integration.md` operational table "identity propagation under multi-hop").
- A2A spec `https://a2a-protocol.org/latest/specification/` + canonical `.proto` `https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto` — `tasks/get`, `tasks/resubscribe`, `message/stream`, push-notification config (§4.3.3); the authoritative A2A wire openwop defers to.
- openwop-app **ADR 0033 — Work-twin connector reachability** — the motivating host; explicitly defers async A2A to "an upstream OpenWOP RFC" (this one). The host wiring is gated on this RFC reaching at least `Active`.
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.
```
