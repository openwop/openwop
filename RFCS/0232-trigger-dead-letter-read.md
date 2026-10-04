# RFC 0232: a trigger subscription's dead-lettered deliveries are readable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0232                                                            |
| **Title**         | a trigger subscription's dead-lettered deliveries are readable  |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-03                                                      |
| **Updated**       | 2026-10-04 — `Active` → `Accepted` (provisional; the RFC 0156 §B review is owed), under the maintainer's 2026-10-03 directive to close the program without HITL. **Evidence tier: tier-1 — steward-verified: openwop-app, the steward-operated production host at `app.openwop.dev`.** Evidence: openwop-app's certified production major-2 bundle on suite 2.45.12 (build `983976bbc`, strict mode, no seams), which records the §E rows `executed-pass`; checked into `evidence/v2-host-bundles/`. · 2026-10-03 — `Draft` → `Active`, comment window waived by STEWARD OVERRIDE of RFC 0147 §A.6 (MAINTAINERS.md). The maintainer decided the five questions (§Decisions): leg 4 splits into two ids, both in the floor, the state-change id `inapplicable` without a seam; a run-less transition is *recorded*, and the read is where a dead-lettered attempt is visible. The facet, the read (v1 and v2), the page schema, the §D prose, leg 4a's normative-surface path and the §B rows land with it. · 2026-10-03 — §C.2 reworded: `attempt` carries the fields of the `trigger.delivery.attempted` payload, not "the payload exactly as emitted", because a host may emit no event for a run-less attempt (openwop-app does not, in production). Unresolved question 4 added on where a run-less event goes. Gap G4 answered for openwop-app. · 2026-10-03 — filed `Draft` at the maintainer's direction (2026-10-02: "New RFC: a dead-letter read for triggers"), to give RFC 0230's last acceptance box a production path. The 7-day comment window opens with the pull request and closes 2026-10-10. |
| **Affects**       | a new optional read `GET /v1/trigger-subscriptions/{subscriptionId}/dead-letters` (v1 `api/openapi.yaml`, derived into `api/v2/openapi.yaml`) and its page schema · a new optional facet `triggerBridge.deadLetter` (the v1 seed of `schemas/capabilities.schema.json`, carried into v2) · `spec/v1/trigger-bridge.md` §B and §C, `spec/v2/core/webhooks.md` §Inbound triggers · `trigger-bridge-delivery.test.ts` leg 4 (a normative-surface path) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2): one optional endpoint behind one optional facet. A host that does not advertise the facet is bound exactly as today. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A trigger delivery that is dead-lettered starts no run, so the `trigger.delivery.attempted` event that records it is on no run's log. Nothing on the wire can read it: the suite reads it only through a host's test seams. This RFC adds an optional read, `GET /v1/trigger-subscriptions/{subscriptionId}/dead-letters`, behind a facet `triggerBridge.deadLetter`, that lists a subscription's dead-lettered deliveries, each with the fields of its `trigger.delivery.attempted` payload. It mirrors the webhook dead-letter read RFC 0188 added for outbound deliveries. With it, a production host that serves no test seams can witness that its run-less delivery events carry no inbound content, which is the leg RFC 0230 cannot close on production today.

## Motivation

**RFC 0230 cannot be accepted on a production host.** Its last acceptance box needs a host to pass the `openwop-trigger-bridge` path in strict mode on a certified production cut. openwop-app serves the RFC 0230 ingest and, on suite 2.45.9 with no test seam, passes legs 1–3 of `trigger-bridge-delivery` on the signed path (its session's report, 2026-10-02). Leg 4, `openwop.requirement.0083.trigger-delivery.runless-content-free`, fails: it reads the run-less events through the event-log seam, and RFC 0230 §Conformance says it stays seam-witnessed. The production host serves no seams, on purpose, and turning them on for a certification run is a security change nobody has approved. A failed floor row leaves the profile uncertified, and an uncertified bundle is not acceptance evidence (RFC 0174 §B.1). So no production cut of any host can satisfy RFC 0230 as written.

**The events are observable in principle and unreadable in fact.** A dead-lettered delivery is something the suite can cause on production: RFC 0230's leg 2 posts a badly signed event to a `required` subscription, and `trigger-bridge.md` §F.2 says the host records that delivery as `trigger.delivery.attempted{outcome: "dead-lettered"}`. The event exists. It is on no run's log, `/host/events` carries only heartbeat messages, and no endpoint lists it.

**The v1 text routes these deliveries to a sink that has no read for them.** `trigger-bridge.md` §B says a dead-lettered subscription's deliveries go to "the RFC 0053 sink". RFC 0053's sink is the run sink: it holds failed runs for forking. A trigger delivery that was dead-lettered never became a run. RFC 0188 found and fixed the same mis-routing for outbound webhook deliveries, which now have a sink and a read of their own (`webhooks.md` §Dead letters).

**Operators need the read anyway.** A sender whose posts are refused, or whose deliveries exhaust their retries, has no way to see that from the host today short of logs. The webhook read exists for the same reason.

## Proposal

### §A. The facet

`triggerBridge` gains one optional member, shaped as `webhooks.deadLetter` is:

```json
"triggerBridge": {
  "deadLetter": { "retentionDays": 7, "maxPageSize": 100 }
}
```

- `retentionDays` (integer, at least 1): how long a dead-lettered delivery stays readable.
- `maxPageSize` (integer, 1–1000): the ceiling the host clamps `limit` to.
- A host advertises the facet only if it serves §B.

### §B. The read

`GET /v1/trigger-subscriptions/{subscriptionId}/dead-letters` (`listTriggerDeadLetters`), derived into v2 as `GET /trigger-subscriptions/{subscriptionId}/dead-letters`.

1. A host advertising `triggerBridge.deadLetter` MUST serve it. A host that does not advertise the facet answers `404 not_found`.
2. Scope: `webhooks:manage`, the scope that creates a trigger subscription. The subscription is tenant-bound (`identity.md` §5). At major 1, with bare ids, another tenant's id and an id the host never minted answer `404 not_found` alike. At major 2 the id names its tenant, so `identity.md` §5 governs: another tenant's id is refused `403 id_tenant_mismatch` and discloses nothing (found by openwop-app, 2026-10-03, before the v2 witness shipped).
3. Paging: `limit` (clamped to `maxPageSize`) and an opaque `cursor`. A cursor minted for another subscription MUST be refused `400 validation_error`.
4. The page lists the subscription's dead-lettered deliveries, newest first, for `retentionDays`.

### §C. The record

Each record names one dead-lettered delivery:

| Field | Type | Meaning |
| --- | --- | --- |
| `subscriptionId` | id | equals the path segment |
| `attemptEventId` | event id | the id of the dead-lettered `trigger.delivery.attempted` event |
| `attempt` | object | the dead-lettered attempt, shaped as the `trigger.delivery.attempted` payload (`run-event-payloads.schema.json#triggerDeliveryAttempted`), `outcome: "dead-lettered"` |
| `stateChange` | object, optional | the `trigger.subscription.state.changed` payload this dead-lettering caused, when it caused one |
| `reason` | enum | `verification_failed` or `retries_exhausted` |
| `deadLetteredAt` | date-time | when the host routed the delivery to the sink |
| `expiresAt` | date-time | when the record ages out; `expiresAt − deadLetteredAt` matches `retentionDays` |

1. **Content-free.** A record MUST NOT carry the inbound body, the inbound headers, the signature, the signing secret or any credential. `attempt` and `stateChange` are the events' own payloads, which `trigger-bridge.md` §C already requires to be content-free.
2. **The same fields.** `attempt` carries the fields the host would put in the `trigger.delivery.attempted` event for this delivery, and no others. Where the host also emits that event somewhere a reader can see it (a test seam), the two MUST agree.
3. **A refused post is a dead-lettered delivery.** A delivery refused by a `required` verification check (§F.2) appears with `reason: "verification_failed"` and no `stateChange`, because a refused event MUST NOT change the subscription's state.

### §D. Prose

- **`trigger-bridge.md` §B**: a dead-lettered subscription's deliveries go to the subscription's own delivery sink (§B of this RFC), not the RFC 0053 run sink. The `dead-lettered` row of the states table is corrected to say so.
- **`trigger-bridge.md` §C**: one paragraph stating §B and §C of this RFC for a host that advertises the facet.
- **`spec/v2/core/webhooks.md` §Inbound triggers**: the `dead-lettered` state no longer points at the run sink; one sentence states question 4's decision; a short list states the read's rules.
- **Both:** for a run-less transition, "emit" means the host keeps a content-free record (question 4). The schema descriptions that routed a dead-lettered trigger delivery to the RFC 0053 sink (`run-event-payloads`, `trigger-subscription`, v1 and v2) are corrected with the prose.

### §E. Conformance

Leg 4 of `trigger-bridge-delivery.test.ts` gains a normative-surface path, run whenever the host advertises both `inboundSigning` and `triggerBridge.deadLetter`, and alongside the seam path where both are offered (as legs 1–3 do since 2.45.8):

1. Register a `required` webhook subscription and post a body carrying a canary with a bad signature: `401 signature_invalid`.
2. Read the subscription's dead letters. A record for that delivery is present, with `reason: "verification_failed"` and no `stateChange`.
3. The canary, the signature and the signing secret appear nowhere in the record.
4. `attempt` validates against `triggerDeliveryAttempted` with `outcome: "dead-lettered"`.

Server-free: the page schema and the facet validate in `spec-corpus-validity`. The paging, tenant and cursor rules of §B join the leg as their own requirement ids, gated on the facet.

**What the read cannot witness on production.** The suite cannot cause a subscription state change on a production host: a refused post must not change state, retry exhaustion needs a delivery the host fails repeatedly, and no wire surface pauses a subscription. So the `trigger.subscription.state.changed` half of leg 4 still has only the seam.

**How leg 4 is scored (decided, question 1 (a)).** Leg 4 is two requirement ids, both in the `openwop-trigger-bridge` floor:

- `openwop.requirement.0083.trigger-delivery.runless-attempt-content-free` runs the seam path where the seam is served and the steps above where the host advertises `inboundSigning` and `triggerBridge.deadLetter`, and both where both are offered. With neither, it records `blocked`, as before.
- `openwop.requirement.0083.trigger-delivery.runless-state-change-content-free` runs only on the seam. Without it the row records `inapplicable`, with the reason that no wire surface causes a state change (gap G2). At major 2 the payload schema is closed with an enum `reason`, so a schema-valid event cannot carry content.

The §B rules are `trigger-dead-letter-read.test.ts`, outside the floor: `openwop.requirement.0232.trigger-dead-letters.paging`, `.cursor-bound` and `.tenant-bound`, each `inapplicable` where the facet or `inboundSigning` is not advertised. The tenant row needs a second tenant's credential (`OPENWOP_TEST_TENANT_B_API_KEY`) and records `blocked` without one.

The judge (`conformance/src/lib/trigger-dead-letter-witness.ts`) is pure. Its unit tests turn on each defect in an otherwise conforming page: a record carrying the canary, the signature or the signing key; a page missing the refused delivery; an `attempt` that does not validate; a `stateChange` on a refused post; and an `expiresAt` that does not match `retentionDays`. No host serves the read yet, so no live sabotage proof exists (gap G3).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.1 a host advertising the facet serves the read — `openwop.requirement.0232.trigger-dead-letters.paging` | `200` and a schema-valid page | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §B.2 another tenant's id is refused (`404` at major 1, `403 id_tenant_mismatch` at major 2) — `openwop.requirement.0232.trigger-dead-letters.tenant-bound` | status and envelope | the suite, with a second tenant's credential | witnessable — executed-pass required on a host bundle |
| §B.3 a cursor from another subscription is refused — `openwop.requirement.0232.trigger-dead-letters.cursor-bound` | `400 validation_error` | the suite, with two subscriptions | witnessable — executed-pass required on a host bundle |
| §C.1 a record carries no inbound content — `openwop.requirement.0083.trigger-delivery.runless-attempt-content-free` | the record, against the canary the suite posted | the suite, by posting a badly signed event | witnessable — executed-pass required on a host bundle |
| §C.2 `attempt` agrees with the emitted event | equality with the seam's copy of the event | the suite, only where the seam is also served | witnessable — seam-gated (the event-log seam) |
| §C.3 a refused post appears, without a state change — `openwop.requirement.0083.trigger-delivery.runless-attempt-content-free` | the record's `reason` and absent `stateChange` | the suite, by posting a badly signed event | witnessable — executed-pass required on a host bundle |
| §C `stateChange` is content-free | a record carrying `stateChange` | nobody, on a host without seams | unwitnessable — no wire surface causes a subscription state change (G2) |
| §C `expiresAt − deadLetteredAt` matches `retentionDays` — `openwop.requirement.0083.trigger-delivery.runless-attempt-content-free` | the record | the suite, on any record | witnessable — executed-pass required on a host bundle |

## Compatibility

`additive`.

- One new optional facet and one new optional endpoint behind it.
- No existing field, event, endpoint or error code changes. `trigger.delivery.attempted` and `trigger.subscription.state.changed` keep their shapes; the record carries their payloads unchanged.
- §D's correction of `trigger-bridge.md` §B changes where the text says dead-lettered trigger deliveries go. No host is known to route them to the RFC 0053 run sink, which holds runs, and a delivery that was dead-lettered has no run to hold. A reviewer who reads the correction as a behaviour change should say so in the window.

## Alternatives considered

1. **Do nothing; accept RFC 0230 on a seams-on cut of a non-production deployment.** Fastest. It contradicts the reason RFC 0230 exists, which is evidence from production. Rejected by the maintainer (2026-10-02).
2. **Let the acceptance predicate count a profile whose only failure is a seam-only row.** It weakens a gate this corpus has tightened several times (RFC 0174). Rejected by the maintainer (2026-10-02).
3. **A run-less event stream for trigger subscriptions** (`GET /trigger-subscriptions/{id}/events`, every run-less event). It covers state changes too, but the suite still cannot cause one on production, so it buys no extra witness and costs a second stream surface. Rejected (§Decisions 2).
4. **Put the events on `/host/events`.** That channel is heartbeat-only by `events.md`, and a host-wide stream would mix tenants' subscriptions on one channel.
5. **A pause and resume endpoint** would let the suite cause a state change. It is a real operator surface with its own authorization questions, and belongs in its own RFC (§Decisions 3).

## Decisions

The maintainer decided all five questions on 2026-10-03. None remain open.

1. **How is leg 4 scored where only the read is available?** (a): split into two ids, both in the floor. The state-change id records `inapplicable` on a host without the seam, because no party can cause the condition there (§E). (b) would have narrowed the floor, which RFC 0230 said it would not. (c) would have left RFC 0230 waiting on a surface nobody has proposed.
2. **A general run-less event stream instead of a list?** No. The suite cannot cause a state change on production either way, so a stream buys no extra witness and costs a second stream surface (Alternative 3).
3. **Pause and resume for trigger subscriptions?** Out of scope. It belongs in its own RFC, with its own authorization questions. That RFC would close gap G2.
4. **Where does a run-less event go?** It is recorded. For a run-less transition (a dead-lettered attempt, a state change), "emit" in `trigger-bridge.md` §C and `webhooks.md` §Inbound triggers means the host keeps a content-free record of that payload; a host advertising `triggerBridge.deadLetter` makes a dead-lettered attempt visible through this read. openwop-app's content-free row, with no event emitted in production, conforms. The prose says so (§D).
5. **Should `reason` add `backpressure` or `source-removed`?** Not now. Neither cause dead-letters a delivery on any known host. A later revision can add a value additively.

## Implementation notes (non-normative)

- **openwop-app** is the host that needs this for RFC 0230. Its session reports, from source (2026-10-03): dead-lettered and refused deliveries are already content-free rows in one host collection, so no new redaction is needed. The work is a by-subscription index (the read is a full scan today), a small history row for the state change, and retention for the collection (none today). Its estimate: one ADR, a day or two. No delivery reaches the RFC 0053 run sink there, which matches §D's correction.
- **The v2 reference host** does not advertise `triggerBridge`, so it is untouched.
- **Sequencing.** Spec, schema and facet at `Active`; the leg-4 path with its sabotage proof in the same suite release; openwop-app serves the read; then the production cut that RFC 0230 waits on.

## Acceptance criteria

- [x] `Active`: Unresolved question 1 is decided. The window was waived by STEWARD OVERRIDE of RFC 0147 §A.6 on 2026-10-03, and the RFC 0156 §B review is owed.
- [x] The facet is in the v1 seed and carried into v2; the read is in `api/openapi.yaml` and derived into `api/v2/openapi.yaml`; the page schema validates in `spec-corpus-validity`; the prose of §D is merged; `CHANGELOG.md` records it.
- [x] Leg 4's normative-surface path ships, each row failing on its sabotage (proven against the pure judge; a live proof waits for a host that serves the read, G3): a record carrying the canary, a record missing the refused delivery, an `attempt` that does not validate, a record carrying a `stateChange` for a refused post.
- [x] `Accepted` (provisional; the RFC 0156 §B review is owed): a host advertising `triggerBridge.deadLetter` records the §E rows `executed-pass` on a certified production bundle with no test seams served. *(openwop-app's certified production major-2 bundle (build `983976bbc`, suite 2.45.12, sha256 `6908ebc7d168…`, signed `openwop-app-bundle-2`, strict mode, no test seams served; `evidence/v2-host-bundles/openwop-workflow-engine.json`): `openwop.requirement.0083.trigger-delivery.runless-attempt-content-free` through the read, and `openwop.requirement.0232.trigger-dead-letters.{paging,cursor-bound,tenant-bound}`; `runless-state-change-content-free` is `inapplicable` with its G2 reason.)*

## References

- RFC 0230 (inbound webhook ingest contract), its §Conformance and last acceptance box; RFC 0083 (trigger bridge); RFC 0099 (external-event ingestion); RFC 0188 (webhook dead-letter read); RFC 0053 (run dead-letter sink); RFC 0174 §B.1 (acceptance evidence).
- `spec/v1/trigger-bridge.md` §B, §C, §F.2; `spec/v2/core/webhooks.md` §Dead letters and §Inbound triggers.
- `conformance/src/scenarios/trigger-bridge-delivery.test.ts` leg 4.
- openwop-app's 2.45.9 seam-free run (its session's report, 2026-10-02): legs 1–3 pass on the signed path, leg 4 fails without the seam.
- Registers: [`gaps`](./registers/0232-trigger-dead-letter-read.gaps.md), [`risks`](./registers/0232-trigger-dead-letter-read.risks.md).
