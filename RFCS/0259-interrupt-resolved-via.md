# RFC 0259: `interrupt.resolved` records the instrument of a token resolution

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0259                                                            |
| **Title**         | `interrupt.resolved` records the instrument of a token resolution (`resolvedVia`) beside who authenticated (`resolvedBy`) |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-04                                                      |
| **Updated**       | 2026-11-08 — **`Draft → Active`, comment window waived by the maintainer** (user instruction to openwop-be, 2026-11-08: "skip the comment window and proceed with implementation by collaborating with an openwop-app session"). STEWARD OVERRIDE of RFC 0147 §A.6 (identity and authorization), recorded in `MAINTAINERS.md`. Lands the `interruptResolved.resolvedVia` schema and the `resolvedBy` description, the `interrupt.resolvedVia` facet, the `readInterruptToken` seam, the threat-model row and `v2-interrupt-resolved-via` (7 ids) in suite 2.46.44, from the drafted `rfc/0259-resolved-via-impl`. UQ 1–6 decided below; §A.1 is classified a restatement (additive). openwop-app implements it (its ADR 1059, #5585) behind a default-off flag. Earlier 2026-11-04 — filed as `Draft`. This RFC touches identity and authorization, so `Draft → Active` runs the full comment window: RFC 0147 §A.6 forbids a bootstrap waiver here, and only the maintainer may override it, directly. The wire shape may still move during the window. An independent architect review (§Alternatives 1) replaced the filed-for shape — a new Subject `kind` — before any text was written. |
| **Affects**       | `schemas/v2/run-event-payloads.schema.json` `$defs/interruptResolved` (`resolvedBy` description = §A.1's normative home; new optional `resolvedVia` = §A.2–§A.5's) · `spec/v2/facets/interrupt.schema.json` + `spec/v2/declaration.json` (new optional `resolvedVia` facet; `schemas/v2/capabilities.schema.json` regenerated) · `SECURITY/threat-model-secret-leakage.md` (one row) · `api/seams-v2.yaml` + `scripts/derive-v2-api.py` (new seam `readInterruptToken`) · conformance: new scenario `v2-interrupt-resolved-via.test.ts` · CHANGELOG. `subject.schema.json` is NOT changed. v1 is frozen and not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 / §2.4 (an optional property on a closed v2 object; an optional facet boolean; a new seam). §A.1 states, for one resolve surface, what identity.md §2.1 already requires of every lane. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A resolution through `resolveInterruptByToken` proves possession of a resume token, not identity. v2's `interrupt.resolved` has one identity seat, `resolvedBy`, a closed Subject that no token presentation fits honestly, so a host records nothing and a consumer cannot tell "resolved by an approval link" from "resolver unknown". This RFC adds `resolvedVia` — the instrument (`scheme: "interrupt-token"`), an optional opaque `tokenRef`, and an optional host-attested `boundTo` Subject — as a separate axis from `resolvedBy`, and states that `resolvedBy` never names a Subject the request did not authenticate. A facet boolean, `interrupt.resolvedVia`, gates the positive recording obligation; a new test seam lets the suite read a resume token so the rules can be witnessed.

## Motivation

### The gap

- `$defs/interruptResolved.resolvedBy` is `$ref subject.schema.json` (`run-event-payloads.schema.json`). The Subject is closed: `kind ∈ {user, agent, anonymous, workload}`, a `lane` from ten authentication lanes, `issuer`/`subjectId`/`tenant` REQUIRED (`spec/v2/core/identity.md` §1.1).
- A token presentation is none of those. The token is minted by the host at suspension (`identity.md` §4; `interrupt.md` §Tokens) and is the authorization (`interrupt.md` §Resolve surfaces: "Auth: the token"). Recording any Subject in `resolvedBy` for it would assert an identity nobody authenticated; recording `anonymous` would be false too (an approval link is usually addressed to a known person).
- So a conformant host records **no** `resolvedBy` on a token resolution. A consumer reading the log sees the same absence for "an emailed approval link was used" as for "a host that does not record resolvers".

### Who hits it

- **openwop-app** resolves through a bare token on three surfaces (`POST /v1/interrupts/{token}`, the decide-by-email confirm form, an internal helper) and records no `resolvedBy` there by design (its ADR 0932 D2, ADR 1040 D6). The emailed links already carry a host MAC over `(token, voter)` (its ADR 0478 / 0899), so the host *knows* whom it addressed the link to and has nowhere to say so.
- **Book AI**, an openwop-app tenant product, applies an AI-drafted change only when the approval of record maps to the book's owner or a co-author. It reads the gate's latest `interrupt.resolved` and requires `resolvedBy.kind === "user"`, no `actor`, a person lane, the run tenant, and a `subjectId` it matches forward. A share-link approval carries no `resolvedBy`, so it falls back to a receipt Book AI writes only on its own route, and an approval made through the host's link **fails to apply**. Book AI's stated requirement (2026-11-04): accept a link approval only under a **host-attested** binding to a full user Subject; the minter does not count ("sharing isn't approving"); an unbound link is refused; keep the token off the record.

### Why the spec

The record is the wire event. Two hosts that each invent a vendor key under the RFC 0185 hatch (`openwop-…`) give a consumer two shapes, and a hatch member "MUST NOT be interpreted" (RFC 0185 §C), so no consumer may build on it. The distinction between *authenticated by* and *presented* is an identity rule (`identity.md` §2.1: bind to the verified identity, "never to an asserted header"), and it belongs where that rule lives.

## Proposal

### §A. Normative rules

Homes (the v2 core is at its word budget, `scripts/check-core-budget.mjs`, so the rules live in schema descriptions, as RFC 0257's do): §A.1 in `$defs/interruptResolved.resolvedBy.description`; §A.2–§A.5 in `$defs/interruptResolved.resolvedVia` and its members; the facet rule in `spec/v2/facets/interrupt.schema.json` `resolvedVia`.

**§A.1 — `resolvedBy` names only an authenticated Subject. (Unconditional.)** `resolvedBy` names only a Subject the resolving request authenticated on a lane (`identity.md` §2.1). A host **MUST NOT** record in `resolvedBy` a Subject that the request merely presented a resume token for, named in its body (for example a `voter`), or was addressed by. When nothing authenticated, `resolvedBy` is absent. An authenticated caller that also presents a token (for example an API key on the run-scoped surface) is still recorded: it authenticated.

**§A.2 — `resolvedVia` records the instrument.** `resolvedVia` is OPTIONAL and closed, with `scheme` REQUIRED.

- A host advertising `interrupt.resolvedVia: true` **MUST** record `resolvedVia` with `scheme: "interrupt-token"` on every resolution through `resolveInterruptByToken` or any host surface that presents that interrupt's resume token.
- A host **MUST NOT** record `resolvedVia` on a resolution that presented no resume token (a run-scoped resolution with no token, a timer, a host-internal resume).
- `scheme` is a closed vocabulary that grows under `overview.md` §0; a consumer **MUST NOT** act on a member it does not recognize. `interrupt-token` is the only member at this RFC.

**§A.3 — `tokenRef` is a reference, never token material.** OPTIONAL. For a host that issues distinct tokens per recipient, so that two presentations can be told apart. It **MUST NOT** equal or contain the token or any of its segments, and **MUST NOT** be computable from the token without a host-held secret — a bare digest of the token, truncated or not, is forbidden, because the event log would otherwise be an oracle confirming a leaked token. It **SHOULD** be minted independently and stored with the token. Grammar `^[A-Za-z0-9._~-]{16,128}$`. A host that issues one token per interrupt gains nothing from it and SHOULD omit it.

**§A.4 — `boundTo` is host-attested attribution.** OPTIONAL. A Subject of `kind` `user` or `agent`, never with the legacy issuer.

- **What the host attests.** A host **MUST** set `boundTo` only when both hold: (a) the host itself issued this link to that Subject — for example the approval email it sent to that person — and never for a link a member generated, copied or pasted; and (b) on this request it verified its own MAC, under a key it holds, over the token and that Subject. It **MUST NOT** set `boundTo` from a name it did not bind (a body `voter` with no host binding is not one).
- **Lifetime and use.** A host that sets `boundTo` **MUST** honour the token's `expiresAt` and its invalidation on resolution (`interrupt.md` §Tokens), and **MUST** count at most one vote per `boundTo` for one interrupt, so a bound link decides or votes once.
- **Window.** `mintedAt` (when the token was issued) and `expiresAt` (its `expiresAt`) are OPTIONAL date-times on `resolvedVia`; a host **SHOULD** record both with `boundTo`, so a consumer can refuse a link older than its own window.
- `boundTo` **MUST** be built with the mapping the host uses for `owner.subject` for that person, with `tenant` equal to the run tenant, so a consumer can compare it with the Subjects it already knows.
- `boundTo` is attribution, not authentication: a bound link can be forwarded. A consumer that treats a bound link as that person's decision makes a policy choice the record states plainly.
- `boundTo.actor` keeps RFC 0170 §A.2's meaning: present only when a host delegation record attests that the bound Subject acted for another.
- **Eligibility.** When the interrupt declares eligibility (`interrupt.md` §Approver enforcement: `approversList`, or group/role refs the host enforces), a host advertising `interrupt.resolvedVia` **MUST** carry `boundTo` on a successful token resolution, or **MUST** refuse that resolution. §Approver enforcement already obliges the host to refuse a resolver not in the list, so it has to have identified one; this rule makes it say whom.

**§A.5 — History.** `resolvedVia` is part of the recorded resolution: replay and `forkRun` **MUST** copy it verbatim with the rest of the payload and **MUST NOT** recompute it (`replay.md`; eligibility is never re-resolved, `interrupt.md` §Approver enforcement). Rotating a host secret never rewrites a recorded `tokenRef` or `boundTo`.

### §B. The facet

`spec/v2/facets/interrupt.schema.json` (listed in `spec/v2/declaration.json` `interrupt.facets[]`; `capabilities.schema.json` is regenerated, never hand-edited) gains `resolvedVia: boolean` — "true only if the host records `interrupt.resolved.resolvedVia` on every token resolution and carries `boundTo` or refuses a token resolution of an interrupt that declares eligibility". Absent ⇒ false. §A.1 does not depend on it.

### §C. The seam

**§C.1** `api/seams-v2.yaml` gains `POST /conformance/seams/sample/interrupts/token` (`readInterruptToken`), derived from `scripts/derive-v2-api.py`: body `{ runId, nodeId, bind? }`; `200 { token, resumeValueMembers? }`; `404` when unwired or no open interrupt matches. It returns the token the production path minted for a run the caller created. With `bind: true` it also returns the members the host's own production binding path would put in a presentation addressed to the caller (for openwop-app, a signed `voter`), which the suite merges into the `resumeValue` unchanged. It mints nothing production does not and resolves nothing. It exists because v2 gives an outside party no way to read a resume token (`interrupt.md` §Resolve surfaces; the signed-token surface is a SHOULD and the suite cannot mint a token — `v2-interrupt-resolve-terminal.test.ts`).

### Wire shape changes

```diff
 "interruptResolved": { "properties": {
   "resolvedBy": {
     "$ref": "subject.schema.json",
-    "description": "v1 interrupt.md MUST … carried into v2 as the resolving Subject."
+    "description": "… RFC 0259 §A.1: it names only a Subject the resolving request authenticated on a lane …"
   },
+  "resolvedVia": {
+    "type": "object", "additionalProperties": false, "required": ["scheme"],
+    "properties": {
+      "scheme":   { "type": "string", "enum": ["interrupt-token"] },
+      "tokenRef": { "type": "string", "pattern": "^[A-Za-z0-9._~-]{16,128}$" },
+      "boundTo":  { "allOf": [ { "$ref": "subject.schema.json" },
+                    { "properties": { "kind": { "enum": ["user", "agent"] },
+                                      "issuer": { "not": { "const": "urn:openwop:legacy" } } } } ] },
+      "mintedAt":  { "type": "string", "format": "date-time" },
+      "expiresAt": { "type": "string", "format": "date-time" }
+    }
+  },
```

```diff
 spec/v2/facets/interrupt.schema.json "properties": {
+  "resolvedVia": { "type": "boolean" },
```

### Examples

Positive — an emailed approval link the host addressed to Ana, resolved without a session (synthetic values):

```json
{ "nodeId": "gate", "interruptId": "acme/0123456789abcdef", "kind": "approval",
  "decision": "granted", "action": "accept",
  "resolvedVia": { "scheme": "interrupt-token",
    "boundTo": { "issuer": "urn:example:session", "subjectId": "u_7f3a9c1e", "tenant": "acme", "lane": "session", "kind": "user" },
    "mintedAt": "2026-11-04T09:00:00Z", "expiresAt": "2026-11-04T09:30:00Z" } }
```

Positive — an open link nobody was bound to: `"resolvedVia": { "scheme": "interrupt-token" }`, no `resolvedBy`.

Positive — an API-key caller on the run-scoped surface: `resolvedBy` is its workload Subject; no `resolvedVia` (no token presented).

Negative — each fails validation: `"resolvedVia": {}` (no scheme); `{ "scheme": "share-link" }`; `{ "scheme": "interrupt-token", "token": "…" }` (closed); a `tokenRef` of `"ow2.hs256.k.p.m"` (grammar); a `boundTo` of kind `anonymous` or `workload`, or with issuer `urn:openwop:legacy`.

Negative — valid JSON, forbidden by §A.1: `"resolvedBy": { …kind:"user"… }` on an unauthenticated `POST /interrupts/{token}` whose body named `voter: "ana"`.

### Security considerations

- **No token on the record.** §A.3 forbids the token, its segments and any bare digest; the suite checks all three (§Conformance leg 4). `tokenRef` is optional, so the default is to carry nothing derived from the token at all.
- **Attribution is not authentication — the residual risk, stated.** A bound link is a bearer credential addressed to one person. Anyone that person forwards it to, and anyone who reads their mailbox, can use it, and the record will still name the addressee. §A.4 narrows the window (host-issued links only, expiry and single vote honoured, `mintedAt`/`expiresAt` on the record so a consumer can apply a shorter window of its own) but cannot close it: closing it needs the person to authenticate, which is the run-scoped surface. A consumer that treats `boundTo` as that person's decision — Book AI does, by an explicit policy decision — accepts this residual risk, and the normative text says so rather than implying a login.
- **No identity laundering.** §A.1 closes the obvious misuse — copying a body `voter` into `resolvedBy` — on every host, advertised or not.
- **Threat model.** `SECURITY/threat-model-secret-leakage.md` §4.1 gains a row: a resume token, a segment or a digest of it on `interrupt.resolved` would let the log confirm a leaked token; §A.3 and leg 4 are the mitigation.
- **Privacy.** `boundTo` is a person's Subject, as `resolvedBy` already is; it adds no new PII class. Subject erasure works by unlinking at the identity record, never by rewriting the event log (`replay.md`: history is fixed). The `subjectId` grammar already forbids PII (`ids.schema.json#/$defs/subjectId`).
- **Cross-tenant.** `boundTo.tenant` MUST equal the run tenant; a `tokenRef` minted per token is not linkable across tenants.
- No new invariant row: §A.1 and §A.3 are witnessed by the scenario; registering them in `SECURITY/invariants.yaml` waits on a host witness (RFC 0167 §C rule: not before the tests run green somewhere).

### Open spec gaps (what this RFC does not cover)

| # | Gap | Why not here |
| --- | --- | --- |
| 1 | Instruments other than an interrupt token — an MCP `requestState` resume, an inbound-webhook resume | Each needs its own `scheme` member and its own binding story; §A.2 grows under §0 when one is specified. |
| 2 | Who minted or shared a link (`mintedBy`) | A host-minted resume token carries the gate's eligibility policy, not a person's authority; naming the run owner would attribute authority falsely, and the one consumer says the minter does not count. Additive later for a host that mints per-person delegated links. |
| 3 | A per-recipient token scheme | `tokenRef` is the seat; issuing distinct tokens is a host choice this RFC does not require. |
| 4 | A v1 projection | v1 is frozen and end-of-support (RFC 0234). A host still serving major 1 carries the member on the open v1 def as an extra key or omits it. |

## Compatibility

`additive` (`COMPATIBILITY.md` §2.1, §2.4):

- `resolvedVia` is a new OPTIONAL property on the closed `interruptResolved`; no field is added to `required`, none is retyped, none removed. Existing producers do not emit it; existing consumers ignore it or, on the closed def, now accept it. `check-v2-surface-monotone.mjs` passes: additions only.
- `interrupt.resolvedVia` is a new OPTIONAL facet boolean; absent ⇒ false. No host's current advertisement changes meaning.
- The seam is new, test-only, and gated on the seams profile.
- §A.1 tightens nothing a conformant host does: `identity.md` §2.1 already forbids binding to an asserted identity, and no `interruptResolved.resolvedBy` emitted from an unauthenticated token presentation can be an authenticated Subject. A host that copies a body `voter` into `resolvedBy` today violates §2.1 already; §A.1 makes the case explicit and witnessable.
- `subject.schema.json` is untouched, so `owner.subject`, `run.started.owner`, the `actor` chain and `SubjectLink` are unaffected. This is the point of choosing a sibling property (§Alternatives 1).
- **A consumer that switches on `resolvedBy`** is unaffected by an unbound token resolution: `resolvedBy` stays absent, as today. Book AI's receipt fallback keeps working; it learns `resolvedVia.boundTo` when it chooses.

## Conformance

### Existing coverage

- `owner-subject-shape.test.ts` — the Subject; unchanged.
- `v2-approval-reject-disposition.test.ts` leg 9 — a fork copies the recorded resolution (`decision`/`action`/`reason`/`resolvedBy`); the rule §A.5 restates.
- `v2-interrupt-token-scheme.test.ts`, `interrupt-token-matrix.test.ts` — the token grammar and lifecycle; unchanged.

### New scenario (planned): `v2-interrupt-resolved-via.test.ts`

| Leg | Requirement id | Gate |
| --- | --- | --- |
| 1 | `openwop.requirement.0259.shape` | none — server-free |
| 2 | `openwop.requirement.0259.token-resolve-names-no-subject` | fixture `conformance-approval` + seams profile + `readInterruptToken` |
| 3 | `openwop.requirement.0259.resolved-via-recorded` | as 2 + `interrupt.resolvedVia: true` |
| 4 | `openwop.requirement.0259.token-ref-opaque` | as 3 + a `tokenRef` present |
| 5 | `openwop.requirement.0259.run-resolve-no-via` | as 3 |
| 6 | `openwop.requirement.0259.bound-to-caller` | as 3 + the seam returning `resumeValueMembers` for `bind: true` |
| 7 | `openwop.requirement.0259.forged-binding-binds-no-one` | as 6 |

Leg 4 refuses a `tokenRef` that contains the token or any ≥ 8-character segment of it, or that shares an 8-character run with the sha256 of the token or a segment in hex, base64 or base64url — this catches the truncated-digest convention, which a bare "not equal to sha256" check would pass. Leg 7 is the negative: a token bound to the caller (Subject A), presented with that binding altered so it claims someone else (B) — every member the seam returned is changed by one character. The host **MUST NOT** record `boundTo` (it may refuse the resolution); attributing the decision to A or to B fails. Leg 6 compares `boundTo` with the `run.started.owner.subject` of the run the caller created: a host whose caller is a workload Subject cannot bind (`boundTo` admits `user`/`agent`), returns no members, and records `inapplicable`.

No new fixture: every leg runs on `conformance-approval`.

### Capability gating

Legs 3–6 gate on the facet; leg 2 does not, because §A.1 is unconditional. All host legs gate on the seams profile, because only the seam yields a token: profile not advertised ⇒ `inapplicable`; advertised with the seam unwired ⇒ `blocked` (`seamAbsent`).

### Reference-host coverage and INTEROP-MATRIX

openwop-app implements §A–§B behind a host flag that defaults off (its ADR 1059) and does not advertise `interrupt.resolvedVia` until this RFC's shape is locked (`Active`) and vendored. The v2 reference host (`openwop-examples`) does not yet implement the seam: reference-host implementation is deferred and is the `Accepted` gate. No INTEROP-MATRIX column: the facet is a family member, not a profile.

### Suite vs spec

Leg 4's 8-character-run heuristic is a suite judgement of "computable from the token without a host-held secret", not a spec requirement on its own: it is the probe, and its false-positive rate is stated in the scenario.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A schema shape | validation of `interruptResolved` with and without `resolvedVia` — `v2-interrupt-resolved-via.test.ts` (planned) | the suite, unaided | witnessable — unaided |
| §A.1 no unauthenticated `resolvedBy` | an unauthenticated token resolve logs no `resolvedBy` — `v2-interrupt-resolved-via.test.ts` (planned) | the suite, given a token from `readInterruptToken` | seam-gated (`readInterruptToken`) |
| §A.2 recorded on a token resolution | `resolvedVia.scheme` on that event — `v2-interrupt-resolved-via.test.ts` (planned) | the suite via the seam, on a host advertising the facet | seam-gated (`readInterruptToken`) |
| §A.2 absent on a run-scoped resolution | no `resolvedVia` on that event — `v2-interrupt-resolved-via.test.ts` (planned) | the suite, on a host advertising the facet | witnessable — gated (facet; the scenario also requires the seams profile) |
| §A.3 `tokenRef` opaque | `tokenRef` vs the token the suite holds — `v2-interrupt-resolved-via.test.ts` (planned) | the suite via the seam | seam-gated (`readInterruptToken`) |
| §A.4 `boundTo` from the host's own binding, owner mapping | `boundTo` equals the caller's `owner.subject` — `v2-interrupt-resolved-via.test.ts` (planned) | the suite via the seam with `bind: true` | seam-gated (`readInterruptToken`) |
| §A.4 no `boundTo` from a binding the host did not make | an altered binding records no `boundTo` — `v2-interrupt-resolved-via.test.ts` (planned) | the suite via the seam with `bind: true` | seam-gated (`readInterruptToken`; host-judged — the suite cannot verify the MAC, only that an altered binding binds no one) |
| §A.4 host-issued links only; expiry and one vote per `boundTo` | — | needs the suite to hold a member-generated link and a second bound vote on a quorum gate the suite can be named in | claims-check — the host states its link issuance; expiry and invalidation are already witnessed by `interrupt-token-matrix` and `v2-interrupt-resolve-terminal` |
| §A.4 eligibility ⇒ `boundTo` or refuse | a token resolve of an ACL'd interrupt either carries `boundTo` or is refused | needs a fixture whose `approversList` names the suite's own Subject in the host's ref grammar, which the suite cannot spell | unwitnessable — the suite cannot place itself in a host's approver list; Unresolved question 2 |
| §A.5 fork copies verbatim | a replay fork's `interrupt.resolved` carries the source's `resolvedVia` | the suite, on a host advertising `replay` mode `replay` and the facet | witnessable — gated (no dedicated leg yet; planned beside `v2-approval-reject-disposition` leg 9) |

## Alternatives considered

1. **A new Subject `kind: "capability"` (and `lane: "capability"`) inside `resolvedBy`.** The shape this RFC was filed to propose. Rejected by an independent architect review before drafting: (a) `subject.schema.json` is the shared `$ref` of `RunSnapshot.owner`, `run.started.owner` and four unrolled `actor` levels, so every site would need a `not kind: capability` exclusion, unsafe by default for the next site; (b) `capability` is not an authentication lane — `identity.md` §2.1–§2.2 make a lane a binding pipeline advertised in `auth.lanes[]` with issuers, revocation and assurance, and `check-lane-revocation-rules.mjs` would need a row with nothing true to say; (c) any value in `resolvedBy` for a token resolution removes the one consumer's documented fallback (Book AI refuses a present `resolvedBy` whose kind is not `user`), turning today's working receipt path into a refusal; (d) a nested `interruptId` duplicates the event's and diverges on fork, where a host re-mints the id.
2. **A separate `capability-subject.schema.json` with `resolvedBy: anyOf [Subject, CapabilitySubject]`.** Avoids (a) and (b) but keeps (c), and makes `resolvedBy` mean two different things.
3. **`boundTo` as the Subject and the holder as `actor`.** Rejected: RFC 0170 §A.2 makes `actor` "who acts on this subject's behalf" under a delegation the host attests; a link holder is not attested to be anyone, and Book AI refuses any `actor`.
4. **A required token-derived `subjectId` (per-tenant HMAC of the token).** Rejected as the default: with one token per interrupt it identifies nothing the `interruptId` does not, and it adds a key-management obligation. Kept as the optional `tokenRef` for per-recipient tokens.
5. **Host vendor keys under the RFC 0185 hatch.** Rejected: a hatch member MUST NOT be interpreted (RFC 0185 §C), so no consumer could rely on it.
6. **Do nothing.** A token resolution stays indistinguishable from an unrecorded one, and Book AI cannot accept approvals made through the host's own links.

## Decided questions

Decided 2026-11-08 at `Draft → Active`:

1. **`scheme` members for MCP `requestState` and inbound-webhook resumes.** Deferred (Open gap 1): neither presents an interrupt token.
2. **Witnessing §A.4's eligibility rule.** Deferred to a seam revision once a host implements the binding.
3. **`SECURITY/invariants.yaml` rows for §A.1 and §A.3.** Not yet: they are registered once a host witnesses them (RFC 0167 §C).
4. **`boundTo.lane` with no attestable login lane.** The owner mapping, as written. A host with none omits `boundTo` and, under §A.4's eligibility rule, refuses. Revisit if a host finds that too strict.
5. **§A.1: restatement or new obligation.** A restatement of `identity.md` §2.1 ("bind the verified identity to the request, never to an asserted header") for the token surface, so the RFC stays `additive`. The one host with a signed-voter path already records no `resolvedBy` on a token resolution (openwop-app ADR 0899, ADR 0932 D2).
6. **§A.4(b), the host's MAC check.** Host-judged, as the falsifiability row says. Leg 7 witnesses only that an altered binding binds no one.

## Implementation notes (non-normative)

- openwop-app: the token surfaces call `resolveAndResume(…, { capabilityToken: true })`. The host work is to record `resolvedVia { scheme: "interrupt-token" }` there, derive `boundTo` from a verified `(token, voter)` MAC (`verifyVoterBinding`) through the same Subject mapping as the run-owner stamp, omit `tokenRef` (one token per interrupt), and refuse an unbound token resolution of an ACL'd interrupt when advertising. Behind a host flag defaulting off until this RFC's shape is on `main`.
- Book AI: read `resolvedVia.boundTo` when `resolvedBy` is absent, with the same checks it applies to `resolvedBy` today.
- Reference host: the seam is a thin read of the stored token; the recording is one property on the resolve path.

## Acceptance criteria

- [x] Comment window run (`Draft → Active`; RFC 0147 §A.6). *(Waived by the maintainer, 2026-11-08.)*
- [x] Schema updated: `interruptResolved.resolvedVia`; `resolvedBy` description; facet boolean via `declaration.json`; the threat-model row. *(2026-11-08, 2.46.44.)*
- [x] Seam added to `api/seams-v2.yaml` through `scripts/derive-v2-api.py`. *(2026-11-08.)*
- [x] Conformance scenario `v2-interrupt-resolved-via.test.ts` (one server-free leg, six host legs). *(2026-11-08, 2.46.44.)*

- [x] CHANGELOG entry. *(2.46.44 release section.)*
- [ ] A host implements §A–§C and its bundle records legs 2, 3 and 5 `executed-pass` (leg 6 where the caller is a person).
- [ ] Register sweep (`RFCS/registers/0259-*.gaps.md`, `.risks.md`).

## References

- `spec/v2/core/identity.md` §1.1, §2.1, §4; `spec/v2/core/interrupt.md` §Resolve surfaces, §Tokens, §Approver enforcement; `spec/v2/core/overview.md` §0; `spec/v2/core/replay.md`.
- RFC 0170 (v2 identity), RFC 0183 (`interruptResolved` action fidelity), RFC 0185 (extension hatch), RFC 0167 §C, RFC 0234 (v1 end of support), RFC 0257 (normative home in a schema description).
- openwop-app ADR 0478, 0899 (voter binding), 0932 (resume schema and `resolvedBy`), 1040 D6 (`RESBY-CAP-1`).
- Prior art: OAuth 2.0 bearer tokens (RFC 6750) — possession is authorization, not identity; Google Docs / Notion share links — "anyone with the link" is recorded as anonymous, a named invitee as that person.

## Status history

- 2026-11-04 — Draft.
- 2026-11-08 — Active (comment window waived); schema, facet, seam, threat-model row and scenario land in 2.46.44.
