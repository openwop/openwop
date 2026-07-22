# RFC 0132: Anonymous-actor authorization for public agent surfaces

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**           | 0132                                                                                                                                                                                                                                                                                                                                                                            |
| **Title**         | An anonymous-actor principal kind for public agent surfaces — an opaque, origin-bound, non-PII actor whose authority is a per-surface tool grant (default-deny, never the default-on baseline), with a read tier and a mandatorily-gated bounded-write/egress tier                                                                                                              |
| **Status**        | `Draft`                                                                                                                                                                                                                                                                                                                                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                  |
| **Created**       | 2026-07-22                                                                                                                                                                                                                                                                                                                                                                      |
| **Updated**       | 2026-07-22                                                                                                                                                                                                                                                                                                                                                                      |
| **Affects**       | `schemas/capabilities.schema.json` (proposed additive optional `anonymousActor` block — lands at `Active`) · `schemas/run-snapshot.schema.json` (proposed additive optional `owner.principalKind` — lands at `Active`) · `spec/v1/auth.md` (§"Identity claims" — the anonymous principal kind) · `spec/v1/capabilities.md` (new `anonymousActor` family) · `spec/v1/observability.md` (audit attribute) · `SECURITY/invariants.yaml` (four proposed rows — land with their tests at `Active`) · `SECURITY/threat-model-prompt-injection.md` · `SECURITY/threat-model-secret-leakage.md` · new conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                                                                                                                                                                                                                               |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                              |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                              |

## Summary

Public agent surfaces — an embeddable chat widget, a marketing-site assistant, a link a logged-out visitor follows — dispatch an LLM turn on behalf of a caller who has **no account and no credential**. Today the protocol has no wire vocabulary for that caller: RFC 0048's `principal` is an authenticated user or agent, and a host that wants a public surface to do more than echo a single managed turn has no portable, conformance-testable contract for *what a caller-with-no-identity may cause an agent to do*. This RFC defines an **anonymous actor** — a new, explicit `principal` kind that is opaque, origin-bound, per-session-ephemeral, non-cross-linkable, and carries no PII (RFC 0048 parity) — whose authority is **not** any user/role and **not** the default-on tool baseline, but a **default-deny, explicit, per-surface tool grant** advertised via a new optional `anonymousActor` capability family, with two tiers: a tenant-scoped, no-egress, no-secrets **read** tier, and a **bounded-write/egress** tier permitted *only* behind a mandatory per-action HITL/approval gate or a hard rate-limit + per-session cap, SSRF-guarded egress (RFC 0079), and a hard floor that an anonymous actor never reaches tenant BYOK credentials, secrets, or cross-tenant data. Every anonymous-actor tool call emits an audit record attributable to the opaque session id in the `openwop.*` OTel namespace. It is additive — a host that does not advertise `anonymousActor` is unaffected, and existing clients ignore the new capability and the new optional `principalKind`.

## Motivation

The protocol models every actor as an authenticated `principal` (RFC 0048): a host derives `{ tenant, workspace?, principal }` from the caller's credential, and the whole authorization stack — RBAC scopes (RFC 0049), the credentialed-egress boundary (RFC 0079), the deliverable/tool boundary — assumes an *acting user*. The reference host's own tool surfaces enforce this directly: a tool "fails EMPTY without an acting user," and a default-on baseline of action tools is attached to every *authenticated* agent turn.

But a growing class of surfaces has **no acting user by construction**:

1. **The public embeddable chat widget.** A logged-out website visitor pastes a message into an embed; the host dispatches an LLM turn charged to the *operator's* tenant. The reference host ships exactly this (a single-turn, **no-tools**, origin-gated, managed-key gateway), and it deliberately **defers tool-enabled public dispatch behind this RFC** — because the moment a public surface can call a tool, the question "*what may a caller with no identity cause an agent to do, against whose data, with whose credentials?*" becomes a wire-level security question, not a host implementation detail.
2. **Marketing-site and pre-signup assistants** that answer from an operator's public content and, eventually, take a bounded action (book a slot, capture a lead) on the visitor's behalf.
3. **Federated / A2A public entry points** where a peer forwards an end-user interaction that never authenticated against *this* host.

Each host will otherwise invent its own answer. Without a shared contract, one host will let a public surface inherit the same default-on tool baseline an authenticated agent has (a catastrophic over-grant), another will attach a tenant credential to a visitor-triggered egress (a confused-deputy exfiltration), a third will key the anonymous caller on an IP address or a fingerprint (a PII / cross-linkability leak). These are not hypothetical — they are the exact failure modes the reference host's public gateway was hand-hardened against, one surface at a time, with no portable contract to point conformance at.

**The spec is the right place** because the anonymous actor is a *wire-level principal kind*: its opacity + non-PII property must hold across the discovery, ownership, event, and audit surfaces (the same reason RFC 0048 put `principal` on the wire); its authority derives from a *capability advertisement + per-surface grant* that a client and the conformance suite must be able to read and refute; and the "never reaches secrets / never rides a default baseline / egress must be SSRF-guarded / write must be gated" rules are **cross-host security invariants**, not per-host policy. The host keeps what is genuinely host-owned — the capability-token format that binds a surface to the actor (ADR 0013 is the reference binding), the concrete surface→tool operator config, the rate-limiter. This RFC pins the principal kind, the capability shape, the tier semantics, the four MUST-NOTs, and the audit contract.

## Proposal

### §A — The anonymous-actor principal kind (normative)

RFC 0048 §A defines `principal` as "the acting identity (a user or an agent)" and its §Unresolved-Q1 explicitly **deferred a principal-*kind* discriminator** ("`user` vs `agent`… deferred until the RBAC binding needs it"). This RFC resolves that open question for the anonymous case by defining a third, explicit kind.

An **anonymous actor** is a `principal` that represents a caller who authenticated no identity against this host. It has these properties, each normative:

1. **Opaque + non-PII.** The anonymous actor's `principal` identifier MUST be an opaque, host-minted string that is not, and does not embed, PII — no IP address, no email, no device fingerprint, no third-party identity (RFC 0048 §"Identifier opacity" parity, applied with no exceptions because there is no user behind it to key on).
2. **Origin-bound + ephemeral.** The identifier MUST be scoped to a single public-surface session and MUST NOT be a stable, long-lived handle. A host MUST NOT reuse one anonymous-actor identifier to correlate two sessions, and MUST NOT allow a caller to supply or influence it (it is host-minted, like `decidedBy` in RFC 0051 / the `prompt-injection-decidedby-host-only` invariant).
3. **Non-cross-linkable.** The identifier MUST NOT be resolvable — by the host or by any consumer of the wire — to an authenticated `principal`, a `workspace`, or any other anonymous-actor session. It is a leaf: it owns its session and nothing else.
4. **Never an authority source.** An anonymous actor's authority is defined **solely** by §B/§C below. It MUST NOT inherit any role (RFC 0049), any RBAC scope beyond what §C grants, or any default-on tool baseline. A host MUST NOT resolve a role for it and MUST NOT default-allow any action for it.

**Wire witness (additive, optional).** So a host, a client, and the conformance suite can observe that a run was authorized as anonymous, this RFC adds an OPTIONAL `principalKind` sibling to the RFC 0048 `owner` triple:

```diff
   "owner": {
     "type": "object",
     "required": ["tenant"],
     "properties": {
       "tenant":    { "type": "string", "minLength": 1 },
       "workspace": { "type": "string", "minLength": 1 },
       "principal": { "type": "string", "minLength": 1 },
+      "principalKind": {
+        "type": "string",
+        "enum": ["user", "agent", "anonymous"],
+        "description": "RFC 0132. The kind of the acting principal. OPTIONAL and EXPLICIT — absent ⇒ unconstrained (today's RFC 0048 behavior; a host that does not distinguish kinds omits it). `anonymous` ⇒ the §A anonymous-actor rules and the §C default-deny grant bind; the `principal` id MUST be opaque, origin-bound, ephemeral, non-cross-linkable, non-PII. Resolves RFC 0048 §Unresolved-Q1 for the anonymous case."
+      }
     },
     "additionalProperties": false
   }
```

`principalKind` is EXPLICIT, never inferred: an absent value keeps today's behavior (the same posture RFC 0131 took for `AgentManifest.role`). A host that advertises `anonymousActor` (§B) and dispatches through a public surface MUST set `owner.principalKind: "anonymous"` on the resulting run so the authorization is observable and auditable.

### §B — The `anonymousActor` capability family (normative)

A host that honors anonymous-actor authorization advertises it as a document-root capability family on `GET /.well-known/openwop` (RFC 0073 document-root layout). The block is a closed, server-emitted object mirroring the `dataResidency` / `authorization` family shape:

```jsonc
"anonymousActor": {
  "type": "object",
  "additionalProperties": false,
  "required": ["supported", "tiers"],
  "properties": {
    "supported":  { "const": true, "description": "RFC 0132. Host honors anonymous-actor authorization. The block is OMITTED ENTIRELY when unsupported (dataResidency-style const-true, not supported:false)." },
    "tiers":      { "type": "array", "minItems": 1, "uniqueItems": true,
                    "items": { "enum": ["read", "bounded-write-egress"] },
                    "description": "The anon capability tiers this host BEHAVIORALLY honors (truthful-advertisement). `read`: tenant-scoped reads, no egress, no secrets (§C.1). `bounded-write-egress`: writes/egress permitted ONLY behind a §C.2 control." },
    "writeEgressControls": { "type": "array", "minItems": 1, "uniqueItems": true,
                    "items": { "enum": ["hitl", "rate-limit-session-cap"] },
                    "description": "REQUIRED and non-empty IFF `bounded-write-egress` ∈ tiers. The mandatory controls the host enforces before an anon write/egress: `hitl` = a per-action approval gate (RFC 0051); `rate-limit-session-cap` = a hard per-IP/per-window rate limit AND a per-session action cap. Absent when the host advertises only `read`." },
    "failClosed": { "const": true, "description": "RFC 0132. An anon tool call whose grant is absent, unresolvable, or errors MUST deny (never default-allow). Mirrors capabilities.authorization.failClosed." }
  }
}
```

**Advertisement rules (normative):**

1. **Truthful advertisement.** A host MUST list a tier in `tiers` only if it behaviorally honors that tier per §C. Advertising `bounded-write-egress` without enforcing a §C.2 control is a dishonest capability claim per `capabilities.md` §Truthful advertisement; `OPENWOP_REQUIRE_BEHAVIOR=true` MUST fail it.
2. **Conditional control requirement.** `writeEgressControls` MUST be present and non-empty when `bounded-write-egress ∈ tiers`, and MUST be absent (or omitted) otherwise. A `bounded-write-egress` tier with no advertised control fails validation — a control-less write/egress tier is exactly the fail-open shape this RFC forbids.
3. **`failClosed` is `const: true`.** A host that advertises `anonymousActor` commits to fail-closed grant resolution; there is no fail-open anonymous mode.
4. **Backward compat.** Clients MUST tolerate the block's absence; a host that omits `anonymousActor` supports no anonymous-actor authorization and any public surface it runs is out of this RFC's scope (e.g. the reference host's current no-tools single-turn gateway needs no advertisement).

### §C — The per-surface tool grant + the two tiers (normative)

A **public agent surface** is an operator-configured entry point a host exposes to unauthenticated callers. The host binds a surface to an anonymous actor via a host-defined capability token — **this RFC does NOT define the token format** (ADR 0013's origin-gated `wgt_`-token is the reference binding; the token is host-owned config, never a secret on the wire). The host MUST resolve, from the surface, a `tenant` (the surface's owner) and an **explicit tool allowlist**.

1. **Default-deny, explicit grant (the load-bearing MUST-NOT).** An anonymous actor MUST be granted **only** the tools explicitly listed in the resolved surface allowlist. A host MUST NOT attach to an anonymous actor any default-on tool baseline, any tool granted to authenticated agents by default, or any tool not in the surface's explicit allowlist. The effective granted set for an anon session is discoverable through the existing RFC 0078 tool-catalog read scoped to the anonymous principal, which fails **empty** when the surface grants nothing (never a baseline). This is the `anon-actor-no-default-baseline` invariant (§F).

2. **The read tier.** A tool granted at the `read` tier MUST be tenant-scoped to the surface's tenant, MUST NOT perform egress, and MUST NOT resolve, return, or otherwise reach any secret / BYOK credential material. A `read`-tier tool call for an anon actor that would cross a tenant boundary MUST fail closed (`run_forbidden` / an empty result — never another tenant's data), reusing the CTI-1 cross-tenant guarantee. This is the `anon-actor-no-secret-reach` invariant (§F).

3. **The bounded-write/egress tier.** A tool granted at the `bounded-write-egress` tier — one that mutates durable state or performs outbound egress — is permitted for an anonymous actor **only** when ALL of:
   - **A mandatory control is enforced** (`anon-actor-write-egress-gated`, §F): either a per-action HITL/approval gate (RFC 0051 — the action suspends pending a human decision) **or** a hard rate-limit **and** a per-session action cap. A host MUST advertise which control(s) it uses (`writeEgressControls`, §B) and MUST NOT permit an ungated anon write/egress; an anon write/egress with no resolvable control MUST be denied.
   - **Egress is SSRF-guarded and credential-safe** (`anon-actor-egress-ssrf-guarded`, §F): an anon-initiated egress MUST ride the host's SSRF-guarded, audience-bound egress path (RFC 0076 §B `safeFetch` + RFC 0079 credential↔destination binding). A host MUST NOT attach a tenant BYOK credential or any host-issued credential to an anon-initiated egress unless the credential's provenance `audiences` explicitly include the destination **and** host policy permits anon use of that credential; the default posture is `downgraded` (anonymous egress, no credential) or `denied`. An anon actor never becomes a confused deputy for a tenant credential.
   - **No secret / cross-tenant reach** (`anon-actor-no-secret-reach`, §F, applies to both tiers): the write/egress MUST NOT read or write across the surface's tenant boundary and MUST NOT surface secret material.

4. **Authority does not escalate.** An anonymous actor MUST NOT acquire additional tools, tiers, or scope over the life of a session (no privilege accretion). A multi-turn public session re-resolves the same surface grant each turn.

### §D — Audit (normative)

Every anonymous-actor tool call MUST emit an audit record attributable to the opaque anonymous-session `principal`, in the canonical `openwop.*` OTel namespace (`observability.md`). The record reuses the existing RFC 0049 `authorization.decided { principal, action, resource, allowed, reason }` event (already in the closed event vocabulary + `run-event-payloads.schema.json`) — no new event type is minted. The `principal` is the opaque anon id (§A); `allowed:false` denials (a not-granted tool, an ungated write, a blocked egress) MUST be emitted with a machine-stable `reason` (e.g. `anon-not-granted`, `anon-write-ungated`, `anon-egress-denied`). The audit record MUST carry no PII and no credential material (`anon-actor-audit-opaque`, §F — an application of RFC 0048 identifier-opacity + SR-1). A host MAY additionally set the OPTIONAL OTel span attribute `openwop.actor.kind = "anonymous"` on anon-authorized spans for dashboards; the attribute is content-free.

### §E — Composition

- **RFC 0048** — the `owner`/`principal` model this extends with the `anonymous` kind (resolving its §Unresolved-Q1) + the identifier-opacity rule §A reuses without exception.
- **RFC 0011** — auth-scoped discovery: an anonymous caller sees the host's public capability view; the `anonymousActor` advertisement lives there. The RFC 0011 authorization-oracle invariant is unaffected (anonymous is the *narrowest* view).
- **RFC 0049** — the `authorization.decided` audit event (§D) + the fail-closed posture `failClosed` mirrors; an anon actor resolves to *no* role (§A.4).
- **RFC 0076 §B / RFC 0079** — the SSRF-guarded, audience-bound egress path an anon write/egress MUST ride (§C.3); the `egress.decided` `downgraded`/`denied` outcomes are exactly the anon-egress default posture.
- **RFC 0078** — the tool-catalog read scoped to the anon principal is the wire witness that the grant is explicit + default-deny (fails empty, §C.1).
- **RFC 0064** — the per-tool authorization boundary where the §C grant is enforced.
- **RFC 0051** — the HITL/approval control option for the `bounded-write-egress` tier (§C.3); no new interrupt kind.

### §F — Safety + SECURITY invariants (normative — proposed; land with their tests at `Active`)

This RFC introduces four new protocol-tier MUST-NOTs (plus one identifier-opacity application). Per the `check-security-invariants.sh` gate + the RFC 0079 precedent, a protocol-tier invariant lands in `SECURITY/invariants.yaml` **together with its public conformance test** — so these rows are **specified here and land at `Draft → Active`**, not at this Draft filing:

| Invariant (proposed) | MUST-NOT | Tier | Enforcing conformance scenario |
| --- | --- | --- | --- |
| `anon-actor-no-default-baseline` | An anonymous actor MUST NOT inherit any default-on / default-granted tool baseline; every callable tool is an explicit per-surface grant. | protocol | `anonymous-actor-default-deny.test.ts` |
| `anon-actor-no-secret-reach` | An anonymous-actor tool call MUST NOT resolve/return BYOK or secret material, and MUST NOT reach cross-tenant data (CTI-1 + SR-1 parity). | protocol | `anonymous-actor-no-secret-reach.test.ts` |
| `anon-actor-egress-ssrf-guarded` | An anon-initiated egress MUST ride the SSRF-guarded, audience-bound path (RFC 0076/0079); a host-issued/tenant credential MUST NOT attach out-of-audience — `downgraded`/`denied`. | protocol | `anonymous-actor-egress-guarded.test.ts` |
| `anon-actor-write-egress-gated` | An anon bounded-write/egress tool MUST be behind a mandatory control (HITL/approval OR hard rate-limit + per-session cap); an ungated anon write/egress MUST be denied. | protocol | `anonymous-actor-write-gated.test.ts` |
| `anon-actor-audit-opaque` | The anon-session `principal` MUST be opaque + non-cross-linkable + non-PII; the `authorization.decided` audit record carries no PII/credential material. | protocol | `anonymous-actor-audit-opaque.test.ts` |

`threat-model-prompt-injection.md` gains an adversary row (A-ANON: a public-surface visitor supplying crafted input to a *tool-enabled* anonymous dispatch) and `threat-model-secret-leakage.md` gains a "public-surface credential reach" row (an anon egress must never become a confused deputy for a tenant credential).

### §G — Examples

**Positive — read-tier discovery + dispatch.**

Discovery doc (root):

```json
"anonymousActor": { "supported": true, "tiers": ["read"], "failClosed": true }
```

A logged-out visitor's session on a public surface (tenant `acme`) calls a granted read tool `catalog.read`:

```json
{ "event": "authorization.decided",
  "payload": { "principal": "anon:sess-3f9c…", "action": "tool:catalog.read",
               "resource": "tenant:acme", "allowed": true, "reason": "anon-granted" } }
```

The run snapshot echoes `owner: { "tenant": "acme", "principal": "anon:sess-3f9c…", "principalKind": "anonymous" }`. No secret is resolved; the result is tenant-scoped to `acme`.

**Positive — gated write tier.**

```json
"anonymousActor": { "supported": true, "tiers": ["read", "bounded-write-egress"],
                    "writeEgressControls": ["hitl"], "failClosed": true }
```

The visitor asks the agent to "book a demo"; the granted `lead.capture` write tool suspends on an RFC 0051 approval interrupt (the `hitl` control) before any durable write.

**Negative — over-grant (non-conformant behavior).** An anonymous actor that calls a tool **not** in the surface allowlist — e.g. one of the authenticated default-on baseline action tools — and the host dispatches it. Non-conformant by §C.1 / `anon-actor-no-default-baseline`. The conformant behavior is `authorization.decided { allowed: false, reason: "anon-not-granted" }` and no dispatch.

**Negative — confused-deputy egress (non-conformant behavior).** An anon-initiated `http.fetch` to `attacker.example` to which the host attaches a tenant credential minted for `api.stripe.com`. Non-conformant by §C.3 / `anon-actor-egress-ssrf-guarded` (composes RFC 0079 `egress-credential-audience-bound`). Conformant: `egress.decided { decision: "denied"|"downgraded", reason: "out-of-audience" }`.

**Negative — schema.** `anonymousActor: { "supported": true, "tiers": [] }` fails (`minItems: 1`). `anonymousActor: { "supported": true, "tiers": ["bounded-write-egress"] }` with no `writeEgressControls` fails the §B.2 conditional (a control-less write tier). `anonymousActor: { "supported": false, … }` fails (`supported` is `const: true` — the block is omitted when unsupported). `owner.principalKind: "guest"` fails the enum.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1 + the §4 decision table row "New optional capability advertised, off by default → additive" and "New normative requirement on a previously-undefined behavior → additive (the spec was previously silent)").

Backward-compatibility guarantees, per clause:

- **New optional capability family.** `anonymousActor` is a new document-root discovery block; a host that omits it stays v1-compliant, and a client that does not understand it ignores it (RFC 0073 forward-compat). Off by default — no host advertises it until it implements it.
- **New optional field.** `owner.principalKind` is optional with no default; an absent value is exactly today's RFC 0048 behavior. `run-snapshot.schema.json` is a server-emitted document and stays open (`COMPATIBILITY.md` §2.1 schema-closure: server-emitted shapes MUST NOT be closed); appending an optional enum-valued property invalidates no existing snapshot. The `owner` sub-object stays `additionalProperties: false`, and the new property is a declared member, so closure is preserved.
- **New normative requirements bind only opt-in surfaces.** The four §F MUST-NOTs and the §C tier rules constrain **only** behavior that exists solely under a host that advertises `anonymousActor` and runs a tool-enabled public surface — a previously-undefined behavior (the spec was silent on tool-enabled anonymous dispatch). They do not retroactively fail any existing host: a host with no public surface, or the reference host's current no-tools single-turn gateway, advertises nothing and is unaffected.
- **No existing field, event, error code, or endpoint changes.** The audit contract reuses the existing `authorization.decided` event (RFC 0049) — no new event type, so the `observability.md` closed-event-vocabulary rule is not touched. The `run_forbidden` error code (RFC 0048 §D) is reused for cross-tenant fail-closed.

Spec **major does not bump**; spec **minor bumps**; the conformance suite **minor bumps** with the new capability-gated scenarios. No v1 conformance pass is invalidated.

## Conformance

**Existing coverage (adjacent surface):**

- `auth.test.ts` — unauthenticated request → `401`. The anonymous-actor path is orthogonal: a public surface is *intentionally* unauthenticated at the transport layer; its authority comes from the surface grant, not a bearer token. (This RFC does not relax `auth.test.ts` — a protocol endpoint requiring a scope still returns `401` without a credential.)
- `identity-owner-shape.test.ts` — the `owner`-triple schema-validity template the `principalKind` shape scenario extends.
- `authorization-fail-closed.test.ts` — the `failClosed` const-true + deny-on-unresolved template the `anonymousActor.failClosed` shape scenario mirrors.
- `discovery.test.ts` — required-capability discovery shape.
- `cross-workspace-isolation.test.ts` — the CTI/`run_forbidden` fail-closed pattern §C.2 reuses.
- `egress-audience-binding.test.ts` (RFC 0079) — the credential↔destination binding §C.3 composes.

**New scenarios landing with this RFC:**

- `anonymous-actor-shape.test.ts` (always-on, server-free): `capabilities.schema.json` declares the `anonymousActor` block; a conforming advert validates; the negatives reject (`tiers: []`; `bounded-write-egress` without `writeEgressControls`; `supported: false`); `run-snapshot.schema.json` accepts `owner.principalKind: "anonymous"` and rejects `"guest"`. **Capability-gate name:** none (shape floor).
- `anonymous-actor-default-deny.test.ts` (gated on `anonymousActor.supported`, `OPENWOP_REQUIRE_BEHAVIOR` hard-fail): an anon session's tool-catalog read (RFC 0078) returns **only** the surface's explicit grant and never a default baseline; a call to a non-granted tool → `authorization.decided { allowed:false, reason:"anon-not-granted" }`, no dispatch. Backs `anon-actor-no-default-baseline`.
- `anonymous-actor-no-secret-reach.test.ts` (gated): an anon tool call with a planted BYOK canary in the surface tenant's secrets never surfaces the canary; a cross-tenant read fails closed. Backs `anon-actor-no-secret-reach` (SR-1 + CTI-1 canary discipline).
- `anonymous-actor-egress-guarded.test.ts` (gated): an anon egress to an out-of-audience destination → `egress.decided { denied|downgraded }`, credential NOT attached. Backs `anon-actor-egress-ssrf-guarded` (composes RFC 0079).
- `anonymous-actor-write-gated.test.ts` (gated): an anon `bounded-write-egress` tool with no resolvable control → denied; with a `hitl` control → suspends on an approval interrupt before the write. Backs `anon-actor-write-egress-gated`.
- `anonymous-actor-audit-opaque.test.ts` (gated): the `authorization.decided` record for an anon call carries an opaque, non-PII `principal` and no credential material. Backs `anon-actor-audit-opaque`.

**Capability gating.** All behavioral scenarios gate on `anonymousActor.supported` and soft-skip when unadvertised (hard-fail under `OPENWOP_REQUIRE_BEHAVIOR=true`), registered in `conformance/coverage.md` §"Capability-gated scenarios" with `Behavior-unlock dependency = a reference host wires a tool-enabled public surface`. No new fixtures beyond a `conformance-anon-surface` fixture (a public-surface workflow with a single read-tier grant), added to `conformance/fixtures.md`.

**Reference-host coverage.** Deferred at `Draft` — the shape scenario ships; the behavioral scenarios soft-skip until the reference host (openwop-app) lands tool-enabled public dispatch over its existing origin-gated gateway. `INTEROP-MATRIX.md` gains a `### Anonymous-actor authorization (RFC 0132 — capabilities.anonymousActor)` section in the same PR that lands the shape scenario.

## Alternatives considered

1. **Do nothing — leave public-surface tool authorization host-private.** Rejected. The reference host already ships a public gateway hand-hardened against exactly these failure modes and *deferred tool-enabled dispatch behind this RFC*; every other host will re-derive (or fail to derive) the same protections with no shared contract. "What may an identity-less caller cause an agent to do, against whose data, with whose credentials?" is a cross-host security question — the same reason RFC 0048 put the principal on the wire and RFC 0079 put credential-egress binding on the wire. Leaving it host-private guarantees divergence and, on at least one host, a catastrophic over-grant (public surface inherits the authenticated default-on baseline) or a credential confused-deputy.
2. **Reuse the authenticated `principal` with an "anonymous" role in RFC 0049 RBAC.** Rejected. A role resolves *to scopes* and presumes an identity to bind the role to; an anonymous actor has no identity and must be *incapable* of resolving a role (§A.4) — modeling it as a role invites a host to accidentally grant it role-derived scopes, and gives conformance nothing to assert about the "never rides a baseline / never reaches secrets" floor. The anonymous actor needs its *own* default-deny grant model and its *own* invariants, not a seat in the RBAC table.
3. **A single "read-only anonymous" tier — no write/egress at all.** Rejected as under-scoped against the maintainer direction (broader capability, not read-only) and against the real demand (a public assistant that books a slot / captures a lead). But the write path is the dangerous one, so this RFC does not make it symmetric with read: the `bounded-write-egress` tier is permitted **only** behind a mandatory control + SSRF-guarded egress + the secret/cross-tenant floor. A host that wants read-only simply advertises `tiers: ["read"]` — this alternative is the strict subset, not a separate design.
4. **Put the whole per-surface tool allowlist in the discovery document.** Rejected. The surface→tool mapping is operator config that changes per deployment and per surface (like connection-pack provider config), and publishing every surface's grant on the public discovery doc is both noisy and an enumeration aid. The wire contract is the *capability + the tier semantics + the default-deny MUST*; the *effective grant* for a live anon session is witnessed through the existing RFC 0078 tool-catalog read (which fails empty), which is more precise and already conformance-observable.

## Unresolved questions

1. **`principalKind` for the authenticated cases.** This RFC adds the `anonymous` enum value and, incidentally, `user`/`agent` (resolving RFC 0048 §UQ1's discriminator). Should `user`/`agent` distinction carry its own normative weight (e.g. an audit requirement), or stay a passive marker until a consumer pulls? Proposed: passive for now; only `anonymous` binds behavior in this RFC.
2. **Cross-surface session correlation for legitimate continuity.** §A.2 forbids reusing an anon id across sessions. A host may legitimately want a visitor's multi-page journey to feel continuous. Is a host-minted, per-surface, still-non-PII "continuity token" (opaque, revocable, never cross-linkable to an identity) in scope, or a follow-on? Proposed: out of scope here — continuity that survives a session is a de-anonymization pressure that deserves its own security pass.
3. **A2A-forwarded anonymous interactions.** When a peer forwards an end-user interaction (RFC 0100/0101) that never authenticated against this host, does the forwarded actor map to `principalKind: "anonymous"`, and does the RFC 0128 purpose-propagation label ride the anon boundary? Proposed: defer to a cross-host follow-on; keep this RFC's anonymous actor a *local* public-surface concept.
4. **Anonymous-actor rate-limit vocabulary.** `rate-limit-session-cap` is advertised as a control but its *parameters* (window, per-IP budget, per-session cap) are host-owned. Should the host advertise the numeric caps so a client can pre-flight, or is that an abuse-surface disclosure best kept opaque? Proposed: keep opaque (advertising the exact cap tells an abuser precisely how much they may do) — advertise only *that* a cap exists.
5. **`bounded-write-egress` + BYOK downgrade default.** §C.3 defaults an out-of-audience anon egress to `downgraded`/`denied`. Should a host ever be permitted to attach a *tenant* credential to an anon egress (in-audience, host-policy-permitted), or is anon egress *always* credential-free? Proposed: allow the in-audience, explicitly-host-permitted case (composing RFC 0079) rather than a blanket ban, but default to credential-free. Confirm before `Active`.

## Implementation notes (non-normative)

- **Sequencing.** One new capability block + one optional snapshot field + five proposed invariants (landing with their tests at `Active`) + the audit reuse of `authorization.decided`. No new event type, no new error code, no new interrupt kind — deliberately composed from RFC 0048/0049/0051/0064/0076/0078/0079 so the surface a reviewer must trust is small.
- **Reference host (openwop-app).** The path is short: the existing public gateway (`features/chat-widget/publicGateway.ts`) already resolves a surface from an origin-gated token, derives the tenant from the resource, dispatches through a managed (host-owned) key, and fences untrusted visitor input — it just runs **no tools**. Anonymous-actor authorization is: mint an opaque per-session anon principal, set `owner.principalKind: "anonymous"`, resolve the surface's explicit tool allowlist (default-deny — NOT the ADR 0315 baseline), scope reads to the surface tenant, and route any write/egress through the approval gate or the rate-limit/cap + the RFC 0079 egress path. The chat-first-port unit A5 (`docs/chat-first-port/a5-chat-widget-deployment.md`) deferred exactly this behind this RFC.
- **The host keeps.** The capability-token format (ADR 0013), the concrete surface→tool operator config, the rate-limiter implementation, the abuse-signal logging. This RFC pins only the wire-observable contract.
- **Expected effort:** S–M for the schema block + capability + optional field + prose + shape conformance (lands at `Draft → Active`); M for a reference implementation over the existing gateway + the five behavioral scenarios.

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] `spec/v1/capabilities.md` §"anonymousActor" + `spec/v1/auth.md` §"Identity claims" (the `anonymous` principal kind) document §A–§E.
- [ ] `schemas/capabilities.schema.json` `anonymousActor` block + `schemas/run-snapshot.schema.json` `owner.principalKind` (additive optional).
- [ ] `SECURITY/invariants.yaml` — the five §F rows land together with their public tests (per `check-security-invariants.sh`); `threat-model-prompt-injection.md` + `threat-model-secret-leakage.md` rows.
- [ ] `spec/v1/observability.md` — the OPTIONAL `openwop.actor.kind` attribute + the anon audit reuse of `authorization.decided`.
- [ ] Conformance: `anonymous-actor-shape.test.ts` (always-on) + the five gated behavioral scenarios; `conformance-anon-surface` fixture in `fixtures.md`; `coverage.md` capability-gated rows.
- [ ] CHANGELOG entry under the appropriate spec-minor version + `INTEROP-MATRIX.md` `### Anonymous-actor authorization` section.
- [ ] All five Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host implements a tool-enabled public surface + passes the behavioral scenarios, OR the RFC explicitly defers reference-host implementation.

## References

- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the `owner`/`principal` model + identifier-opacity rule this extends; its §Unresolved-Q1 (principal-kind discriminator) this resolves for the anonymous case.
- [`RFCS/0011-auth-scoped-discovery.md`](./0011-auth-scoped-discovery.md) — the auth-scoped discovery view an anonymous caller sees.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — the `authorization.decided` audit event + fail-closed posture reused.
- [`RFCS/0079-credential-provenance-and-egress-policy.md`](./0079-credential-provenance-and-egress-policy.md) · [`RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md`](./0076-pack-runtime-requirements-and-host-safe-fetch.md) — the SSRF-guarded, audience-bound egress path an anon write/egress MUST ride.
- [`RFCS/0078-portable-tool-catalog-and-tool-session-contract.md`](./0078-portable-tool-catalog-and-tool-session-contract.md) — the tool-catalog read that witnesses the default-deny grant (fails empty).
- [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](./0064-tool-invocation-hooks-and-authorization.md) — the per-tool authorization boundary the §C grant is enforced at.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — the HITL control option for the bounded-write/egress tier.
- [`RFCS/0106-realtime-voice-session-profile.md`](./0106-realtime-voice-session-profile.md) — a recent host-surface capability-family RFC used for shape reference.
- [`spec/v1/auth.md`](../spec/v1/auth.md) · [`spec/v1/capabilities.md`](../spec/v1/capabilities.md) · [`spec/v1/observability.md`](../spec/v1/observability.md) — the spec docs touched.
- [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) · [`SECURITY/threat-model-secret-leakage.md`](../SECURITY/threat-model-secret-leakage.md) · [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml) — the threat library + invariant catalogue the §F rows join.
- Host implementation context (non-normative): openwop-app ADR 0013 (origin-gated capability token — the reference surface↔actor binding), ADR 0315 (default-on tool baseline — the baseline an anonymous actor MUST NOT ride), ADR 0308/0309 (deliverable tools fail closed without an acting user), ADR 0127 (the public embeddable chat widget), `backend/typescript/src/features/chat-widget/publicGateway.ts`, `docs/chat-first-port/a5-chat-widget-deployment.md` (deferred tool-enabled public dispatch behind this RFC).
