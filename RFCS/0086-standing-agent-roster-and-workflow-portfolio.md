# RFC 0086: Standing Agent Roster + Workflow Portfolio

| Field | Value |
| --- | --- |
| **RFC** | 0086 |
| **Title** | Define a **standing agent roster** — a named, tenant-scoped, mutable agent _instance_ (the "digital-twin employee", e.g. `"Sally"`) that **references** a manifest/deployment (`agentId` + optional `version`/`channel`), **owns a workflow portfolio** (the workflows it is responsible for by role), and to which **trigger-fired runs are attributed** as a content-free recorded fact — composing RFC 0070/0072 (manifest agents + inventory), RFC 0082 (`@channel` binding), RFC 0052 (schedule triggers) and RFC 0083 (durable work-item triggers), while keeping per-host work surfaces (Kanban boards) as host/vendor extensions |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-30 |
| **Updated** | 2026-05-31 (`Active → Accepted` — graduated on a non-steward host. **MyndHyve `workflow-runtime` (rev `workflow-runtime-00424-kam`, live on `https://api.myndhyve.ai`) advertises `agents.roster` field-for-field** — `{supported:true, installScope:"tenant", portfolioTriggerSources:["schedule","queue","webhook"]}` with `installScope` equal to `agents.manifestRuntime.installScope` (§F MUST) — **serves the NORMATIVE `GET /v1/agents/roster[/{rosterId}]`** (steward-curl-verified 401 auth-gated, route mounted — not a `/v1/host/sample/*` extension), and emits the content-free `roster.run.initiated`. See [Amendment record](#amendment-record). |
| **Affects** | NEW `schemas/agent-roster-entry.schema.json` (the standing named-instance record) · `schemas/agent-inventory-response.schema.json` (additive optional `portfolio` + `rosterId`/`persona` projection on the RFC 0072 inventory entry) · `schemas/run-event.schema.json` (additive `RunEventType`: `roster.run.initiated`) · `schemas/run-event-payloads.schema.json` (one content-free payload) · `schemas/capabilities.schema.json` (additive optional `agents.roster` block) · `spec/v1/agent-roster.md` (NEW normative doc) · `api/openapi.yaml` (additive `GET /v1/agents/roster` + `GET /v1/agents/roster/{rosterId}`) · `api/asyncapi.yaml` · `SECURITY/invariants.yaml` · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop has manifest agents (RFC 0070), an inventory + dispatch surface (RFC 0072), tenant scoping (RFC 0074), live dispatch (RFC 0077), and a **version** deployment lifecycle (RFC 0082). What it **lacks is the standing instance**: a named, tenant-local, mutable agent — the "digital-twin employee" `"Sally"` — that is **responsible, by role, for a portfolio of workflows** and that **fires that portfolio on schedules and on inbound work items**, with the resulting runs **attributed back to it**. Today the manifest is the _class_ (a pack-distributed, immutable template — RFC 0003 §C; its `agentId` pattern explicitly **excludes** the `host:<id>` instance form), and RFC 0082's "deployment" is the _version channel_ (which build serves). Neither is the _named worker that owns standing work_. The live platform proves the shape is real but **non-portable**: an adopter (MyndHyve) carries this entirely in a private `AutomationAgent` record (`name` + `workflowIds[]` + `schedule` + `kanbanAccess`), which no other host can discover, attribute, or interoperate with. This RFC standardizes that instance **additively**: a **roster entry** (`agent-roster-entry.schema.json`) keyed by a host-local `rosterId`, carrying `persona` (the human name, mirroring `AgentRef.persona`), an `agentRef` (the manifest/deployment it instantiates), a **`workflows[]` portfolio**, an owner triple (RFC 0048, tenant-scoped per RFC 0074), and an `enabled` flag; an **inventory projection** so a peer/operator can discover an agent's responsibilities; one content-free **`roster.run.initiated`** recorded-fact event that attributes a trigger-fired run to the roster member; and an **`agents.roster`** capability. Triggers **compose** existing primitives — schedules via RFC 0052, durable inbound work items via RFC 0083 — so this RFC adds **no new `WorkflowTrigger.type`**, and the concrete work surface (a Kanban board, a queue, an inbox) stays a host/vendor extension. No existing field, event, or endpoint changes.

## Motivation

Three concrete gaps, each visible on the live platform:

1. **No standing named instance — only the class and the version.** An `AgentManifest` is an immutable pack template (RFC 0003 §C) whose `agentId` pattern (`agent-manifest.schema.json` §`agentId`) **reserves `host:<id>` out** precisely because the manifest is _not_ an instance. RFC 0082 adds a _version_ deployment lifecycle (`agentId@stable`, canary, rollback) — "which build serves", not "which named worker owns standing work". So "Sally in Marketing is responsible for the email-campaign workflow and four other digital-marketing chains, on her own cadence" is **inexpressible in the protocol**: it is neither a manifest edit (the pack ships once, identically, to every tenant) nor a version channel (Sally is not a build of an agent). It is a tenant-local, mutable _instance_ — a surface openwop does not yet name.

2. **No portable portfolio → no discoverable responsibilities + no attribution.** When a scheduled job or an inbound work item starts a run today, nothing on the wire says _which standing agent it ran on behalf of_. RFC 0077's `agent.invocation.started` carries the `agentId` (the class) and RFC 0082 carries the resolved `version` (the build), but neither carries the _named worker_. An operator's Mission Control cannot answer "what is Sally responsible for, and which of her runs fired overnight?"; an audit cannot attribute a run to the standing agent that owns it; a peer host cannot discover an agent's portfolio. The adopter that already needs this (MyndHyve) keeps `AutomationAgent.workflowIds[]` and `assignedAgentName` host-private — so it is invisible to conformance, to `/.well-known/openwop`, and to any second host.

3. **Triggers exist but are not bound to a standing owner.** RFC 0052 (schedule) and RFC 0083 (durable trigger bridge: webhook/schedule/queue/email/form) give the _firing_ machinery, but a fired run is anonymous — it is not "Sally's 9am campaign run". There is no contract that says "this portfolio workflow, when fired by this trigger, runs **as** this roster member and records that fact." Without it, the standing-worker model can only be built host-private, exactly as MyndHyve did.

The spec is the right place because _the standing-instance identity_, _the portfolio-discovery projection_, and _the run→roster attribution_ are cross-host interop + observability concerns: a peer host dispatching to "Sally", an operator console showing her responsibilities, and an audit trail attributing her overnight runs all need one agreed contract. The _roster store_ (where entries live), the _scheduling cadence_, and above all the _concrete work surface_ (a Kanban board, a ticket queue) stay host implementation choices; this RFC fixes the instance record, the discovery projection, the attribution event, and the capability gate — additively, composing the trigger primitives rather than duplicating them.

## Proposal

### §A — The roster entry (`agent-roster-entry.schema.json`)

A **roster entry** is a host-local, tenant-scoped, **mutable** record — the standing agent instance. It is deliberately _not_ the manifest (immutable, pack-distributed) and _not_ the deployment record (per-version). It **references** them:

```jsonc
{
  "rosterId": "host:sally-marketing",          // host-issued stable instance id (the host:<id> form RFC 0070 reserves)
  "persona":  "Sally",                          // human display name; projected onto AgentRef.persona on dispatch
  "agentRef": {                                 // which manifest/deployment this instance runs (RFC 0002/0070/0082)
    "agentId": "core.openwop.agents.brief-writer",
    "channel": "stable"                         // OR "version": "2.3.1" — XOR per RFC 0082 §A; absent ⇒ host default
  },
  "workflows": [                                // the standing portfolio: workflows this agent owns by role
    "marketing-email-campaign",
    "social-post-scheduler"
  ],
  "owner": { "tenantId": "acme", "workspaceId": "growth" },   // RFC 0048 triple; tenant-scoped per RFC 0074
  "enabled": true,                              // when false, the entry's portfolio triggers are inert (do not fire)
  "label": "Marketing Brief Writer",            // optional UI label; falls back to persona
  "description": "Owns outbound email + social campaign workflows."
}
```

`rosterId` **is** a valid wire-level `host:<id>` AgentRef `agentId` — it reuses the runtime-synthesis namespace that `agent-ref.schema.json` already reserves for "host-internal AgentRefs that don't ship as packs" (RFC 0002), **not** a parallel id space. This is the dispatch handle for "run as Sally": a `WorkflowNode.agent: { "agentId": "host:sally-marketing" }` (or `POST /v1/runs` against that id) **MUST** be resolved by the host to the roster entry's bound `agentRef` (the manifest/deployment that actually executes — §A `agentRef`), **MUST** project the entry's `persona` onto the resulting dispatch `AgentRef`, and **MUST** emit `roster.run.initiated` (§C) attributing the run to the entry. The manifest schema still forbids `host:<id>` as a _manifest_ `agentId` (RFC 0070) — this RFC does not change that; it names the runtime instance the reserved form was always for. `persona` is the human name and **reuses** the existing `AgentRef.persona` semantics (RFC 0002) — exactly the adopter's `persona = agent.name` mapping. `agentRef` is the manifest/deployment binding; a roster entry **MUST** reference an `agentId` the host can resolve (RFC 0070), and **MAY** pin a `version` or `channel` (RFC 0082, mutually exclusive). `workflows[]` is the portfolio — workflow ids the host can resolve; an entry **MUST NOT** list a workflow outside its `owner` triple's tenant scope (the WCT/CTI carry-forward, §Conformance). `enabled: false` makes the entry's portfolio **triggers** inert without deleting it (the adopter's `enabled` flag).

### §B — Portfolio discovery (additive projection on the RFC 0072 inventory)

A host advertising `agents.roster` exposes the standing roster at two additive sibling reads under the existing agents surface:

```http
GET /v1/agents/roster              → { "roster": AgentRosterEntry[], "total": integer }   // tenant-scoped (RFC 0074)
GET /v1/agents/roster/{rosterId}   → AgentRosterEntry                                       // 404 if cross-tenant/unknown
```

Both are **tenant-scoped exactly as RFC 0074 scopes `GET /v1/agents`**: a `'tenant'`-install host returns only entries within the authenticated principal's owner triple, and an entry outside it **404s** (never discloses another tenant's roster). Additionally, the RFC 0072 inventory entry (`agent-inventory-response.schema.json`) gains an **additive optional** projection so a single `GET /v1/agents` call can surface responsibilities without a second round-trip:

```jsonc
// AgentInventoryEntry, additive optional fields:
"roster": [
  { "rosterId": "host:sally-marketing", "persona": "Sally", "workflows": ["marketing-email-campaign", "social-post-scheduler"] }
]   // the standing instances of this manifest agent visible to the caller, with their portfolios
```

A host that omits `agents.roster` omits these fields and the two reads `501` — exactly as an unsupported feature does today.

### §C — Run attribution: `roster.run.initiated` (additive, content-free, recorded-fact)

When a trigger (a schedule per RFC 0052, or a durable work item per RFC 0083) fires a workflow **that is in a roster entry's portfolio**, the host **MUST** emit one content-free **`roster.run.initiated`** event as a recorded fact on the resulting run, attributing it to the standing agent:

| Event                  | Payload (content-free)                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `roster.run.initiated` | `{ rosterId, persona, agentId, workflowId, triggerSource, triggerSubscriptionId? }` |

`triggerSource` is one of the RFC 0083 sources (`schedule` / `webhook` / `queue` / `email` / `form`) or a host-extension source name (e.g. a vendor Kanban bridge — §E). `triggerSubscriptionId` is the RFC 0083 subscription id when the fire came through the trigger bridge (so the trigger→run→roster chain is fully traceable via `/ancestry`, RFC 0040). The event is **content-free** (identifiers only — no prompt, no work-item body, no credential material; SR-1) and is a **recorded-fact event** per [`replay.md`](../spec/v1/replay.md) §"Recorded-fact events" (the RFC 0057 `memory.written` / RFC 0077 `invocationId` precedent): on replay against a checkpoint the host **MUST** re-emit it from the log and **MUST NOT** regenerate its identifiers — so a replayed run is attributed to the same roster member even if the entry was since renamed, re-pointed, or deleted. Because the payload is content-free it introduces no non-deterministic body to diverge on. Ordering is anchored to the run's lifecycle, not to any particular node: the host **MUST** emit `roster.run.initiated` once, immediately after `run.started` (the run's first event) and before any agent invocation — a portfolio workflow MAY contain non-agent nodes or several agent invocations, so attribution is to the _run_, not to a single `agent.invocation.started` bracket.

### §D — Triggers compose existing primitives (no new `WorkflowTrigger.type`)

This RFC deliberately adds **no** new trigger type. A roster entry's portfolio fires through the primitives that already exist:

- **Scheduled portfolio runs** use RFC 0052 (`scheduling` / the `schedule` `WorkflowTrigger`). The roster entry binds the _owner_; the schedule binds the _cadence_. A host MAY store the cadence on the roster entry as host-runtime state (the adopter's `schedule {cron, timezone}`), but the **normative firing contract is RFC 0052's** — this RFC does not re-declare schedule semantics (no double-ownership of triggers; the firing lives in one place).
- **Inbound work-item portfolio runs** use RFC 0083 (the durable trigger bridge: a `trigger-subscription` with at-least-once delivery, dedup, retry, dead-letter, and the trigger→run `causationId`). A work item landing in a watched source (a Kanban "To Do" column, a queue, an inbox) is an RFC 0083 delivery that fires a portfolio workflow; this RFC's only addition is the §C attribution stamp on the resulting run.

The roster entry's contribution is **ownership + attribution**, not a parallel trigger stack.

### §E — The work surface stays a host/vendor extension (the Non-Goal, made explicit)

Following the RFC 0083 §E precedent (channels stay extensions): this RFC does **not** standardize Kanban boards, columns, cards, swimlanes, or any concrete work-item UI. A host's board (e.g. a demo-app Kanban, the adopter's `kanbanAccess` model) is a host/vendor extension. What it MUST do to participate is **bridge a "card entered the watched column" event into an RFC 0083 trigger delivery** that fires a roster-portfolio workflow, so the §C `roster.run.initiated{ triggerSource, triggerSubscriptionId }` attribution and the RFC 0083 `causationId` chain hold. The board's _shape_ is its own; its _bridge into a roster-owned run_ is openwop's. A future RFC MAY standardize a single `kanban.card.moved` event behind a `host.kanban` capability **iff** cross-host demand appears — explicitly out of scope here (Alternatives §3).

### §F — Capability advertisement (`agents.roster`)

```jsonc
"agents": { "roster": {
  "supported": true,
  "installScope": "tenant",                 // 'host' | 'tenant' — MUST equal agents.manifestRuntime.installScope (RFC 0074)
  "portfolioTriggerSources": ["schedule", "queue", "webhook"]   // which RFC 0052/0083 sources fire portfolios here
}}
```

Truthful advertisement (RFC 0031): a host that does not scope per tenant advertises `installScope: "host"` and returns a single global roster; a host that fires portfolios only on schedules advertises only `["schedule"]` and does not claim work-item firing. `agents.roster` **REQUIRES** `agents.manifestRuntime.supported: true` (a roster entry instantiates a manifest agent — RFC 0070); a host advertising `roster` without `manifestRuntime` is a `validation_error` (truthful-advertisement floor). `agents.roster.installScope` **MUST equal** `agents.manifestRuntime.installScope` — a roster cannot be host-global while the manifests it instantiates are tenant-scoped (or vice-versa); a mismatched advertisement is a `validation_error`. The field is restated on `roster` (rather than only inherited) so the roster reads' scoping is self-describing, but it is not an independent knob. A host that omits the block does not instantiate standing agents (today's default); the conformance behavioral scenarios skip cleanly.

### Examples

**Positive (scheduled portfolio run).** On a host advertising `agents.roster.supported` + `agents.manifestRuntime` + `scheduling` (RFC 0052), a roster entry `host:sally-marketing` (`persona:"Sally"`, `agentRef:{agentId:"…brief-writer", channel:"stable"}`, `workflows:["marketing-email-campaign", …]`, `owner:{tenantId:"acme",…}`) has its `marketing-email-campaign` workflow on a `0 9 * * MON-FRI` schedule. At 09:00 the schedule fires → the host resolves `@stable` and pins it (RFC 0082 §B) → emits `roster.run.initiated{ rosterId:"host:sally-marketing", persona:"Sally", agentId:"…brief-writer", workflowId:"marketing-email-campaign", triggerSource:"schedule" }` → then the RFC 0077 `agent.invocation.started`. `GET /v1/agents/roster` (as an `acme` principal) returns the entry with its portfolio; a `beta`-tenant principal does not see it.

**Positive (inbound work item).** A vendor Kanban bridge registers an RFC 0083 `trigger-subscription` watching the "To Do" column. A card lands → an RFC 0083 delivery (`dedupKey:"card-7f3"`) fires `marketing-email-campaign` → `roster.run.initiated{ …, triggerSource:"queue", triggerSubscriptionId:"sub_abc" }`, and the run's `run.started` carries the delivery `causationId` (RFC 0083 §C-3), so `/ancestry` resolves card → delivery → run → Sally.

**Negative (cross-tenant).** `GET /v1/agents/roster/host:sally-marketing` by a `beta`-tenant principal on a `'tenant'`-install host → `404` (never discloses `acme`'s roster). **Negative (no manifest runtime).** Advertising `agents.roster` without `agents.manifestRuntime` → `validation_error`. **Negative (out-of-scope portfolio).** A roster entry owned by `acme` listing a `beta`-only workflow → rejected at write (`workspace_membership_required`). **Negative (schema).** A `roster.run.initiated` payload carrying the work-item body → fails validation (`additionalProperties:false`, content-free). **Negative (replay).** A host that re-attributes a replayed run to the _current_ roster entry (instead of re-reading the recorded `rosterId`) → non-conformant by §C.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). A new roster-entry schema; additive optional `roster` + `portfolio` projection on the RFC 0072 inventory entry (absent ⇒ today's inventory, unchanged); a new optional `agents.roster` capability block (absent ⇒ the two roster reads `501`, exactly as an unsupported feature today); one additive content-free `RunEventType` (`roster.run.initiated`; consumers tolerate unknown event types per §2.1); two additive sibling read endpoints; additive prose. **No existing field is moved, renamed, removed, or type-changed; `AgentRef`/`AgentManifest`/`AgentInventoryEntry` keep their meaning; no existing event/endpoint contract changes; no `MUST` is relaxed; no new `WorkflowTrigger.type` (the trigger enum is untouched — §D composes RFC 0052/0083).** A host that omits `agents.roster` is exactly as conformant as today. Adding the one event type does not bump `eventLogSchemaVersion` (RFC 0008 §K / 0058 precedent). The attribution event _strengthens_ observability without weakening replay determinism — §C pins `rosterId` as a recorded fact, so a `roster`-attributed run is as deterministic on replay as any other.

## Conformance

- **New scenarios:**
  - **`agent-roster-shape.test.ts`** (always-on, server-free): the roster-entry record validates; `rosterId` accepts the `host:<id>` instance form; `agentRef` honors the RFC 0082 `version` XOR `channel` rule; the `roster.run.initiated` payload validates and is content-free; the inventory `roster`/`portfolio` projection validates; negatives (content-bearing attribution payload; `agentRef` with both `version` and `channel`; portfolio entry that is not a string id).
  - **`agent-roster-attribution.test.ts`** (gated on `agents.roster.supported`): a scheduled portfolio fire emits `roster.run.initiated` before `agent.invocation.started` with the owning `rosterId`/`persona`; a work-item fire carries the RFC 0083 `triggerSubscriptionId` + the run's `causationId`; a replay re-reads the recorded `rosterId` (the §C determinism contract); a cross-tenant `GET /v1/agents/roster/{id}` 404s (the RFC 0074 scoping). Soft-skips when unadvertised.
- **Capability gating** per `conformance/coverage.md` (shape always-on; attribution + scoping gated). New roster fixture + `fixtures.md` row.
- **SECURITY:** protocol-tier **`roster-attribution-no-content`** (the §C content-free guarantee — an always-on server-free public test, the RFC 0057 `memory-attribution-no-content` precedent) + reuses **`roster-tenant-scoped`** carry-forward from RFC 0074 (a `'tenant'`-install roster never discloses cross-tenant entries) and `workspace_membership_required` (RFC 0028 T2) for the out-of-scope-portfolio write rejection. **No new authority is conferred by a roster entry** — a roster entry's portfolio does **not** widen the underlying manifest's `toolAllowlist` (RFC 0002 §A14), grant RBAC scopes (RFC 0049), or bypass approval gates (RFC 0051); the entry is an _ownership + attribution_ record, enforced by the always-on `roster-confers-no-tool-escalation` shape assertion (the bridge to RFC 0087's org-chart authority invariant).
- **Reference host.** Deferred (files at `Draft`). The schema + event + capability + inventory projection ship at `Draft → Active`; the attribution + scoping scenarios soft-skip until a reference host implements the roster store + the trigger→portfolio binding. `Active → Accepted` is gated on a non-steward host (the adopter already has `AutomationAgent`) advertising `agents.roster` + emitting `roster.run.initiated` (the RFC 0077/0082 precedent).

## Alternatives considered

1. **Put the portfolio + triggers on `AgentManifest` (a `workflows[]` + `triggers[]` field in the pack).** Rejected — the manifest is immutable + pack-distributed (RFC 0003 §C) and its `agentId` deliberately excludes the instance form. A pack ships once, identically, to every tenant; "Sally owns these workflows in this tenant on this cadence" is mutable per-deployment state that would force a republish on every change and could not be tenant-scoped. The instance belongs in a host roster record, not the manifest (the same reasoning RFC 0082 §Alt-3 used to keep deployment state off the manifest).
2. **Reuse RFC 0082's deployment record as the standing instance.** Rejected — RFC 0082's "deployment" is per-(`agentId`, `version`): _which build serves a channel_. A roster entry is per-_named-worker_: _which standing agent owns which workflows_. One agent build (`brief-writer@stable`) backs many roster members ("Sally", "Sam" — two marketing workers sharing a manifest, distinct portfolios). Conflating them would force one deployment record per worker and break the version-channel semantics. §A references the deployment via `agentRef.channel`; it does not subsume it.
3. **Standardize the Kanban board (boards/columns/cards) as a normative artifact type + a `kanban.card.moved` event now.** Rejected for this RFC (deferred) — it over-fits one host's UI to the wire before any second host needs it, and the adopter itself drives everything off a generic work-item→workflow target, not a normative board. §E keeps the board a host/vendor extension bridged via RFC 0083; a single `kanban.card.moved` event behind `host.kanban` is a clean _future_ additive step iff cross-host demand appears (the messaging-channels-as-extensions precedent, RFC 0083 §E).
4. **Add a new `WorkflowTrigger.type: "roster"` / `"kanban-column"`.** Rejected — RFC 0052 (schedule) and RFC 0083 (durable inbound bridge, incl. queue/webhook/form) already own the firing machinery; a new trigger type would double-own trigger semantics (the §D anti-double-ownership rule). The roster contributes ownership + attribution (§C), not a parallel trigger.
5. **Make attribution a field on `run.started` instead of a dedicated event.** Rejected — `run.started` is an existing event whose shape MUST NOT change (`COMPATIBILITY.md` §2.2). A new content-free `roster.run.initiated` event is the additive, replay-safe way to attribute (the RFC 0057/0077 recorded-fact-event precedent), and it composes cleanly before the invocation bracket.
6. **Do nothing.** Rejected — the standing-worker model is real (an adopter ships it host-private), and without a portable instance + portfolio + attribution it stays invisible to discovery, conformance, audit, and any second host — the exact non-portability RFC 0072/0082 were authored to avoid for the class + version.

## Unresolved questions

To decide before `Active`:

1. **Roster store endpoint set.** Are roster entries managed via a `POST/PATCH/DELETE /v1/agents/roster` CRUD surface, or is management host-private (read-only on the wire, like RFC 0072 inventory)? Proposed: read-only on the wire at `Draft → Active` (the discovery + attribution slice is the interop surface); a management surface defers to `Active → Accepted` per the RFC 0077/0082 endpoint-deferral precedent.
2. **`persona` uniqueness within a tenant.** Must `persona` be unique per owner triple (two "Sally"s in one workspace), or is `rosterId` the only uniqueness key? Proposed: `rosterId` is the only key; `persona` is a display name and MAY collide (the host MAY warn). Confirm against the adopter's model.
3. **Portfolio ↔ deployment-channel interaction.** When a roster entry pins `agentRef.channel:"stable"` and the channel moves (RFC 0082 promotion), the _next_ portfolio fire resolves the new version, but an in-flight run stays pinned (RFC 0082 §B). Is that the intended "Sally always runs current-stable" semantics? Proposed: yes — the roster owns the _binding intent_ (`@stable`); RFC 0082 owns the _per-run pin_. Confirm no replay divergence at the roster layer (there is none — §C records `rosterId`, not the resolved version, which RFC 0077 already records).
4. **Multiple roster members sharing one workflow.** May two roster entries both list `marketing-email-campaign` in their portfolios (Sally owns it Mon–Wed, Sam Thu–Fri)? Proposed: yes — `workflows[]` is a non-exclusive ownership claim; the firing trigger (RFC 0052/0083) decides which fire attributes to whom via the §C event. Confirm the attribution is unambiguous per fire (it is — one fire, one `roster.run.initiated`).
5. **Disabled-entry semantics.** Does `enabled:false` make only _triggers_ inert (proposed), or also hide the entry from `GET /v1/agents/roster`? Proposed: triggers inert, entry still discoverable (an operator must see paused workers). Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Composes RFC 0070/0072 (Accepted — manifest + inventory), RFC 0074 (Accepted — `installScope` tenant scoping), RFC 0048 (Accepted — owner triple), RFC 0052 (scheduling — §D), RFC 0083 (`Draft` — the durable work-item bridge §D/§E; the work-item firing path co-matures with 0083), RFC 0082 (`@channel` binding §A), RFC 0077 (the invocation bracket §C composes before), RFC 0040 (the `causationId` chain §C). Foundation for RFC 0087 (the org-chart layer whose members are roster entries). Independent of RFC 0081/0084.
- **Reference host (demo app).** Wiring is: a roster-entry store keyed by `rosterId` (tenant-scoped), the `GET /v1/agents/roster[/{id}]` reads + the inventory projection, a portfolio→trigger binding (a schedule per RFC 0052 / an RFC 0083 subscription per work surface), and the `roster.run.initiated` stamp on a fired portfolio run. The demo app's Kanban board (a host extension, §E) bridges "card → To Do column" into an RFC 0083 delivery that fires the bound portfolio workflow.
- **Adopter mapping.** MyndHyve's private `AutomationAgent{ name, workflowIds[], schedule, kanbanAccess, protocolRef, sourceManifestId }` projects directly: `name → persona`, `workflowIds → workflows[]`, `sourceManifestId/protocolRef → agentRef`, `schedule → an RFC 0052 binding`, `kanbanAccess → an RFC 0083 subscription on the board (host extension)`. Adoption is a projection of an existing record, not new modeling — the `Active → Accepted` evidence path.
- **Expected effort:** S–M for the schema + event + capability + inventory projection + shape conformance; M for the reference roster store + the trigger→portfolio binding + attribution; the Kanban board itself is a separate app-extension effort (out of normative scope).

## Acceptance criteria

Checklist for `Active` (files at `Draft`):

- [ ] `spec/v1/agent-roster.md`: §A roster entry, §B portfolio discovery + inventory projection, §C `roster.run.initiated` attribution (recorded-fact), §D triggers-compose-existing, §E work-surface-stays-extension, §F capability.
- [ ] `agent-roster-entry.schema.json`; additive `roster`/`portfolio` on `agent-inventory-response.schema.json`; additive `agents.roster` on `capabilities.schema.json`; one `roster.run.initiated` RunEventType + content-free payload.
- [ ] `GET /v1/agents/roster` + `GET /v1/agents/roster/{rosterId}` in `openapi.yaml`; the attribution event in `asyncapi.yaml`.
- [ ] SECURITY: protocol-tier `roster-attribution-no-content` + its always-on public test; `roster-confers-no-tool-escalation` shape assertion; reuses `roster`-scoped RFC 0074 carry-forward + `workspace_membership_required`.
- [ ] Conformance: `agent-roster-shape.test.ts` (always-on) + `agent-roster-attribution.test.ts` (gated) + fixture + `coverage.md` row.
- [ ] CHANGELOG entry + INTEROP-MATRIX row (no host advertises `roster` yet).
- [ ] All five Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host implements the roster store + portfolio binding + attribution + passes the gated scenario, OR the RFC explicitly defers reference-host implementation — the explicit `Active → Accepted` gate (non-steward host advertising `roster`).

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- The gated behavioral scenario **`agent-roster-attribution.test.ts`** — authored steward-side in `@openwop/openwop-conformance@1.11.0` (the deferred §Conformance deliverable; PR #392/#394) — **passes non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`**: `GET /v1/agents/roster` 200 → portfolio fire → `roster.run.initiated` read back from the durable log, ordered first-after-`run.started`, content-free (`roster-attribution-no-content`), `host:<id>` rosterId, durable-path `triggerSubscriptionId`.
- Per RFC 0001 §3 + the explicit §Conformance `Active → Accepted` gate (a non-steward host advertising `roster`), both criteria are met.
- Coordinated via the `billy` crosstalk bus. **Strengthening follow-up (non-gating):** production-path attribution wiring in MyndHyve's `runExecutor` is tracked; the gated proof drives the production emitter via the conformance sample seam.).
- 2026-05-30 (Draft → Active — wire surface landed: NEW `agent-roster-entry.schema.json` (`host:<id>` rosterId + `agentRef` version-XOR-channel + `workflows[]` portfolio + owner triple) + additive `agents.roster` capability (`installScope` MUST-equal-manifestRuntime + `portfolioTriggerSources`) + additive `roster` portfolio projection on `agent-inventory-response.schema.json` + one content-free `roster.run.initiated` RunEventType (recorded-fact, anchored to `run.started`) + NEW normative `spec/v1/agent-roster.md` (§A `host:<id>` dispatch handle / §B discovery / §C attribution / §D triggers-compose-0052+0083 / §E work-surface-extension / §F capability) + always-on `agent-roster-shape.test.ts` + protocol-tier SECURITY invariant `roster-attribution-no-content`.
- The reference impl shipped as a host-extension at `/v1/host/sample/roster` + board attribution (apps/workflow-engine, #368). The `GET /v1/agents/roster` endpoint, SDK helpers, behavioral attribution scenario, and reference-host normative wiring defer to `Active → Accepted` per the RFC 0077/0082 precedent.).

## References

- [`RFCS/0070-agent-manifest-runtime.md`](./0070-agent-manifest-runtime.md) + [`RFCS/0072-agent-inventory-and-dispatch.md`](./0072-agent-inventory-and-dispatch.md) — the manifest + inventory the roster instantiates + projects onto (§A/§B); the `agentId` pattern that reserves the `host:<id>` instance form.
- [`RFCS/0074-tenant-scoped-agent-inventory.md`](./0074-tenant-scoped-agent-inventory.md) — the `installScope` tenant scoping §B/§F reuse; the cross-tenant-404 carry-forward.
- [`RFCS/0082-agent-deployment-lifecycle.md`](./0082-agent-deployment-lifecycle.md) — the `agentId@channel` binding §A references; the manifest-is-not-the-instance reasoning (§Alt-2/3).
- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) + [`RFCS/0083-durable-trigger-and-channel-bridge-profile.md`](./0083-durable-trigger-and-channel-bridge-profile.md) — the schedule + durable inbound trigger machinery §D composes (no new trigger type); the channels-stay-extensions precedent (§E).
- [`RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — the `agent.invocation.started` bracket §C composes before; the recorded-fact-event posture.
- [`RFCS/0040-multi-agent-cross-host-causation.md`](./0040-multi-agent-cross-host-causation.md) — the `causationId`/`/ancestry` chain §C extends (trigger → run → roster).
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](./0002-agent-identity-and-reasoning-events.md) — `AgentRef.persona` (the human name §A reuses) + `toolAllowlist` §A14 (the authority the roster does NOT widen).
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the owner triple §A scopes by.
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"Recorded-fact events" — the §C attribution-event replay contract.
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.
