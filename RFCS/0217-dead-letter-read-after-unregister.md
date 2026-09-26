# RFC 0217: after a subscription is unregistered, its dead-letter read answers as though it never existed

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0217                                                            |
| **Title**         | after a subscription is unregistered, its dead-letter read answers as though it never existed |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-26                                                      |
| **Updated**       | 2026-09-26 — filed and moved `Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no identity or authorization surface is narrowed, and the only new answer is one `identity.md` §5 already gives for an unknown id. Filed as its own RFC rather than as an edit to RFC 0188 because RFC 0188 is `Accepted`, and an `Accepted` RFC may carry only requirements a certified bundle has witnessed (RFC 0174 §B.1 rule 4) |
| **Affects**       | `spec/v2/core/webhooks.md` §Durability (one sentence on the dead-letter read) · conformance (one leg in `v2-webhook-durable-delivery.test.ts`, suite 2.41.2) · amends RFC 0188 §A (the read) |
| **Compatibility** | `additive` — a new normative requirement on a previously undefined behavior (`COMPATIBILITY.md` §4). No wire, schema, error-code or event change |
| **Supersedes**    | — amends RFC 0188 §A; RFC 0188 stands                           |
| **Superseded by** | —                                                               |

## Summary

RFC 0188 added `GET /webhooks/{webhookId}/dead-letters` and said nothing about the id of a subscription that has been unregistered. RFC 0215 §B stopped that subscription's attempts and deliberately wrote nothing to its sink, and left the read's answer as its gap G5. This RFC settles it: after `unregisterWebhook` answers `204`, the read MUST answer `404 not_found`, exactly as for a same-tenant id the host never minted, and the host MAY discard that subscription's records at the unregister.

## Motivation

The read is the only surface that names a subscription after the owner has withdrawn it. A client that unregisters and then reads can observe one of three things today, all conforming to the letter: a `404`, a `200` with the old records, or a `200` with an empty page. A second client, or a later owner of the id space, cannot tell which one a host chose, and the choice decides whether the sink is an oracle for "this id once existed" and whether delivery metadata outlives the owner's withdrawal. `expiresAt` (RFC 0188 §A.4) promises retention without saying the subscription must still exist.

## Proposal

### §A. The read after the unregister

One sentence in `spec/v2/core/webhooks.md` §Durability, after the dead-letter bullet's content-free rule:

> The read belongs to a live subscription: after `unregisterWebhook` answers `204`, `GET /webhooks/{webhookId}/dead-letters` for that id MUST answer `404 not_found`, exactly as for a same-tenant id the host never minted, and the host MAY discard that subscription's records at the unregister. `expiresAt` bounds a record's retention only while its subscription exists.

- **Why `404`, not a readable tombstone.** The read is path-scoped to a subscription, and `identity.md` §5 already answers an unknown id `404` (a foreign tenant segment `403`, checked before lookup, RFC 0188 §A.2). A tombstone would add an "unregistered" subscription state that neither rule knows, and it would keep delivery metadata after the owner said stop. RFC 0215 §B already sends nothing new to the sink after the `204`.
- **Why indistinguishable from never-minted.** Otherwise the sink becomes an oracle for whether an id ever existed.
- **Why `MAY` discard.** A host that keeps the rows until its retention purge (the v2 reference host) and one that deletes them with the subscription (MyndHyve) are both conforming. Neither is observable through the protocol once the read answers `404`.

### Examples

**Conforming.** Register, unregister (`204`), read: `404 { error: "not_found" }`. The same read of `<tenant>/never-minted-id`: `404 { error: "not_found" }`.

**Non-conforming.** After the `204` the read answers `200 { deliveries: [] }` or `200` with the old records. Or it answers `404` with a different code than a never-minted id gets.

## Compatibility

`additive` under `COMPATIBILITY.md` §4. No wire shape changes. It binds only hosts advertising `webhooks.deadLetter`. Measured before filing: the v2 reference host already answers `404 not_found`. MyndHyve answers `404` from one branch for both cases and discards the rows at unregister, but with the unregistered code `subscription_not_found`, which `errors.md` already forbids for every v2 error response; it is fixing that host-side.

## Conformance

`v2-webhook-durable-delivery.test.ts` gains one leg, gated on `webhooks.deadLetter`. It registers a subscription, reads its sink (`200`, the control), unregisters (`204`), reads again, and reads a never-minted same-tenant id. It passes when both later reads answer `404 not_found`. Sabotage (v2 reference host): a host that answers `200 { deliveries: [] }` for an unknown id fails the row ("got 200").

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A no sink after unregister, indistinguishable from never-minted (`openwop.requirement.0217.dead-letter-read-after-unregister`) | after the `204`, the read answers `404 not_found`, the same status and code as a never-minted same-tenant id; a `200` before the unregister is the control | the suite, gated on `webhooks.deadLetter` | witnessable — gated on the facet |

## Alternatives considered

1. **A readable tombstone for `retentionDays`.** Rejected in §A: it adds a subscription state the identity rules do not know, and it keeps metadata after withdrawal. It would also have required the host to keep the subscription row, which MyndHyve deletes.
2. **Leave it host-defined.** Rejected: the read is the one surface where the choice is visible, and an unstated choice is an existence oracle on some hosts and not others.
3. **Edit RFC 0188 in place, as an owner correction.** Rejected at filing: RFC 0188 is `Accepted`, and the Accepted predicate refuses a requirement id no certified bundle has witnessed. A new rule on an `Accepted` RFC is a new RFC until it is witnessed.

## Unresolved questions

None.

## Implementation notes (non-normative)

- A host whose read looks the subscription up first (the v2 reference host, MyndHyve) meets §A already, provided its not-found branch answers `not_found`.
- Prior art: endpoint-scoped delivery logs (GitHub's `/repos/{owner}/{repo}/hooks/{hook_id}/deliveries`, Svix's attempts by endpoint) are addressed through the endpoint and document no read after it is deleted. Stripe's events outlive a deleted endpoint only because they are account-scoped.

## Acceptance criteria

- [x] `Active`: the `webhooks.md` sentence and the leg (suite 2.41.2), sabotage-proved against a tombstone host.
- [ ] `openwop.requirement.0217.dead-letter-read-after-unregister` `executed-pass` on a certified host bundle — reason: minted in suite 2.41.2, which is not yet published; the first certified cut of a host advertising `webhooks.deadLetter` on ≥ 2.41.2 (the v2 reference host, or MyndHyve after its error-code fix) witnesses it.

## References

- RFC 0188 §A (the read), §A.2 (tenant refusal before lookup), §A.4 (`expiresAt`).
- RFC 0215 §B and gap register G5.
- `spec/v2/core/identity.md` §5; `spec/v2/core/errors.md`.
