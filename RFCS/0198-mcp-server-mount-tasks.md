# RFC 0198: the MCP server mount maps long runs to MCP Tasks, and a disconnect cancels only the run it owns

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0198                                                            |
| **Title**         | the MCP server mount maps long runs to MCP Tasks, and a disconnect cancels only the run it owns |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — filed, and moved `Draft → Active` in the filing PR. **Comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation". This is an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194). §A.6 forbids bootstrap waiver language from shortening the comment window for an RFC of this risk class. The override falls outside the `MAINTAINERS.md` waiver grant and is recorded there as an override, not as a routine waiver. The RFC is in that class because it affects **replay** (interrupt resolution through `tasks/update`), **external effects** (a disconnect cancels a run that may be mid-effect) and **isolation** (task ids resolvable through `tasks/get` / `tasks/cancel`). Acceptance under this override is provisional, and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`). |
| **Affects**       | `spec/v2/core/interop.md` (new §"MCP tasks and cancellation"); `spec/v2/interop-map.json` + `interop-map.schema.json` (`pins.mcpTasks`, `mcp.tasks`; RFC 0208 creates the file); `schemas/v2/run-event-payloads.schema.json` (`runCancelled.reason` description: one registered value); `SECURITY/invariants.yaml` (+1); `spec/v1/mcp-integration.md` §D (one informative pointer); RFC 0153 (`Amended by` row); conformance (one new major-2 scenario) |
| **Compatibility** | `additive` per `COMPATIBILITY.md`. Tasks: §4 "new optional capability advertised, off by default". Cancellation: §4 "new normative requirement on a previously-undefined behavior". |
| **Supersedes**    | — (amends RFC 0153: reverses, for v2 only, its UQ4 resolution of 2026-08-16, "`io.modelcontextprotocol/tasks` is deliberately unmapped"; RFC 0153 otherwise stands and is not superseded) |
| **Superseded by** | —                                                               |

## Summary

An OpenWOP host that acts as an MCP server today has two options for a run that outlasts a request. It can hold `tools/call` open, or, at a HITL wait, answer `InputRequiredResult`. MCP 2026-07-28 makes the first option fragile: on streamable HTTP, "the server MUST treat a client disconnect as cancellation of that request". The corpus never says what that cancellation does to the run. This RFC maps the stable MCP Tasks extension (`io.modelcontextprotocol/tasks`, 2026-07-28) onto the v2 run. A tasked `tools/call` returns a durable handle, and that handle is the tenant-bound `runId`. `tasks/get`, `tasks/update` and `tasks/cancel` are `getRun`, `resolveInterruptByRun` and `cancelRun` under the caller's Subject. The RFC also fixes what a disconnect does. While the host still owes the request a response, the request owns the run, and cancelling the request cancels the run. Once the host has answered, no disconnect touches the run. This reverses RFC 0153 UQ4's "none first-class" decision for v2. It adds no OpenWOP capability field: the extension is advertised through MCP's own `server/discover`.

## Motivation

**The current text leaves the outcome undefined.** The current MCP profile (`spec/v1/mcp-integration.md` §B) says a broken response stream "loses the in-flight request and the client MUST re-issue it with a new JSON-RPC id". The legacy table (§2) says `pending`/`running` ⇒ "Request blocks". The live upstream cancellation page, fetched 2026-09-22, says:

> **Streamable HTTP**: Closing the SSE response stream is the cancellation signal. The server **MUST** treat a client disconnect as cancellation of that request. No `notifications/cancelled` message is required or expected.
> A server **MUST** send `notifications/cancelled` referencing a `subscriptions/listen` request ID when it tears down that subscription stream … Servers **MUST NOT** send `notifications/cancelled` for any other purpose.

Put these together and the outcome for a durable run behind a blocking `tools/call` is undefined when the network drops. The run might continue with nobody holding a handle: the client re-issues, a second run starts, and every external effect happens twice. Or the run might be cancelled, and nothing says so. The corpus also has the host *emitting* `notifications/cancelled` "as run state changes" (`mcp-integration.md` §1, legacy table). Upstream now forbids that for anything except tearing down `subscriptions/listen` (`review/verify-CD.md` C-F7(a)).

**The upstream tool for this exists and is stable.** The `modelcontextprotocol/ext-tasks` README lists `2026-07-28` as **Stable** (SEP-2663). The extension defines `CreateTaskResult` (`resultType: "task"`), `tasks/get`, `tasks/update` (which carries `inputResponses` for `input_required`), cooperative `tasks/cancel`, and a rule that a server "MUST NOT return `CreateTaskResult` until the task is durably created — that is, until a `tasks/get` for the returned `taskId` would resolve". An OpenWOP run meets that bar already: `createRun` MUST make the minted id readable (`runs.md`).

**Why UQ4 is reopened.** RFC 0153 UQ4 was resolved on 2026-08-16 as "none first-class … RFC 0100 owns durable interop. Promote only on evidence." A decision the window considered can be reversed only by a new RFC (`RFCS/README.md` §"Mint a new RFC"). Three pieces of evidence postdate that resolution or were not weighed in it:

1. The disconnect-is-cancellation MUST was not cited in RFC 0153 or in either review slice (verify-CD, cross-slice note 1).
2. RFC 0100's durable surface is A2A. An MCP client cannot use it, so for an MCP caller "RFC 0100 owns durable interop" means that no durable interop exists.
3. v2 has no MCP server-mount text at all. RFC 0208 homes it, and a v2 mount without Tasks would re-create the undefined outcome in the new major.

This RFC keeps what UQ4 protected: **the run stays the one durable unit.** An MCP task and an A2A task for the same run are two projections of one run with one id, not two records of work.

## Proposal

### §A Advertisement

1. A host MAY serve the extension on its v2 server mount. It advertises it in the `capabilities.extensions` of its `server/discover` result (ext-tasks §Capability Negotiation) **and** by listing the existing value `extensions` in `mcp.features[]`. It advertises it nowhere else, and this RFC adds no OpenWOP field.
2. A host that advertises it MUST implement the extension as published at revision 2026-07-28, and MUST implement the map's `mcp.tasks` rows (§D–§F).

### §B Task creation

3. A host MUST answer a `tools/call` that declared the extension with `CreateTaskResult` whenever the backing run is not terminal when the host answers, and never with `InputRequiredResult`. Upstream leaves the choice per request to the server. OpenWOP removes it for runs, so the suite can test the rule and a client that opted in always gets a handle.
4. A run that finishes before the host answers MAY be answered with the plain `CallToolResult`, as upstream allows.

### §C Identity and isolation

5. `taskId` MUST be the run's `runId` in its projected wire form (identity.md §5). Its opaque segment MUST carry at least 128 bits of entropy (ext-tasks §Security: "Servers MUST generate them with sufficient entropy that a third party cannot enumerate or guess them"). Upstream permits using task ids as bearer tokens. OpenWOP does not: **a `taskId` is never a credential.**
6. `tasks/get`, `tasks/update` and `tasks/cancel` are authorized as `getRun`, `resolveInterruptByRun` and `cancelRun` for the caller's Subject (the RFC 0208 §B incorporation rule). A task the caller cannot read gets `-32602`, the same response a nonexistent task gets, including when REST would answer a tenant mismatch with `403` (RFC 0208 §C). A `subscriptions/listen` request for such a task id leaves it out of the acknowledgement in the same way (map row).

### §D Status projection (`mcp.tasks.status`)

| `RunSnapshot.status` | `Task.status` |
| --- | --- |
| `pending`, `running`, `paused`, `cancelling`, `waiting-external` | `working` |
| `waiting-approval`, `waiting-input` | `input_required`, with one `inputRequests` entry per open interrupt, keyed by `interruptId`, projected as the MRTR `InputRequiredResult` row projects it (including RFC 0199 §D.2: never form mode for a `credential` interrupt or a non-flat or secret-marked schema) |
| `completed` | `completed`; `result` is the `CallToolResult` the call would have returned |
| `failed` | `completed`, with `result.isError: true`. Upstream reserves `failed` for a JSON-RPC error and says "MUST NOT be used to represent non-JSON-RPC errors, such as a tool result that completed with `isError: true`". A run's failure is a tool outcome, so `failed` is used only for a JSON-RPC error the host itself raises. |
| `cancelled` | `cancelled` |

`waiting-external` maps to `working` because no client input is outstanding. An `input_required` task with no `inputRequests` would violate ext-tasks §Task Polling item 2.

### §E `tasks/update` resolves interrupts, once

7. Each `inputResponses[<interruptId>]` resolves that interrupt exactly as an MRTR retry's `inputResponses` entry does (RFC 0208 `mcp.mrtr`): `accept`, `decline` or `cancel`, with the eligible-approver check `interrupt.md` requires. A key that was already answered, never issued, or is no longer open resolves nothing. An interrupt is resolved at most once, however many times it is answered, which satisfies upstream's "each request key … MUST be unique over the lifetime of a single task" by construction.
8. A resolution is an ordinary `interrupt.resolved` event. Replay and fork treat it as recorded history. They MUST NOT re-issue it or re-prompt (`replay.md`); this is existing law, restated here because a `tasks/update` is the new way to cause one.

### §F Reads, cancellation, TTL

9. The host MUST NOT append anything to a run's log to answer `tasks/get`.
10. `tasks/cancel` is acknowledged with an empty result and cancels the run as `cancelRun` does. On a terminal run it is acknowledged and nothing is appended (RFC 0194 §A.2).
11. `ttlMs` is `null`, or not shorter than the host's retention for the run. A host MUST NOT fail or cancel a run because a task's TTL elapsed: the TTL describes the handle, not the work. After purge, `tasks/get` returns `-32602`, which upstream explicitly allows ("It is compliant behavior for a server to return an error stating the task cannot be found if it has purged an expired task").

### §G Cancellation and disconnect (with or without Tasks)

12. **Until the host has sent its whole response to a request that starts or continues a run, the run belongs to that request.** A client disconnect on streamable HTTP, or a stdio `notifications/cancelled` naming the request, MUST cancel the run as `cancelRun` would: the same cascade and the same compensation rules. The run's `run.cancelled` carries `reason: "mcp-request-cancelled"`. "Continues" covers an MRTR retry.
13. **Once the response has been sent**, whether a `CreateTaskResult`, an `InputRequiredResult` or a final result, a disconnect MUST NOT affect the run. A task then ends through `tasks/cancel`, `cancelRun`, or its own terminal state.
14. A host MUST NOT send `notifications/cancelled` except to end a `subscriptions/listen` stream. In particular it MUST NOT use it to report that a run was cancelled. A cancelled blocking call is answered `CallToolResult { isError: true }`, and a cancelled task reads `cancelled`.

The cut in §G.12–13 is where the host can still tell the client what happened. Before the response, cancelling is the only outcome that leaves no orphan: a run that keeps executing after the client disconnected has external effects that no one can observe, and a re-issued call would start a second run. After the response, the client holds a handle (the task, the `requestState`, or the result), and the run must survive the network.

### Proposed text

`spec/v2/core/interop.md`, after RFC 0208's §"The operation mappings" (+200 core words):

```markdown
## MCP tasks and cancellation (RFC 0198)

A host MAY serve the MCP Tasks extension `io.modelcontextprotocol/tasks` (revision `2026-07-28`) on its server mount. It advertises it in its `server/discover` `capabilities.extensions` and by listing `extensions` in `mcp.features[]`, and nowhere else. A host that advertises it MUST implement the extension as published and the map's `mcp.tasks` rows, and:

- MUST answer a `tools/call` that declared the extension with `CreateTaskResult` whenever the run is not terminal when the host answers, never with `InputRequiredResult`;
- MUST use the run's projected `runId` (identity.md §5) as `taskId`, with an opaque segment of at least 128 bits of entropy. A `taskId` is never a credential;
- MUST NOT append to a run's log to answer `tasks/get`.

**Cancellation.** Until the host has sent its whole response to a request that starts or continues a run, the run belongs to that request: a client disconnect on streamable HTTP, or a stdio `notifications/cancelled` naming the request, MUST cancel the run as `cancelRun` would, with `run.cancelled.reason` `mcp-request-cancelled`. Once the response is sent, a disconnect MUST NOT affect the run; a task ends through `tasks/cancel`, `cancelRun`, or its own terminal state. A host MUST NOT send `notifications/cancelled` except to end a `subscriptions/listen` stream.
```

The §D–§F rules are rows in `spec/v2/interop-map.json` (`mcp.tasks.status`, `.methods`, `.fields`; about 290 words, not measured by the core budget, per RFC 0208 G1). The full rows are in the implementation plan.

### Examples

**Positive.** The client sends `tools/call { name: "conformance-approval", _meta: { "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/tasks": {} } } } }`. The host answers `{ resultType: "task", taskId: "acme~2Fr-Q2hc…", status: "input_required", ttlMs: null, … }`. The client calls `tasks/get`, which returns `input_required` with `inputRequests: { "acme/i-7Hk…": { method: "elicitation/create", … } }`. The client calls `tasks/update { inputResponses: { "acme/i-7Hk…": { action: "accept", content: {…} } } }` and gets `{ resultType: "complete" }`. A later `tasks/get` returns `completed` with `result: { content: […], isError: false }`. The log has exactly one `interrupt.resolved`.

**Negative.**
- The same request answered `{ resultType: "input_required", … }` violates §B.3.
- A `taskId` of `t-42` violates §C.5 (the grammar and the entropy requirement).
- `tasks/get` on another tenant's task answered `-32603` or `403` violates §C.6.
- A run behind a task-less `tools/call` that runs to `completed` after the client disconnected mid-call violates §G.12.
- A run cancelled because the client disconnected *after* receiving `CreateTaskResult` violates §G.13.
- A `notifications/cancelled` on a `tools/call` response stream when an operator cancels the run violates §G.14.

## Compatibility

**Additive.**

- **§A–§F** are a new optional capability, off by default (COMPATIBILITY §4, row 1). No host advertises the extension, and a host that does not advertise it is unaffected. No OpenWOP schema changes shape. `mcp.features[]` gains no member. The existing value `extensions` is reused, as architect review P3-H6 directs.
- **§G** applies to any v2 host with a server mount. v2 has no mount text today (RFC 0208 homes it), and no committed v2 bundle advertises `mcp.serverMount`, so this is "new normative requirement on a previously-undefined behavior" (§4, last row). Upstream already binds the request half, and this RFC defines only what that means for the run. §G.14 restates an upstream MUST.
- **`run.cancelled.reason`** is a free string. The new registered value is a description-only change to `runCancelled` (it already lists `v1_pin_unsupported` this way).
- **v1 is unchanged** beyond an informative pointer at `mcp-integration.md` §D ("not mapped in v1; v2 maps it, RFC 0198"). v1's disconnect semantics stay undefined: v1 takes corrections only, and a v1 MUST would need a v1 witness (P3-L1). This is recorded as gap G5.
- **Dependency.** RFC 0208 creates the registry and the mount rows this RFC's rows extend. This RFC's spec PR is ordered after RFC 0208's. If RFC 0208 were withdrawn, §D–§F would move into `interop.md` as an inline table, at about +90 words.
- **Core word budget:** +200 core words, no families homed, net **+200**. Neither `a2a` nor `mcp` is a v1-dependent family (see RFC 0208 G5).
- **No `traceparent` rule.** `_meta.traceparent` propagation belongs to RFC 0207 (architect review P3-M4).

## Conformance

One new major-2 scenario, `v2-mcp-tasks.test.ts`. Its gate: `mcp.serverMount` is present, `mcp.profiles ∋ mcp-2026-07-28`, and `server/discover` lists `io.modelcontextprotocol/tasks`. It uses the advertised fixtures `conformance-approval`, `conformance-failure`, `conformance-delay` and `conformance-cancellable`, each exposed as a tool under its workflowId (a suite requirement; `conformance/fixtures.md`). The disconnect legs also need `runList`, so they can find a run the client never got a handle for. None of it enters a floor.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 advertised through `server/discover` + `features` | `openwop.requirement.0198.advertised-via-discover`: if the extension is in the discover result, then `mcp.features ∋ extensions` (one direction only; see G9). Sabotage: advertised in discover without the feature | any host | witnessable — unaided |
| §B.3 a non-terminal run gets a task | `openwop.requirement.0198.task-when-nonterminal`: `resultType: "task"` for `conformance-approval` with the extension declared. Sabotage: answering `input_required` | the suite, unaided | witnessable — gated (fixture + advertisement) |
| §C.5 `taskId` is the run id | `openwop.requirement.0198.task-id-is-run-id`: `getRun(<taskId decoded>)` returns `200` with `workflowId: conformance-approval`, and the opaque segment is ≥ 22 base64url characters. Sabotage: an opaque handle unrelated to the run | the suite, unaided | witnessable — the entropy itself is **unwitnessable**; length is a proxy |
| §C.6 unreadable task = nonexistent | `openwop.requirement.0198.task-unreadable-not-found`: `-32602` for a fabricated same-tenant id, a foreign-tenant id, and B's `tasks/get` on A's task, all with identical shape. Sabotage: `403`, or `-32603` for the foreign id | the suite; the cross-caller half needs `OPENWOP_TEST_TENANT_B_API_KEY` | witnessable — gated (`blocked` without the second credential) |
| §C.6 listen acknowledgement omits unreadable ids | `openwop.requirement.0198.listen-omits-unreadable`: B's `subscriptions/listen { taskIds: [A's] }` acknowledges no ids. Sabotage: acknowledging it | the suite with two credentials | witnessable — gated |
| §D status projection | `openwop.requirement.0198.task-status-projection`: `input_required` keyed by the `interruptId` seen in `pollRunEvents`; `conformance-failure` ⇒ `completed` + `isError: true`. Sabotage: `failed` for a failed run | the suite, unaided | witnessable — gated |
| §E.7 one resolution however often answered | `openwop.requirement.0198.task-update-resolves-once`: two identical `tasks/update` calls give two acks and exactly one `interrupt.resolved`. Sabotage: a second resolution, or a `409` surfaced as a JSON-RPC error | the suite, unaided | witnessable — gated |
| §E.7 approver eligibility | `openwop.requirement.0198.task-update-approver-checked`: the `conformance-approval-approvers` fixture (whose `approversList` names a principal the suite's bearer is not): a `tasks/update` from that non-listed caller resolves nothing — the run stays `waiting-approval` and no `interrupt.resolved` is recorded. Sabotage: resolving without the eligibility check | the suite, unaided (the fixture makes the suite's own bearer the non-listed resolver) | witnessable — gated |
| §E.8 replay does not re-issue | — (a host's replay of a tasked run is not reachable through the mount) | — | witnessable — gated, by the existing `v2-run-fork-prefix` / replay rows. No new witness is claimed here; the rule is restated, not new |
| §F.9 `tasks/get` appends nothing | `openwop.requirement.0198.task-get-read-only`: the event count is unchanged across three polls of a suspended run (`heartbeat.*` excluded). Sabotage: a per-poll event | the suite, unaided | witnessable — gated |
| §F.10 `tasks/cancel` cancels | `openwop.requirement.0198.task-cancel-cancels-run`: after the ack, `getRun` reaches `cancelling`/`cancelled` within 10 s, and `tasks/get` later reads `cancelled`. On a terminal task: ack, no new event. Sabotage: ack with no cancel | the suite, unaided | witnessable — gated |
| §F.11 TTL never ends the run | — (it needs a clock past the host's TTL) | operator / time | **unwitnessable** in a bounded suite run; stated |
| §G.12 disconnect before the response cancels | `openwop.requirement.0198.disconnect-cancels-run`: a task-less `tools/call conformance-delay`, aborted after 500 ms. The run is found via `listRuns?workflowId=conformance-delay`, created after the call. It reaches `cancelled` with `run.cancelled.reason: "mcp-request-cancelled"`. Sabotage: the run completes | the suite, unaided | witnessable — gated on `runList` + fixture + the streamable-http transport (stdio is **unwitnessable** from a network suite) |
| §G.13 disconnect after the response does not | `openwop.requirement.0198.task-survives-disconnect`: after `CreateTaskResult` for `conformance-delay`, the connection is closed, and `tasks/get` later reads `completed`. Sabotage: the run cancelled | the suite, unaided | witnessable — gated |
| §G.14 no server `notifications/cancelled` | `openwop.requirement.0198.no-server-cancelled`: a blocking `tools/call conformance-cancellable` whose response is SSE is cancelled through REST `cancelRun`; the stream carries no `notifications/cancelled` frame and ends with `CallToolResult { isError: true }`. Sabotage: the legacy emit | the suite, unaided | witnessable — gated on an SSE response (a JSON response cannot carry the frame; recorded `inapplicable`) |

## Security

- **New invariant `mcp-task-tenant-scoped`** (tier `protocol`, severity `critical`, threat model `SECURITY/threat-model-interop.md`, witness `witnessable-gated`, test `v2-mcp-tasks.test.ts`). A task id resolves only for a Subject that could `getRun` it. An unreadable id is indistinguishable from a nonexistent one on `tasks/*` and on `subscriptions/listen`. A task id is never a credential.
- **External effects:** §G.12 bounds the orphan-effect window to "before the host answered". A candidate invariant, `mcp-request-bound-run-no-orphan`, is recorded as gap G3. It is not registered, because its stdio half is unwitnessable.
- **Content:** `statusMessage` is content-free (map row). `inputRequests` carry the same trust model as standalone elicitation (ext-tasks §Security: "A task is not a higher-trust channel"). `tasks/update` content never becomes authority (RFC 0208 `mcp.mrtr`).
- `SECURITY/threat-model-interop.md` gains a "task handle" paragraph covering enumeration, the handle-as-bearer case, and cross-caller subscription.

## Review record (RFC 0147 §A.2)

RFC 0153 is an RFC 0147 child (SR-6), so this amendment carries the five-lens pass:

| Lens | Outcome |
| --- | --- |
| Spec | Three free-standing MUST groups in core; the row-shaped rules in the RFC 0208 registry; UQ4 reversal recorded in `Supersedes`; RFC 0100 reconciled (one run, two projections) |
| Schema | No shape change; the registry's `mcp.tasks` group is optional in its schema; one description-only registered reason |
| Security | Tenant-bound ids with 128-bit entropy, never bearer; uniform not-found; subscription isolation; +1 invariant |
| Conformance | 14 rows, each with a named sabotage; four unwitnessable halves stated (entropy, TTL, stdio, replay) |
| Compatibility | Additive under §4 rows 1 and 6; v1 untouched; ordered after RFC 0208 |

## Alternatives considered

1. **Keep UQ4 (do nothing).** The upstream disconnect MUST still applies. Every long run behind a blocking call has an undefined fate on a network drop, and MCP clients have no durable handle at all.
2. **Detach on disconnect** (the run continues and the result is dropped). Rejected. No handle exists, the client MUST re-issue with a new id, and a second run duplicates every external effect. An idempotency key would need an MCP-level field that upstream does not have.
3. **A new OpenWOP field (`mcp.tasks: true`).** Rejected. `server/discover` is MCP's authoritative advertisement, and a second copy is card/runtime drift waiting to happen (the `a2a-card-runtime-consistent` lesson). The architect review also directs reusing `extensions` (P3-H6).
4. **An opaque task handle mapped to `runId`.** Rejected. It adds a second id namespace that needs its own tenant binding, when `runId` is already tenant-bound and readable through every v2 surface.
5. **Leave the task-vs-block choice to the server, per request (upstream's default).** Rejected for runs. §B.3 would then be unwitnessable, and a client that opted in could still be left blocking.
6. **Cancel on stdio `notifications/cancelled` only, and ignore HTTP disconnect.** This violates the upstream MUST.

## Unresolved questions

1. **Is §G.12 too harsh for an MRTR retry?** A dropped connection during the retry of a long approval flow cancels the run. The remedy is Tasks (§B), and a host that wants grace can answer every call with a task. A grace window was considered and rejected, because it re-creates the orphan window.
2. **Should every v2 `runId` carry 128 bits of entropy** (an `identity.md` §5 rule), rather than only runs projected as tasks? Doing so would be stricter validation of host-minted ids, which is a safety-fix question. It is left open (G4).
3. **Push delivery.** `notifications/tasks` rides `subscriptions/listen` only. An MCP equivalent of A2A push configs does not exist upstream, so there is nothing to map yet.
4. **Should a v1 current-profile host be bound by §G?** v1 is corrections-only. A v1 MUST needs a v1 witness (G5).

## Implementation notes (non-normative)

- **Witness.** No v2 host serves an MCP server mount (committed bundles: v2-reference's `mcp` record has no `serverMount`). openwop-app's v1 mount (`routes/mcp.ts`) is the shortest path. It needs a v2 advertisement, the Tasks extension, and a disconnect hook that calls its cancel path. v2-reference would build the mount from nothing (the arch-P3 "longest pole"). Either needs the steward's go for a production deploy.
- The rows extend RFC 0208's registry, so `check-interop-map.mjs` validates `mcp.tasks.status` as a total function over `RunSnapshot.status` from day one.

## Acceptance criteria

- [x] `Active` — 2026-09-22, by steward override of RFC 0147 §A.6. The window was waived, not run (see `Updated`).
- [x] RFC 0208's spec PR merged first (#1492). Then this RFC's `interop.md` section, `mcp.tasks` rows, the `runCancelled.reason` description and the invariant row merged, with `check-interop-map.mjs` green (and its two `mcp.tasks` sabotages, a deleted `waiting-external` row and `tasks/update → resolveInterrupt`, refused by `v2-interop-map-coherent`).
- [ ] `v2-mcp-tasks.test.ts` ships in a published suite minor, and its tarball is verified.
- [ ] A committed, certified v2 bundle from at least one host carries every witnessable row at `executed-pass` in strict mode, with nothing relaxed and no `partial-witness:` detail. `task-unreadable-not-found` and `listen-omits-unreadable` are exercised with the second credential.
- [x] `Amended by` row on RFC 0153; informative pointer in `spec/v1/mcp-integration.md` §D; CHANGELOG entry; RFC 0156 §B register row (`not-reviewed`, filed with the RFC).

## References

- MCP Tasks extension, revision 2026-07-28 (Stable, SEP-2663). Specification: <https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md>, §Capability Negotiation, §Supported Methods, §Task Creation, §Task Polling, §Task Update Requests, §Task Cancellation, §Error Handling, §Security Considerations. Schema: <https://github.com/modelcontextprotocol/ext-tasks/blob/main/schema/2026-07-28/schema.ts>. Overview: <https://modelcontextprotocol.io/extensions/tasks/overview>. All fetched 2026-09-22.
- MCP 2026-07-28 cancellation: <https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation> (source `docs/specification/2026-07-28/basic/patterns/cancellation.mdx`); streamable HTTP §Cancellation; `schema.ts` `CancelledNotification` ("Servers MUST NOT use this notification to cancel any other request"). Fetched 2026-09-22.
- RFC 0153 (UQ4, superseded for v2); RFC 0100 (the A2A durable-task counterpart); RFC 0208 (registry, incorporation, isolation); RFC 0194 (terminal event; override precedent); RFC 0147 §A.2/§A.5/§A.6; RFC 0156 §B.
- `review/arch-P3.md` P3-H5, P3-H6, P3-M4; `review/verify-CD.md` C-F3, C-F7(a); `review/verify-AB.md` A-F5.
