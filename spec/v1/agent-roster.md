# openwop Spec v1 — Standing Agent Roster + Workflow Portfolio

> **Status: DRAFT v1.x (filed via [RFC 0086](../../RFCS/0086-standing-agent-roster-and-workflow-portfolio.md), 2026-05-30).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the standing agent-instance record, the workflow-portfolio + inventory projection, the content-free `roster.run.initiated` attribution event, and the `capabilities.agents.roster` advertisement. The `GET /v1/agents/roster` endpoint, the SDK helpers, the behavioral attribution scenario, and the reference-host roster store land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop has manifest agents (RFC 0070), an inventory + dispatch surface (RFC 0072), tenant scoping (RFC 0074), live dispatch (RFC 0077), and — with RFC 0082 — a per-version deployment lifecycle. What it lacks is the **standing instance**: a named, tenant-local, mutable agent — the "digital-twin employee" `"Sally"` — that is **responsible, by role, for a portfolio of workflows** and that **fires that portfolio on schedules and on inbound work items**, with the resulting runs **attributed back to it**. The [`AgentManifest`](../../schemas/agent-manifest.schema.json) is the *class* (a pack-distributed, immutable template whose `agentId` pattern deliberately excludes the `host:<id>` instance form), and the RFC 0082 deployment record is the *version channel* (which build serves). Neither is the *named worker that owns standing work*. An adopter that needs this carries it entirely in a host-private record — invisible to discovery, to conformance, to `/.well-known/openwop`, and to any second host.

This document adds that instance **additively**: a [roster entry](../../schemas/agent-roster-entry.schema.json) keyed by a `host:<id>` `rosterId`, carrying `persona` (the human name), an `agentRef` (the manifest/deployment it instantiates), a `workflows[]` portfolio, an owner triple (RFC 0048, tenant-scoped per RFC 0074), and an `enabled` flag; an inventory projection so a peer/operator can discover an agent's responsibilities; one content-free `roster.run.initiated` recorded-fact event that attributes a trigger-fired run to the member; and an `agents.roster` capability. Triggers **compose** existing primitives — schedules via RFC 0052, durable inbound work items via RFC 0083 — so this surface adds **no new `WorkflowTrigger.type`**, and the concrete work surface (a Kanban board, a queue, an inbox) stays a host/vendor extension.

## §A — The roster entry + the `host:<id>` dispatch handle

A [roster entry](../../schemas/agent-roster-entry.schema.json) is a host-local, tenant-scoped, **mutable** record — the standing agent instance. It is deliberately *not* the manifest (immutable, pack-distributed) and *not* the deployment record (per-version); it **references** them via `agentRef` (`agentId` + an optional exact `version` XOR a `channel`, per RFC 0082 §A).

`rosterId` **MUST** be a `host:<id>` form — the runtime-synthesis namespace [`AgentRef`](../../schemas/agent-ref.schema.json) reserves for host-internal agents that don't ship as packs (RFC 0002). It is a **dispatchable** id, not a parallel id space: a `WorkflowNode.agent: { "agentId": "<rosterId>" }` (or a `POST /v1/runs` against it) **MUST** be resolved by the host to the entry's bound `agentRef`, **MUST** project the entry's `persona` onto the resulting dispatch `AgentRef`, and **MUST** emit `roster.run.initiated` (§C). The manifest schema still forbids `host:<id>` as a *manifest* `agentId` (RFC 0070); this surface names the runtime instance the reserved form was always for. `persona` reuses `AgentRef.persona` semantics (RFC 0002). `workflows[]` is the standing portfolio; an entry **MUST NOT** list a workflow outside its `owner` tenant scope (the WCT/CTI carry-forward). `enabled: false` makes the entry's portfolio **triggers** inert (no run fires) without deleting it; a disabled member **SHOULD** remain discoverable so an operator can see paused workers.

## §B — Portfolio discovery

A host advertising `agents.roster` exposes the standing roster at two additive sibling reads (lands at `Active → Accepted`):

```
GET /v1/agents/roster              → { "roster": AgentRosterEntry[], "total": integer }
GET /v1/agents/roster/{rosterId}   → AgentRosterEntry
```

Both **MUST** be tenant-scoped exactly as RFC 0074 scopes `GET /v1/agents`: a `'tenant'`-install host returns only entries within the authenticated principal's owner triple, and an entry outside it **MUST** `404` (never disclosing another tenant's roster). Additionally, the RFC 0072 inventory entry ([`agent-inventory-response.schema.json`](../../schemas/agent-inventory-response.schema.json)) gains an **additive optional** `roster` projection — the standing instances of a manifest agent visible to the caller, each with its `persona` + `workflows[]` portfolio — so a single `GET /v1/agents` call surfaces responsibilities. A host that omits `agents.roster` omits these fields and `501`s the reads.

## §C — Run attribution: `roster.run.initiated`

When a trigger (a schedule per RFC 0052, or a durable work item per RFC 0083) fires a workflow **that is in a roster entry's portfolio**, the host **MUST** emit one [`roster.run.initiated`](../../schemas/run-event-payloads.schema.json) event as a recorded fact on the resulting run, attributing it to the standing agent. The host **MUST** emit it once, immediately after `run.started` (the run's first event) and before any agent invocation — a portfolio workflow MAY contain non-agent nodes or several agent invocations, so attribution is to the *run*, not to a single `agent.invocation.started` bracket.

The payload is **content-free** (`roster-attribution-no-content`): `{ rosterId, persona, agentId, workflowId, triggerSource, triggerSubscriptionId? }` — ids + persona + trigger source ONLY, never the inbound work-item body, the resolved prompt, or credential material (SR-1). It is a **recorded-fact event** per [`replay.md`](./replay.md) §"Recorded-fact events": on replay against a checkpoint the host **MUST** re-emit it from the log and **MUST NOT** regenerate its identifiers — so a replayed run is attributed to the same member even if the entry was since renamed, re-pointed, or deleted. When the fire came through the RFC 0083 trigger bridge, `triggerSubscriptionId` carries the subscription id so the trigger → run → roster chain resolves via `/ancestry` (RFC 0040).

## §D — Triggers compose existing primitives (no new `WorkflowTrigger.type`)

This surface adds **no** new trigger type. A roster entry's portfolio fires through existing primitives: **scheduled** portfolio runs use RFC 0052 (the `schedule` `WorkflowTrigger`); **inbound work-item** portfolio runs use RFC 0083 (a durable `trigger-subscription` with at-least-once delivery, dedup, retry, dead-letter, and the trigger→run `causationId`). The roster entry binds the *owner* + supplies the §C attribution; the firing contract stays RFC 0052/0083 (no double-ownership of trigger semantics).

## §E — The work surface stays a host/vendor extension

This surface does **not** standardize Kanban boards, columns, cards, swimlanes, or any concrete work-item UI (the RFC 0083 §E channels-stay-extensions precedent). A host's board is a host/vendor extension; what it MUST do to participate is **bridge a "work item entered the watched column" event into an RFC 0083 trigger delivery** that fires a roster-portfolio workflow, so the §C attribution + the RFC 0040 causation chain hold. A future RFC MAY standardize a single `kanban.card.moved` event behind a `host.kanban` capability iff cross-host demand appears — out of scope here.

## §F — Capability advertisement (`agents.roster`)

```jsonc
"agents": { "roster": {
  "supported": true,
  "installScope": "tenant",                 // 'host' | 'tenant' — MUST equal agents.manifestRuntime.installScope (RFC 0074)
  "portfolioTriggerSources": ["schedule", "queue", "webhook"]
}}
```

`agents.roster` **REQUIRES** `agents.manifestRuntime.supported: true` (a roster entry instantiates a manifest agent — RFC 0070); advertising `roster` without `manifestRuntime` is a `validation_error`. `agents.roster.installScope` **MUST equal** `agents.manifestRuntime.installScope`. Truthful advertisement (RFC 0031): a source not listed in `portfolioTriggerSources` does not fire portfolios on this host. A host that omits the block does not maintain a roster (today's default); the behavioral conformance scenarios skip cleanly.

## Open spec gaps

| Gap | Disposition |
|---|---|
| `GET /v1/agents/roster[/{id}]` + roster-management endpoints | Deferred to `Active → Accepted` (OpenAPI/AsyncAPI + SDK helpers). The read surface is the interop slice; management is host-private at v1.x. |
| Behavioral attribution + scoping conformance | Deferred to `Active → Accepted` (gated on `agents.roster.supported`); the always-on `agent-roster-shape.test.ts` asserts the wire contract now. |
| Reference-host roster store | Demonstrated as a host-extension at `/v1/host/sample/roster` (apps/workflow-engine); the normative `GET /v1/agents/roster` reference wiring lands at `Active → Accepted`. |
| Dispatch-as-agent (resolving `agentRef` → the executing agent) | The reference impl attributes by `agentRef`; executing the portfolio workflow *as* that agent is deferred. |
| `kanban.card.moved` as a normative event | Deferred to a future `host.kanban` RFC iff cross-host demand appears (§E). |
