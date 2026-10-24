# RFC 0250: Opt-in host-event replay and explicit resynchronization

| Field | Value |
| --- | --- |
| **RFC** | 0250 |
| **Title** | Opt-in host-event replay and explicit resynchronization |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts), proposed by Codex for review |
| **Created** | 2026-10-24 |
| **Updated** | 2026-10-24 — **`Draft → Active`, comment window waived by the maintainer** (user instruction 2026-10-24, choosing "Waive it" for RFC 0250); STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. Revised by the steward's `/architect` ruling on the #2035 review: the facet is `{minRetentionSeconds}` (presence is the claim, no `mode`); every MUST is observable through the RFC 0241 trigger; restart, oversize and the no-foreign-lookup rule are not separate MUSTs, because losing a retained event or answering a foreign cursor differently already breaks §B or §C; the retention exceptions are stated; the error row has no details; the rules live in the `hostEvents` facet description. Host: openwop-app (EVENT-01). · 2026-10-24 — initial Draft, proposed by Codex (#2035). |
| **Affects** | `spec/v2/core/events.md` §Host events; `core/capabilities.md`; `core/errors.md` via error registry; `spec/v2/facets/hostEvents.schema.json`; derived capabilities/error envelopes; `api/v2/openapi.yaml` and `asyncapi.yaml` through `scripts/derive-v2-api.py`; conformance; v2 SDKs and hosts |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `hostEvents.replay` facet and `replay=required` request mode to the existing host-event stream. In that mode, a retained durable cursor resumes across a host process restart; an unavailable cursor gets an explicit, tenant-safe refusal before SSE opens. Requests without the new mode keep existing semantics. Host-event envelopes, run-event logs and ephemeral delivery remain unchanged. This Draft defines a proposed contract for review; hosts cannot advertise it until its owning spec/schema work is accepted and their behavior is qualified.

## Motivation

RFC0236 requires durable event IDs and recommends cursor replay within retention, but does not define a retained interval or what an unknown/expired cursor means. The openwop-app assessment at app commit `87719df6f` traced a 1,000-frame process-local ring and local-only oversized NOTIFY fallback (`src/host/hostEventStream.ts:34,93`). A reconnect can silently enter live mode on a different/new process. Fixing storage and large-event fan-out is host work under the existing contract; requiring an explicit refusal or an advertised replay guarantee is a new interoperable contract and belongs here.

A subscriber must distinguish a successfully resumed feed from one requiring a new authorized baseline. This proposal does not create a host-state snapshot API or promise that a collection-list snapshot is atomic with event emission; applications still reconcile through their existing entity APIs. The app plan tracks that integration as EVENT-01.

## Proposal

### A. The facet

`spec/v2/facets/hostEvents.schema.json` gains an optional, closed member. The family's normative text gains that file, and `events.md` §Host events gains one pointer.

```jsonc
"replay": { "minRetentionSeconds": 3600 }   // integer >= 1; required inside the member
```

Presence is the claim. There is no mode string: a versioned behaviour changes through a new RFC, not an enum token. `minRetentionSeconds` is how long after emission a durable event stays resumable as a cursor, whatever the volume of newer events, across ordinary process replacement.

### B. Resume

A consumer sends `replay=required` on `streamHostEvents` with `Last-Event-ID` naming a durable event. It MUST NOT send the parameter to a host that does not advertise `hostEvents.replay`, and such a host MAY ignore it. With an absent or empty `Last-Event-ID` the stream opens live and replays nothing: there is no position to resume and no cursor to refuse.

For a cursor naming a durable event the caller can see, emitted less than `minRetentionSeconds` ago, a host advertising `hostEvents.replay` MUST:
- replay every durable event visible to the caller that it committed after the cursor, each exactly once, in commit order;
- never re-emit the cursor event, and never replay an ephemeral event;
- then continue live with no gap at the backlog/live handoff.

Commit order binds events whose commits are ordered: one committed before the next was emitted. Events committed concurrently, for example by two instances at once, have no defined order between them, live or replayed. Commit order is the host's own. It is not put on the wire, event ids stay opaque, and the suite observes it only as the order of events it emitted one after another. Losing a retained event (on a process restart, or an oversized internal notification) is a violation of this section; there is no separate rule for each cause. `resumable=true` and the RFC 0247 bounded close work as before; network ambiguity still needs `eventId` de-duplication.

### C. Refusal

A cursor older than `minRetentionSeconds` MAY be resumed or refused: the bound is a floor, so a host need not tie its refusal to its sweep timing. For any cursor it does not resume under `replay=required`, the host MUST answer `409 host_event_resync_required` before any SSE byte. That covers a cursor that is unknown, belongs to another tenant, names an ephemeral event, is older than the bound, or whose event was removed. The status and body MUST be byte-identical across those cases, so the refusal is not an oracle for another tenant's events. Authentication and scope failures keep their own answers.

The registry row: `409`, `retriable: false`, `details: null`, `statusSource: "v2 decision"`. A consumer receiving it MUST NOT retry the same cursor: it reconciles through its own entity reads and opens a fresh stream. This RFC defines no snapshot.

### D. Retention exceptions and safety

An event removed by lawful deletion, tenant removal or revoked visibility is left out of replay, and a cursor naming one is refused as in §C. These exceptions only ever remove events from a caller's view; none widens one (`host-event-tenant-isolation`). The replay store holds durable events only: the existing rule that an ephemeral event is never persisted is unchanged. A refusal echoes no cursor, payload, tenant id or secret.

### E. API

`streamHostEvents` gains the optional query `replay` (enum `[required]`) and a `409` response, through `scripts/derive-v2-api.py`. No new channel or message.

### Examples

| Case | Result |
| --- | --- |
| Advertised `{replay:{minRetentionSeconds:3600}}`; `replay=required` with a retained durable cursor | `200`; the durable events after it, in commit order, then live |
| The same request with an unknown, foreign, ephemeral or expired cursor | `409 host_event_resync_required`, the same bytes every time |
| `{replay:{minRetentionSeconds:0}}`, or an unknown member | the facet schema refuses it |
| No `replay=required` | unchanged behaviour, including today's unknown-cursor answer |

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4): an optional facet member on a closed object, an opt-in query parameter, a new response on the opted-in path and one new error code. Requests without the parameter, the envelope, the run event log and every existing host are unchanged.

## Conformance

New scenario `v2-host-event-strict-replay`. It is gated on `hostEvents.replay` and the RFC 0241 trigger, with both `host-test.*` types listed. Judges are in `lib/host-event-replay-witness.ts`, whose self-tests fail each wrong host answer.

| Id | Case | Expect |
| --- | --- | --- |
| `0250.shape` | (server-free) facet positives and negatives | validate / refuse |
| `0250.resume-backlog` | emit D1, D2, ephemeral E, D3; reconnect with cursor D1; emit D4 live | exactly D2, D3, D4, in order; never D1 |
| `0250.ephemeral-not-replayed` | the same stream | E's `eventId` never arrives |
| `0250.cursor-refused` | an unknown cursor | `409 host_event_resync_required`, not `text/event-stream` |
| `0250.refusal-uniform` | E's id; tenant B's real durable id (`OPENWOP_TEST_TENANT_B_API_KEY`) | the same status and bytes as the unknown cursor |
| `0250.legacy-unchanged` | an unknown cursor without `replay=required` | not the new refusal |

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A closed member, positive retention | schema vectors | the suite, server-free | witnessable-unaided |
| §B backlog after the cursor, exactly once, in commit order, then live | the ids of the suite's own sequential emits | the suite, through the RFC 0241 trigger | witnessable-gated |
| §B no ephemeral replay | the ephemeral event's `eventId` absent from the resumed stream | the suite | witnessable-gated |
| §B retention survives restart and volume | a cursor inside the window still resumes | only by elapsed time or an operator restart; a loss breaks the §B row above when it happens | witnessable-gated (by the §B row; not separately caused) |
| §C refusal before any SSE byte | `409` and its content type | the suite | witnessable-gated |
| §C byte-identical refusals | unknown vs foreign vs ephemeral cursor bodies | the suite, with a second tenant | witnessable-gated |
| §C the opt-in leaves legacy alone | an unknown cursor without the parameter | the suite | witnessable-gated |
| §D lawful-deletion exception | a removed event absent from replay | only an operator who removes data | unwitnessable — the suite cannot remove a host's data; the rule only narrows a view |

## Alternatives considered

1. **Keep the legacy SHOULD and document local limits.** That remains the default for hosts that don't opt in; it cannot give a consumer an explicit resync signal.
2. **Require strict replay of every `hostEvents` host.** Rejected: it strengthens old behaviour without an opt-in.
3. **Emit a resync marker as a host event.** Rejected: it mixes connection state into the business-event type union.
4. **A numeric sequence on the host-event envelope.** Rejected: ids are opaque, and the envelope deliberately has no `sequence`.
5. **Separate MUSTs for restart survival, oversize delivery and no foreign lookup.** Rejected at `Active`: none is observable from outside, and each is already a way of breaking §B or §C, which are.

## Unresolved questions

All five were resolved on 2026-10-24 by `/architect`:

1. **Names:** `hostEvents.replay`, `replay=required` and `host_event_resync_required` (409). No existing code names this state.
2. **Retention exceptions:** §D. Lawful deletion, tenant removal and revoked visibility remove events, and nothing widens a view.
3. **Order and handoff:** commit order, internal to the host and observed through sequential emits; the backlog is followed by live delivery with no gap (§B).
4. **Fixtures:** the RFC 0241 trigger causes every observable row. Restart and expiry are not separately caused, and no new seam is added.
5. **SDKs:** a typed, non-retrying resync is owed by openwop-sdks (G5).

## Implementation notes (non-normative)

The motivating host is openwop-app: a 1,000-frame process-local ring and a local-only oversized NOTIFY (`hostEventStream.ts`, app commit `87719df6f`). It implements this as EVENT-01, with a durable store, and advertises only after the suite release that carries the legs. The other `hostEvents` hosts (the v2 reference host and MyndHyve) are unaffected until they opt in.

## Acceptance criteria

- [x] The facet member, the normative-text entry, the `events.md` pointer, the error row and the derived `streamHostEvents` parameter and `409`.
- [x] `v2-host-event-strict-replay` with its six legs, judges and self-tests.
- [ ] A host advertises `hostEvents.replay`, and a certified major-2 bundle records the five `0250.*` host legs `executed-pass`.
- [ ] openwop-sdks exposes the opt-in and a non-retrying resync (G5).

## References

- [Events](../spec/v2/core/events.md) §Host events, [Capabilities](../spec/v2/core/capabilities.md), [Errors](../spec/v2/core/errors.md), [Compatibility](../COMPATIBILITY.md).
- [RFC 0236](0236-host-events.md), [RFC 0241](0241-host-event-test-trigger.md), [RFC 0247](0247-bounded-stream-lifetime.md).
- [Gap register](registers/0250-opt-in-host-event-replay-and-resync.gaps.md), [risk register](registers/0250-opt-in-host-event-replay-and-resync.risks.md).
- The steward review on openwop/openwop#2035.

## Status history

- 2026-10-24 — Draft (openwop#2035, proposed by Codex).
- 2026-10-24 — Active (comment window waived; STEWARD OVERRIDE of RFC 0147 §A.6, see Updated).
