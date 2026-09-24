# RFC 0215: a webhook delivery does not wait on another subscription's receiver, and an unregistered subscription gets no further attempts

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0215                                                            |
| **Title**         | a webhook delivery does not wait on another subscription's receiver, and an unregistered subscription gets no further attempts |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-24                                                      |
| **Updated**       | 2026-09-24                                                      |
| **Affects**       | `spec/v2/core/webhooks.md` §Durability (two new bullets) and §Surfaces (one sentence on `unregisterWebhook`) · `SECURITY/invariants.yaml` (+2, proposed below; added at `Active`) · conformance (2 new scenarios, `webhooks`-gated) |
| **Compatibility** | `additive` — a new normative requirement on a previously undefined behavior (`COMPATIBILITY.md` §4). No wire, schema, error-code or event change |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`webhooks.md` makes one isolation promise, the confidentiality half: a subscription receives only its own tenant's events (`webhook-cross-tenant-isolation`). It makes no availability promise. Nothing, in v1 or v2, stops one subscription's dead receiver from delaying every other subscription's deliveries. Nothing says that unregistering a subscription stops the attempts already queued for it either. Both gaps were measured on the reference host while it was conformant to the letter. This RFC adds two rules to `webhooks.md` §Durability. An attempt to one subscription MUST NOT wait for an attempt to another subscription to finish. After `unregisterWebhook` answers `204`, the host MUST NOT start another attempt for that subscription.

## Motivation

Both instances come from openwop-app (`docs/steward/TODO.md` at `020867cbb`), measured from the host's own timestamps and logs rather than inferred.

**1. Head-of-line starvation (openwop-app `WHD-1`, 2026-09-20).** The delivery worker claimed a batch of due rows and processed them **strictly sequentially**: `for (const rec of due) { await sendDelivery(rec) }`, with `CLAIM_BATCH = 5` and `DELIVERY_TIMEOUT_MS = 10 s`. A few dead subscribers therefore held every other subscriber behind them for up to 50 s per poll cycle. Measured on deployed `3080f2f24a0f`, one healthy subscription, run completed ~00:06:

```
attempt 1  00:11:51   ~5.5 min after the event
attempt 2  00:20:56   +9.0 min      (configured backoff: 2s)
attempt 3  00:26:17   +5.3 min      (configured backoff: 4s)
attempt 4  00:33:55   +7.6 min      (configured backoff: 8s)
```

The gaps are not backoff. Each row was due seconds later and was not *claimed* for minutes. Everything the corpus asks of a durable host still held: retries per `retryPolicy`, at-least-once, dead-letter on exhaustion. The failure surfaced only because it concealed three `blocked` conformance rows during a certification cut. The fix (#4052) processes the claimed batch concurrently. Its regression test uses **4** hung subscribers against a batch of **5**, so it does not exercise a host with five or more dead receivers due at once. That is the case this RFC's floor (§A.2) is chosen to reach.

**2. Deliveries to a withdrawn destination (openwop-app `WHD-16`, 2026-09-21).** Production logs, 21:30–21:50Z: **~1,600 failed attempts**, all to *one* expired evidence-cut tunnel, and all *after* the suite had unregistered its subscriptions (0 remained). `deleteWebhook` removed the subscription row but not its pending deliveries. The rows kept POSTing **signed events** to a URL its owner had withdrawn. Ordered `next_attempt_at ASC`, they sat ahead of the cut's live deliveries, so one gap produced both failure shapes. openwop-app fixed it (#4083: `deleteWebhook` drops pending rows atomically in both backends). The corpus has never required that.

**Why the spec is the right place.** Both failures are invisible to a host's own tests unless the test creates the contention (openwop-app's `adr0722` fan-out test passed on `memory://` because it had no queue contention). Both are observable from outside, and both are exploitable across tenants, which makes them protocol properties rather than implementation quality:

- A tenant that registers subscriptions to black-hole URLs delays **other tenants'** deliveries on any host whose delivery capacity is shared. This is the availability counterpart of `webhook-cross-tenant-isolation`.
- An unregistered URL is one its owner no longer controls or vouches for. An expired tunnel hostname, or a lapsed domain, can be re-registered by someone else. Continuing to deliver signed run events there hands them run data after the owner has said stop.

## Proposal

### §A. One subscription's receiver does not hold another's delivery

New bullets in `spec/v2/core/webhooks.md` §Durability, after the at-least-once bullet:

> - not make the start of an attempt to one subscription wait for an attempt to a *different* subscription to finish (answered, failed, or timed out). One subscription's slow or dead receiver MUST NOT delay another subscription's deliveries;
> - sustain §A.1 while at least **8** subscriptions have attempts outstanding that their receivers have not answered. A host MAY bound concurrent attempts beyond that, and SHOULD NOT let one tenant's unanswered attempts occupy capacity that another tenant's deliveries need.

- **§A.1 (MUST NOT).** It is a head-of-line rule and says nothing about mechanism. A per-subscription lane, a concurrent pool, or async I/O all satisfy it. A sequential loop over a batch does not.
- **§A.2 (floor, MUST).** Without a number, §A.1 is unsatisfiable by any bounded host (with enough dead receivers, every pool fills), and a host could argue any bound it has meets it. The floor makes the rule satisfiable and testable: at 8 outstanding unanswered attempts, a ninth subscription's attempt still starts. The number is a Draft proposal (Unresolved question 1).
- **§A.3 (cross-tenant, SHOULD).** This is the availability analogue of `webhook-cross-tenant-isolation`. It is a SHOULD because the fair-share mechanism is a real design cost for a host, and because the only way to observe it needs an operator-supplied second-tenant credential (Falsifiability).

Scope: §A governs *when an attempt starts*. It does not bound how long after an event becomes due its first attempt must start. That is a latency SLO, not an isolation property (gap register G2).

### §B. Unregistering stops the attempts

One sentence appended to the `unregisterWebhook` row's surrounding text in `webhooks.md` §Surfaces, and one bullet in §Durability:

> After `unregisterWebhook` answers `204`, the host MUST NOT start any further attempt for that subscription, including attempts already scheduled for retry. An attempt already in flight when the `204` is sent MAY complete. Undelivered events are not dead-lettered by the unregister; the subscription no longer exists to own them.

The last sentence resolves the one interaction with §Durability: "route an exhausted delivery to the dead-letter sink, rather than drop it" governs deliveries of a *live* subscription. Unregistering is the owner withdrawing the subscription, not a delivery failure. The `webhooks.deadLetter` read (RFC 0188) is keyed by `webhookId`, and nothing in the corpus says whether it still answers once that subscription is unregistered. Records written *by* the unregister would depend on an answer nobody has given. Whether *existing* dead-letter records outlive the unregister is the same unstated question, and it is gap register G5, not this RFC.

### Examples

**Conforming (§A).** Nine subscriptions match one run. Eight receivers accept the connection and never answer. The ninth answers `204`. Its attempt arrives while all eight are still held open.

**Non-conforming (§A).** Same setup. The ninth receiver's attempt arrives only after the host abandons one of the eight held attempts (its connection closes at the host's timeout). The ninth waited on another subscription's attempt.

**Conforming (§B).** A subscription's receiver answers `500`, so a retry is scheduled. The client unregisters (`204`). No attempt arrives for that `webhookId` after the in-flight grace, through the whole window in which the retry would have come.

**Non-conforming (§B).** The retry arrives, signed, after the `204`: openwop-app before #4083.

### Proposed invariants (added to `SECURITY/invariants.yaml` at `Active`)

| id | tier | severity | threat model | test |
| --- | --- | --- | --- | --- |
| `webhook-delivery-isolation` | protocol | high | none fits — see gap register G3 | `v2-webhook-delivery-isolation.test.ts` (planned) |
| `webhook-unregister-stops-delivery` | protocol | high | `SECURITY/threat-model-secret-leakage.md` (signed run data to a withdrawn destination) | `v2-webhook-unregister-stops-delivery.test.ts` (planned) |

**Decision on TODO S3's question** ("a new invariant beside `webhook-cross-tenant-isolation`, or a §Durability clause?"): **both, for different reasons.** The normative text belongs in §Durability, because it is an obligation of the delivery surface, which RFC 0173 §B already made durable. The invariant rows exist because each failure crosses a trust boundary: §A across tenants, §B across the owner's withdrawal. The invariant catalogue is where the corpus records properties an attacker would target. Neither row is added to `invariants.yaml` at `Draft`, because a row without a runnable test would count against the unwitnessable ratchet for as long as this RFC is in comment.

## Compatibility

`additive` under `COMPATIBILITY.md` §4, "new normative requirement on a previously-undefined behavior". v1 and v2 `webhooks.md` are silent on both the ordering of attempts across subscriptions and what happens to pending attempts at unregister.

- No wire shape changes: no schema, OpenAPI operation, header, event, or error code.
- A host that already isolates (openwop-app after #4052 at up to 5 outstanding; MyndHyve not yet measured, gap register G1) keeps passing. The floor of 8 may be above openwop-app's current claim batch. See Risk R1.
- The obligation binds only hosts advertising `webhooks`. It lands at the v2 major, in the next suite minor, and adds nothing to v1.

## Conformance

**Existing coverage.** `v2-webhook-durable-delivery.test.ts` (retry, at-least-once, dead-letter), `webhook-tenant-isolation.test.ts` (confidentiality), `v2-webhook-egress-refusal.test.ts`. None creates contention between subscriptions, and none unregisters with a retry pending.

**New scenarios** (both gated on `webhooks`, both built on `startScopedReceiver`, whose `respond` callback owns the response and can therefore hold one open):

1. `v2-webhook-delivery-isolation.test.ts` (planned).
   - **Control leg:** one healthy subscription, one run; its delivery arrives. If it does not, every other leg records `blocked` with `noDeliveryCause`, never a failure.
   - **§A leg:** register 8 subscriptions whose receivers accept and never answer (held until the leg ends), then one healthy subscription, all matching one run.
     - Pass: the healthy attempt arrives within `RETRY_WAIT_FLOOR_MS` while no held attempt has been abandoned.
     - Fail: it arrives only after the host abandoned a held attempt, or not at all.
     - `partial-witness`: it arrives before *any* held attempt was even started. The host may simply have dispatched the healthy one first, so nothing was contended.
   - Registration order puts the held subscriptions first, which a FIFO host will dispatch first.
2. `v2-webhook-unregister-stops-delivery.test.ts` (planned). The receiver answers `500` to every attempt. Wait for the first attempt, unregister (`204`), and record the time. Any attempt for that `webhookId` arriving more than 5 s after the `204`, within `retryWaitFor(policy, cap)`, fails the row. A host advertising `retryPolicy.maxAttempts: 1` has no retry to observe and records `inapplicable`.

A public front (`OPENWOP_WEBHOOK_RECEIVER_URL`) may time out a held request itself: a cloudflared tunnel does so at ~100 s. That is longer than the §A window, so the front cannot be mistaken for the host abandoning the attempt. The scenario still records which side closed.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A.1 no head-of-line across subscriptions | healthy attempt arrives while 8 held attempts stay open (`v2-webhook-delivery-isolation.test.ts`, planned) | the suite (holds its own receivers open) | witnessable — gated (on `webhooks`); dispatch order not controllable ⇒ `partial-witness` when nothing contended |
| §A.2 floor of 8 | same leg, at exactly 8 held | the suite | witnessable — gated (on `webhooks`) |
| §A.3 cross-tenant fair share (SHOULD) | tenant B's delivery arrives while tenant A holds attempts open past its floor | the suite, with an operator-supplied `OPENWOP_TEST_TENANT_B_API_KEY` | witnessable — gated (on `webhooks` and the tenant-B key; absent key ⇒ `inapplicable`). A SHOULD, so the leg reports and never fails; the leg's shape is gap register G4 |
| §B no attempt after `204` | an attempt for the unregistered `webhookId` arrives > 5 s after `204` (`v2-webhook-unregister-stops-delivery.test.ts`, planned) | the suite (fails every attempt, then unregisters) | witnessable — gated (on `webhooks`) |

## Alternatives considered

1. **Do nothing.** The reference host fixed both defects on its own, so why legislate? Because the corpus would still certify the pre-fix host. openwop-app's defect was found only because it hid three `blocked` rows during a certification cut. A second host with the same sequential loop and no such luck certifies clean. "Durable" in §Durability would keep meaning *eventually delivered, after any amount of other subscribers' failure*.
2. **A latency bound instead of an isolation rule** ("the first attempt MUST start within N s of the event"). It is simpler to state, but it is the wrong property. It convicts a host that is merely busy and acquits one whose queue is idle today. It also puts a number on the wire that every host would have to meet under any load. Isolation is what failed, so isolation is what is stated. A latency SLO is gap register G2.
3. **§A as a SHOULD.** A SHOULD cannot fail a row, and the whole motivation is a host that passed every row while starving its subscribers. A SHOULD is right for the cross-tenant fairness mechanism (§A.3) and wrong for head-of-line blocking (§A.1).
4. **Dead-letter pending attempts at unregister instead of dropping them (§B).** Rejected in §B: the sink is read per `webhookId`, and whether that read survives an unregister is unstated (G5). Writing records into a sink that may be unreadable is worse than a stated drop.
5. **An advertised concurrency facet** (`webhooks.maxOutstanding`) instead of a fixed floor. It would let each host state its own bound. But an advertised bound of 1 would make a sequential host conforming, which re-admits the defect. A floor with no field is stricter and needs no schema change. Unresolved question 1 keeps the number open.

## Unresolved questions

1. **Is 8 the right floor?** It is chosen to exceed the one measured claim batch (openwop-app, 5), so the scenario reaches the case that host's own test does not. It is not derived from any upstream standard, and hosted webhook services' published designs have not been surveyed for a number (gap register G6).
2. **Should §B also cover a subscription whose `url` is later rejected at delivery time by §Egress?** Today that is a delivery failure retried under the policy. It is arguably the same "destination no longer valid" case, and it is scoped out here.
3. **Should the §B grace be 5 s?** It must cover an attempt the host had already started when it answered `204`. A host with a 30 s delivery timeout may still be in the middle of an earlier attempt, but that attempt's request has already *arrived* at the receiver, and the scenario keys on arrivals. So 5 s covers network transit only.
4. **Should the corpus ever bound first-attempt latency?** §A is deliberately an isolation rule, not an SLO (Alternative 2, gap register G2). openwop-app's WHD-1 retries were each due within seconds and not claimed for minutes. That is covered by §A when other subscribers caused it, and uncovered when an idle queue simply polled slowly.

## Implementation notes (non-normative)

- openwop-app: #4052 (concurrent claimed batch, bounded by `CLAIM_BATCH`) and #4083 (atomic pending-row drop on delete) are the two fixes. With `CLAIM_BATCH = 5`, §A.2 at 8 likely needs either a larger batch or a claim that skips subscriptions with an attempt already outstanding. Risk R1 records this as expected, not measured.
- A design that meets §A for any number of dead receivers: each subscription's attempts are serialized in its own lane, and lanes share nothing but the socket pool. A concurrent pool bounded at ≥ 8 meets the floor but not the SHOULD in §A.2, because one tenant can fill it.
- Sequencing: spec text + scenarios in one suite minor; invariant rows at `Active`; `Accepted` on a certified bundle from each of two hosts carrying both rows `executed-pass`.

## Acceptance criteria

- [ ] Spec text merged (`webhooks.md` §Durability, §Surfaces).
- [ ] Schema / OpenAPI / AsyncAPI updated where applicable — **none applicable**: no wire change.
- [ ] `v2-webhook-delivery-isolation.test.ts` and `v2-webhook-unregister-stops-delivery.test.ts` in the suite, sabotage-proved against a sequential worker and against a delete that leaves pending rows.
- [ ] `SECURITY/invariants.yaml` rows `webhook-delivery-isolation` and `webhook-unregister-stops-delivery`.
- [ ] CHANGELOG entry under the suite minor that ships the scenarios.
- [ ] Two hosts' certified bundles record both rows `executed-pass` (openwop-app; MyndHyve per G1).

## References

- openwop-app `docs/steward/TODO.md` `WHD-1` (#4052), `WHD-3`, `WHD-16` (#4083), at `020867cbb`.
- openwop `TODO.md` §S3 (steward follow-ups from the 2026-09-19 gap-closure program).
- `spec/v2/core/webhooks.md` §Surfaces, §Durability; `spec/v1/webhooks.md` §Unregister.
- RFC 0093 (webhook delivery hardening; `webhook-cross-tenant-isolation`), RFC 0173 §B (durable delivery binds with the surface), RFC 0188 (delivery dead-letter read route).
- Prior art: not surveyed at `Draft` (gap register G6).
