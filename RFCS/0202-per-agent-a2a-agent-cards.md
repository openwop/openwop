# RFC 0202: each inventoried agent is published as an A2A Agent Card

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0202                                                            |
| **Title**         | each inventoried agent is published as an A2A Agent Card, reached by an opaque routing value, without making the card an existence oracle across tenants |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (filed `Draft`) · 2026-09-22 — `Draft → Active` in the filing PR; **comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects isolation and authorization: it publishes tenant-scoped inventory through a second protocol surface); acceptance under this override is provisional and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`). |
| **Affects**       | `spec/v2/core/interop.md` (new §"Per-agent cards") · `spec/v2/facets/a2a.schema.json` (optional `agentCards`) · `spec/v2/declaration.json` (`a2a.facets`) · `schemas/v2/agent-inventory-response.schema.json` (optional `a2aTenant`) · `schemas/v2/capabilities.schema.json` (regenerated) · `SECURITY/invariants.yaml` (+1, `agent-card-no-tenant-leak`) · `SECURITY/threat-model-interop.md` · conformance (one new major-2 scenario). Isolation and authorization surface. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (§2.1; §4 "new normative requirement on a previously-undefined behavior") |
| **Supersedes**    | — (amends RFC 0072 §A and RFC 0074 by addition: the inventory entry gains an optional field; neither RFC's MUSTs change) |
| **Superseded by** | —                                                               |

## Summary

An OpenWOP host that speaks A2A publishes one Agent Card whose skills are its workflows, while the agents a peer actually wants to address — the manifest agents in `GET /agents` — exist only on an OpenWOP-specific route. A2A already has the pieces to address many agents behind one endpoint: `AgentInterface.tenant` ("used for routing requests to a specific agent or tenant when multiple agents are served behind a single A2A endpoint") and the authenticated extended card. This RFC publishes each inventory entry as an A2A 1.0 `AgentCard` reached through an opaque routing value the host mints and returns on the entry, served only as an authenticated extended card. It keeps `GET /agents` and the roster as the governance projection (`degraded[]`, `memoryDegraded`), and it keeps RFC 0074's rule that another tenant's agent is indistinguishable from one that does not exist — on the new surface as well as the old.

## Motivation

- **The addressable unit is on the wrong surface.** `spec/v1/node-packs.md` §"Agent inventory (RFC 0072 §A)" makes `GET /agents` the inventory; `spec/v1/a2a-integration.md` §C maps the host card's `skills[]` to workflows. An A2A peer that wants the host's "support-resolver" agent has no A2A way to name it (review finding B-F2/B-F3; `review/verify-AB.md` rows B-F2, B-F3 — confirmed as optional bridge material, not a normative conflict).
- **A2A cards are public; the inventory is not.** A2A v1.0.1 §8.2 discovers cards by well-known URI, registry, or direct configuration, and the public card is unauthenticated. RFC 0074 requires that an agent the caller's workspace has not approved "MUST be absent from `GET /v1/agents` and MUST `404` on `GET /v1/agents/{agentId}` — indistinguishable from 'not installed'". A naive per-agent card URL (`/agents/{agentId}/card`, public) is an existence oracle: a 200 for tenant B's agent and a 404 for a random id tells tenant A what B installed. The design has to keep the card off every unauthenticated surface and make the refusal for a foreign agent byte-identical to the refusal for a value that never existed.
- **The governance projection must survive.** RFC 0072 §C ("MUST surface the degraded set") and RFC 0080 §C ("degradation MUST be observable here") have no A2A home; the card cannot carry them, so the card must not be presented as a replacement for the entry.
- **v2 has nothing to extend.** `spec/v2/core/interop.md` homes `a2a` and carries only facet, negotiation and projection rules; there is no v2 per-agent surface to amend.

## Proposal

### §A Advertisement

1. A host advertising the new optional facet `a2a.agentCards` MUST also offer the `a2a-1.0` profile and advertise `agents.manifestRuntime`, and MUST declare `capabilities.extendedAgentCard: true` on its public card (A2A v1.0.1 §3.1.11: the operation "is available only if `AgentCard.capabilities.extendedAgentCard` is `true`").

### §B The routing value

2. For every entry a caller's `GET /agents` returns, the host mints an opaque routing value `R` and returns it as the entry's new optional `a2aTenant`. `R` MUST be stable for the agent and host version, and MUST NOT encode a tenant, workspace, or principal identifier.
3. An entry for which the host routes no workflow to the agent has no `a2aTenant` (A2A `AgentCard.skills` is REQUIRED; an agent with nothing to invoke has no card).

### §C The card

4. `GetExtendedAgentCard` (JSON-RPC; HTTP+JSON `GET /{tenant}/extendedAgentCard`) with `tenant: R` MUST return that agent's A2A 1.0 `AgentCard`:

   | `AgentCard` field (A2A v1.0.1 `a2a.proto`) | Source |
   | --- | --- |
   | `name` (REQUIRED) | entry `persona` |
   | `description` (REQUIRED) | entry `description`, else `label` |
   | `version` (REQUIRED) | entry `packVersion` |
   | `supportedInterfaces[]` (REQUIRED) | the host card's interfaces, each with `tenant: R` |
   | `capabilities` (REQUIRED) | equal to the host card's |
   | `securitySchemes`, `securityRequirements` | equal to the host card's |
   | `defaultInputModes`, `defaultOutputModes` (REQUIRED) | as the host card's rule (v1 `a2a-integration.md` §C) |
   | `skills[]` (REQUIRED) | one skill per workflow the host routes to the agent for this caller, under the v1 §C skill rule |

5. The card MUST NOT carry anything the inventory entry may not carry — the system-prompt body, resolved handoff schemas, or credential material (SR-1). It does not replace the entry: `degraded[]` and `memoryDegraded` remain on the entry, and a client that needs them reads `GET /agents`.

### §D Non-disclosure

6. **Authorization before resolution.** A request carrying `R` MUST be authenticated and authorized under the same policy as `GET /agents/{agentId}`, before `R` is resolved (A2A v1.0.1 §13.1: "Authorization checks MUST occur before any database queries or operations that could leak information about the existence of resources outside the caller's authorization scope").
7. **Identical refusal.** For an `R` naming an agent outside the caller's inventory — another tenant's, unapproved, or uninstalled — every A2A operation MUST return what it returns for an `R` the host never minted: the same HTTP status, the same error code, the same body apart from the JSON-RPC `id`.
8. **Nothing public.** The unauthenticated card at `agentCardUrl` MUST NOT list any `R`.
9. **A hint, not a selector.** `R` is an A2A `tenant` value, so RFC 0208 §C ("`contextId`, `tenant` and `_meta` never select a tenant, workspace or principal") already binds it: `R` is resolved within the caller's tenant of record. This RFC does not restate that rule. It owns only the routing value and the card; the registry's `a2a.card` `supportedInterfaces[].tenant` row points here (RFC 0208 §A, "Rows another RFC owns").

### Normative text (v2)

`spec/v2/core/interop.md` gains, after §"The durable-task projection" (and so after RFC 0208's §"The operation mappings", whose Isolation paragraph this section relies on):

> ## Per-agent cards
>
> A host advertising `a2a.agentCards` MUST also offer the `a2a-1.0` profile and `agents.manifestRuntime`, and MUST declare `capabilities.extendedAgentCard: true` on its public card. It publishes each entry of a caller's agent inventory (`GET /agents`) as an A2A `AgentCard`, reached through the entry's `a2aTenant`: an opaque routing value `R` the host mints, stable for the agent and host version, that MUST NOT encode a tenant, workspace, or principal.
>
> `GetExtendedAgentCard` with `tenant: R` MUST return that agent's card: `name` is the entry's `persona`, `version` its `packVersion`, `description` its `description` or else `label`; `supportedInterfaces[]` are the host card's interfaces, each carrying `tenant: R`; `capabilities` and `securitySchemes` equal the host card's; `skills[]` holds one skill per workflow the host routes to the agent for this caller. The card MUST NOT carry anything the inventory entry may not, and does not replace it: `degraded[]` and `memoryDegraded` stay on the entry.
>
> **Non-disclosure.** A request carrying `R` MUST be authenticated and authorized as `GET /agents/{agentId}` is, before `R` is resolved. For an `R` naming an agent outside the caller's inventory, every A2A operation MUST return what it returns for an `R` the host never minted, apart from the JSON-RPC `id`. The public card at `agentCardUrl` MUST NOT list any `R`. `R` is a `tenant` value under §"The operation mappings" **Isolation**.

214 words by `check-core-budget.mjs`'s count. The `a2a` family is already homed in `interop.md`, so no family is homed and the net core delta is **+214**. (`agents` is not homed here: its v2 home is six v1 documents and 19 facets, and an honest restatement is a separate RFC — see G1. The prose above is an `a2a` obligation, not an `agents` one.)

### Wire shape

```diff
 // spec/v2/facets/a2a.schema.json — properties
+    "agentCards": {
+      "const": true,
+      "description": "RFC 0202. Present ⇒ each inventory entry with an `a2aTenant` is published as an A2A 1.0 AgentCard through GetExtendedAgentCard with tenant = a2aTenant (interop.md §Per-agent cards). Requires the a2a-1.0 profile and agents.manifestRuntime. Omit when not offered (RFC 0192)."
+    },
```

```diff
 // schemas/v2/agent-inventory-response.schema.json — $defs/AgentInventoryEntry/properties
+    "a2aTenant": {
+      "type": "string",
+      "minLength": 1,
+      "maxLength": 128,
+      "pattern": "^[A-Za-z0-9._~-]+$",
+      "description": "RFC 0202. Opaque A2A routing value for this agent: the `tenant` of its AgentInterface entries and of GetExtendedAgentCard. Stable for the agent and host version; encodes no tenant, workspace or principal. Present only when the host advertises a2a.agentCards and routes at least one workflow to the agent. Path-segment-safe because the A2A HTTP+JSON binding carries it as `/{tenant}/…`."
+    },
```

`spec/v2/declaration.json` `a2a.facets` gains `"agentCards"`; `schemas/v2/capabilities.schema.json` is regenerated by `scripts/generate-from-declaration.mjs`. No endpoint is added: the card rides the A2A operation `GetExtendedAgentCard` on the interfaces the host already serves, so `api/v2/openapi.yaml` and `spec/v2/path-manifest.json` are unchanged apart from the `getAgent`/`listAgents` descriptions naming the new field.

**Positive example.** Caller in tenant A lists `GET /agents` and receives `{ "agentId": "vendor.acme.support.resolver", "persona": "Resolver", …, "a2aTenant": "ag-7f3c9e" }`. `GetExtendedAgentCard { "tenant": "ag-7f3c9e" }` returns `{ "name": "Resolver", "version": "1.4.0", "supportedInterfaces": [{ "url": "https://host.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0", "tenant": "ag-7f3c9e" }], "skills": [{ "id": "triage-ticket", … }], … }`.

**Negative examples.**
- The host lists `{ "tenant": "ag-7f3c9e" }` in the public card at `/.well-known/agent-card.json` — violates §D.8.
- Tenant A sends `GetExtendedAgentCard { "tenant": "<tenant B's R>" }` and receives `-32001`/`FAILED_PRECONDITION`, while a never-minted value receives `ExtendedAgentCardNotConfiguredError` — violates §D.7 (the two refusals differ).
- `a2aTenant: "tenant-acme-agent-resolver"` — violates §B.2 if `acme` is the tenant identifier.

## Compatibility

**Additive.** Every new field is optional (`a2a.agentCards`, `a2aTenant`) on objects whose earlier documents stay valid — the "optional property on a closed v2 object" precedent of RFCs 0183, 0186 and 0188 (`review/arch-P3.md` ground rules). A host that does not advertise `a2a.agentCards` is unchanged; a client that ignores `a2aTenant` is unchanged. The §D rules bind only the new surface: they are §4's "new normative requirement on a previously-undefined behavior", not stricter validation of input that succeeds today. No MUST in RFC 0072, 0074, 0080 or 0152 is relaxed; `GET /agents` keeps every obligation it has. v1 is untouched (see G2).

## Conformance

One new major-2 scenario, `v2-a2a-agent-cards.test.ts`, gated on `a2a.agentCards` and a non-empty caller inventory, landing while this RFC is `Active` (`check-rfc-status-coherence.mjs` rule 7). It speaks A2A 1.0 JSON-RPC to the first `JSONRPC` interface of the host's public card (the `a2a-1-0-task-roundtrip` client code). Cross-tenant legs need the operator-provisioned second principal `OPENWOP_TEST_TENANT_B_API_KEY` (as `workspace-cross-tenant-isolation-blackbox.test.ts` does) and an agent installed in tenant B only; without it they record `blocked`, never `pass`, as that scenario does.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 advertisement preconditions | `openwop.requirement.0202.advertisement` — with `a2a.agentCards` present: `a2a.profiles ∋ a2a-1.0`, `agents.manifestRuntime` present, public card `capabilities.extendedAgentCard === true` | the suite, unaided | witnessable-gated (on the facet) |
| §B.2 `R` stable | `openwop.requirement.0202.routing-value` — two `GET /agents` reads return the same `a2aTenant` per `agentId` | the suite, unaided | witnessable-gated. The "encodes no identifier" clause is witnessed only as a substring check against identifiers the host itself discloses (run owner fields); a host that encodes an identifier it never discloses is not caught — partial, recorded as G4 |
| §C.4 card projection | `openwop.requirement.0202.card-projection` — `name`/`version`/`description` equal the entry; `supportedInterfaces[]` equals the host card's interface set with `tenant: R` added; `capabilities` and `securitySchemes` equal the host card's | the suite, unaided | witnessable-gated |
| §C.5 SR-1 on the card | `openwop.requirement.0202.card-sr1` — the card body contains no canary from the fixture agent's system prompt or handoff schema | the suite, when the host installs the `conformance-agent-pack-install` fixture pack | witnessable-gated (fixture) |
| §D.6 authorization before resolution | `openwop.requirement.0202.auth-before-resolve` — unauthenticated `GetExtendedAgentCard` with a real `R` and with a never-minted value return identical responses | the suite, unaided | witnessable-gated |
| §D.7 identical refusal | `openwop.requirement.0202.identical-refusal` — as tenant A: `GetExtendedAgentCard`, `SendMessage`, `ListTasks` with tenant B's `R` vs a never-minted value return identical status, code and body (JSON-RPC `id` excepted) | operator (second principal + an agent only tenant B has) | witnessable-gated (operator-provisioned) |
| §D.8 nothing public | `openwop.requirement.0202.public-card-no-r` — no `supportedInterfaces[].tenant` of the header-less and `A2A-Version: 1.0` public cards equals any `a2aTenant` the caller saw | the suite, unaided | witnessable-gated |
| §D.9 tenant of record | `openwop.requirement.0202.tenant-of-record` — a `SendMessage` through `R` creates a run readable by the caller at `GET /runs/{runId}` and `404` to tenant B | operator (second principal) | witnessable-gated (operator-provisioned) |

**How each row can fail (sabotage, to be run before the row is cited):** drop `extendedAgentCard` from the public card (A.1); mint `R` per request (B.2); serve the host card unchanged for `R` (C.4); copy the manifest's `systemPromptRef` body into `description` (C.5); resolve `R` before the auth check and answer `404` vs `401` (D.6); return `-32001` for a foreign `R` and `-32007` for a never-minted one (D.7); list agent interfaces in the public card (D.8); create the run in the agent's install tenant (D.9).

### Invariant

`agent-card-no-tenant-leak` — protocol tier, severity high, threat model `SECURITY/threat-model-interop.md`, tests `v2-a2a-agent-cards.test.ts`, witness `witnessable-gated`: "A per-agent A2A card, and every A2A operation addressed by a per-agent routing value, MUST NOT disclose whether an agent outside the caller's inventory exists." Registered only once a committed bundle carries `.identical-refusal` at `executed-pass` (the `docs/RFC-0147-SELF-AUDIT.md` rule that an invariant is registered when its threat is verified on the wire); until then it is named in this RFC and in the gap register (G5).

## Alternatives considered

- **A public per-agent card URL (`/agents/{agentId}/agent-card.json`).** The obvious A2A shape and the one peers expect. Rejected: it is the existence oracle §D exists to prevent on every `installScope: "tenant"` host, and on a host-scoped host it discloses inventory that `GET /agents` puts behind `runs:read`.
- **Agents as extra `skills[]` on the host's extended card.** Keeps one card. Rejected: A2A skills are workflows in OpenWOP (v1 §C), so an agent-as-skill collapses two identifiers into one namespace, and a skill has no `version` or interface of its own — the card a peer addresses is still the host.
- **An OpenWOP REST route returning the card (`GET /agents/{agentId}/card`).** Inherits RFC 0074's 404 for free. Rejected as the primary shape: it is a parallel discovery surface an A2A client cannot find, and it is the thing `positioning.md` warns against. A host MAY still serve one; this RFC does not define it.
- **Do nothing.** Peers keep addressing the host, not the agent, and every host that wants per-agent A2A invents a routing scheme; the first one to use a public URL leaks inventory.

## Unresolved questions

1. Should an agent whose inventory entry is `degraded` omit the skills that depend on an inert tier? Left open: the card cannot say *why* a skill is absent, and omission hides degradation from a peer that never reads the inventory.
2. Should roster entries (RFC 0086 `GET /agents/roster`) get cards too? Their `workflows[]` portfolio is exactly `skills[]`. Deferred to keep one addressable class per RFC (G3).
3. Should `R` be revocable per caller (a capability-style token) rather than stable per agent? Stable is what an A2A client caches; revocation is what a leaked value would want.
4. Timing: identical bodies do not make identical latency. Is a latency-equalization SHOULD worth stating, given A2A §13.1 does not?

## Implementation notes (non-normative)

- **Sequencing.** The spec PR lands after RFC 0208's, which supplies the Isolation paragraph §D.9 relies on and the `a2a.card` row this RFC's prose owns.
- No v2 host advertises both `a2a` and `agents` today (v2-reference: `a2a` seam-gated, no inventory; MyndHyve: `agents` with `installScope: "tenant"`, no v2 `a2a`). Witnessing needs either MyndHyve to serve A2A 1.0 JSON-RPC under v2, or v2-reference to gain `/agents` and a conformance agent pack. See the companion implementation plan (not committed with the RFC).
- Minting `R` as a keyed MAC of `agentId` under a host secret satisfies §B.2 without storage; it is the same for every tenant that installed the agent, which §D tolerates because resolution is always within the caller's inventory.

## Acceptance criteria

- [x] `Active` — 2026-09-22, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [ ] Spec text merged: `interop.md` §"Per-agent cards"; facet and inventory schema fields; declaration facet; regenerated capabilities schema.
- [ ] `v2-a2a-agent-cards.test.ts` ships in a published suite, every row sabotage-proven.
- [ ] A committed v2 host bundle carries every row of the falsifiability table at `executed-pass`, including `.identical-refusal` and `.tenant-of-record` with the second principal provisioned (a bundle with those two `inapplicable` does not satisfy this box).
- [ ] `agent-card-no-tenant-leak` registered in `SECURITY/invariants.yaml`; `SECURITY/threat-model-interop.md` updated.
- [ ] CHANGELOG entry; `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" override row; `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row `not-reviewed`.
- [ ] `Accepted` is provisional until the RFC 0156 §B review.

## References

- A2A v1.0.1 (`a2aproject/A2A` tag `v1.0.1`, fetched 2026-09-22): `specification/a2a.proto` `AgentInterface.tenant` (field 3: "An opaque string used for routing requests to a specific agent or tenant when multiple agents are served behind a single A2A endpoint. When set, clients MUST include this value in the `tenant` field of all request messages"), `AgentCard` (fields 1–14), `GetExtendedAgentCardRequest.tenant`, HTTP binding `GET /{tenant}/extendedAgentCard`; `docs/specification.md` §3.1.11, §8.2, §8.3.2 rule 4, §13.1, §13.3. https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto · https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md
- RFC 0072 §A/§C, RFC 0074, RFC 0080 §C, RFC 0086, RFC 0152 §C/§E, RFC 0175, RFC 0194 (override precedent), RFC 0147 §A.6, RFC 0156 §B.
- `spec/v1/node-packs.md` §"Agent inventory", §"Inventory scope"; `spec/v1/a2a-integration.md` §C, §E; `spec/v2/core/interop.md`; `api/v2/openapi.yaml` `getAgent`.
- Review inputs: `review/verify-AB.md` B-F2, B-F3; `review/arch-P3.md` P3-M1 (η-a), P3-L2.
