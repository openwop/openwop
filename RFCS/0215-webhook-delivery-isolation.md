# RFC 0215: a webhook delivery does not wait on another subscription's receiver, and an unregistered subscription gets no further attempts

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0215                                                            |
| **Title**         | a webhook delivery does not wait on another subscription's receiver, and an unregistered subscription gets no further attempts |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-24                                                      |
| **Updated**       | 2026-09-26 — **`Active → Accepted`, provisional pending RFC 0156 §B retrospective review** (it went `Active` under a waived window; register row `not-reviewed`). Evidence tier: tier-2 — MyndHyve (`api.myndhyve.ai`), the steward-affiliated sibling host, a deployed production revision; with a tier-1 corroborating witness, the v2 reference host (openwop-examples), a reference example and not a production host. Both certified bundles on published 2.40.0 record `openwop.requirement.0215.no-head-of-line` and `openwop.requirement.0215.unregister-stops-delivery` `executed-pass`, neither a partial witness: MyndHyve's production cut (openwop#1595; revision `workflow-runtime-00771-tat`, build `commit:ff36553c`, witness `3dda5af695f1`, signed `myndhyve-bundle-2026-09b`, 239 pass / 0 fail / 0 blocked, discovery-core + core-standard certified; `--verify` against the key its live discovery publishes → VERIFIED) and the v2 reference host's public cut (openwop#1587; build `commit:265fca7`, witness `f1b77199fb31`, signed `v2-reference-4`, 403 / 0 / 0, relaxations `[]`, all three profiles certified). openwop-app also passes both rows on its deployed revision (`00743-brq`, build `9797183c`) but its bundle does not certify for reasons outside this RFC (harness-credential rows), so it is not cited. Gap G1 closed. · 2026-09-25 (`Draft → Active`) — moved `Active` the day after filing; **comment window waived** by an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the public window for an RFC affecting **isolation** and **external effects** (§A is the availability half of tenant isolation; §B governs signed deliveries to an external destination). The steward decided on 2026-09-25 to waive it ("waive the comment window and move 0215 to Active"). Recorded in `MAINTAINERS.md` as an override row, not a routine waiver; the RFC 0156 §B retrospective review is owed (`docs/WAIVER-RETROSPECTIVE-REGISTER.md`), so any acceptance is provisional until it is recorded. The evidence gate (RFC 0147 §A.5) is not overridden. An architecture review before the flip decided the open questions (§Resolved questions) and changed both scenarios' shape (§Conformance): §A now establishes contention before the healthy delivery falls due, and §B is judged against a control subscription. Spec text, both scenarios (sabotage-proved on the v2 reference host) and both invariant rows land in suite 2.40.0. · 2026-09-25 — prior-art survey done (§Prior art; gap G6 closed) and the availability invariant given a threat-model home (`threat-model-secret-leakage.md` §4.12; gap G3 closed). **The public comment window runs in full, to 2026-10-01** (RFC 0147 §A.6: an isolation RFC takes the whole window). · 2026-09-24 — filed `Draft` |
| **Affects**       | `spec/v2/core/webhooks.md` §Durability (two new bullets) and §Surfaces (one sentence on `unregisterWebhook`) · `SECURITY/invariants.yaml` (+2, added at `Active`) · conformance (2 new scenarios, `webhooks`-gated, suite 2.40.0) |
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
- **§A.2 (floor, MUST).** Without a number, §A.1 is unsatisfiable by any bounded host (with enough dead receivers, every pool fills), and a host could argue any bound it has meets it. The floor makes the rule satisfiable and testable: at 8 outstanding unanswered attempts, a ninth subscription's attempt still starts. The number was decided at `Active` (§Resolved questions 1).
- **§A.3 (cross-tenant, SHOULD).** This is the availability analogue of `webhook-cross-tenant-isolation`. It is a SHOULD because the fair-share mechanism is a real design cost for a host, and because the only way to observe it needs an operator-supplied second-tenant credential (Falsifiability).

Scope: §A governs *when an attempt starts*. It does not bound how long after an event becomes due its first attempt must start. That is a latency SLO, not an isolation property (gap register G2).

### §B. Unregistering stops the attempts

One sentence appended to the `unregisterWebhook` row's surrounding text in `webhooks.md` §Surfaces, and one bullet in §Durability:

> After `unregisterWebhook` answers `204`, the host MUST NOT start any further attempt for that subscription, including attempts already scheduled for retry. An attempt whose request the host had begun sending before the `204` MAY complete. The unregister does not oblige the host to route that subscription's undelivered events to the dead-letter sink.

The last sentence resolves the one interaction with §Durability: "route an exhausted delivery to the dead-letter sink, rather than drop it" governs deliveries of a *live* subscription. It is a permission, not a prohibition (architecture review, 2026-09-25): the Draft said undelivered events "are not dead-lettered", which no client can observe, since the dead-letter read is keyed by a `webhookId` that no longer exists, and which the v2 reference host's store violates harmlessly by marking orphaned rows `dead-lettered` internally. An unobservable prohibition is not a rule. Unregistering is the owner withdrawing the subscription, not a delivery failure. The `webhooks.deadLetter` read (RFC 0188) is keyed by `webhookId`, and nothing in the corpus says whether it still answers once that subscription is unregistered. Records written *by* the unregister would depend on an answer nobody has given. Whether *existing* dead-letter records outlive the unregister is the same unstated question, and it is gap register G5, not this RFC.

### Examples

**Conforming (§A).** Nine subscriptions match one run. Eight receivers accept the connection and never answer. The ninth answers `204`. Its attempt arrives while all eight are still held open.

**Non-conforming (§A).** Same setup. The ninth receiver's attempt arrives only after the host abandons one of the eight held attempts (its connection closes at the host's timeout). The ninth waited on another subscription's attempt.

**Conforming (§B).** A subscription's receiver answers `500`, so a retry is scheduled. The client unregisters (`204`). No attempt arrives for that `webhookId` after the in-flight grace, through the whole window in which the retry would have come.

**Non-conforming (§B).** The retry arrives, signed, after the `204`: openwop-app before #4083.

### Invariants (added to `SECURITY/invariants.yaml` at `Active`, 2026-09-25)

| id | tier | severity | threat model | test |
| --- | --- | --- | --- | --- |
| `webhook-delivery-isolation` | protocol | high | `SECURITY/threat-model-secret-leakage.md` §4.12 (starvation by registration; gap register G3) | `v2-webhook-delivery-isolation.test.ts` |
| `webhook-unregister-stops-delivery` | protocol | high | `SECURITY/threat-model-secret-leakage.md` §4.12 (signed run data to a withdrawn destination) | `v2-webhook-unregister-stops-delivery.test.ts` |

**Decision on TODO S3's question** ("a new invariant beside `webhook-cross-tenant-isolation`, or a §Durability clause?"): **both, for different reasons.** The normative text belongs in §Durability, because it is an obligation of the delivery surface, which RFC 0173 §B already made durable. The invariant rows exist because each failure crosses a trust boundary: §A across tenants, §B across the owner's withdrawal. The invariant catalogue is where the corpus records properties an attacker would target. Neither row was added at `Draft`, because a row without a runnable test would count against the unwitnessable ratchet for as long as this RFC was in comment. Both landed at `Active` with their scenarios, `witnessable-gated`.

## Compatibility

`additive` under `COMPATIBILITY.md` §4, "new normative requirement on a previously-undefined behavior". v1 and v2 `webhooks.md` are silent on both the ordering of attempts across subscriptions and what happens to pending attempts at unregister.

- No wire shape changes: no schema, OpenAPI operation, header, event, or error code.
- A host that already isolates (openwop-app after #4052 at up to 5 outstanding; MyndHyve not yet measured, gap register G1) keeps passing. The floor of 8 may be above openwop-app's current claim batch. See Risk R1.
- The obligation binds only hosts advertising `webhooks`. It lands at the v2 major, in the next suite minor, and adds nothing to v1.

## Conformance

**Existing coverage.** `v2-webhook-durable-delivery.test.ts` (retry, at-least-once, dead-letter), `webhook-tenant-isolation.test.ts` (confidentiality), `v2-webhook-egress-refusal.test.ts`. None creates contention between subscriptions, and none unregisters with a retry pending.

**New scenarios** (suite 2.40.0; both gated on `webhooks`, both built on `startScopedReceiver`, whose `respond` callback owns the response and can therefore hold one open). The Draft's shapes were revised by the architecture review before `Active`; the Draft text is in this file's history.

1. `v2-webhook-delivery-isolation.test.ts`, requirement `openwop.requirement.0215.no-head-of-line` (§A.1 and §A.2: one observation at the floor).
   - **Contention first.** 8 *held* subscriptions filter `run.started`; their receivers accept each attempt and never answer until the leg ends. One *healthy* subscription filters `run.completed` and answers `204`. One `conformance-delay` run of 2 s: `run.started` makes the 8 held attempts due at t0, `run.completed` makes the healthy one due at t0 + 2 s, when 8 are outstanding. The host's dispatch order cannot decide the row, so the Draft's "healthy attempt arrived first" `partial-witness` case no longer exists.
   - **Pass:** the healthy attempt arrives while all 8 held attempts are open.
   - **Fail:** the held attempts were still open when the run was terminal, and the healthy attempt arrived only once the host released one, or never within `RETRY_WAIT_FLOOR_MS`. A host that never opened 8 at once, and whose held attempts had not timed out by then, also fails: that is a bounded dispatcher below the floor.
   - **`partial-witness`:** the host's own delivery timeout closed held attempts before the run was terminal. The timeout is the host's to choose; a host whose timeout is shorter than 2 s is not measured by this instrument.
   - **`blocked`:** no attempt for any of the nine subscriptions arrived (`noDeliveryCause`).
   - Sabotage (v2 reference host, 2026-09-25): a sequential worker fails ("1 held attempt(s) arrived … the healthy attempt did not arrive within 20000ms"); a 5-slot pool fails ("5 held … the healthy attempt arrived 3053ms after it, with 3 held open"). Unsabotaged, it passes.
2. `v2-webhook-unregister-stops-delivery.test.ts`, requirement `openwop.requirement.0215.unregister-stops-delivery` (§B).
   - **Against a control.** Absence alone proves nothing: `webhooks.retryPolicy` carries no interval, so "no retry arrived" cannot distinguish a host that stopped from one whose next retry lies beyond the window. Two subscriptions on one receiver filter `run.completed`, and every attempt is answered `500`. The *target* is unregistered as soon as its first attempt has been answered. The *control* is left alone, and its retries are the ones the target's would have been.
   - **Pass:** the control is retried after the `204` + 5 s and the target is not.
   - **Fail:** an attempt for the target arrives after the `204` + 5 s.
   - **`partial-witness`:** neither is retried after that point within `retryWaitFor(policy, cap)`.
   - **`inapplicable`:** the host advertises `retryPolicy.maxAttempts: 1`.
   - Sabotage (v2 reference host, 2026-09-25): an attempt that falls back to a cached subscription after the delete fails ("target …: 5 attempt(s), 1 after the 204 + 5000ms; control …: 5 attempt(s), 1 after that point"). Unsabotaged, it passes.

A public front (`OPENWOP_WEBHOOK_RECEIVER_URL`) may time out a held request itself: a cloudflared tunnel does so at ~100 s. That is longer than the §A leg holds an attempt, so the front cannot be mistaken for the host abandoning the attempt. The scenario still records which side closed.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A.1 no head-of-line across subscriptions (`openwop.requirement.0215.no-head-of-line`) | the healthy attempt arrives while 8 held attempts stay open (`v2-webhook-delivery-isolation.test.ts`) | the suite (holds its own receivers open) | witnessable — gated (on `webhooks`); contention is established before the healthy delivery falls due |
| §A.2 floor of 8 (`openwop.requirement.0215.no-head-of-line`) | same leg, at exactly 8 held | the suite | witnessable — gated (on `webhooks`); one observation with §A.1, so one id |
| §A.3 cross-tenant fair share (SHOULD) | tenant B's delivery arrives while tenant A holds attempts open past its floor | the suite, with an operator-supplied `OPENWOP_TEST_TENANT_B_API_KEY` | witnessable — gated (on `webhooks` and the tenant-B key); a SHOULD, so no row is minted (gap register G4, decided): a row that cannot fail does not belong in a certification bundle |
| §B no attempt after `204` (`openwop.requirement.0215.unregister-stops-delivery`) | an attempt for the unregistered `webhookId` arrives > 5 s after `204`, while a control subscription on the same run is still retried (`v2-webhook-unregister-stops-delivery.test.ts`) | the suite (fails every attempt, then unregisters) | witnessable — gated (on `webhooks`); no control retry in the window ⇒ `partial-witness` |

## Alternatives considered

1. **Do nothing.** The reference host fixed both defects on its own, so why legislate? Because the corpus would still certify the pre-fix host. openwop-app's defect was found only because it hid three `blocked` rows during a certification cut. A second host with the same sequential loop and no such luck certifies clean. "Durable" in §Durability would keep meaning *eventually delivered, after any amount of other subscribers' failure*.
2. **A latency bound instead of an isolation rule** ("the first attempt MUST start within N s of the event"). It is simpler to state, but it is the wrong property. It convicts a host that is merely busy and acquits one whose queue is idle today. It also puts a number on the wire that every host would have to meet under any load. Isolation is what failed, so isolation is what is stated. A latency SLO is gap register G2.
3. **§A as a SHOULD.** A SHOULD cannot fail a row, and the whole motivation is a host that passed every row while starving its subscribers. A SHOULD is right for the cross-tenant fairness mechanism (§A.3) and wrong for head-of-line blocking (§A.1).
4. **Dead-letter pending attempts at unregister instead of dropping them (§B).** Rejected in §B: the sink is read per `webhookId`, and whether that read survives an unregister is unstated (G5). Writing records into a sink that may be unreadable is worse than a stated drop.
5. **An advertised concurrency facet** (`webhooks.maxOutstanding`) instead of a fixed floor. It would let each host state its own bound. But an advertised bound of 1 would make a sequential host conforming, which re-admits the defect. A floor with no field is stricter and needs no schema change. §Resolved questions 1 decided the number.

## Resolved questions

Decided at `Active` by the architecture review of 2026-09-25, in place of the comment window the steward waived.

1. **Is 8 the right floor? Yes.** Nothing published contradicts or derives a number (§Prior art), and every described isolation mechanism meets any floor. 8 exceeds the one measured claim batch (openwop-app, 5), costs the suite nine concurrent connections through a tunnel, and both deployed hosts can meet it: MyndHyve dispatches one task per `(subscription, event)` with no module-level serialization, and openwop-app is replacing its batch barrier with a lane per subscription.
2. **Should §B also cover a subscription whose `url` is later rejected by §Egress? No.** It stays a delivery failure retried under the policy. A Standard Webhooks-style `410 Gone` rule would change what a delivery *response* means and needs its own RFC.
3. **Should the §B grace be 5 s? The spec states no number.** The normative text allows "an attempt whose request the host had begun sending before the `204`", and the receiver keys on arrival, so the grace covers transit of a request already on the wire. 5 s is the scenario's instrument setting, like `RETRY_WAIT_FLOOR_MS`, and can change in a suite patch.
4. **Should the corpus ever bound first-attempt latency? Not here.** §A is an isolation rule, not an SLO (Alternative 2, gap register G2).

## Implementation notes (non-normative)

- openwop-app: #4052 (concurrent claimed batch, bounded by `CLAIM_BATCH`) and #4083 (atomic pending-row drop on delete) are the two fixes. With `CLAIM_BATCH = 5`, §A.2 at 8 likely needs either a larger batch or a claim that skips subscriptions with an attempt already outstanding. Risk R1 records this as expected, not measured.
- A design that meets §A for any number of dead receivers: each subscription's attempts are serialized in its own lane, and lanes share nothing but the socket pool. A concurrent pool bounded at ≥ 8 meets the floor but not the SHOULD in §A.2, because one tenant can fill it.
- Sequencing: spec text, scenarios and invariant rows together at `Active` (suite 2.40.0); `Accepted` on certified bundles from two hosts, at least one of them deployed, each carrying both rows `executed-pass`.

## Acceptance criteria

- [x] `Active` — 2026-09-25, by steward override of RFC 0147 §A.6. The window was waived, not run (see `Updated`).
- [x] Spec text merged (`webhooks.md` §Durability, §Surfaces).
- [x] Schema / OpenAPI / AsyncAPI updated where applicable — **none applicable**: no wire change.
- [x] `v2-webhook-delivery-isolation.test.ts` and `v2-webhook-unregister-stops-delivery.test.ts` in the suite, sabotage-proved against a sequential worker, a 5-slot pool, and a delete that leaves pending attempts live.
- [x] `SECURITY/invariants.yaml` rows `webhook-delivery-isolation` and `webhook-unregister-stops-delivery`.
- [x] CHANGELOG entry under the suite minor that ships the scenarios (2.40.0).
- [x] RFC 0156 §B retrospective row for this override exists (`not-reviewed`) — `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row 0215.
- [x] Certified bundles from two hosts, at least one of them deployed, record `openwop.requirement.0215.no-head-of-line` and `openwop.requirement.0215.unregister-stops-delivery` `executed-pass` (candidates: openwop-app, MyndHyve per G1, the v2 reference host). Amended at `Active` from "openwop-app; MyndHyve": MyndHyve's production deploys are gated on its own operator, and GOVERNANCE's evidence tiers already admit the reference host as a witness. **Met 2026-09-26:** MyndHyve's certified production cut on 2.40.0 (openwop#1595, tier-2, deployed) and the v2 reference host's certified public cut on 2.40.0 (openwop#1587, tier-1).

## Prior art

Surveyed 2026-09-25 (gap register G6), from each system's own documentation.

| System | Isolation between endpoints (§A) | Deleting an endpoint (§B) |
| --- | --- | --- |
| [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) (the scheme RFC 0201 adopts) | Silent. It recommends a 15–30 s request timeout and a multi-day exponential retry schedule with jitter, but says nothing about one endpoint's attempts delaying another's. | Silent on pending attempts. A `410 Gone` response means the sender "should disable the webhook endpoint, and stop sending it messages". |
| [Stripe](https://docs.stripe.com/webhooks) | Not stated. | "If your destination has been disabled or deleted when we attempt a retry, we prevent future retries of that event." The event is dropped, not dead-lettered. |
| [Svix](https://docs.svix.com/retries) | Stated as a design principle ([fan-out](https://www.svix.com/resources/glossary/webhook-fanout/)): "one queued work item per endpoint per event, rather than a worker iterating over subscribers", so "one slow or broken subscriber cannot hold up the rest", with "per-endpoint concurrency and rate limits, so one customer's burst cannot starve another's". No number. | "If an endpoint is removed or disabled delivery attempts to the endpoint will be disabled as well." |
| [Convoy](https://www.getconvoy.io/blog/circuit-breaker-in-golang) | Names the failure: "zombie endpoints … clog up your queues, create back pressure, and delay event delivery to legitimate webhook endpoints". Its control is a per-endpoint circuit breaker with configurable thresholds. No fixed number. | Not surveyed. |
| [Hookdeck](https://hookdeck.com/docs/delivery-groups) | Per-tenant sub-queues within one destination ("delivery groups"), rotated so that a burst from one group "does not delay the others". "Idle groups do not reserve capacity." That is the shape of §A.3's fair-share SHOULD. | Not surveyed. |
| [Shopify](https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks) | Not stated. 5 s response timeout. | Removes a subscription after persistent failure. "Removed webhook subscriptions won't receive any deliveries unless you create them again." Silent on attempts already queued. |

**What the survey changes.**
- **§B is established practice.** Both hosted senders that document the case (Stripe, Svix) stop pending retries when an endpoint is deleted. Stripe drops the undelivered events rather than dead-lettering them, which is the choice §B makes (Alternative 4). §B stays as written.
- **§A is established design, not established contract.** Every service that describes its isolation describes a mechanism. None publishes a guarantee a subscriber could test, and none gives a number. So nothing here contradicts 8, and nothing derives it (§Resolved questions 1). The survey supports the lane design in §Implementation notes, which Svix describes almost word for word, and it supports keeping §A a head-of-line rule rather than a latency bound (Alternative 2). No surveyed service promises a first-attempt latency either.
- **Hookdeck's delivery groups are a working instance of §A.3**, which shows that the fair-share SHOULD has a known implementation.

## References

- openwop-app `docs/steward/TODO.md` `WHD-1` (#4052), `WHD-3`, `WHD-16` (#4083), at `020867cbb`.
- openwop `TODO.md` §S3 (steward follow-ups from the 2026-09-19 gap-closure program).
- `spec/v2/core/webhooks.md` §Surfaces, §Durability; `spec/v1/webhooks.md` §Unregister.
- RFC 0093 (webhook delivery hardening; `webhook-cross-tenant-isolation`), RFC 0173 §B (durable delivery binds with the surface), RFC 0188 (delivery dead-letter read route).
- Prior art: §Prior art (surveyed 2026-09-25; gap register G6).
- RFC 0147 §A.6 (the window this RFC's `Active` overrides); RFC 0156 §B (the review owed); RFC 0194 (override precedent).
