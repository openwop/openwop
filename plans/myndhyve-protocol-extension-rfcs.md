# OpenWOP Protocol Extension RFCs — Enabling MyndHyve

> **Status: CLOSED 2026-05-25** — 8 of the 10 proposed RFCs landed `Draft → Active → Accepted` in a single cohort on 2026-05-25 (commit `c9c6bfc`, PR #148). The verification run was MyndHyve workflow-runtime revision `workflow-runtime-00211-69w` against `@openwop/openwop-conformance@1.6.0`, reporting **28 PASS / 0 FAIL** across the cohort scenarios with all five new capability blocks (`host.credentials`, `host.oauth`, `authorization`, `host.scheduling`, `host.deadLetter`) advertised live on `https://api.myndhyve.ai/.well-known/openwop` (curl-verified 2026-05-25). Per-RFC adoption write-up is `docs/openwop-adoption/0045-0054-cohort-summary.md` in the adopter's repo; see also [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) §"VERIFIED cohort".
>
> **Accepted (8):** RFC 0045 (connector pack manifest) · RFC 0046 (`host.credentials`) · RFC 0047 (`host.oauth`) · RFC 0048 (tenant·workspace·principal) · RFC 0049 (RBAC scopes) · RFC 0051 (approval-gate primitive) · RFC 0052 (scheduling) · RFC 0053 (dead-letter routing). Each promoted on the same conformance run.
>
> **Still `Draft` — MyndHyve opted out (2):** RFC 0050 (SAML / SCIM enterprise identity profiles) — MyndHyve hasn't yet wired a SAML ACS endpoint, so the cohort run had no positive SAML evidence; the synthetic-IdP fixture is now bundled in `@openwop/openwop-conformance` (see `examples/conformance-saml-idp/`) so any host with `auth-profiles.saml` wiring can graduate it independently. RFC 0054 (run diff & execution comparison) — defers on a time-travel-debug UI surface in MyndHyve's app; the spec is land-ready and the schema (`run-diff-response.schema.json`) is vendored, awaiting a consuming UI before the host wires the endpoint.
>
> **Sequencing held.** The "Recommended order" below (0046 → 0047 → 0045 → 0048 → 0049/0050/0051 → 0052/0053/0054) was honored — `host.credentials` landed first, the OAuth flows that depend on it shipped second, the connector manifest that depends on both shipped third. Identity (0048) preceded the RBAC + approval-gate work it enables. Tier 3 reliability landed as an independent track.
>
> **Body preserved.** The proposal text below is retained as-authored for traceability; it uses future tense ("MyndHyve **must** advertise…", "**Depends on RFC 0046**") because it was a plan, not a retrospective. Read it as "what was proposed" — the actual Accepted RFCs at `RFCS/0045-*.md` through `RFCS/0053-*.md` are the normative artifacts.

---

**Purpose:** This document outlines the RFCs OpenWOP needs to author so that MyndHyve can express its product features *through the protocol* instead of as host-only code that no other host can interoperate with. It is the protocol-track companion to [`openwop_roadmap_gap_analysis.md`](./openwop_roadmap_gap_analysis.md).

**Framing.** MyndHyve is an OpenWOP **host**. Much of MyndHyve's product surface — connectors, the workspace credential vault, OAuth, workspace/RBAC scoping, CMS approval gates, scheduled routines — is currently implemented as MyndHyve-private code *above* the protocol. That works for MyndHyve alone, but it means:

1. **MyndHyve's `vendor.myndhyve.*` packs are not portable.** A pack that needs an OAuth'd Slack token or a workspace-shared API key only runs on MyndHyve, because the credential/auth surface it depends on isn't in the wire contract.
2. **MyndHyve can't advertise these behaviors** to peers via `/.well-known/openwop`, so cross-host composition (A2A, sub-workflow dispatch, the second-host federation tripwire) silently degrades.
3. **Conformance can't certify them.** There are no scenarios to prove MyndHyve's credential redaction, RBAC fail-closed, or approval-gate semantics match a portable contract.

Each RFC below states the **concrete MyndHyve problem**, **what OpenWOP must solve**, **the proposed protocol extension** (capability advertisement / wire shapes / events / schema / conformance), **how MyndHyve wires it**, and **compatibility + dependencies**. All are **additive** — none breaks the frozen v1 wire contract.

RFC numbers continue from the current head (`0044`). Final numbers are assigned at PR time per `RFCS/0001-rfc-process.md`; the numbering here reflects the recommended authoring order.

---

## Dependency & sequencing graph

```
TIER 1 — Connectors & Credentials (highest leverage; unblocks every vendor integration)
  0045 Connector Pack Manifest & Action Model
        └─ depends on ─▶ 0046 host.credentials capability
                              └─ depends on ─▶ 0047 OAuth 2.0 flows (host.oauth)

TIER 2 — Multi-Tenant Identity & Governance (MyndHyve workspaces / RBAC / approvals)
  0048 Tenant · Workspace · Principal identity model   (formalizes the tenant dim already in RFC 0011)
        ├─ enables ─▶ 0049 RBAC scopes & authorization decisions
        ├─ enables ─▶ 0050 SAML / SCIM (/ optional LDAP) enterprise identity profiles  (extends RFC 0010)
        └─ enables ─▶ 0051 Approval & Deployment Gate primitive

TIER 3 — Runtime reliability & tooling
  0052 Scheduling & time-based triggers   (promotes + extends RFC 0017 host.queueBus, still Draft)
  0053 Dead-letter routing & failure sinks
  0054 Run diff & execution comparison
```

**Recommended order:** 0046 → 0047 → 0045 (credentials before the connector model that consumes them) → 0048 → 0049/0050/0051 → 0052/0053/0054. Tier 1 is the critical path: it converts MyndHyve's 38 host-locked `vendor.myndhyve.*` packs into portable, registry-distributable artifacts.

---

# TIER 1 — Connectors & Credentials

## RFC 0046 — `host.credentials` capability: credential vault, encryption, sharing & rotation

> **Author this first.** Everything in Tier 1 depends on a portable credential surface.

### The MyndHyve problem
MyndHyve stores per-user secrets at `users/{uid}/secrets` and runs a **workspace-shared BYOK vault** (shipped per the `wop-tenant-secrets` initiative). Today the protocol only has the `run-options.md` §"Credential references" spec annex + `capabilities.secrets.scopes: ['user','tenant']` advertisement — enough to *pass a secret reference into a run*, but **not** a first-class surface for:
- storing/encrypting a credential at rest,
- sharing one credential across many workflows in a workspace,
- rotating a credential with a grace window,
- redacting it consistently in events, debug bundles, and replay.

So MyndHyve's vault logic is host-private and uncertifiable, and no `vendor.myndhyve.*` pack can declare "I need credential X" in a portable way.

### What OpenWOP must solve
A host-capability sibling to `host.fs` / `host.kvStorage` / `host.blobStorage` (RFCs 0014–0019) that defines a **credential resolution + lifecycle contract** every host can implement and every pack can target — without ever putting plaintext on the wire.

### Proposed protocol extension
- **Capability:** `capabilities.host.credentials` advertising `{ supported, scopes: ['user'|'workspace'|'tenant'], encryptionAtRest: bool, rotation: 'none'|'two-key-overlap', sharing: bool }`.
- **Resolution contract:** a pack references a credential by `{ ref, scope }`; the host resolves it at node-execution time and injects it into the node sandbox **only** — never into `inputs`, persisted variables, events, or replay state. (Mirrors the framework-reserved-name stripping MyndHyve already does.)
- **Rotation:** two-key overlap window borrowed verbatim from the API-key rotation already verified on the Postgres host (`auth-api-key-rotation.test.ts`); old + new valid during overlap, canary-redaction asserted.
- **Schema:** `credential-reference.schema.json` (the wire shape of a reference — *not* the secret) + extend `node-pack-manifest.schema.json` with `requiredCredentials[]`.
- **SECURITY invariant:** `credential-payload-redaction` (sibling to the existing `mcp-toolcall-payload-redaction`), added to `SECURITY/invariants.yaml` + CI gate.
- **Conformance:** capability-shape; positive resolve-roundtrip via a `conformance.credential.echo` fixture node; adversarial-redaction in events/debug-bundle/replay; rotation overlap.

### How MyndHyve wires it
MyndHyve maps its workspace vault to `scope: 'workspace'`, advertises `host.credentials.{rotation:'two-key-overlap', sharing:true}`, and re-expresses its `users/{uid}/secrets` + workspace vault as the resolver behind the contract. Its packs gain a portable `requiredCredentials` declaration.

### Compatibility & dependencies
Additive (new optional capability + schema). Supersedes the informal `run-options.md` BYOK annex with a first-class surface; the annex's existing `secrets.scopes` advertisement stays valid. No dependencies.

---

## RFC 0047 — OAuth 2.0 authorization flows for connectors (`host.oauth`)

### The MyndHyve problem
MyndHyve's connectors (`users/{uid}/connectors`) and Campaign Studio integrations (Slack, Google Calendar, Gmail, payment providers) require **OAuth 2.0 authorization-code + refresh**. The protocol today specifies OAuth2 **client-credentials** + OIDC user-bearer (RFC 0010) for *host authentication* — but nothing for a **node/connector acquiring a third-party token on a user's behalf**. `auth.md` explicitly defers this ("Open spec gaps"). MyndHyve therefore hand-rolls the entire OAuth dance host-side, and connector packs can't declare their OAuth needs portably.

### What OpenWOP must solve
A capability + contract for the host to perform the authorization-code grant, persist the resulting token (via `host.credentials`), refresh it transparently, and expose it to a node as a resolved credential — so a connector pack only declares *which provider + scopes* it needs, not *how* the token is obtained.

### Proposed protocol extension
- **Capability:** `capabilities.host.oauth` → `{ supported, grants: ['authorization_code','client_credentials','refresh_token'], providers: [{id, authUrl, tokenUrl, scopesSupported}] }`.
- **Connector-auth declaration:** in the pack manifest (see RFC 0045) a node declares `auth: { type: 'oauth2', provider, scopes[] }`.
- **Token lifecycle:** acquired tokens stored as `host.credentials` entries (scope `user` or `workspace`); refresh handled host-side; node receives a resolved bearer token in-sandbox only.
- **Events:** `connector.authorized` / `connector.auth_expired` (additive, redaction-safe — no token material).
- **Conformance:** capability-shape; synthetic-provider authorization-code roundtrip + refresh; redaction of token in all surfaces.

### How MyndHyve wires it
MyndHyve advertises its existing provider catalog under `host.oauth.providers`, routes its connector OAuth flows through the contract, and stores tokens in the RFC 0046 vault. Slack/Google/etc. connector packs become portable.

### Compatibility & dependencies
Additive. **Depends on RFC 0046** (token storage). Composes with RFC 0010 (host auth) without overlap — 0010 is "who is the caller," 0047 is "what third-party token does this node hold."

---

## RFC 0045 — Connector pack manifest & action model

### The MyndHyve problem
OpenWOP packs today are strong on **triggers** (`core.openwop.triggers`, 16 of them) and AI/agent nodes, but there is **no standard "connector" abstraction** — the n8n/Make-style *trigger + action + auth + pagination* bundle. MyndHyve's outbound integrations (Slack post, email send, CRM upsert, commerce order, ads publish) are expressed as ad-hoc nodes inside `vendor.myndhyve.*` packs, each re-implementing auth wiring, retries, and rate-limit handling differently. There's no portable contract for "a Salesforce connector" that another host could install and run.

### What OpenWOP must solve
A manifest extension that lets a pack declare itself a **connector**: a named integration exposing typed **actions** (and reusing the existing trigger model), each binding to an **auth declaration** (RFC 0047) and **credential requirement** (RFC 0046), with standardized retry/backoff and rate-limit metadata. This is the "Connector SDK framework" gap from the analysis, expressed the OpenWOP way (manifest-first, not a code SDK).

### Proposed protocol extension
- **Manifest block:** extend `node-pack-manifest.schema.json` with an optional `connector: { id, displayName, auth, actions: [{ typeId, displayName, idempotent, rateLimit?, paginated? }], triggers: [...] }`.
- **Action contract:** an action is a normal side-effectful node with declared `idempotent` + optional `rateLimit` hints the host scheduler honors.
- **Discovery:** connectors surface in the registry index + `packs.openwop.dev` so the (future App-layer) connector marketplace has data to render.
- **Conformance:** manifest-validity (connector block parses + actions resolve to real node typeIds); idempotency-hint honored; rate-limit metadata advertised.

### How MyndHyve wires it
MyndHyve re-emits its 38 `vendor.myndhyve.*` integration packs with `connector` blocks, deduplicating their hand-rolled auth/retry into the shared contract. They become installable on any conformant host and listable in the registry.

### Compatibility & dependencies
Additive (optional manifest block). **Depends on RFC 0046 + 0047** for the auth/credential references it points at.

---

# TIER 2 — Multi-Tenant Identity & Governance

## RFC 0048 — Tenant · Workspace · Principal identity model

### The MyndHyve problem
MyndHyve is deeply multi-tenant: every collaborative entity lives at `workspaces/{wsId}/`, every user has a personal workspace, and team workspaces carry RBAC. The protocol already has a **tenant** dimension (auth-scoped discovery, RFC 0011, narrows capability views per tenant) — but no notion of a **workspace** sub-tenant or a **principal** (the acting user/agent identity) as portable, wire-level concepts. So MyndHyve's workspace scoping, run ownership (`runs/{runId}` keyed by `userId`+`workspaceId`), and cross-tab claims (`run_claims`) are host-private conventions that A2A peers and the conformance suite can't reason about.

### What OpenWOP must solve
Promote the tenant dimension to a small, explicit **identity triple — `{ tenant, workspace?, principal }`** — that threads through discovery, run options, run ownership, and events; and define how RBAC (RFC 0049) and auth profiles (RFC 0050) bind to it.

### Proposed protocol extension
- **Identity claims:** standardize `tenant`, `workspace`, `principal` as optional claims carried in the auth context and echoed (redaction-safe) onto run ownership + `run.created`.
- **Scoped discovery extension:** RFC 0011's tenant-narrowing extended to workspace granularity.
- **Run ownership:** `RunSnapshot.owner: { tenant, workspace?, principal }` (additive).
- **Conformance:** workspace-scoped discovery subset; run-ownership echo; cross-workspace isolation (CTI-style — a principal in workspace A cannot read workspace B's run).

### How MyndHyve wires it
MyndHyve maps `ws-personal-{userId}` and team workspaces directly onto `workspace`, `activeWorkspaceId` onto the claim, and its `run_claims` dedup onto owner-scoped claims. Existing single-tenant hosts ignore the optional `workspace` claim with no change.

### Compatibility & dependencies
Additive. Builds on **RFC 0011**. Foundation for 0049/0050/0051.

---

## RFC 0049 — RBAC scopes & authorization decisions

### The MyndHyve problem
MyndHyve enforces workspace roles (`owner`/`admin`/`editor`/`viewer`) and CMS RBAC entirely host-side, **fail-closed** (a cache miss returns `{allowed:false}`). The protocol has a rich **API-key scope vocabulary** (`docs/api-keys/SCOPE-VOCABULARY.md`, with per-segment wildcards + verb implication) but no contract tying **roles → scopes → an authorization decision on a run or node**. MyndHyve's RBAC is therefore invisible to the protocol and uncertifiable.

### What OpenWOP must solve
A portable mapping from the RFC 0048 principal's **role** to **scopes** (reusing the existing scope grammar), plus a standardized **authorization-decision** surface so denials are observable, auditable, and conformance-testable — including the fail-closed default MyndHyve relies on.

### Proposed protocol extension
- **Role→scope binding:** advertise `capabilities.authorization.roles: [{ role, scopes[] }]`; reuse `anyScopeMatches` semantics from the API-key parser.
- **Decision event:** `authorization.decided { principal, action, resource, allowed, reason }` (redaction-safe), feeding the existing audit-log integrity profile (RFC 0009/0010).
- **Fail-closed MUST:** absent/unseeded role ⇒ deny, asserted by conformance.
- **Conformance:** scope-match matrix; fail-closed default; denial emits an audit entry.

### How MyndHyve wires it
MyndHyve's `RBACService` (local-mode, fail-closed) and `RoleSeedService` become the resolver behind the contract; CMS audit events (`cms.page.force_published`, etc.) map onto `authorization.decided` + the audit log it already feeds.

### Compatibility & dependencies
Additive. **Depends on RFC 0048.** Reuses existing scope vocabulary + audit profile.

---

## RFC 0050 — SAML / SCIM (and optional LDAP) enterprise identity profiles

### The MyndHyve problem
MyndHyve's enterprise prospects expect **SSO via SAML** and **user provisioning via SCIM**. The protocol has OAuth2-CC + OIDC (RFC 0010) but no SAML assertion-validation contract and no SCIM provisioning sync. Without these in the protocol, MyndHyve must build them as bespoke host code with no conformance backing.

### What OpenWOP must solve
Two new entries in the auth-profile family (sibling to the OAuth2/OIDC work in RFC 0010): a **SAML assertion-validation profile** and a **SCIM provisioning profile** that syncs external IdP users/groups onto RFC 0048 principals + RFC 0049 roles. LDAP is included as an **optional** directory-bind variant (lower priority — most demand is SAML/SCIM).

### Proposed protocol extension
- **`auth-profiles.md` annex:** SAML profile (assertion signature validation, `alg:none` rejection mirroring the OIDC work, attribute→principal mapping); SCIM profile (`/scim/v2/Users` + `/Groups` sync → principal/role upserts).
- **Advertisement:** `capabilities.auth.profiles += ['saml','scim']` (conditional, like the existing OAuth2/OIDC conditional advertisement).
- **Conformance:** synthetic-IdP SAML assertion roundtrip (positive + 6 negatives incl. bad signature, `alg:none`, expired); SCIM user+group provisioning roundtrip → principal/role assertion.

### How MyndHyve wires it
MyndHyve adds SAML/SCIM validators alongside its OIDC path (the Postgres host's `jwt-validator.ts` is the template), mapping provisioned users onto workspace memberships + roles (RFC 0049).

### Compatibility & dependencies
Additive (conditional profiles). **Depends on RFC 0048** (principal mapping) **+ RFC 0049** (role mapping). Extends **RFC 0010**.

---

## RFC 0051 — Approval & deployment-gate primitive

### The MyndHyve problem
MyndHyve runs an **always-on CMS workflow approval gate** (a page can't publish unless its stage is `approved`/`published`; force-publish is owner/admin-only and audit-logged). It also has HITL interrupt nodes. But "approval as a governed, role-bound, audited gate" — distinct from a generic clarification interrupt — is host-private. The protocol has interrupt profiles (multi-approver quorum, auth-required resume) but no **first-class approval/deployment gate** that binds to RBAC and emits governance events.

### What OpenWOP must solve
A standardized gate node + event shape for **role-gated approvals and deployment promotions**, composing the existing interrupt-profile machinery (quorum, auth-required) with RFC 0049 authorization and the audit log — so approval/force-publish/deploy-promote semantics are portable and certifiable.

### Proposed protocol extension
- **Node:** `core.openwop.governance.approvalGate` (interrupt node) with `requiredRole`/`requiredScope`, optional quorum, and an `override` path (role-gated, audited).
- **Events:** `approval.requested` / `approval.granted` / `approval.rejected` / `approval.overridden { principal, reason }` → audit log.
- **resumeSchema:** per the engine interrupt contract (rejects malformed resume with `400 INVALID_RESUME_VALUE`).
- **Conformance:** role-gated grant; unauthorized-principal denied; override emits audit; reject loopback.

### How MyndHyve wires it
MyndHyve re-expresses its CMS approval gate + force-publish as this node; `cms.page.force_published` maps to `approval.overridden`. Its existing approval-gate card/UI (`WorkflowCardRenderer`) renders the protocol events.

### Compatibility & dependencies
Additive (new node + events). **Depends on RFC 0049** (role binding). Composes with existing interrupt profiles.

---

# TIER 3 — Runtime reliability & tooling

## RFC 0052 — Scheduling & time-based triggers (promote + extend RFC 0017)

### The MyndHyve problem
MyndHyve runs **scheduled routines / recurring agents** (cron) and time-delayed campaign steps. RFC 0017 (`host.queueBus`) is the natural home but is still **Draft** and unwired; the trigger pack has a `schedule` trigger with no portable execution contract behind it. MyndHyve's scheduler is host-private.

### What OpenWOP must solve
Promote RFC 0017 from Draft to a wired contract and extend it with the **cron / delayed-execution / calendar / event-scheduling** trigger semantics the roadmap lists — capability-advertised and conformance-tested.

### Proposed protocol extension
- **Capability:** `capabilities.host.scheduling` → `{ cron: bool, delayed: bool, calendar: bool, maxFutureHorizon }`.
- **Trigger contract:** `schedule` trigger config (cron expr / delay / calendar ref) → durable scheduled run; `core.control.delay` already reads `config.delayMs` (per the conformance fixture rules) and stays as the in-DAG primitive.
- **Conformance:** cron-fires-once-per-tick; delayed-execution honors horizon; missed-tick policy.

### How MyndHyve wires it
MyndHyve maps its routine scheduler onto `host.scheduling` and re-expresses recurring campaigns as scheduled triggers.

### Compatibility & dependencies
Additive. **Promotes RFC 0017.** Independent of Tiers 1–2.

---

## RFC 0053 — Dead-letter routing & failure sinks

### The MyndHyve problem
When a MyndHyve workflow node exhausts retries, the failure is logged but there's no portable **dead-letter sink** — no standard place a poisoned run lands for inspection/replay. Reliability at scale (Bryce's production campaigns) needs this. The protocol has retry policies + idempotency but no DLQ surface.

### What OpenWOP must solve
A capability + event contract for routing terminally-failed runs/nodes to a durable, inspectable sink that composes with the existing replay/fork machinery (a dead-lettered run can be forked and retried).

### Proposed protocol extension
- **Capability:** `capabilities.host.deadLetter` → `{ supported, retentionDays }`.
- **Event:** `run.dead_lettered { runId, nodeId, reason, attempts }`; dead-lettered runs remain fork-eligible (RFC 0009/0011).
- **Conformance:** retry-exhaustion → `dead_lettered`; dead-lettered run is fork-replayable; retention honored.

### How MyndHyve wires it
MyndHyve adds a DLQ sink keyed by workspace and surfaces it in the Active Runs dashboard / workflow studio.

### Compatibility & dependencies
Additive. Composes with retry (RFC 0009) + replay (RFC 0011). Independent.

---

## RFC 0054 — Run diff & execution comparison

### The MyndHyve problem
MyndHyve's workflow studio and debugging flows would benefit from **comparing two runs** (e.g. an original vs a forked replay) — the "execution diffing" gap from the analysis. Fork creates a new run (RFC 0011) but there's no protocol surface to diff two event logs / final states, so any comparison UI MyndHyve builds is host-private and can't be certified.

### What OpenWOP must solve
A read-only comparison surface that, given two run IDs (typically a run and its fork), returns a structured diff of their event sequences and terminal states — deterministic and replay-aware.

### Proposed protocol extension
- **Endpoint:** `GET /v1/runs/{a}/diff/{b}` → structured diff `{ divergedAtSeq, eventDiffs[], stateDiff }`.
- **Determinism:** diff is a pure function of the two event logs (aligns with the determinism-scoring work in `replay.md`).
- **Conformance:** identical runs ⇒ empty diff; fork-after-seq-N ⇒ `divergedAtSeq == N`; terminal-state diff shape.

### How MyndHyve wires it
MyndHyve's workflow studio renders the diff for run-vs-fork comparison; feeds the time-travel debugging UI.

### Compatibility & dependencies
Additive (new read endpoint). **Depends on RFC 0011** (fork). Independent of Tiers 1–2.

---

## Summary table

| # | Title | Tier | Layer it unblocks | Key MyndHyve feature enabled | Depends on |
|---|---|---|---|---|---|
| 0045 | Connector pack manifest & action model | 1 | Protocol → portable packs | 38 `vendor.myndhyve.*` integration packs become portable | 0046, 0047 |
| 0046 | `host.credentials` capability | 1 | Protocol | Workspace BYOK vault, sharing, rotation | — |
| 0047 | OAuth 2.0 flows (`host.oauth`) | 1 | Protocol | Slack / Google / payment connector auth | 0046 |
| 0048 | Tenant · workspace · principal model | 2 | Protocol | `workspaces/{wsId}/` scoping, run ownership | RFC 0011 |
| 0049 | RBAC scopes & authorization decisions | 2 | Protocol | owner/admin/editor/viewer enforcement, CMS RBAC | 0048 |
| 0050 | SAML / SCIM enterprise identity | 2 | Protocol | Enterprise SSO + provisioning | 0048, 0049, RFC 0010 |
| 0051 | Approval & deployment-gate primitive | 2 | Protocol | CMS approval gate + force-publish | 0049 |
| 0052 | Scheduling & time-based triggers | 3 | Protocol | Scheduled routines, recurring campaigns | promotes RFC 0017 |
| 0053 | Dead-letter routing & failure sinks | 3 | Protocol | Production reliability, run inspection | RFC 0009/0011 |
| 0054 | Run diff & execution comparison | 3 | Protocol | Workflow studio run-vs-fork debugging | RFC 0011 |

## Cross-cutting principles (every RFC honors these)

- **Additive only.** Nothing invalidates an existing v1 conformance pass; each is a new optional capability/event/endpoint/schema, advertised via `/.well-known/openwop` and skipped by hosts that don't implement it.
- **Redaction-safe.** No credential, token, or secret material crosses the wire, enters `inputs`/persisted variables, events, debug bundles, or replay state. New SECURITY invariants gate this (sibling to `mcp-toolcall-payload-redaction`, `http-client-ssrf-guard`).
- **Conformance-first.** Each RFC ships scenarios in `@openwop/openwop-conformance` (capability-shape always; behavior assertions gated on advertisement) so MyndHyve's implementation is certifiable, not just claimed.
- **Fail-closed.** Authorization/credential absence denies, never opens (matches MyndHyve's RBAC default).
- **MyndHyve as the reference adopter.** Each RFC flips `Active → Accepted` only once MyndHyve (or another host) lands the implementation and the suite reflects it — which also advances the GOVERNANCE.md second-host federation tripwire.

## Not proposed here (and why)

- **Redis cache, worker pools, queue partitioning, priority queues, horizontal-scaling controls, dashboards/alerts/SLA surfaces** — the spec deliberately leaves these host-internal. MyndHyve implements them as it sees fit; no wire contract is needed or wanted.
- **Marketplace UI, org/workspace admin screens, embedded/white-label builder** — these are **App-layer** (MyndHyve product or the `app.openwop.dev` app), not protocol. RFC 0045/0048/0049 give them the protocol *data* to render; the UI itself needs no RFC.
- **LangGraph / Temporal compatibility bridges** — real protocol gaps, but not on MyndHyve's critical path; defer until an adopter pulls.
