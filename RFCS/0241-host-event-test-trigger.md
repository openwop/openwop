# RFC 0241: a host event can be triggered on demand for test

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0241                                                            |
| **Title**         | a host event can be triggered on demand for test                |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-07                                                      |
| **Updated**       | 2026-10-08 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (STEWARD OVERRIDE of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host: its certified public cut with the seams profile OFF on published suite 2.45.28 (`evidence/v2-host-bundles/openwop-host-v2-reference-2.45.28-seams-off.json`; build `commit:bb7c5930`, witness `1c3cec75516d`, signed `v2-reference-4`, 420 pass / 0 fail / 0 blocked, every claimed profile certified, egress guard closed, nothing relaxed; openwop-examples #160, #163–#165) records the six `openwop.requirement.0236.*` ids and `openwop.requirement.0241.trigger.bound-by-listing` `executed-pass`, every event caused through §B. Reaching a certifiable seams-off cut took suite 2.45.27 and 2.45.28, which record six other seam-driven legs `inapplicable`, not `blocked`, on a seam-free host. Gaps G1 and G2 are closed on that cut; openwop-app's adoption is tracked in TODO. · 2026-10-07 — `Draft` → `Active`, comment window waived by the maintainer (2026-10-07: "Waive, go Active"), recorded as a STEWARD OVERRIDE of RFC 0147 §A.6 in MAINTAINERS.md. §A–§D are merged; `v2-host-event-delivery` causes its events through §B when the host lists the §A types (suite 2.45.26). · 2026-10-07 — filed `Draft` after an `/architect` design review (2026-10-07) of one problem: every RFC 0236 requirement except one, and the protocol-tier invariant `host-event-tenant-isolation`, can be caused only through the §G emit seam, which production hosts do not serve. |
| **Affects**       | a new optional v2 operation `POST /host/events/test` (`api/v2/openapi.yaml`, added in `scripts/derive-v2-api.py` as a v2-only operation) · two reserved protocol host-event types, bound in `schemas/v2/host-event.schema.json` · `spec/v2/core/events.md` §Host events · `conformance/src/scenarios/v2-host-event-delivery.test.ts` and `lib/host-event-witness.ts` · `SECURITY/invariants.yaml` (`host-event-tenant-isolation`) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4): one optional operation, bound only on a host that lists one of two reserved types in its `hostEvents` record. A host that lists neither is bound exactly as today. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0236 gave events that belong to no run a v2 shape, but the suite can cause one only through a conformance seam, so a production host can witness five of its six requirements, and the cross-tenant MUST-NOT behind them, only on a test deployment. This RFC adds the pattern GitHub (ping) and Stripe (test events) use: `POST /host/events/test` makes the host emit one empty test event, of a reserved type, to the caller's own tenant. A host opts in by listing the reserved types in `hostEvents.types[]`. Nothing else changes.

## Motivation

**The corpus breaks its own witness rule.** `spec/v2/core/conformance.md` §Witness class: a MUST whose only witness is `seam-gated` must mint a normative observation path or be demoted to SHOULD. `hostEvents` is declared `witnessable-gated`, yet `v2-host-event-delivery` drives every leg that needs an event through the §G seam (`/conformance/seams/sample/host-events/emit`, RFC 0236 §G). Demotion is not available: invariant `host-event-tenant-isolation` (`SECURITY/invariants.yaml`) is a protocol-tier MUST-NOT.

**It blocks production evidence.** openwop-app serves `hostEvents` in production (175 durable types, 2026-10-07) and deliberately serves no seams. Its certified cuts record every `openwop.requirement.0236.*` row except `webhook.ephemeral-refused` as `inapplicable` (that one leg needs no event and runs without the seam since suite 2.45.26). RFC 0236 is `Accepted` on a reference example alone; a production host cannot add to that evidence at all.

## Proposal

### §A. The reserved types

Two protocol host-event types, each with a fixed delivery class:

| Type | `delivery` |
| --- | --- |
| `host-test.durable-triggered` | `durable` |
| `host-test.ephemeral-triggered` | `ephemeral` |

- **A.1.** `host-event.schema.json` binds each to its delivery class and an empty closed payload (`{ "type": "object", "maxProperties": 0 }`), as it binds `channel.presence`.
- **A.2.** A host MUST emit them only in answer to §B, and MUST NOT emit any other type in answer to §B.
- **A.3.** They follow `events.md` §Naming (`domain.verb-ed`). The type is the marker: a subscriber that does not want test events does not name them in `events[]`, and §B takes no `type`, so it cannot be used to produce a real type.

### §B. The operation

`POST /host/events/test` (`emitTestHostEvent`), scope `webhooks:manage`.

- **B.1.** A host that lists either §A type in `hostEvents.types[]` MUST serve this operation for each listed type's class, and otherwise MUST NOT serve it. Listing the type is the claim; there is no separate facet.
- **B.2.** The request body is closed: `{ "delivery": "durable" | "ephemeral", "workspaceId"?: string }`. A `delivery` whose type is not listed is `400 validation_error`.
- **B.3.** The host emits one event of that class's §A type through its ordinary path: the same envelope (`host-event.schema.json`), channel (`/host/events`), webhook body (`{ hostEvent }`), delivery class and tenant gate as any host event. It answers `202 { "eventId", "type" }`.
- **B.4.** The event belongs to the caller's tenant, and to `workspaceId` when given. A host MUST NOT deliver it to another tenant, or outside that workspace. A `workspaceId` of another tenant is `403 id_tenant_mismatch`; an unknown one is `404 not_found`.
- **B.5.** A host SHOULD rate-limit the operation more tightly than reads; a limited request is `429 rate_limited` with `Retry-After`. `Idempotency-Key` is honoured as on other `POST`s.

No new error code: every refusal above is already in `spec/v2/errors.json`.

### §C. Prose

`events.md` §Host events gains one bullet (about 40 words): listing a reserved test type binds `emitTestHostEvent`, which emits it to the caller's tenant only. The edit is word-neutral; request and response detail lives in the operation description. The core word budget is at its cap.

### §D. Conformance

`v2-host-event-delivery` causes its events through §B when the host lists the §A types, and through the §G seam otherwise; each disposition note names the path used. The judges are unchanged: the event is an ordinary host event. The self-test double gains three defects, each failing its leg: §B emits a non-reserved type; §B's event reaches a second tenant; §B is served while no §A type is listed. `host-event-tenant-isolation` keeps its test, now observable without seams.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 only reserved types answer §B | the `event:` and envelope `type` of the frame carrying the returned `eventId` | the suite, through §B (`openwop.requirement.0241.trigger.bound-by-listing`) | witnessable — gated on a listed §A type |
| §B.1 served exactly when listed | §B answers `404`/`405` when no §A type is listed, `202` when one is | the suite (`openwop.requirement.0241.trigger.bound-by-listing`) | witnessable — gated |
| §B.2 unlisted class refused | `400 validation_error` for the class whose type is not listed | the suite, on a host listing one class (`openwop.requirement.0241.trigger.bound-by-listing`) | witnessable — gated |
| §B.3 the ordinary path | the six RFC 0236 legs pass with §B as the cause: `openwop.requirement.0236.host-event.envelope`, `openwop.requirement.0236.webhook.host-variant`, `openwop.requirement.0236.webhook.ephemeral-refused`, `openwop.requirement.0236.ephemeral.no-fan-out`, `openwop.requirement.0236.ephemeral.no-resume`, `openwop.requirement.0236.host-event.tenant-isolation` | the suite, through §B | witnessable — gated |
| §B.4 tenant and workspace scope | a second tenant's stream receives nothing for the first tenant's §B event; a foreign `workspaceId` is `403` | the suite, with a second-tenant credential (`openwop.requirement.0236.host-event.tenant-isolation`) | witnessable — gated |
| §B.5 rate limit (SHOULD) | `429` with `Retry-After` under load | — | unwitnessable — a SHOULD whose condition is load beyond the host's own limit, which the suite does not generate |

## Compatibility

`additive`. One optional operation and two reserved types; no closed object changes, no MUST relaxes, no code or status changes meaning. A host that lists neither §A type is bound exactly as today. Host events belong to no run, so replay is unaffected.

## Alternatives considered

1. **Do nothing.** The six RFC 0236 rows stay unwitnessable on every production host, and `host-event-tenant-isolation` keeps a seam-only witness, against `conformance.md` §Witness class.
2. **Demote the requirements to SHOULD.** Not available for a protocol-tier cross-tenant MUST-NOT, and it would weaken the rule to fit the suite.
3. **A ping on `registerWebhook`** (GitHub's pattern). It covers the durable webhook legs only: nothing reaches the stream, and there is no ephemeral event.
4. **A `test: true` flag on the host-event envelope** instead of reserved types. It changes the closed `host-event.schema.json` and costs budgeted words, and is needed only if a test event reused a real type, which §A.2 forbids. The type is already the filter key (`events[]`, `event:`). RFC 0240 (purpose labels) has no type to reserve and needs a flag; the two RFCs share the rest of their shape.
5. **A `hostEvents.testEvents` facet.** It would say twice what the listed types already say.

## Decisions

Settled in the `/architect` review (2026-10-07):

1. **A plain sub-resource, not `/host/events:test`.** The only colon-verb route at v2 is `:fork`, and reserved characters have already broken a production front door.
2. **`webhooks:manage`, not `runs:read`.** Causing deliveries is a write; the scope holder can already register the receivers.
3. **Ephemeral support is optional.** A host lists only the classes it emits; the legs needing the other class record `inapplicable`.
4. **No fixture.** The operation needs nothing installed.

## Implementation notes (non-normative)

- **v2 reference host** (`openwop-examples`): list both §A types with the seams profile off, and serve §B through the emit path the §G seam already uses. Its certified cut with seams off is the tier-1 evidence.
- **openwop-app:** the same, beside its 175 durable types. Its production cut becomes RFC 0236's tier-2 witness.
- Shared with RFC 0240: a canonical operation (never a `/conformance/seams` path), scoped to the caller's tenant and refusable like any operation, an ordinary rate limit and no new error code.

## Acceptance criteria

- [x] `Active`: the comment window was waived on the record (maintainer, 2026-10-07; MAINTAINERS.md). §A–§C merged (`events.md`, `host-event.schema.json`, the operation in `scripts/derive-v2-api.py`, `spec/v2/path-manifest.json`); `CHANGELOG.md` records it.
- [x] `v2-host-event-delivery` causes events through §B when listed, with each new defect failing its leg in the self-test double.
- [x] `Accepted`: a certified major-2 bundle from a host with the seams profile off records the six `openwop.requirement.0236.*` ids `executed-pass`, with §B as the cause. *(2026-10-08: the v2 reference host's certified public seams-off cut on published suite 2.45.28, build `commit:bb7c5930`; all six and `0241.trigger.bound-by-listing` `executed-pass`.)*

## References

- RFC 0236 (host events), §G the emit seam.
- RFC 0240 (planned): the same pattern for purpose labels.
- `spec/v2/core/conformance.md` §Witness class; `spec/v2/core/events.md` §Host events; `spec/v2/core/webhooks.md` §Delivery.
- GitHub webhook `ping`; Stripe test events.
