# RFC 0188: `listWebhookDeadLetters` — the delivery dead-letter read, and the seat that makes `deliveryId` witnessable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0188                                                            |
| **Title**         | `GET /webhooks/{webhookId}/dead-letters`: the read that makes `webhooks.md` §Durability observable, gated on a new `webhooks.deadLetter` facet |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-18                                                      |
| **Updated**       | 2026-09-18 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no identity or auth surface is narrowed — one new optional read is added, gated on a facet no host advertises yet.) |
| **Affects**       | `api/v2/openapi.yaml` (`listWebhookDeadLetters`) · `spec/v2/path-manifest.json` · `schemas/v2/webhook-dead-letter-page.schema.json` (new) · `spec/v2/facets/webhooks.schema.json` (new `deadLetter` facet) · `spec/v2/declaration.json` (family `webhooks` gains the facet and, for the first time, an `owningRfc`) · `spec/v2/core/webhooks.md` §Durability · `SECURITY/invariants.yaml` (`dead-letter-read-carries-no-payload`) · `SECURITY/threat-model-secret-leakage.md` §4.10 |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1): one new optional operation gated on a new facet of an existing family; no existing field, MUST, error code, event shape or v1 surface changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`spec/v2/core/webhooks.md` §Durability has always required a host to route an exhausted delivery to a dead-letter sink "inspectable for `retentionDays`" — and the corpus served no endpoint that could inspect it. This RFC adds that read, gated on a new `webhooks.deadLetter` facet, and uses its response as the seat that finally makes the `deliveryId` kind witnessable.

## Motivation

**A MUST with no reader.** Every committed host bundle records the same sentence against `openwop.requirement.0173.webhook-durable-delivery.dead-letter`: *"exhaustion was observed, routing to the sink was not."* The scenario watches a subscriber exhaust its retries and then has nowhere to look. A normative obligation that no observer can check is the failure class this corpus writes gates to prevent, and it has been sitting inside the durability rule since the v2 cut.

**A bound kind with nowhere to appear.** `identity.md` §5 binds `deliveryId` as tenant-bound. It `$ref`s in exactly one place — `trigger-event.schema.json`, whose own description says that object is an in-run payload that never reaches the durable log. So `v2-bound-id-kinds` records its `deliveryId` leg `inapplicable` with a reason that names the CORPUS, not the host: *"the kind has nowhere to appear on the wire, so no host can be held to it."* A kind the identity rules bind and the wire never carries is a rule nobody can break and nobody can keep.

**Every host that grows this surface grows a different address.** The reference host already serves exactly this read — `deadLetterRead: "/webhooks/{webhookId}/dead-letters"`, advertised under `extensions.openwop-v2-reference.host`. That is not a violation: `versioning.md` §1.4's JSON prohibition binds on a manifest-named path, and this path is not in the manifest. It is the RFC 0182 motivation restated — an interop gap, where the absence of a normative address means each host invents one. This RFC adopts the address a host already serves rather than inventing a second.

**And the sink is owned by the wrong RFC.** Three documents route *delivery* dead-letters to "the RFC 0053 sink". RFC 0053 is run-scoped and says so twice, explicitly distinguishing itself from a transport DLQ, and never mentions deliveries. Meanwhile the `webhooks` family has `owningRfc: null` — so the v2 delivery dead-letter MUST is asserted by three documents and owned by none.

## Proposal

### §A.1 The read

`GET /webhooks/{webhookId}/dead-letters` returns one page of dead-lettered deliveries for that subscription, newest first, shaped by `schemas/v2/webhook-dead-letter-page.schema.json`. `webhookId` is tenant-bound and carried as ONE path segment — `~`-projected per RFC 0184, or percent-encoded.

### §A.2 Tenant scoping

The subscription segment is tenant-bound, so `identity.md` §5's rule applies unchanged: a foreign tenant segment MUST answer `403 id_tenant_mismatch`, checked BEFORE lookup, so a probe cannot distinguish "not yours" from "does not exist".

### §A.3 Pagination

`limit` and `cursor`, as RFC 0182 §A.3: `limit` clamped to `webhooks.deadLetter.maxPageSize`, a cursor from another subscription refused `400 validation_error`. The idiom is deliberately identical — a second pagination dialect in the same protocol is a defect, not a feature.

### §A.4 What a record carries

`deliveryId`, `webhookId`, `runId`, `eventId`, `eventType`, `attempts`, `deadLetteredAt`, `expiresAt`, `reason` (`retries_exhausted` | `payload_unprojectable`), and optionally `lastStatus`. `expiresAt` is what turns `retentionDays` from an advertisement into an observable: a reader can check it against the facet.

### §A.5 The facet, and the split it settles

`webhooks.deadLetter` (`retentionDays`, `maxPageSize`) advertises the DELIVERY sink. It is **not** the top-level `deadLetter` family (RFC 0053), which is the RUN sink and whose `retentionDays` governs a dead-lettered run's fork-eligibility window. Two sinks, two owners. A host that does not advertise the facet MUST answer `404 not_found`.

This RFC also claims `webhooks.owningRfc`, which has been `null` since the family existed.

### §B.1 The record is content-free

A dead-letter record MUST NOT carry the delivered body, the delivery headers, or the subscription secret.

A dead-letter queue is, by construction, every event the subscriber FAILED to receive. A record carrying the body would turn one read scope into a complete replay of exactly that traffic, retained for the whole `retentionDays` window — the largest single payload-disclosure surface the protocol could have, wearing the costume of a diagnostic. The response schema is `additionalProperties: false` over a closed field list, so a host cannot add one without failing validation.

## Compatibility

`additive`, per COMPATIBILITY.md §2.1. One new optional operation, one new response schema, one new facet. No existing field, MUST, error code, event shape or v1 surface changes. All four error responses already exist in `spec/v2/errors.json`. A host not advertising `webhooks.deadLetter` is unaffected and the suite records `inapplicable` with that reason.

## Conformance

- `v2-bound-id-kinds` — the `deliveryId` leg stops recording a corpus gap and asserts the bound grammar and the caller's tenant segment on a real record.
- `v2-webhook-durable-delivery` — the dead-letter leg stops soft-skipping unconditionally and asserts the exhausted delivery is present in the sink, which is the half `webhooks.md` §Durability asserts and no bundle has ever witnessed.

Both legs are gated on `webhooks.deadLetter`; a host without it records `inapplicable`, not `blocked`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 the read exists and is shaped | `openwop.requirement.0188.dead-letter-read` — a page validating against `webhook-dead-letter-page.schema.json`, with a tenant-bound `deliveryId` on every record | the suite, gated on `webhooks.deadLetter` | witnessable — gated on the facet |
| §A.2 foreign tenant refused before lookup | `403 id_tenant_mismatch` on a foreign subscription segment, indistinguishable from a segment that does not exist | the suite, gated | witnessable — gated on the facet |
| §A.5 the sink is the DELIVERY sink | a host advertising `webhooks.deadLetter` and not the RFC 0053 `deadLetter` family still serves this read | the suite, gated | witnessable — gated on the facet |
| §B.1 the record carries no payload | nothing. A record that OMITS the body is indistinguishable from one whose body happened to be empty; the schema's closed field list is what refuses the field, and a host that adds one fails validation rather than leaking quietly | a host (must not) | witnessable — unaided (corpus): `check-v2-schemas` enforces the closure, and `SECURITY/invariants.yaml` carries the MUST-NOT with a test |

## Alternatives considered

**Reuse the RFC 0053 `deadLetter` family.** Rejected — it is run-scoped and says so twice. Gating this read on it would cement into the wire exactly the conflation three documents already suffer from, and would make one `retentionDays` govern two unrelated retention windows.

**Put the read under `/host/<org>/…`.** Rejected — that is the vendor path space (RFC 0181). A read this generic, which two conformance scenarios already need and one host already serves, belongs in the protocol path space or nowhere.

**Carry the delivered body so a subscriber can self-heal.** Rejected, and it is the tempting one: a subscriber that could re-read the payload could replay it. But §B.1's reasoning is decisive — the queue is precisely the traffic that never arrived, and a replay surface guarded only by manage scope is a worse failure than a subscriber who must ask the run for its events, which they can already do with tenant-checked reads.

## Unresolved

**The causing-delivery pointer is deliberately NOT seated here.** How a run points back at the delivery that caused it is a separate question, on the inbound side: `webhooks.md` is outbound, and the pointer belongs on the durable event-log payload, in a trigger-ingestion document `spec/v2/core/` does not yet have. RFC 0040 §Alternatives already rejected overloading `causationId` for a cross-space pointer in favour of a sibling field; that decision stands and awaits a home.

## Acceptance criteria

- [x] `Draft → Active`: the read in `api/v2/openapi.yaml` and `spec/v2/path-manifest.json`, the response schema, the `webhooks.deadLetter` facet, the `webhooks.owningRfc` claim, the §Durability prose, the SECURITY invariant with its threat-model section, and the two scenario legs. (This PR.)
- [ ] `Active → Accepted`: `openwop.requirement.0188.*` `executed-pass` on a certified host bundle. The reference host already serves the path as a vendor extension, so its work is to advertise the facet, move the path off `extensions.<org>.deadLetterRead`, and re-cut.
