# Threat Model: Interop (A2A and MCP)

> **Scope:** A2A (`spec/v1/a2a-integration.md`, RFC 0152) and MCP (`spec/v1/mcp-integration.md`, RFC 0153) in both directions under the v2 negotiation contract of RFC 0175 §D–§E: negotiation, discovery/runtime drift, identifiers and content crossing the peer boundary, MRTR, the forwarded end user, and the `negotiation.decided` event.
> **Last updated:** 2026-09-03
> **Companion artifacts:** `spec/v1/a2a-integration.md` §B/§C/§E · `spec/v1/mcp-integration.md` §B–§E · `RFCS/0175-*` · `RFCS/0170-*` §A.5 · `SECURITY/threat-model-prompt-injection.md` · `SECURITY/invariants.yaml`.
> **Status of evidence:** The peer-facing legs (RFC 0175 §D.1, §D.2) are `seam-gated` — the wire toward a peer is not observable from the host's own API (RFC 0175 G2). The `negotiation.decided` leg is `witnessable-gated`: the record lands on the host's own event log (RFC 0175 adversarial review 4).

## 1. Why this model

Both Stable composition documents state their threats and cite this file (RFC 0152 G8, RFC 0153 G8); RFC 0175 §F.1 writes it. The threats are not the prompt-injection ones (`threat-model-prompt-injection.md` owns markers, allowlists, and gate advancement). They are **protocol-boundary** threats: a peer authenticated but not authorized, a version negotiated but not the one reported, a card describing a runtime it does not match, an id or an end user crossing the boundary carrying more than it should.

v1 left negotiation fail-closed only for an already-authenticated request, with no floor, refresh window, or audit event (RFC 0175 §Motivation). v2 makes the exchange a protocol (§D). This model records what each control defends against and what witnesses it.

## 2. Trust boundaries

```text
[Peer discovery]                 Agent Card · server/discover · capabilities.a2a / .mcp
        │ T1  advertised versions, interfaces, security schemes
        ▼
[Negotiation exchange]           A2A-Version · MCP-Protocol-Version · minimumVersion / minimumRevision
        │ T2  authenticated; floored; negotiation.decided
        ▼
[OpenWOP authorization boundary] principal → tenant, workspace, scopes, actor
        │ T3  a peer principal never selects tenant or grants scope
        ▼
[Content and identifiers]        parts · artifacts · taskId · requestState · inputResponses
        │ T4  untrusted in; redacted, labelled out; ids tenant-bound
        ▼
[Host event log → subscribers]   negotiation.decided · run events
        │ T5  content-free; peer as digest
```

- **T1 Discovery.** Card / `server/discover` and `capabilities.*` are two views of one fact and MUST NOT disagree (`a2a-integration.md` §C; `mcp-integration.md` §B).
- **T2 Negotiation.** Authenticated, floored, recorded (RFC 0175 §D.1–§D.3).
- **T3 Authorization.** Authentication establishes a peer principal; it does not grant authorization (`a2a-integration.md` §E; `mcp-integration.md` §E).
- **T4 Content.** Inbound parts and arguments are `untrusted`; outbound content obeys SR-1 redaction and RFC 0128 labels (`a2a-integration.md` §E).
- **T5 Audit.** The event log is projected outward (`threat-model-replay.md` §2 T4).

## 3. Adversaries

| ID | Adversary | Capability |
| --- | --- | --- |
| A1 | Unauthenticated downgrader | Negotiates without a credential, offering only a version below `preferredVersion` or the floor. |
| A2 | Drifting peer | Publishes a card or `server/discover` answer listing an interface, version, or security scheme the runtime does not serve; or lets an advertisement age past upstream's lifecycle. |
| A3 | Forwarding prober | Presents a `taskId` / `runId` minted in another tenant, or a `tenant` hint, to learn whether it exists. |
| A4 | Content-returning peer | Answers with artifacts, `_meta`, extensions, or `requestState` asserting approvals, scopes, or foreign references. |
| A5 | Spinning MCP server | Answers every retry with `input_required` to hold a run open indefinitely. |
| A6 | Event-log reader | A subscriber or analytics sink that receives `negotiation.decided`. |
| A7 | Identity-laundering peer | Forwards a never-authenticated end user to be recorded as a subject that links, delegates, or inherits. |
| A8 | Token replayer | Captures a resume `Message` or an MRTR `requestState` and re-sends it. |

## 4. Threats

| Threat | Surface | v2 control | Witness |
| --- | --- | --- | --- |
| **Version downgrade by an unauthenticated peer** (A1) | negotiation exchange, both protocols, both directions | The exchange MUST be authenticated; an unauthenticated negotiation MUST NOT lower the version below `preferredVersion` (RFC 0175 §D.1). A negotiation below `minimumVersion` / `minimumRevision` MUST fail closed with `interop_version_unsupported`, whether or not policy permits explicit downgrade above the floor (§D.2). The wire header MUST equal the negotiated value on every subsequent call (`a2a-integration.md` §B; `mcp-integration.md` §B). | `negotiation-authenticated`, `minimum-version-refused` (seam-gated); `negotiation-decided-emitted` (witnessable-gated); `a2a-version-negotiation`, `mcp-version-negotiation` (seam-gated). |
| **Card / runtime drift** (A2) | Agent Card, `server/discover`, `capabilities.a2a` / `.mcp` | The `supportedInterfaces[].protocolVersion` set MUST equal `protocolVersions`; the card MUST be generated from the source the runtime routes on; a scheme the endpoint does not check is drift (`a2a-integration.md` §C). `server/discover.supportedVersions[]` MUST equal `capabilities.mcp.protocolVersions`; header/body disagreement is refused `-32020` (`mcp-integration.md` §B). Advertised versions MUST be re-evaluated against upstream within `refreshedAt` ≤ 90 days (RFC 0175 §D.4). | `a2a-card-runtime-consistency` (`a2a-card-runtime-consistent`, witnessable-gated); `mcp-2026-07-28-discover` (`mcp-header-body-consistent`); `refresh-sla` (unaided). |
| **Cross-tenant task lookup by a forwarded taskId** (A3) | `GetTask` / `CancelTask` / `SubscribeToTask` / push-config reads; `tenant` hint | Reads on a task the caller cannot read MUST answer `TaskNotFoundError`; `ListTasks` MUST be scoped to the caller; `tenant` is a hint, never a selector, and a disagreeing hint MUST be neutralized or refused without revealing whether the tenant exists (`a2a-integration.md` §E). In v2 `runId` is tenant-bound (`<tenantId>/<opaque>`); a host MUST reject an id whose tenant segment is not the caller's (RFC 0170 §D.1). | `a2a-1-0-task-roundtrip` (`TASK_NOT_FOUND` for unreadable ids, gated); `id-grammar` (unaided: foreign-tenant id refused). |
| **Artifact leakage across the peer boundary** (A4, A6) | outbound `Task.history`, `status.message`, artifacts; MCP list caches; extended card | Outbound content obeys SR-1 redaction and RFC 0128 labels; `agent.*`, provider-usage, and tool-I/O events never cross the A2A boundary (D.5); push credentials never touch the log (D.6) (`a2a-integration.md` §E). The extended card MUST NOT disclose skills the principal cannot use (§C). Caller-dependent MCP results MUST be `cacheScope: "private"` and MUST NOT cross authorization contexts (`mcp-integration.md` §D). | `mcp-cache-tenant-scope` (`mcp-cache-tenant-scoped`, seam-gated; needs a second credential). The A2A half is asserted normatively (D.5); no dedicated scenario. |
| **MRTR round exhaustion** (A5) | `tools/call` / `prompts/get` / `resources/read` answering `input_required` | `mcp.mrtr.maxRounds` (1–16, advertised) is the ceiling; the host MUST refuse a further round beyond it with `mcp_mrtr_rounds_exceeded` (RFC 0175 §E.1). Timeout is owned by the node / RFC 0058 run bounds; a cancel issues no retry (`mcp-integration.md` §C.1). | `mrtr-rounds-ceiling` (gated on `mcp`, witnessable-gated). |
| **Peer identity leakage through `negotiation.decided`** (A6) | the host's event log and everything projected from it | Content-free by rule; the peer is an **origin digest**, never in clear (RFC 0175 §D.3; UQ1 / G4 decided here: digest). The event log is projected to subscribers and sinks (`threat-model-replay.md` §2 T4), so a clear origin would name every counterparty to every reader; a digest correlates one peer across outcomes and nothing more. The RFC 0128 purpose label rides separately (RFC 0175 R3). | `negotiation-decided-emitted` (event shape on the normative surface); RFC 0175 §D.5. |
| **Anonymous end users forwarded by a peer** (A7) | A2A entry with a never-authenticated end user; MCP anonymous mount | Recorded as `kind: anonymous`, `lane: anonymous`, the forwarding peer's subject as `actor`; never linked (RFC 0170 §A.5; RFC 0165 §B.6). `actor` is provenance, never authorization (RFC 0165 §B.5). A current-profile MCP host MUST require authentication in production unless it advertises `anonymousActor` and applies its rules — default-deny grants, no secret reach, egress-guarded, opaque audit (`mcp-integration.md` §E). | RFC 0165 §B.6 leg (gated on `a2a`, fake peer); `mcp-current-auth-boundary` (`mcp-peer-no-authority-escalation`); `auth-subject-link.test.ts` anonymous leg (seam-gated). |
| **Replay of a peer-forwarded interrupt token** (A8) | A2A resume `Message`; MRTR retry with `requestState` | `requestState` MUST be HMAC-signed and MUST bind principal, TTL, request digest, `runId`, and the RFC 0051 interrupt token; a second retry with the same `requestState` MUST fail; the resolver MUST be authorized as an RFC 0051 approver (`mcp-integration.md` §C.2, §E). An interrupt with key `K` resolves at most once per run regardless of replay (`interrupt.md`); a token whose `alg` or `kid` the host does not hold is refused `interrupt_token_invalid` (RFC 0170 §E.1). Peer content MUST NOT advance a gate (`a2a-integration.md` §"Trust boundary"). | `mcp-mrtr-roundtrip` (forged state refused, gated); `interrupt-token-scheme` (unaided); `a2a-peer-authority.test.ts` (`approvalAdvanced: false`, seam-gated). |

## 5. Residual risks

- **The peer-facing wire is unobservable from the host's API.** §D.1 and §D.2 are witnessed only through the C.1 seams profile; a host that does not mount the seam records `blocked` on those legs (RFC 0175 G2). `negotiation.decided` stays observable.
- **The refresh window is unmeasured.** 90 days is the shortest window both upstreams' lifecycle policies exceed; re-measured at the first refresh after the cut (RFC 0175 G1).
- **Streaming and push are not witnessed.** The fake peer does not stream (RFC 0152 G6); no real upstream peer is wired in CI (G3, externally gated).
- **A legacy peer after the cut.** A v2 host MAY keep an unadvertised private A2A 0.3 / MCP 2025-06-18 path (RFC 0175 R1); nothing here witnesses it.
- **Delegation composition is stated, not witnessed.** RFC 0154 §B is shape-only (RFC 0152 G5).
- **Invariant registration.** RFC 0175 §F.1 names `interop-negotiation-authenticated`, `interop-minimum-version-enforced`, `interop-peer-no-authority-escalation` as this model's rows beside the two silent-downgrade rows. They enter `SECURITY/invariants.yaml` with their tests in Phase 3 (RFC 0167 §C rule); at the time of writing they are not present there.

## 6. Verification

v2 scenarios (suite 2.0.0, RFC 0175 §Conformance):

- **`negotiation-authenticated`** — an unauthenticated exchange cannot lower the version. Driven through the C.1 seams profile; **seam-gated**.
- **`minimum-version-refused`** — a peer below the floor is refused with `interop_version_unsupported`; the event says `refused`. **Seam-gated** for the peer-capture leg.
- **`negotiation-decided-emitted`** — the host's own event log carries `negotiation.decided` for a seam-driven exchange. **Witnessable-gated** on `a2a` / `mcp`.
- **`refresh-sla`** — `refreshedAt` within the window. **Unaided.**
- **`mrtr-rounds-ceiling`** — round `maxRounds + 1` refused via the fake server. **Witnessable-gated** on `mcp`.
- **`threat-model-template`** — this file carries the template sections (`scripts/check-threat-model-template.mjs`). Corpus.

Carried from v1: `a2a-version-negotiation`, `mcp-version-negotiation`, `a2a-peer-authority`, `mcp-cache-tenant-scope`, `mcp-extension-opacity`, `mcp-current-auth-boundary` (seam-gated); `a2a-card-runtime-consistency` (witnessable-gated); `a2a-1-0-task-roundtrip`, `mcp-mrtr-roundtrip` (gated). `OPENWOP_REQUIRE_BEHAVIOR=true` makes gated skips hard failures.

## 7. References

- RFC 0175 §D.1–§D.5, §E.1, §F.1, §Conformance, adversarial review 4, G1–G4, R1, R3; RFC 0152 §B, §C, §E, G5–G9; RFC 0153 §B–§E, G7–G9; RFC 0170 §A.5, §D.1, §E.1; RFC 0165 §B.5–§B.6; RFC 0154 §B; RFC 0132; RFC 0128; RFC 0051; RFC 0058.
- `spec/v1/a2a-integration.md` §"Trust boundary", §B, §C, §E, §Conformance; `spec/v1/mcp-integration.md` §"Trust boundary", §B–§E, §Conformance; `spec/v1/interrupt.md`; `spec/v1/host-sample-test-seams.md` §22–§23; `spec/v2/errors.json` (`interop_version_unsupported`, `mcp_mrtr_rounds_exceeded`).
- `SECURITY/invariants.yaml` (`a2a-version-no-silent-downgrade`, `mcp-version-no-silent-downgrade`, `a2a-card-runtime-consistent`, `a2a-peer-no-authority-escalation`, `mcp-peer-no-authority-escalation`, `mcp-cache-tenant-scoped`, `mcp-extension-no-authority`, `mcp-header-body-consistent`); `SECURITY/threat-model-prompt-injection.md`; `SECURITY/threat-model-secret-leakage.md`; `SECURITY/threat-model-replay.md` §2.
