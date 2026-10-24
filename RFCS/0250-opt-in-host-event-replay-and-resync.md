# RFC 0250: Opt-in host-event replay and explicit resynchronization

| Field | Value |
| --- | --- |
| **RFC** | 0250 |
| **Title** | Opt-in host-event replay and explicit resynchronization |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts), proposed by Codex for review |
| **Created** | 2026-10-24 |
| **Updated** | 2026-10-24 — initial Draft; five architect passes completed; no comment window, approval, implementation or conformance pass implied |
| **Affects** | `spec/v2/core/events.md` §Host events; `core/capabilities.md`; `core/errors.md` via error registry; `spec/v2/facets/hostEvents.schema.json`; derived capabilities/error envelopes; `api/v2/openapi.yaml` and `asyncapi.yaml` through `scripts/derive-v2-api.py`; conformance; v2 SDKs and hosts |
| **Compatibility** | `additive` proposed, conditional on review against `COMPATIBILITY.md` §§2.3–2.4; legacy requests unchanged |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `hostEvents.replay` facet and `replay=required` request mode to the existing host-event stream. In that mode, a retained durable cursor resumes across a host process restart; an unavailable cursor gets an explicit, tenant-safe refusal before SSE opens. Requests without the new mode keep existing semantics. Host-event envelopes, run-event logs and ephemeral delivery remain unchanged. This Draft defines a proposed contract for review; hosts cannot advertise it until its owning spec/schema work is accepted and their behavior is qualified.

## Motivation

RFC0236 requires durable event IDs and recommends cursor replay within retention, but does not define a retained interval or what an unknown/expired cursor means. The openwop-app assessment at app commit `87719df6f` traced a 1,000-frame process-local ring and local-only oversized NOTIFY fallback (`src/host/hostEventStream.ts:34,93`). A reconnect can silently enter live mode on a different/new process. Fixing storage and large-event fan-out is host work under the existing contract; requiring an explicit refusal or an advertised replay guarantee is a new interoperable contract and belongs here.

A subscriber must distinguish a successfully resumed feed from one requiring a new authorized baseline. This proposal does not create a host-state snapshot API or promise that a collection-list snapshot is atomic with event emission; applications still reconcile through their existing entity APIs. The app plan tracks that integration as EVENT-01.

### Intake and five-pass record

| Input | Status / evidence |
| --- | --- |
| Implementer need | EVENT-01 in openwop-app dated competitive assessment; no public issue filed |
| Existing normative owner | `spec/v2/core/events.md` §Host events; RFC0236 §§B–D; RFC0247 bounded close |
| Existing witnesses | `v2-host-event-delivery.test.ts`; RFC0241 advertised test trigger; existing run SSE tests are not host-event replay proofs |
| Threats / invariants | auth-profiles, secret-leakage, node-packs where producer code applies; existing `host-event-tenant-isolation`, SR-1, ephemeral no-persistence obligations |
| Spec pass | Optional mode extends §Host events; it does not restate the run-log cursor rule or change legacy unknown-cursor handling |
| Schema pass | Optional facet; optional query; one new registry error; no event fields or required root properties |
| Security pass | Authenticate/authorize first; cursor lookups inside visible tenant/workspace domain; uniform unavailable response; no cursor/payload/key echoed |
| Conformance pass | Suite can emit durable/ephemeral test events and request cursors; actual restart and retention trimming require operator-controlled conditions, recorded as gated evidence |
| Compatibility pass | New facet/mode only; older readers retain old mode; suite minor and SDK minor required when implemented |
| Number / base | Next unused number 0250 at refreshed `origin/main` 10633f3c (0249 is Active); recheck number before filing |
| Standards | Template, RFC index, CONTRIBUTING, COMPATIBILITY, GOVERNANCE, MAINTAINERS, ROADMAP, INTEROP-MATRIX, SECURITY and invariant/threat library read; skill's old PROTOCOL-GAP-CLOSURE-PLAN path is absent, current ROADMAP/KNOWN-LIMITS used |

## Proposal

### A. Optional replay facet

In `spec/v2/facets/hostEvents.schema.json`, add this property to the existing properties object. The existing required list stays `["types"]`; final derived `hostEvents` family object remains closed. The schema remains draft 2020-12; generated capabilities carry the existing v2 `$id`.

```diff
 "properties": {
+  "replay": {
+    "type": "object",
+    "additionalProperties": false,
+    "required": ["mode", "minRetentionSeconds"],
+    "properties": {
+      "mode": { "const": "required-cursor-v1" },
+      "minRetentionSeconds": { "type": "integer", "minimum": 1 }
+    }
+  },
   "types": { "type": "array" }
 }
```

This is a contextual diff sketch, not replacement of the existing types item schema. Absence means no strict-replay promise; it does not mean no legacy retention. No default retention duration is imposed on hosts. `minRetentionSeconds` is a proposed minimum interval for authorized durable-event resume, subject to UQ2's deletion/revocation boundary. Hosts MUST NOT advertise this facet unless they implement B–D. They MUST preserve its advertised retention across ordinary process replacement. Counts of newer events MUST NOT shorten that interval. This does not prescribe a DB, queue or internal event sequence.

### B. Request and success

An authenticated consumer MAY send `replay=required` on `streamHostEvents` when discovery advertises A. With no `Last-Event-ID`, the host opens a live stream; it does not infer an initial historical cursor. With an authorized, retained durable cursor, the host MUST replay the visible durable events after that event, in original per-subscriber stream order, and join live delivery without a retention/live handoff gap. It MUST NOT re-emit the cursor event or any ephemeral event as replay. Event IDs remain opaque; consumers and hosts MUST NOT order them lexicographically. Internal durable ordering is not an added wire `sequence`.

`resumable=true` and `limits.maxStreamAgeSec` continue to operate as RFC0247 defines. A consumer reconnecting after a bounded close sends both mode parameters and the last durable ID. Network ambiguity still requires eventId deduplication; this RFC does not promise exactly-once application effects or exactly-once network delivery.

### C. Cursor unavailable

For `replay=required` with a cursor it cannot honor, a host MUST return `409 host_event_resync_required` before writing SSE headers or frames. An expired, unknown, wrong delivery-class, foreign or invisible cursor produces the same response after normal authorization. The host MUST NOT look up a cursor in another tenant and expose whether it exists. Missing/invalid authentication and insufficient scope retain their owning auth/identity errors; this RFC cannot redefine them.

Proposed new `spec/v2/errors.json` row (the release minor in `since` is assigned at implementation, not invented here):

```json
{
  "code": "host_event_resync_required",
  "meaning": "The requested strict host-event cursor cannot be resumed; the consumer must reconcile an authorized baseline.",
  "httpStatus": 409,
  "statusSource": "RFC 0250 section C",
  "retriable": false,
  "details": {
    "type": "object", "additionalProperties": false,
    "required": ["service", "reason"],
    "properties": {
      "service": {"const": "hostEvents"},
      "reason": {"const": "cursor-unavailable"},
      "correlationId": {"type": "string", "minLength": 1}
    }
  },
  "source": "spec/v2/core/events.md section Host events"
}
```

The snippet intentionally omits `since`: it is not a valid complete registry row until the target minor is assigned. The generated error envelope is not edited by hand. A client receiving this code MUST NOT loop on the same cursor. It reconciles authorized state by its existing application contract, then opens a fresh stream or uses an existing application checkpoint. This RFC does not invent a new snapshot watermark.

An unadvertised strict operation answers `404 not_found` per errors.md §Unadvertised operations. Unsupported query values answer the existing `400 validation_error`; requests with no replay parameter keep their existing behavior, including unknown-cursor behavior. A client MUST NOT assume an older host enforces this mode merely because an unknown query parameter was accepted.

### D. Security and delivery

RFC0236 tenant/workspace/visibility confinement and SR-1 continue to own the envelope's boundaries. Persist only durable events and the minimum metadata needed to resume; no ephemeral event may enter the replay store. Apply current authorization/visibility when replaying. A change in membership may remove visibility but MUST NOT widen it. No unavailable response echoes cursor IDs, event payload, tenant/workspace IDs or BYOK material. Host diagnostic metrics use bounded reason/class labels, not raw cursor or tenant labels.

An oversized internal notification cannot silently drop a durable event while this mode is advertised. Internal publication uses a durable reference or another bounded transport; the wire envelope is unchanged. These are consequences of the replay/delivery promise, not a mandated internal queue design.

### E. HTTP, AsyncAPI and SDK changes

`streamHostEvents` keeps its existing operationId, `host` tag, address and auth schemes/scopes. Add optional query `replay`, enum `[required]`, no default, plus `Last-Event-ID` documentation and a 409 response `$ref` to the generated canonical error envelope. Preserve 200/401 and other existing errors. Update the **source generator** `scripts/derive-v2-api.py`, regenerate `api/v2/openapi.yaml`, and describe the same query in `subscribeHostEvents`' closed HTTP binding in `api/v2/asyncapi.yaml`. No new channel/message and no security-inheritance change. SDKs expose a typed opt-in and surface resync as a caller action, not automatic infinite retry.

### Examples

| Case | Result |
| --- | --- |
| Advertised `{replay:{mode:"required-cursor-v1",minRetentionSeconds:3600}}`, visible retained `eventId`, `replay=required&resumable=true` | 200; durable events after the cursor then live, no replayed ephemeral frame. 3600 is illustrative, not a default. |
| Advertised strict replay, cursor expired or from foreign tenant | Same 409 canonical envelope with service=hostEvents, reason=cursor-unavailable; no cursor echo |
| `minRetentionSeconds: 0`, unknown replay property, or mode with another string | Facet schema rejects |
| Strict request to host with no replay facet | 404 not_found; legacy request without replay remains unchanged |
| No Last-Event-ID with strict mode | New live subscription; no implied historical baseline |

## Compatibility

Proposed **additive** under COMPATIBILITY §§2.1, 2.3, 2.4: the facet is optional, the query is opt-in, existing events/IDs/legacy responses remain unchanged, no old capability becomes default-on, and no core required field or canonical error changes meaning. An older pinned validator need not accept a newer optional facet; version pinning follows current v2 rules. Reclassify if review discovers any existing consumer or host that the actual proposal invalidates. No change touches frozen v1, engine runtime pins, run-log eras, replay/fork copies or recorded event parsing. The new suite scenarios run only on the facet; they do not invalidate prior measured bundles.

## Conformance

Extend existing host-event witnesses rather than creating a second observer. Use RFC0241 listed test types when available, otherwise the existing conformance emit seam. New proposed `v2-host-event-strict-replay.test.ts` has one requirement ID per test and canonical witness dispositions. Fixture/judge positive and negative cases are registered in `conformance/fixtures.md`; server-free schema/judge cases target <1s, while a live stream test has an explicit bounded timeout.

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| A facet closure/positive minimum | valid/invalid discovery examples | suite, server-free | witnessable |
| B exclusive durable replay / no ephemeral replay | exactly the emitted durable backlog, cursor excluded; ephemeral absent | suite through existing listed emit trigger or seam | witnessable-gated |
| B/D replay after process replacement | same retained cursor resumes emitted backlog on new process | operator restart/routing fixture | seam/operator-gated; unavailable fixture is blocked, not passing |
| A promised retention is not count-trimmed | cursor inside advertised minimum remains resumable after newer events | operator controls volume/time; suite only bounded cases | gated; no full-duration proof without elapsed/operator control |
| C unknown/foreign cursor refusal | identical 409 body, no leaked identifiers | suite + second-tenant credentials | witnessable-gated |
| D normal authority before cursor | unchanged auth/scope refusal for invalid caller | suite with credential matrix | witnessable-gated |
| D large event reaches other instance | same event observed on separately routed subscriber | operator routes two instances, producer emits bounded large fixture | operator-gated; new public size-test seam not invented |
| C client avoids retry loop | SDK returns typed resync action instead of reconnect loop | SDK unit/integration harness | consumer-side; host suite cannot witness it |
| D ephemeral never physically persisted | negative storage inspection plus stream/sink absence | operator/storage fixture | implementation evidence; black-box stream alone cannot prove storage absence |

Illustrative scenario structure (not implemented):

```ts
/** spec/v2/core/events.md section Host events, RFC0250. */
describe('hostEvents: strict replay', () => {
  // Gate on hostEvents.replay.mode; emit through the current host-event trigger.
  // Observe replay before judging; do not treat missing restart control as pass.
  // expect(result, driver.describe('events.md section Host events',
  //   '0250.cursor-exclusive')).toMatchObject(expected);
});
```

No reference host is marked implemented. `openwop-examples` v2 reference can supply ordinary replay/refusal evidence; openwop-app supplies real multi-process/large-event qualification. Update INTEROP-MATRIX only from actual signed measured bundles, with the new facet's dispositions. A new restart/purge seam, if needed, is a separately reviewed gap, not silently a test backdoor in production.

## Alternatives considered

1. **Keep legacy SHOULD and document local limits.** Valid for minimal hosts but cannot close explicit resync requirement; retained as the unchanged default.
2. **Require strict replay on all existing hostEvents hosts.** Rejected: strengthens old behavior and breaks legacy implementations without opt-in.
3. **Emit a resync marker as a host event.** Rejected: pollutes the advertised type union/delivery classes and mixes connection state with business events.
4. **Use Last-Event-ID as a numeric sequence or add one to host-event envelope.** Rejected: breaks opaque IDs/runless envelope and existing readers.
5. **Optional strict mode and explicit pre-stream error.** Chosen; requires an error registry/SDK update but preserves existing clients.

## Unresolved questions

1. Confirm facet/query/error names and 409 selection with core events/errors owners before Active; no substitute existing error names this exact state.
2. State exact retention exceptions for lawful deletion, revoked visibility, host tenant removal and emergency security purge. Never weaken CTI-1 or invent a guarantee that lawful deletion is forbidden.
3. Define original per-subscriber order and live/backlog handoff in distributed producers; opaque IDs are not an ordering key. Decide which concurrency/fault witness substantiates it.
4. Are current emit fixtures sufficient to cause retention trim, oversize and process replacement? If not, define safe operator fixtures and honest blocked dispositions; a new wire test seam needs its own review.
5. Assign concrete SDK implementation owners and eventual minor versions; initial baseline reconciliation remains application-specific, with no claim of snapshot atomicity.

## Implementation notes (non-normative)

Order: five-pass/comment review → Active and owning core/facet/error/API/scenario work → reference/app/SDK implementation with evidence → Accepted. No status auto-promotion by this planning task; normal governance/7-day ready-for-review window and required reviewers apply, with no invented waiver. The app may independently fix its durable log/oversized fan-out under existing RFC0236 now; it must wait for accepted new contract before advertising the strict facet. Proposed host stores/retention use existing Storage/outbox/erasure owners. Do not persist ephemeral events to simplify implementation.

Gap/risk companions live in RFCS/registers per current RFC0174 placement. Planning source: openwop-app dated platform-gap-analysis, EVENT-01. Cross-cut: app runtime + SDKs + suite; coordinate those repositories through their existing plans, not a repository-wide release hold.

## Acceptance criteria

- [ ] Maintainer review resolves blocking UQs and compatibility classification; required comment/governance process completed.
- [ ] Owning v2 events/capabilities text and facet/error registry data updated; error/capability schemas and API outputs generated and validated.
- [ ] Positive/negative schema and live replay/refusal witnesses land; unavailable restart/retention conditions produce honest dispositions.
- [ ] Relevant invariant coverage, fixture catalog, suite minor and CHANGELOG updated.
- [ ] SDKs expose opt-in/resync and do not retry-loop; old mode regression cases pass.
- [ ] Reference host and app evidence state exactly which retention/restart/large-event properties were measured; current signed bundles justify any advert.
- [ ] Gap/risk sweep, current INTEROP-MATRIX and acceptance evidence justify Accepted; no unchecked item is converted to a claim.

## References

- [Events](../spec/v2/core/events.md), [Capabilities](../spec/v2/core/capabilities.md), [Errors](../spec/v2/core/errors.md), [Compatibility](../COMPATIBILITY.md).
- [RFC0236](0236-host-events.md), [RFC0241](0241-host-event-test-trigger.md), [RFC0247](0247-bounded-stream-lifetime.md).
- [Gap register](registers/0250-opt-in-host-event-replay-and-resync.gaps.md), [risk register](registers/0250-opt-in-host-event-replay-and-resync.risks.md).
- [Original app implementation](https://github.com/openwop/openwop-app/blob/87719df6fed20cc26936ff22c808dc03c9b5d35f/backend/typescript/src/host/hostEventStream.ts).

### Recommendation

GO for Draft discussion; CONDITIONAL before Active and NO-GO for advertisement. Five UQs remain; retention/privacy, ordering/handoff and witness causability block Active. No implementation, schema change, governance approval or independent measurement is claimed by this document.
