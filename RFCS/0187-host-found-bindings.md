# RFC 0187: four bindings the hosts found — `webhookId`'s kind, the v1 wire's pass-through, the census of writers, and the legacy writer's mark

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0187                                                            |
| **Title**         | Four rules the corpus owed after a host measured them: the `webhookId` mint surface carries the `subscriptionId` kind; a v2-only event type passes through on the v1 wire; a rule enforced per route is only as complete as the census of writers; a legacy writer marks the row it cannot seat |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-18                                                      |
| **Updated**       | 2026-09-18 (`Draft` → `Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no high-risk surface is touched.) · 2026-09-18 (`Active → Accepted`). **Evidence tier: tier-1 — steward-verified.** Witness: `openwop-host-v2-reference` build `commit:87cb8a007d05`, suite 2.4.2, `witnessSha256 9217e347b85f…`, signed `v2-reference-3`, all three profiles certified. **Stated plainly:** that host is tier-1 by `GOVERNANCE.md` §"Acceptance evidence tiers" (a reference host in `openwop-examples`), but it is run from the pinned example and its bundle's `discovery.url` is `http://127.0.0.1:3838` — it is not a host that serves traffic, and this acceptance does not call it deployed. Not corroborated: the scenario did not exist at either production host's bundle suite. |
| **Affects**       | `spec/v2/core/identity.md` §5 (the kind table already names `subscriptionId`; the mint surface now carries it), `spec/v2/core/webhooks.md` §Surfaces, `spec/v2/core/persistence.md` §The v1 wire of an era-`3` log + §The writer rule, `spec/v2/core/interrupt.md` §Approver enforcement, `schemas/v2/trigger-subscription.schema.json`, `api/v2/openapi.yaml` (derived), `spec/v2/id-field-bindings.json`, `spec/v1/deprecations.json`, `conformance/src/scenarios/v2-bound-id-kinds.test.ts` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1) — for a client, a response id it echoes gains a grammar and a path parameter gains an accepted spelling; nothing a client sends today stops being accepted. For a host, three new MUSTs and one narrowed mint, in the shape RFC 0184 §A already established for `runId`; ids already minted bare keep resolving through the overlap (`identity.md` §5). |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Four rules, each one the corpus owed after a production host measured its absence. They are filed together because that is what they have in common: none is a new idea, and each closes a place where two hosts could both be conformant and disagree.

## Motivation

**The `webhookId` mint surface has no kind.** `identity.md` §5 names `subscriptionId` tenant-bound and `spec/v2/id-field-bindings.json` binds the property — but the property lives only in `trigger-subscription.schema.json` and `run-event-payloads.schema.json`. The surface that *mints* the thing, `POST /webhooks → { webhookId }`, is triaged `notAKind` ("the grammar is the owning schema's own"), so the kind has no HTTP surface and the HTTP surface has no kind. Both production hosts mint it bare and said so; a tier-1 host's audit found the same hole in four of the five bound kinds on its own wire. Zero scenarios read any tenant-bound id but `runId`, so a host binding one kind of five is green.

**A v2-only event type has no v1 spelling.** `persistence.md` §The v1 wire of an era-`3` log requires the inverse codemap row on the v1 read path. It does not say what happens to a type with no row. **Which types those are, measured 2026-09-18:** none of the 118 in the closed registry — `event-codemap.json` carries a row for every member of `run-event.schema.json`'s `type` enum, `interrupt.requested` included, and `conformance/src/coherence/event-codemap-complete.test.ts` asserts that bijection at the corpus gate. The rule therefore binds (a) **registered vendor-org types**, which `oneOf[1]`'s `^(?!openwop\.)` branch admits and the codemap deliberately never names, and (b) any future 119th core type seated without a row — which the same coherence test would catch. An earlier draft of this paragraph cited `interrupt.requested` as an instance; it is mapped, and naming a mapped type as the example undermined the rule it was meant to motivate. Both hosts chose pass-through independently (`inverse.get(type) ?? type`); the corpus said nothing, so drop and refuse were equally conformant.

**A rule enforced per route is only as complete as the census of writers.** A tier-2 host gated approver eligibility on all three of its resolve routes, then found its client-writable durable store let any workspace member rewrite a pending suspension and self-resolve it. The host's watch teed the rewrite as the resolution. Every route was gated; the store was a fourth writer nobody had counted.

**A legacy writer poisons a run silently.** `interruptRequested` is closed with no hatch (RFC 0185 §B). A host's pre-migration arm wrote an unseated shape into an era-`3` log; every major-2 read of that run then refused, correctly, on a row the write path had accepted. The failure surfaced at read time, far from the writer.

## Proposal

### §A. The mint surface carries the kind

**§A.1** `webhookId` is a `subscriptionId` (`identity.md` §5): tenant-bound `<tenantId>/<opaque>`, host-minted. `POST /webhooks` MUST answer a bound id; `DELETE /webhooks/{webhookId}` and every other `webhookId` path parameter MUST accept it, in the RFC 0184 projection (`~2F`) and percent-encoded, and MUST refuse a bound id whose tenant segment is not the caller's with `403 id_tenant_mismatch`. `spec/v2/id-field-bindings.json` moves the property out of `notAKind`.

**§A.2** Through the overlap the bare form is admitted exactly as `identity.md` §5 admits it for every tenant-bound parameter: an id carrying only the opaque segment resolves under the caller's tenant and never another's. A host MUST NOT mint one after this RFC; the ones it already minted keep resolving. `spec/v1/deprecations.json` carries the row with `removalTrigger: v1-end-of-support`.

**§A.3** The obligation is per kind, not per host. `v2-bound-id-kinds` witnesses every tenant-bound kind that has a wire surface — `webhookId`, `interruptId`, `effectId`, `deliveryId` — each leg gated on the family that mints it, so a host without the family records `inapplicable`.

### §B. A v2-only type passes through on the v1 wire

**§B.1** A `type` in an era-`3` log with no `spec/v2/event-codemap.json` row has no v1 spelling. On the v1 read path a host MUST emit it unchanged, MUST NOT drop the row, and MUST NOT refuse the read for it. A v1 consumer already tolerates an unknown `type` — the same tolerance every vendor-org type needs (COMPATIBILITY.md §2.1) — and the alternatives lose data or make one new row cost an otherwise readable run.

### §C. The census of writers

**§C.1** Approver eligibility (`interrupt.md` §Approver enforcement) binds every writer of the suspension record, not every route. A host whose durable store is writable by a principal other than the engine MUST enforce the same eligibility at the store, or MUST NOT expose the record to that principal for write. A rule enforced per route is only as complete as the census of writers.

### §D. The legacy writer marks the row

**§D.1** A payload def closed with no hatch (RFC 0185 §B) cannot carry an unseated property. A host that writes such a property into an era-`3` log MUST mark the row at the write path — the properties it could not seat, recorded on the row — so the refusal names the writer rather than surfacing as an unexplained read failure. A host MUST NOT let a read discover an unseated row that its own writer produced without that mark.

## Compatibility

Additive per `COMPATIBILITY.md` §2.1. No required field is removed or retyped; no event shape, status meaning or error code changes; no `MUST` is relaxed. Four MUSTs are added for hosts (§A.1, §B.1, §C.1, §D.1) and one mint is narrowed (§A.1), which is the shape RFC 0184 §A used for `runId`: a new obligation on what a host *emits*, with the old spelling still accepted on the way in for the life of the overlap.

## Conformance

`v2-bound-id-kinds` (new) witnesses §A per kind. §B is witnessed by a leg of `v2-era-2-append-vocabulary` reading a v2-only type on the v1 path through the era-3 seam. §C and §D are host-internal obligations whose witness is the absence of the failure they name: both are `witnessable-gated` on a host that advertises `interrupt` and exposes a client-writable store, and neither is observable from outside a host that does not. They are recorded with that witness class rather than claimed as suite-observable.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 `webhookId` is bound, projected, and tenant-checked | `openwop.requirement.0187.bound-id-kinds.webhook` — register → read by projected segment → foreign tenant `403` | the suite, gated on `webhooks` | witnessable — gated on the `webhooks` family |
| §A.3 every bound kind with a wire surface is witnessed | `openwop.requirement.0187.bound-id-kinds.per-kind` — `interruptId`, `effectId`, `deliveryId` | the suite, each leg gated on its family | witnessable — gated on each kind's family |
| §B.1 a v2-only type passes through on the v1 wire | the type is read under its own name on the v1 path, neither dropped nor refused. The corpus half is already proved: `event-codemap-complete.test.ts` shows all 118 core types are mapped, so the rule's live subject is a registered vendor-org type | a host serving an era-`3` log on the v1 path | seam-gated — `api/seams-v2.yaml`'s era-seed seam pins `eventLogSchemaVersion: { const: 2 }`, so no suite can seed the era-`3` log this rule is about until the seam admits era 3 |
| §C.1 eligibility binds every writer | nothing. A census of writers is a property of the host's storage topology, not of its wire: a black-box probe reaches a record only through routes, and so cannot enumerate the writers that are not routes — which is precisely the fourth writer this rule exists to catch | a host whose durable store is client-writable | unwitnessable — no black-box observation distinguishes a host that gated every writer from one that gated every ROUTE; the enforcement is external audit, in the class of RFC 0166's `externally-gated` |
| §D.1 the legacy writer marks the row | nothing yet. §Unresolved records that the mark's wire spelling is deliberately undecided until a second host has one, and a requirement with no declared spelling cannot have a wire witness — an observer cannot tell a host that marks from one that never wrote an unseated row | a host with a pre-migration writer | negative-existence — witnessable only once §Unresolved is settled and the mark has a spelling to look for |

## Alternatives considered

**Leave `webhookId` unbound.** It is what the corpus says today, and it is defensible in isolation: the register response is an opaque handle. It stops being defensible next to `identity.md` §5, which binds the kind the property *is*, and next to the `403 id_tenant_mismatch` check, which structurally cannot run on an id with no tenant segment.

**Refuse the v1 read for a v2-only type** (the mirror of `event_type_unmapped`). Rejected: there the whole log is untranslatable; here one row of new vocabulary would make an otherwise readable run unreadable on `/v1/…` for the rest of the overlap.

**Drop the unnameable row.** Rejected by `events.md` §Era-2 already — a projection MUST NOT silently drop a property, and a row is not a smaller silence than a property.

## Unresolved questions

- Whether `webhookId`'s bare form should be refused at the v1 end-of-support cut or earlier. Left to the deprecation register's trigger.
- Whether §D.1's mark has a wire shape or stays host-internal. A tier-2 host stamps `unseated: [...]` on the row; the corpus states the obligation, not the spelling, until a second host has one.

## Implementation notes (non-normative)

The reference host mints bound `webhookId`s already; the binding cost it nothing but the scenario. Both production hosts mint bare and will record `executed-fail` on §A.1 until they bind — which is the point of a witness.

## Acceptance criteria

- [x] `Active → Accepted`: `v2-bound-id-kinds` executed-pass on a host bundle for every kind that host advertises; `check-id-kinds-bound` green with `webhookId` bound; the deprecation row present. — evidence: `openwop.requirement.0187.bound-id-kinds.webhook` and `.per-kind` are `executed-pass` on the reference host's certified bundle (suite 2.4.2); `check-id-kinds-bound` reports 98 `*Id` properties across 95 v2 schemas, 49 bound and 49 declared not-a-kind, with `id-field-bindings.json` binding `webhookId` → `subscriptionId`; `spec/v1/deprecations.json` carries `deprecatedIn: RFC 0187 (v2.4)`. **One witness only, and two legs unwitnessed:** MyndHyve's bundle (suite 2.1.7) and openwop-app's (2.0.11) predate the scenario file entirely, so neither carries a row — not even `inapplicable`. The `deliveryId` leg records `inapplicable` for a CORPUS gap, not a host gap (`identity.md` §5 binds the kind but `api/v2/openapi.yaml` serves no dead-letter read), and the noop fixture records no effects, so `effectId` — named in §A.3 — is unwitnessed on the wire.

## References

- RFC 0184 (the projection and the mint rule it established), RFC 0185 §B (the hatch), RFC 0176 §A.3 (the reader rule), RFC 0173 §B (approver enforcement), `spec/v2/core/identity.md` §5, `spec/v2/core/persistence.md`, `spec/v2/core/interrupt.md`.
