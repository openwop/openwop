# Scenario walkthroughs

Three end-to-end examples of OpenWOP runs, showing the workflow definition, the wire-level events the host emits, and what the client sees. Each scenario links back to the normative spec sections that govern its surface.

Reading time: ~15 minutes total. Each scenario is independent — skim the one that matches what you're building.

## Scenario A — Single agent with human approval

**What it shows:** the most common pattern — a supervisor agent makes a decision, asks for human confirmation, resumes when the human answers, and terminates.

**Spec surfaces touched:** [run lifecycle](/spec/v1/run-options.html), [interrupts](/spec/v1/interrupt.html), [stream modes](/spec/v1/stream-modes.html).

### Workflow definition

```json
{
  "id": "wf-approve-and-act",
  "version": 1,
  "nodes": [
    { "id": "decide",  "typeId": "core.orchestrator.supervisor" },
    { "id": "ask",     "typeId": "core.hitl.clarify" },
    { "id": "act",     "typeId": "core.http.request" }
  ],
  "edges": [
    { "from": "decide", "to": "ask" },
    { "from": "ask",    "to": "act" }
  ],
  "channels": [
    { "name": "decision", "type": "string" },
    { "name": "approval", "type": "boolean" }
  ]
}
```

### Wire trace

Client creates the run:

```http
POST /v1/runs
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: ck-2026-05-21-001

{ "workflowId": "wf-approve-and-act", "inputs": { "url": "https://api.example.com/charge" } }
```

Host responds:

```http
HTTP/1.1 201 Created
{ "runId": "run-abc", "status": "pending" }
```

Client opens an SSE stream:

```http
GET /v1/runs/run-abc/events?streamMode=updates
Accept: text/event-stream
```

Events flow:

```
event: run.started        { "runId": "run-abc", "ts": "2026-05-21T18:00:00Z" }
event: agent.reasoned     { "agentId": "supervisor", "decision": "ask-user" }
event: run.interrupted    { "interrupt": { "kind": "clarification", "prompt": "Charge $42 to example.com?" } }
```

The run is now `paused`. The host serializes its state and waits.

### Human answers, run resumes

```http
POST /v1/runs/run-abc:resume
{ "answer": { "approval": true } }
```

Events continue:

```
event: run.resumed        { "ts": "2026-05-21T18:02:14Z" }
event: node.started       { "nodeId": "act" }
event: node.completed     { "nodeId": "act", "output": { "status": 200 } }
event: run.completed      { "result": "ok" }
```

The `runId` is stable across the pause; deep linking, replay, and fork all work against the same id.

### What just happened, normatively

1. `POST /v1/runs` with `Idempotency-Key` accepted per [`idempotency.md`](/spec/v1/idempotency.html). The same key on retry returns the existing run.
2. The orchestrator emitted `agent.reasoned { decision: "ask-user" }` per [RFC 0002](/rfcs/0002-agent-identity-and-reasoning-events.html).
3. `run.interrupted` with `kind: "clarification"` per [`interrupt.md`](/spec/v1/interrupt.html) §A. The run is in `paused` status.
4. `POST /v1/runs/{runId}:resume` accepts the answer per [`interrupt.md`](/spec/v1/interrupt.html) §"Resume contract." The host MUST validate the answer shape before resuming.
5. SSE event ordering preserved across the pause — `run.resumed` follows the last pre-pause event with no gap in sequence per [`stream-modes.md`](/spec/v1/stream-modes.html).

---

## Scenario B — Multi-agent fan-out with envelope retries

**What it shows:** a supervisor dispatches to two worker agents in sequence, each producing a typed envelope. The second agent's first envelope fails schema validation and the host retries automatically before the run continues.

**Spec surfaces touched:** [multi-agent execution](/spec/v1/multi-agent-execution.html), [AI envelope](/spec/v1/ai-envelope.html), [RFC 0032](/rfcs/0032-envelope-reliability-events.html) reliability events.

### Workflow definition

```json
{
  "id": "wf-research-and-summarize",
  "version": 1,
  "nodes": [
    { "id": "supervise", "typeId": "core.orchestrator.supervisor" },
    { "id": "research",  "typeId": "core.openwop.agents.deep-research",
      "config": { "envelope": "research.findings" } },
    { "id": "summarize", "typeId": "core.llm.chat",
      "config": { "envelope": "summary.brief", "model": "claude-sonnet-4-6" } }
  ],
  "edges": [
    { "from": "supervise", "to": "research"  },
    { "from": "supervise", "to": "summarize" }
  ]
}
```

`fanOutPolicy: "sequential"` is the default per [RFC 0022](/rfcs/0022-dispatch-mapping.html); see that RFC for the parallel variant.

### Wire trace

Run starts. Supervisor dispatches to `research`:

```
event: run.started
event: agent.reasoned     { "agentId": "supervisor", "decision": "next-worker",
                            "nextWorkerIds": ["research", "summarize"] }
event: dispatch.started   { "workerId": "research" }
event: agent.toolCalled   { "callId": "tc-001", "agentId": "research", "tool": "web.search" }
event: agent.toolReturned { "callId": "tc-001", "resultDigest": "sha256:…" }
event: envelope.emitted   { "envelope": "research.findings", "valid": true }
event: dispatch.completed { "workerId": "research" }
```

Supervisor dispatches to `summarize`. First attempt at the summary envelope fails schema validation:

```
event: dispatch.started   { "workerId": "summarize" }
event: envelope.emitted   { "envelope": "summary.brief", "valid": false }
event: envelope.retry.scheduled { "attempt": 2, "reason": "schema-violation" }
event: envelope.emitted   { "envelope": "summary.brief", "valid": true }
event: dispatch.completed { "workerId": "summarize" }
event: run.completed
```

### What just happened, normatively

1. `agent.reasoned { decision: "next-worker", nextWorkerIds: [...] }` is the supervisor decision per [RFC 0037](/rfcs/0037-multi-agent-execution-model.html) §"Decision routing."
2. `core.dispatch` iterates `nextWorkerIds` sequentially per [RFC 0022](/rfcs/0022-dispatch-mapping.html) §A. The parent variable bag is the cross-worker handoff channel per §D.
3. The first `envelope.emitted { valid: false }` triggers a host-side retry per [RFC 0032](/rfcs/0032-envelope-reliability-events.html) §B.2 — `envelope.retry.scheduled` carries the attempt count and the canonical `reason`.
4. If the retry budget were exhausted, the run would terminate with `envelope_invalid` (see [Error codes](/errors/) §"Envelope validation"). Here the second attempt validated.
5. `agent.toolCalled` + `agent.toolReturned` pair via shared `callId` per [RFC 0002](/rfcs/0002-agent-identity-and-reasoning-events.html). The tool's args + result are persisted as SHA-256 digests only — never raw — per SR-1 + MCP-1 invariants in [`/security/`](/security/).

---

## Scenario C — Suspend, restart, replay-fork from checkpoint

**What it shows:** a long-running workflow is interrupted by a host restart, comes back up from its event log, and the operator forks a new run from a historical checkpoint to test a policy change.

**Spec surfaces touched:** [replay](/spec/v1/replay.html), [storage adapters](/spec/v1/storage-adapters.html), [version negotiation](/spec/v1/version-negotiation.html).

### Setup

A run started yesterday with the SQLite reference host. Mid-run, the host process restarts.

```
event: run.started        { "runId": "run-xyz" }
event: node.completed     { "nodeId": "fetch-data" }
event: node.completed     { "nodeId": "transform" }
                          ← host process exits here
```

### Host comes back up

On startup, the host scans its event log for runs in non-terminal status. For `run-xyz` it finds the last event and resumes:

```
event: run.resumed        { "ts": "2026-05-21T19:00:00Z",
                            "fromEventLogIdx": 5 }
event: node.started       { "nodeId": "publish" }
event: node.completed     { "nodeId": "publish" }
event: run.completed      { "result": "ok" }
```

The `fromEventLogIdx` field on `run.resumed` identifies the last persisted event the host saw before the restart. Per [`replay.md`](/spec/v1/replay.html) §"Resume after restart," this is how clients can deduplicate if their downstream had partial state.

### Operator forks from a historical checkpoint

A policy change in the `transform` node means the operator wants to re-run the second half of yesterday's pipeline with the new logic, without re-fetching data.

```http
POST /v1/runs/run-xyz:fork
{ "forkAtEventLogIdx": 4,
  "configurable": { "transformMode": "v2" } }
```

Host responds:

```http
HTTP/1.1 201 Created
{ "runId": "run-xyz-fork-1",
  "forkedFrom": "run-xyz",
  "forkAtEventLogIdx": 4,
  "status": "pending" }
```

The new run replays events 0..3 from the parent (`fetch-data` and `transform`'s first half), then begins fresh execution from event 4 with the new `transformMode: "v2"`. The original `run-xyz` is unchanged.

### What just happened, normatively

1. The host's event-log adapter MUST persist events in monotonic order per [`storage-adapters.md`](/spec/v1/storage-adapters.html) §"Event-log contract." Restart resumes from the last persisted entry.
2. `run.resumed` MUST carry `fromEventLogIdx` if the resume crossed a host restart per [`replay.md`](/spec/v1/replay.html).
3. `POST /v1/runs/{runId}:fork` is normative for replay-fork per [`replay.md`](/spec/v1/replay.html) §"Fork contract." The fork is byte-equivalent to the parent up to `forkAtEventLogIdx`; only events past that index are re-executed.
4. The fork carries a new `runId` so client-side deep links to the parent remain stable.
5. Per-region clock fields MAY differ on the fork (the fork executes "now", not at the parent's event times) per [`replay.md`](/spec/v1/replay.html) §"Cross-region replay (RFC 0036)."

---

## What these scenarios skip

Three things deliberately left out, all linked here for the curious:

- **Auth handshake** — every request carries `Authorization: Bearer …`. See [Auth profiles](/spec/v1/auth-profiles.html) for OAuth2 / OIDC / mTLS variants.
- **Webhook delivery** — the SSE stream above is the synchronous view; production hosts also deliver every event over HMAC-signed webhooks per [`webhooks.md`](/spec/v1/webhooks.html).
- **BYOK secret resolution** — the `summarize` node in Scenario B used a host-managed Anthropic key. For BYOK, see [`auth.md`](/spec/v1/auth.html) §"BYOK provider routing."

## Where to go next

| Want to | Go to |
|---|---|
| See the actual workflow-definition schema | [`/schemas/workflow-definition.schema.json`](/schemas/workflow-definition.schema.json) |
| Walk through the full REST endpoint catalog | [`/api/rest/`](/api/rest/) |
| See the production-shaped host that does all this end-to-end | [Postgres reference host](https://github.com/openwop/openwop/tree/main/examples/hosts/postgres) |
| Run scenario A against the live demo | [app.openwop.dev](https://app.openwop.dev/) |
