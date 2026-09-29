# RFC 0225: a webhook host may advertise how long a delivery can keep retrying

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0225                                                            |
| **Title**         | a webhook host may advertise how long a delivery can keep retrying |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-29 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (steward override of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-2 — MyndHyve's certified production cut on suite 2.44.3 (myndhyve#563, `1546ed30`; corpus copy `evidence/v2-host-bundles/myndhyve.json`; api.myndhyve.ai revision `00825-dep`, build `commit:a1755368`; 271 pass / 0 fail / 0 blocked, both claimed profiles certified, no relaxations, witness `58da9407e616`, signed `myndhyve-bundle-2026-09b` and VERIFIED under the key the host serves; `retryPolicy.maxElapsedMs` 600000 advertised, no wait override). `0173.webhook-durable-delivery.dead-letter` records `observed: advertised-bound (maxElapsedMs 600000): waited ≤630000ms; 5 attempt(s), last attempt after 224981ms, sink after 226481ms`, and `0188.dead-letter-content-free` records the same path with the last attempt after 226961ms. So the wait came from the advertised bound, and the dead-letter arrived after about 225 s, past the old 210 s default window, where a pass could not have come from the pre-RFC wait. The detail is signed with the row (suite 2.44.3, openwop #1787). Single witness. · 2026-09-28 — **`Draft → Active`. Comment window waived** by the steward (steward direction 2026-09-28; 7-day window, 0 days elapsed, not run). **STEWARD OVERRIDE of RFC 0147 §A.6**, which forbids a bootstrap waiver from shortening the window for RFCs affecting certification, external effects and replay: §D changes the verdict of a certification row (`0173.webhook-durable-delivery.dead-letter` goes `blocked → executed-fail` past an advertised bound), §B bounds when an outbound webhook delivery (an external effect) is dead-lettered, and §C edits `webhooks.md` §Replay. Logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". The evidence gate is not waived, and the RFC 0156 §B retrospective review is owed. The suite change ships in 2.44.0. · 2026-09-28 — filed `Draft`; the 7-day comment window for a normative addition opens with the pull request and closes 2026-10-05. The window is **not** waived. |
| **Affects**       | `spec/v2/facets/webhooks.schema.json` (`retryPolicy.maxElapsedMs`, optional; `schemas/v2/capabilities.schema.json` regenerated) · `spec/v2/core/webhooks.md` §Delivery (one bullet), §Surfaces (the facet sentence), §Replay (restated by reference) · conformance: `lib/webhook-retry-window.ts`, `v2-webhook-durable-delivery.test.ts` (the dead-letter row `openwop.requirement.0173.webhook-durable-delivery.dead-letter` can now convict) |
| **Compatibility** | `additive` — one OPTIONAL facet member and an obligation that binds only a host that advertises it (`COMPATIBILITY.md` §2.4, §4). The v1 carrier `triggerBridge.retryPolicy` is untouched |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`webhooks.retryPolicy` advertises `maxAttempts` and a backoff shape, but nothing about time. Neither a subscriber nor the suite can tell how long a failing delivery may keep retrying before it reaches the dead-letter sink. This RFC adds an optional `retryPolicy.maxElapsedMs`: the longest, in ms, from a delivery's first attempt starting to its routing to the dead-letter sink when every attempt fails. A host that advertises it MUST dead-letter an exhausted delivery within that bound. The suite then waits for the host's own bound instead of a deadline it chose.

## Motivation

- **Certification needed out-of-band knowledge.** MyndHyve's certified 2.43.0 cut first came back 258 pass / 2 fail / 2 blocked (myndhyve#541). The two dead-letter rows were `blocked` because the suite's 90 s default wait is shorter than that host's real ~450 s schedule (15, 30, 60 and 120 s, repeating). Setting `OPENWOP_WEBHOOK_RETRY_WAIT_MS=540000` fixed it (262 / 0 / 0), but a certifier has to know the value from outside the host's discovery document (openwop #1736).
- **The suite cannot convict honestly either.** `lib/webhook-retry-window.ts` records three windows that each convicted a durable host (20 s, then 90 s). Because the schedule is not on the wire, the suite records `blocked` when a window closes before exhaustion. That is honest, but it means a host that stopped retrying is never failed.
- **Subscribers cannot plan.** A subscriber cannot tell how long a delivery may still arrive after an outage, or when to look in the dead-letter sink.

Measured schedules: MyndHyve repeats 15/30/60/120 s, about 450 s in total, so it would advertise about 540000. openwop-app uses 2 s × 2ⁿ capped at 5 min. The v2 reference host uses `maxAttempts` 5 with a configurable base.

## Proposal

### §A. The facet member

`spec/v2/facets/webhooks.schema.json` `retryPolicy` gains an OPTIONAL `maxElapsedMs` (integer ≥ 1): "the longest, in ms, from a delivery's first attempt starting to its routing to the dead-letter sink when every attempt fails". `schemas/v2/capabilities.schema.json` is regenerated from it. `retryPolicy` stays `additionalProperties: false`, and `maxAttempts` and `backoff` stay required.

### §B. The obligation (`spec/v2/core/webhooks.md` §Delivery)

> - retry a failed attempt per its advertised `retryPolicy` (`maxAttempts`, `backoff ∈ none | fixed | exponential`, optional `maxElapsedMs`) with backoff between attempts, and when it advertises `maxElapsedMs`, dead-letter an exhausted delivery within that many milliseconds of the first attempt's start;

- **Why a total, not the intervals.** The intervals are an implementation schedule, and hosts use jitter, caps and per-status rules. The total is the one number a subscriber and a certifier both need, and it is falsifiable from outside.
- **Why optional.** A host that cannot bound its schedule should not have to invent a number. Such a host is measured as today.
- **Why "within".** A host may dead-letter earlier, for example when a permanent `4xx` stops retries. The bound is a ceiling.

### §C. Two word-neutral edits in the same document

- §Surfaces said the facet "is `{ signatureAlgorithms[] }`", which was stale: the facet also carries `retryPolicy`, `deadLetter` and `secretRotation`. It now says the facet "carries `signatureAlgorithms[]`".
- §Replay restated a rule `replay.md` §Suppression owns ("MUST NOT deliver events a replay re-emits as fixed history; replay-ness is read from the run"). It now points there: "A `replay` fork's re-emitted history is never delivered ([replay.md](../spec/v2/core/replay.md) §Suppression); a `branch` fork's events are." This offsets §B's words under the RFC 0190 kernel budget (30,591 / 30,600 at merge, after RFC 0226). The rule itself is unchanged and stays in `replay.md`.

### §D. The suite

- `retryWaitFor` uses the advertised `maxElapsedMs` plus a 30 s grace, clamped to the 1 h maximum. `OPENWOP_WEBHOOK_RETRY_WAIT_MS` can still only raise it.
- A row convicts only past an advertised bound. In the dead-letter leg of `v2-webhook-durable-delivery` (row `openwop.requirement.0173.webhook-durable-delivery.dead-letter`), a window that closes past `maxElapsedMs` plus the grace, with the delivery not in the sink, is `executed-fail`. Without the member it stays `blocked`, as today. The conviction lands on the existing dead-letter row rather than a new one, because it is the same observation (an exhausted delivery absent from the sink), now with a bound the host stated. One `it` carries one requirement id.

## Compatibility

`additive`. A consumer that ignores the member is unaffected, and a host that does not advertise it is measured exactly as before. A host that advertises it takes on the §B obligation for its own bound. No request, response, event or error shape changes, and the v1 carrier `triggerBridge.retryPolicy` is not touched.

## Conformance

`v2-webhook-durable-delivery.test.ts`, dead-letter leg, row `openwop.requirement.0173.webhook-durable-delivery.dead-letter`: with an advertised `maxElapsedMs` and the `deadLetter` facet, an empty sink past the bound plus the grace is `executed-fail` instead of `blocked`. `lib/webhook-retry-window.test.ts` covers the wait arithmetic, the malformed-value case, and the "convict only past the bound" rule.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B an exhausted delivery is dead-lettered within an advertised `maxElapsedMs` (`openwop.requirement.0173.webhook-durable-delivery.dead-letter`, convicting past the bound) | the delivery's record in `GET /webhooks/{webhookId}/dead-letters` after the bound plus the grace | the suite, with a receiver that answers `500` to every attempt | witnessable — gated |

## Alternatives considered

1. **Advertise the intervals** (`baseMs`, `factor`, `capMs`). This is richer, but hosts with jitter or per-status rules cannot state it truthfully, and it still leaves the suite summing a schedule. The total is what everyone needs.
2. **Keep the operator variable only.** This is the status quo that needed out-of-band knowledge (#1736).
3. **Make it REQUIRED.** That would refuse every existing advertisement, which is a major change.

## Unresolved questions

None.

## Implementation notes (non-normative)

- MyndHyve: advertise about `540000`.
- openwop-app: advertise the sum of its capped schedule for its `maxAttempts`.
- v2 reference host: advertise from its configured base and `maxAttempts`.

## Acceptance criteria

- [x] `Active` (2026-09-28): window waived by steward override (see Updated); the facet member, the `webhooks.md` text and the suite row land together (suite 2.44.0).
- [x] `openwop.requirement.0173.webhook-durable-delivery.dead-letter` `executed-pass` on a committed certified bundle of a host that advertises `maxElapsedMs`: MyndHyve's certified production cut on suite 2.44.3 (myndhyve#563, `1546ed30`; corpus copy `evidence/v2-host-bundles/myndhyve.json`; api.myndhyve.ai revision `00825-dep`, build `commit:a1755368`; 271 pass / 0 fail / 0 blocked, both claimed profiles certified, no relaxations, witness `58da9407e616`, signed `myndhyve-bundle-2026-09b` and VERIFIED under the key the host serves; `retryPolicy.maxElapsedMs` 600000 advertised, no wait override). `0173.webhook-durable-delivery.dead-letter` records `observed: advertised-bound (maxElapsedMs 600000): waited ≤630000ms; 5 attempt(s), last attempt after 224981ms, sink after 226481ms`, and `0188.dead-letter-content-free` records the same path with the last attempt after 226961ms. So the wait came from the advertised bound, and the dead-letter arrived after about 225 s, past the old 210 s default window, where a pass could not have come from the pre-RFC wait. The detail is signed with the row (suite 2.44.3, openwop #1787).

## References

- openwop #1736; myndhyve#541.
- `spec/v2/core/webhooks.md` §Delivery; `conformance/src/lib/webhook-retry-window.ts`.
- RFC 0173 §B (durable delivery), RFC 0188 (the dead-letter read).
