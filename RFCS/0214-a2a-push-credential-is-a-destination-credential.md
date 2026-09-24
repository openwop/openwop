# RFC 0214: an A2A push credential is a destination credential, and a push is an egress like any webhook

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0214                                                            |
| **Title**         | an A2A push credential is a destination credential, and a push is an egress like any webhook |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-23                                                      |
| **Updated**       | 2026-09-23 — filed and moved `Draft → Active` the same day; **comment window waived** by the steward on 2026-09-23 — an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the window for an RFC of this risk class. This RFC is in that class on three axes: it decides which credential may leave the host and to where (**authorization / secret egress**), which outbound POSTs a host makes (**external effects**), and whether a replay fork may make them (**replay**). Recorded in `MAINTAINERS.md` as an override, not a routine waiver; it carries its own ledger row. **Acceptance is provisional and the RFC 0156 §B retrospective review is owed** (register row `not-reviewed`). **Scope is the correction only** (program decision D2): the push implementation, a `pushConfigs[]` schema and a delivery scenario are deferred until an A2A client asks for push. Evidence gate not waived — see §Acceptance: every host-behavior row is gated on `a2a.pushNotifications`, which **no committed host advertises**, so `Accepted` is blocked on the first host that does. |
| **Affects**       | `spec/v2/core/security-defaults.md` §"Onward hops" (one carve-out sentence) · `spec/v2/core/interop.md` (new §"A2A push delivery") · `spec/v2/core/replay.md` §Suppression **Fan-out** (one sentence) · `spec/v2/core/webhooks.md` §Egress (one cross-reference) · `spec/v2/interop-map.json` rows `:104-123` (rule text only; `v2Operation` stays `null`) · `schemas/v2/a2a-task-state.schema.json` (two descriptions — no shape moves) · `SECURITY/invariants.yaml` (+2, one extended) · RFC 0100 §4 (editorial) · conformance: one leg in `v2-a2a-operation-map.test.ts` + corpus-coherence `conformance/src/coherence/v2-push-credential-coherent.test.ts` |
| **Compatibility** | **Class 3 correction** (the carve-out; COMPATIBILITY §3) plus `additive` requirements gated on `a2a.pushNotifications` (COMPATIBILITY §4) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`security-defaults.md` §"Onward hops" forbids attaching **"credential material carried in a body"** to any outbound request, A2A included, and allows only "credentials the host holds for that destination". An A2A `CreateTaskPushNotificationConfig` arrives with exactly such material — `authentication.credentials` and `token` in its body — and A2A v1.0.1 §4.3.3 says the agent **MUST** send it back on every push. Read literally, the two rules make A2A push unsatisfiable: a host that advertises `a2a.pushNotifications` violates one or the other. This RFC resolves the contradiction by naming what that credential is — a credential the client gave the host **for one destination and one purpose** — and binding it there.

It also closes three gaps the contradiction was hiding: the delivery-time egress checks (`webhooks.md` §Egress) were never said to apply to push, so DNS rebinding and a redirect could carry that credential to an internal address; a replay fork was never said not to push; and a foreign push-config id was never said to be indistinguishable from an unknown one. Everything here binds only a host advertising `a2a.pushNotifications`. None does today.

## Motivation

Verified read-only on 2026-09-23 against corpus `d593ad55` and `openwop-app` `main`.

### 1. The corpus forbids what A2A requires

- `spec/v2/core/security-defaults.md` §"Onward hops": *"A host MUST NOT attach a credential it received inbound (…, or credential material carried in a body) to any outbound request: A2A, MCP, webhook, callback, `httpClient` or connector. Outbound authentication uses only credentials the host holds for that destination."* Invariant `inbound-credential-no-passthrough` (reference-impl, critical) restates it.
- A2A v1.0.1 §4.3.3: *"The agent MUST include authentication credentials in the request headers as specified in the … `authentication` field"* — `Authorization: {scheme} {credentials}`. `TaskPushNotificationConfig.authentication` and `.token` arrive in the Create request body.
- The interop map already requires the host to hold them: rows `:104-123` say `token` and `authentication.credentials` are "secrets held by reference" and never returned. The corpus requires a host to store the credential and forbids it to use it.

### 2. Registration is checked; delivery is not

`a2a-push-egress-ssrf` (protocol, critical) and v1 `a2a-integration.md` D.6 check the push `url` at **registration** — scheme and address arms (the 2026-08-25 Class 3 correction). `webhooks.md` §Egress's delivery-time rules (re-resolve, validate every address, connect without re-resolving, refuse redirects) are stated for webhooks only. A push URL that resolves public at registration and private at delivery, or that answers `307` to a metadata endpoint, passes every stated rule — and carries a client credential with it. The reference host's dormant push sink follows redirects (`openwop-app` `routes/registerAllRoutes.ts:328-341`).

### 3. Replay and isolation are silent for push

`replay.md` §Suppression **Fan-out** and `webhooks.md` §Replay forbid delivering re-emitted fixed history to "webhook delivery, outbound streams"; A2A push is not named, and nothing says whether a fork inherits a push config. v1 `a2a-integration.md:497` makes push-config reads on an unreadable task `TaskNotFoundError`, but nothing covers a foreign `configId` on a readable task, nor says config ids must not encode tenant.

### 4. A stale citation

RFC 0100 §4 (`:82`, `:104`) says push "HMAC/signing follows A2A §4.3.3". A2A 1.0.1 §4.3.3 defines no HMAC; v1 `a2a-integration.md` §"What openwop does NOT specify" already says openwop adds no push signing.

## Proposal

### §A A push credential is a destination credential (the correction)

`security-defaults.md` §"Onward hops" gains: an A2A push-config credential (`authentication.credentials`, `token`) is a credential the client gave the host **for its registered push URL**; the host MAY attach it only to a push delivery to that URL's origin, MUST NOT attach it after a redirect or to any other request, and MUST discard it when the config is deleted or the task reaches a terminal state and its final push is attempted. It MUST remain held by reference and MUST NOT enter the event log, persisted run state, a debug bundle or any response (interop map `:104-123`, unchanged). This is the one exception to "credentials the host holds for that destination", and it is narrower than it: the destination is fixed by the client at registration.

### §B A push is an egress under the webhook rules

A push delivery is subject to `webhooks.md` §Egress **at delivery time** — re-resolve, validate every resolved address, connect to the validated address without re-resolving, refuse to follow redirects — as well as at registration. A `3xx` is a failed delivery.

### §C Delivery semantics

A host MUST attempt each push at least once. A host that retries MUST follow `webhooks.md` `retryPolicy` semantics (bounded attempts, backoff). Push dead-letters are not visible to A2A clients (`GET /webhooks/{id}/dead-letters` is keyed by a subscription id a push config is not); a client recovers state with `GetTask`. The body is an A2A 1.0 `StreamResponse` with `Content-Type: application/a2a+json`. A host MUST NOT add an OpenWOP signature to an A2A push: an A2A client has no way to learn the secret. When `authentication` is absent and `token` is present, the host SHOULD send `token` as `Authorization: Bearer <token>`; otherwise `token` is not sent. SHOULD, not MUST: A2A v1.0.1 does not define the carriage and the SDKs disagree (a2a-js may use `X-A2A-Notification-Token`), so a MUST here could fail a receiver that follows an SDK (Unresolved question 1).

### §D Replay forks never push

A `replay` fork MUST NOT deliver an A2A push for re-emitted history, and no fork (replay or branch) inherits a source run's push configs.

### §E Push-config isolation

`Get`/`List`/`Delete` of a push config on a task the caller cannot read, or of a `configId` that is not that task's, MUST answer exactly as for an unknown id, apart from the JSON-RPC `id`. A `configId` MUST NOT encode a tenant, workspace or principal. `Delete` MUST be idempotent (upstream §3.1.10).

### What stays

`v2Operation` stays `null` on rows `:104-123`: the webhook operations are tenant-scoped with a `webhook-delivery.schema.json` body; a push is task-scoped with a `StreamResponse` body. The webhook engine is a host's implementation choice, not a wire mapping.

## Compatibility

- **§A is a W3C Process Class 3 correction** (`COMPATIBILITY.md` §3, RFC 0197 §A.4): conforming to both rules was impossible for any host advertising `a2a.pushNotifications`, so the prior text had no satisfiable reading. **Census:** 0 of 3 committed `evidence/v2-host-bundles/*.json` advertise `a2a.pushNotifications: true` (`openwop-host-v2-reference` advertises `false`; `myndhyve` and `openwop-workflow-engine` carry no `a2a` facet). No schema pointer moves, so there is **no `spec/v2/corrections.json` row** — that register holds Class 3 corrections that move a shape (`corrections.schema.json` `$defs.row.properties.class`: "A Class 2 editorial change moves no shape and needs no row"; a prose-only Class 3 correction is recorded in §3 alone, as the 2026-09-22 OIDC `aud` entry was).
- **§B–§E are additive** (§4, new requirements on previously-undefined behavior), each gated on `a2a.pushNotifications`.
- **Schema descriptions only.** `a2a-task-state.schema.json` `PushConfig.url` still abbreviates the SSRF guard to its address arm (the 2026-08-25 correction reached v1 and the RFC but not this v2 description); `tokenFingerprint` cites a nonexistent HMAC. Both descriptions are corrected; no keyword, type or `required` changes, so `check-v2-surface-monotone` sees nothing. The v2 file's `x-openwop-seeded-from: v1` marker is removed: the corrected descriptions are a v2-only edit, so this RFC now owns the file (`derive-v2-schemas.mjs` convention); the v1 source is unchanged.

## Conformance

Honest statement first: **every host-behavior requirement here binds only a host that advertises `a2a.pushNotifications`, and none does.** The legs below are the ones witnessable **without** a push implementation, and they witness the refusal path and the corpus, not §A–§E themselves.

| Leg (in `v2-a2a-operation-map.test.ts`) | Gate | Assertion | Sabotage | Applicable today? |
| --- | --- | --- | --- | --- |
| `a2a-push-unadvertised-refused` | `a2a` 1.0 advertised, `pushNotifications` not `true` | all four push-config operations answer `-32003 PushNotificationNotSupportedError` (map `:104-123` "else PushNotificationNotSupportedError") | host answers `-32601` (openwop-app today for Get/List/Delete) | **yes** — the one host-witnessable leg; it witnesses an existing map row, not this RFC's new MUSTs |
| `a2a-push-register-ssrf` *(specified; lands with the implementation)* | `pushNotifications: true` | Create with `http://` and a private-address URL ⇒ refused (moves the seam-driven check onto the real operation) | accept `http://push.example.com/` | no host |
| `a2a-push-config-isolation` *(specified; lands with the implementation)* | `pushNotifications: true` | foreign `configId` / foreign task ⇒ same bytes as unknown | leak a distinct reason | no host |
| `a2a-push-secrets-not-returned` *(specified; lands with the implementation)* | `pushNotifications: true` | Get/List never echo `credentials` or `token`; a sentinel credential is absent from `GetTask`, the event log and the debug bundle | echo it | no host |
| delivery legs (§B redirect refusal, §C auth header, §D fork no-push) | `pushNotifications: true` + a public HTTPS receiver | — | — | **deferred** with the implementation |

Corpus coherence (lands with this RFC, `conformance/src/coherence/v2-push-credential-coherent.test.ts`, requirement `openwop.requirement.0214.push-credential-coherent`): the carve-out sentence in `security-defaults.md`, `interop.md` §"A2A push delivery", `webhooks.md` §Egress, `replay.md` Fan-out and the rule text of both push-config map rows each carry their clause; the same `it` feeds seven sabotaged copies (each clause removed) and asserts every one is refused. It witnesses the text, not host behavior.

The host leg `a2a-push-unadvertised-refused` was run before merge against a suite-local stub host: `-32003` on all four operations records `executed-pass`; the same stub answering `-32601` records `executed-fail` with "expected -32601 to be -32003". A stub is a sabotage harness, not a witness.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A credential only to registered origin | `Authorization` at a suite-owned receiver; absence at a redirect target | the suite, with a public HTTPS receiver | witnessable-gated (no host advertises push) |
| §A discard on delete/terminal | no further authenticated POST after Delete | the suite | witnessable-gated |
| §A never in log/state/response | sentinel absent from `GetTask`, events, debug bundle | the suite | witnessable-gated |
| §B delivery-time egress, no redirect | receiver answers `307` → no request at the target | the suite (public receiver) | witnessable-gated |
| §C at least one attempt | receiver count ≥ 1 per transition | the suite | witnessable-gated |
| §C no OpenWOP signature | absence of `OpenWOP-Signature` at the receiver | the suite | witnessable-gated |
| §D replay fork never pushes | receiver count unchanged across a `replay` fork | the suite (needs `replay`) | witnessable-gated |
| §E isolation | byte comparison of two answers | the suite | witnessable-gated |
| existing row: unadvertised ⇒ `-32003` | JSON-RPC error code | the suite, unaided | witnessable |

## Security

- New `a2a-push-credential-destination-bound` (reference-impl at `Active`, critical; `witnessable-gated`) — §A. Graduates to protocol only on a non-vacuous executed-pass on a deployed host advertising push.
- New `a2a-push-secrets-not-returned` (reference-impl at `Active`, high; `witnessable-gated`) — §A last sentence + map rows. Same graduation rule.
- Extended `a2a-push-egress-ssrf` — its note gains the delivery-time arm (§B).
- `inbound-credential-no-passthrough` — note gains one sentence naming the §A exception, so the two invariants cannot be read as contradicting.

## Alternatives considered

- **Forbid A2A push outright.** Rejected: push is an optional upstream capability the corpus already maps; the contradiction, not the capability, is the defect.
- **Require the host to mint its own push credential and ignore the client's.** Rejected: an A2A client verifies pushes with the credential it registered (§4.3.3 "Clients MUST validate webhook authenticity using the provided authentication credentials"); a host-minted one cannot be verified.
- **Add OpenWOP HMAC signing to pushes.** Rejected: A2A defines no secret exchange, so the client cannot verify it.
- **Map the rows to `registerWebhook`.** Rejected: different scope (tenant vs task) and body (`webhook-delivery` vs `StreamResponse`).
- **Implement push now.** Deferred (program decision D2): optional upstream, no v2 host advertises it, the reference host has it off, and a delivery witness needs a public-receiver harness.

## Unresolved questions

1. A2A v1.0.1 does not say how `token` is carried. §C recommends (SHOULD) `Authorization: Bearer` when `authentication` is absent; tighten to MUST only once upstream settles it (program Phase 6).

## Editorial

RFC 0100 §4 (`:82`, `:104`): replace "its HMAC/signing follows A2A §4.3.3 (openwop defers the HMAC details …)" with "A2A 1.0.1 §4.3.3 defines no payload signing; the push carries the client's registered `authentication` (RFC 0214 §A, §C)". `a2a-task-state.schema.json` `tokenFingerprint` description: drop "The A2A push HMAC details (A2A §4.3.3) stay inside the A2A layer".

## Acceptance criteria

- [x] Prose, map rule text, schema descriptions, invariants, COMPATIBILITY §3 entry and the coherence check land (`Active` PR).
- [ ] `a2a-push-unadvertised-refused` records `executed-pass` on a **deployed** tier-1 or tier-2 host (openwop-app after H5's refusal fix) — witnesses the refusal row only.
- [ ] **Blocked:** a deployed host advertising `a2a.pushNotifications: true` records `executed-pass` on the §A/§B/§E legs with a suite-owned public HTTPS receiver (a host's own ledger is not a witness). Until then the RFC stays `Active`. Blocked on: the deferred push implementation (program decision D2).
- [ ] RFC 0156 §B retrospective row for this override exists (`not-reviewed`).

## References

A2A v1.0.1 `docs/specification.md` §3.1.7–§3.1.10, §4.3.3, §13.2; RFC 0100 §4; RFC 0147 §A.6; RFC 0197 §A.4; RFC 0200 §E; `spec/v2/core/security-defaults.md` §"Onward hops"; `spec/v2/core/webhooks.md` §Egress, §Replay; `spec/v2/core/replay.md` §Suppression; `spec/v1/a2a-integration.md` D.6, §E.
