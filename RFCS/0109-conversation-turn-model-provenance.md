# RFC 0109: Conversation-turn model provenance (`agent.model`)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0109                                                            |
| **Title**         | Conversation-turn model provenance (`agent.model`)              |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-06-24                                                      |
| **Updated**       | 2026-06-24                                                      |
| **Affects**       | `schemas/conversation-turn.schema.json`; RFC 0005 §C (turn shape); `capabilities.md` (new optional capability); conformance (1 new capability-gated scenario); SDK `ConversationTurn` type |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.2                          |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Add an OPTIONAL `model` object (`{ provider, model }`) to the `agent` reference on a
conversation turn, so a host MAY attribute WHICH provider/model produced a given
`role: 'agent'` turn. This makes per-turn model attribution an observable, replay-stable
wire fact — enabling clients to display "answered by `<model>`" and router-audit /
multi-model-compare views — without mandating emission and without exposing any credential.

## Motivation

Hosts increasingly route a single conversation across multiple models (per-turn model
selection, fallback, or a rule-based router — e.g. openwop-app ADR 0124). Today the
conversation-turn wire (`conversation-turn.schema.json`, RFC 0005 §C) records the agent
attribution (`agent.agentId`, `agentSharing`, `memoryRef`) but NOT which model actually
produced the turn. A client therefore cannot honestly show per-turn model provenance, and
a host that wants to surface it has no normative field to carry it — the attribution would
either be dropped or smuggled into a non-normative side channel that peers can't read. The
spec is the right place because per-turn provenance is a *cross-host-projectable transcript
fact* (like RFC 0101 `speakerId`), not a UI detail: a conformant client rendering a foreign
host's transcript should be able to read it the same way everywhere.

This RFC is deliberately minimal: ONE optional, additive field; MAY-emit (not MUST); no
new endpoint, event type, or behavior mandate. It is the conversation-turn analogue of the
RFC 0101 `speakerId` addition (per-turn attribution), scoped to the producing model.

## Proposal

### Wire shape change — `conversation-turn.schema.json` `agent` object

The `agent` object already declares `additionalProperties: true`, so the new field is
tolerated by pre-aware hosts/clients unchanged; this RFC documents and names it.

```diff
 "agent": {
   "type": "object",
   "properties": {
     "agentId": { "type": "string", "minLength": 1 },
     "agentSharing": { "type": "string", "enum": ["isolated", "shared", "shared:%shared%"] },
-    "memoryRef": { "type": "string" }
+    "memoryRef": { "type": "string" },
+    "model": {
+      "type": "object",
+      "description": "OPTIONAL provenance — the provider + model that produced this `role: 'agent'` turn. Non-secret catalog identifiers ONLY; MUST NOT carry a key/credential. When present it MUST name the model that actually produced the turn.",
+      "properties": {
+        "provider": { "type": "string", "minLength": 1, "description": "The advertised provider class id (RFC 0031 `aiProviders`), e.g. `anthropic`. Non-secret." },
+        "model": { "type": "string", "minLength": 1, "description": "The model id, e.g. `claude-opus-4-8`. Non-secret." }
+      },
+      "required": ["provider", "model"],
+      "additionalProperties": false
+    }
   },
   "additionalProperties": true
 }
```

### Normative prose (RFC 0005 §C addendum)

- A host MAY include `agent.model` on a `role: 'agent'` turn it produced.
- If `agent.model` is present, it MUST name the provider + model that **actually produced
  the turn** (no fabricated or aspirational attribution — the honesty rule).
- `agent.model.provider` and `agent.model.model` MUST be non-secret identifiers. A host
  MUST NOT place any credential, key, or BYOK secret in `agent.model` (or anywhere on the
  turn) — see `SECURITY/invariants.yaml` SR-1 / secret-leakage.
- `agent.model` is recorded turn state: a host MUST read it verbatim on replay and `:fork`
  and MUST NOT re-resolve it (a forked transcript shows the model that originally produced
  the turn). This preserves replay determinism (RFC 0005 / `replay.md`).
- A client MAY display `agent.model`; a client MUST tolerate its absence (it is OPTIONAL).
- `agent.model` is meaningful only for `role: 'agent'` turns; producers SHOULD NOT set it
  on `user`/`system` turns.

### Capability

A new optional advertised capability `conversationTurnModelProvenance.supported` (boolean,
`capabilities.md`). A host advertises it only if it actually stamps `agent.model` on the
agent turns it produces (`OPENWOP_REQUIRE_BEHAVIOR` honesty). Clients use it to decide
whether to surface a per-turn model UI affordance.

### Examples

Positive (a routed agent turn):

```json
{ "messageId": "run-abc:n1:7:agent", "from": "support-agent", "role": "agent",
  "turnIndex": 7, "ts": 1750000000000, "content": "…",
  "agent": { "agentId": "support-agent", "model": { "provider": "anthropic", "model": "claude-opus-4-8" } } }
```

Negative (rejected — a secret in `model`):

```json
{ "agent": { "agentId": "x", "model": { "provider": "anthropic", "model": "claude-opus-4-8", "apiKey": "sk-…" } } }
```

`additionalProperties: false` on `model` rejects `apiKey` (and any non-`{provider,model}`
field) — the schema-level guard behind the SR-1 redaction rule.

## Compatibility

**Additive.** Against `COMPATIBILITY.md` §2.2: no required→optional change, no
required→removed, no type change on an existing field, no event-shape change, no endpoint
contract change, no relaxed MUST, no error-code meaning change. The field is new, OPTIONAL,
and absent by default — and the `agent` object already permits `additionalProperties`, so:
old clients ignore it; old hosts don't emit it; a host that emits it does not break a peer
that doesn't read it. No migration tooling required.

## Conformance

- **Existing coverage:** the conversation-turn / `conversation.exchanged` scenarios already
  validate turn shape; this RFC adds one capability-gated scenario.
- **New scenario** (`conversation-turn-model-provenance.test.ts`): gated on
  `conversationTurnModelProvenance.supported`. When advertised, an agent turn the host
  produced MUST carry a well-formed `agent.model` (`{provider, model}`, both non-empty) and
  MUST NOT carry any secret-shaped field; hosts that do not advertise it are not exercised
  (so non-emitting hosts are never failed). Server-free fixture round-trip.

## Alternatives considered

1. **Do nothing (host-side `run.metadata` only).** openwop-app ADR 0124 already stamps the
   routed model in `run.metadata.modelRoute`. But that is the *conversation-level* routed
   target, not *per-turn* attribution, and it is non-normative host metadata a peer host
   can't project. Rejected: it cannot answer "which model produced turn N" cross-host.
2. **A top-level `provenance` field on the turn (not under `agent`).** Rejected: model
   attribution is intrinsically about the agent that produced the turn; nesting under
   `agent` (alongside `agentId`) keeps related attribution together and mirrors RFC 0002's
   `agent` shape. (See Unresolved Q1 — open for comment.)
3. **A new `turn.model.*` event.** Rejected: a new event type is heavier than an optional
   field and would duplicate the turn's existing identity/replay machinery.

## Unresolved questions

1. Nest under `agent.model` (this RFC) vs a sibling `provenance` object? `agent.model` is
   proposed for cohesion with `agentId`; revisit in the comment window.
2. Should `model` optionally carry a non-secret `usage` hint (input/output tokens) for the
   same audit view, or does that belong to `observability.md` / the usage event only?
   (Deferred — this RFC is provenance-only; usage stays in the OTel/usage surface.)
3. Should `provider` be constrained to the RFC 0031 advertised-provider vocabulary (an
   enum/ref) or stay a free string? Free string proposed for forward-compat with
   self-hosted/compat classes (RFC 0108).

## Implementation notes (non-normative)

Host work is small once Accepted: the producing host stamps `agent.model` when it builds
the agent turn (e.g. openwop-app's conversation-exchange `makeTurn`, reading the resolved
provider/model it dispatched on). No new storage. The client reads `turn.agent.model` and
renders a chip. Sequencing: schema + prose + capability + the gated scenario land together;
the openwop-app host stamp (ADR 0124 Phase 2d) is the reference implementation.

## Acceptance criteria

- [ ] Spec text (RFC 0005 §C addendum) merged
- [ ] `conversation-turn.schema.json` `agent.model` added (additive; `additionalProperties:false` on `model`)
- [ ] `capabilities.md` `conversationTurnModelProvenance.supported` documented
- [ ] ≥1 capability-gated conformance scenario covering presence + no-secret
- [ ] CHANGELOG `[Unreleased] > Added` entry
- [ ] Reference host (openwop-app, ADR 0124 Phase 2d) stamps `agent.model`, OR the RFC defers reference-host to the dependent ADR

## References

- RFC 0005 (conversation primitive / conversation-turn) — `RFCS/0005-conversation.md`
- RFC 0002 §A1 (`AgentRef`), RFC 0101 (`speakerId` per-turn attribution precedent)
- RFC 0031 (advertised `aiProviders`), RFC 0108 (self-hosted/compat provider class)
- `schemas/conversation-turn.schema.json`, `replay.md` (fork determinism), `SECURITY/invariants.yaml` (SR-1 / secret-leakage)
- openwop-app ADR 0124 (rule-based model router) — the dependent host work (Phase 2d)
