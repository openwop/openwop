# RFC 0252: An eval task takes its fixtures from a recorded run

| Field | Value |
| --- | --- |
| **RFC** | 0252 |
| **Title** | An eval task takes its fixtures from a recorded run |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-10-26 |
| **Updated** | 2026-10-26 — **`Draft` → `Active`, comment window waived by the maintainer** (user instruction 2026-10-26: "Waive the comment window for RFC 0252 and work with other sessions to move it to accepted"); STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. The five Unresolved questions are ruled below. The schema, facet, derived API, scenario `v2-eval-recorded-fixtures`, three fixtures and invariant `eval-fixture-run-tenant-scoped` land with suite 2.46.32. Filed `Draft` the same day (#2046). |
| **Affects** | `api/openapi.yaml` `createRun` (one optional body property; derived `api/v2/openapi.yaml`) · `spec/v2/facets/agents.schema.json` (optional `agents.evalSuite.recordedFixtures`; derived `schemas/v2/capabilities.schema.json`) · `schemas/v2/run-event-payloads.schema.json` (optional `fixtureRuns` on `eval.started`) · `SECURITY/invariants.yaml` (one proposed row) · conformance (new `v2-eval-recorded-fixtures`, three eval-suite fixtures) · v2 SDKs · hosts advertising `agents.evalSuite` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

The most useful regression eval replays what an agent actually did: take a real run, keep its tool answers, and check that a changed agent still reaches a good decision against them. Today a host can do this only privately, by exporting a run's tool calls into a suite's `fixtures.toolResponses`. A suite cannot name the run, because suites are portable documents and carry no host ids. This RFC adds an optional `createRun` property, `fixtureRuns`, that maps a suite task to a prior run on the same host. The host derives the task's fixtures from that run's recorded tool calls and runs the task under RFC 0244's fail-closed `onMiss: "fail"`. A source run the caller cannot use is refused with one uniform `400 validation_error`, as RFC 0251 does for a baseline.

## Motivation

RFC 0244's research (Implementation notes, UQ 7) named "fixtures = the recorded tool boundary of run X" as the highest-value practice it found and left it to a follow-up (gap G5). Three things make it hard to do portably today.

- **A client cannot build the fixtures from the wire.** `agent.tool-called.inputs` and `agent.tool-returned.outcome` are optional. A host that emits `argsHash` instead of `inputs`, or redacts either field, leaves a client with nothing to compare. RFC 0244 §A also grades `args` against the call *as executed*, before any wire redaction, so a client's copy of the wire can differ from what the host would match.
- **A suite cannot carry the reference.** A suite is portable across hosts and tenants; a `runId` is neither.
- **An export operation would put recorded tool results on the wire** in a new, bulk form, outside the event log's existing access path.

The host already holds the as-executed boundary. Letting the client name the run, and having the host derive the fixtures, keeps the content where it is and needs one optional property.

## Proposal

### §A — The facet member

`spec/v2/facets/agents.schema.json` `evalSuite` gains an optional boolean:

```jsonc
"recordedFixtures": true
```

`true` means the host accepts `fixtureRuns` on an eval `createRun` as this RFC defines. A host advertising it MUST also advertise `fixtureMatching` (RFC 0244 §D), because the derived fixtures use `args` and `onMiss`. A client MUST NOT send `fixtureRuns` to a host that does not advertise it; such a host MAY refuse it with `400 validation_error` (the v2 body is closed).

### §B — The request

The `createRun` body gains an optional `fixtureRuns`, meaningful only with `mode: "eval"`: an object whose keys are suite `taskId`s and whose values are `runId`s. Each named task takes its fixtures from that source run.

A host advertising `recordedFixtures` MUST refuse with `400 validation_error`, before the run starts:
- `fixtureRuns` without `mode: "eval"`, or with no keys;
- a key that is not a `taskId` of the suite;
- a named task whose suite `fixtures` carries `toolResponses` or `onMiss` (the two sources are never merged);
- `live-shadow` among the run's modes (it ignores fixtures);
- a source run it cannot use, per §C.

### §C — The source run

A usable source run is a terminal run that the caller's owner triple can read, that holds at least one agent invocation of the eval's `agentId`, and for which the host still holds every one of that agent's tool calls as executed: its inputs, and its result or error. The host holds these in its own store; they need not appear on the wire, where `agent.tool-called` can carry `argsHash` alone and `agent.tool-returned` no `outcome`. Every other value is refused with the same status and the same error code: a run that does not exist (an id that does not decode included), belongs to another tenant, is not terminal, never invoked the agent, or whose calls the host no longer holds. The refusal MUST NOT echo the supplied id.

A source run with a failed tool call is usable only on a host that also advertises `fixtureErrors` (RFC 0245); otherwise it is unusable and refused like the rest. A host is not required to retain calls for any period: it refuses what it cannot replay.

### §D — The derived fixtures

For a named task, the host MUST derive the fixtures from the source run's recorded calls of the eval's `agentId`, excluding delegates (the RFC 0244 §A default), in event-sequence order. Each call yields one `toolResponses` entry:
- `tool` is the call's `toolName`;
- `args` is the call's inputs as the agent passed them, with `argsMatch: "exact"`;
- `response` is its result. A call that failed, or never ran (`status` `forbidden` or `rate_limited`), yields `isError: true` with its error as `response`.

The task runs with `onMiss: "fail"`, and RFC 0244 §D selection, consumption and per-trial reset apply unchanged. The derivation MUST read the boundary the agent saw, never an egress request: credential material the host resolved after the agent's call MUST NOT enter a derived entry (SR-1). The derived entries are suite content: they are never put on the wire, and the summary stays content-free (`eval-summary-no-content-leak`).

### §E — What the run reports

`eval.started` gains an optional `fixtureRuns`, the accepted map verbatim. A host MUST emit it when the request carried `fixtureRuns`. The eval run is a recorded fact: a replay or `:fork` of it re-reads its recorded events and MUST NOT resolve the source run again, which may no longer exist. A miss is reported through `fixtureMissCount` as today.

### Wire shape

```yaml
# api/openapi.yaml createRun requestBody (v2 derivation)
fixtureRuns:
  type: object
  minProperties: 1
  propertyNames: { type: string, minLength: 1 }
  additionalProperties:
    $ref: ../../schemas/v2/ids.schema.json#/$defs/runId
  description: RFC 0252 — maps a suite taskId to a prior run whose recorded tool calls become that
    task's fixtures, served under onMiss "fail". Only with mode eval, to a host advertising
    agents.evalSuite.recordedFixtures. An unusable source run is refused 400 validation_error,
    identically whatever the reason.
```

`eval.started` gains `fixtureRuns` with the same shape. `recordedFixtures` is `{ "type": "boolean" }`, with the §A–§C rules in its description. No core prose changes.

### Examples

| Request (host advertises `recordedFixtures` and `fixtureMatching`) | Result |
| --- | --- |
| `fixtureRuns: {"refund-flow": "<a completed run of the agent>"}` | `201`; `eval.started.fixtureRuns` echoes it; the task's tool calls are served the recorded answers |
| the same, and the changed agent calls a tool with arguments the source run never saw | the call misses: no live tool runs, `fixtureMissCount` 1, the task fails |
| the same with an unknown id, another tenant's run, or a run that never invoked the agent | `400 validation_error`, identical in each case, without the id |
| a key naming no task of the suite | `400 validation_error` |
| a named task whose suite fixtures carry `toolResponses` | `400 validation_error` |
| `fixtureRuns` on a workflow run (no `mode`) | `400 validation_error` |

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4): one optional property on the closed `createRun` body, one optional boolean on a closed facet, and one optional property on a closed event payload. A request without `fixtureRuns` is handled exactly as today. A host that does not advertise `recordedFixtures` is unaffected, and a client that reads the facet never sends the property to it. No MUST relaxes and no error code changes.

**RFC 0147 §A.** The §A.1 freeze on optional wire capabilities is spent (struck 2026-08-20), so it does not bind. §A.6 does: the RFC touches tenant isolation (§C) and replays recorded tool outcomes (§D, §E), so it takes the full comment window. The maintainer waived it on 2026-10-26; that is a STEWARD OVERRIDE recorded in `MAINTAINERS.md`, and the evidence gate for `Accepted` is not waived.

## Conformance

New scenario `v2-eval-recorded-fixtures`, gated on `agents.evalSuite.recordedFixtures`, `fixtureMatching`, and its fixtures in discovery `fixtures`. It reuses the reserved counter tool `conformance.eval:counter` (RFC 0244 G2), whose live answer changes with every `inc`.

- `conformance-eval-recorded-source`: task `record` has `fixtures: {toolResponses: [], onMiss: "live"}`, so both scripted calls (`inc` then `read` on one key) reach the live counter and record `{key, count}`.
- `conformance-eval-recorded-replay`: task `record`, the same script, no `fixtures`.
- `conformance-eval-recorded-drift`: task `record`, whose `inc` names another key.

| Id | Case | Expect |
| --- | --- | --- |
| `0252.shape` | (server-free) `fixtureRuns`, the facet member, the `eval.started` property | validate / refuse |
| `0252.source-replayed` | run source; then replay with `fixtureRuns: {record: <source>}` | `201`; `eval.started.fixtureRuns` names the source; each `agent.tool-returned.outcome` equals the source's; `fixtureMissCount` 0; the live counter reads the same before and after the replay |
| `0252.drift-fails-closed` | drift with the same source | `fixtureMissCount` 1, `passed: false`; the live counter is unchanged |
| `0252.source-refused` | source = an unknown id; = a workflow run that never invoked the agent | `400 validation_error` each, without the id |
| `0252.source-uniform` | source = tenant B's completed source run (`OPENWOP_TEST_TENANT_B_API_KEY`) | the same status and code as the unknown id, without the id |
| `0252.fields-refused` | a key naming no task; the source fixture itself as the target (its task carries `toolResponses`); `fixtureRuns` without `mode` | `400 validation_error` each |

The replay leg can fail: a host that ignores `fixtureRuns` answers the replay's `inc` live, so the counter moves and the outcome differs from the source's.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A, §B shapes | schema vectors | the suite, server-free | witnessable-unaided |
| §B request-rule refusals | `400 validation_error` on each bad request | the suite | witnessable-gated: not probed by a host yet |
| §C unusable source refused, uniformly | the refusal for an unknown run, a run without the agent, and another tenant's run | the suite, with a second tenant | witnessable-gated: not probed by a host yet |
| §D recorded answers served, no live call | outcomes equal the source's; the counter does not move | the suite, through the counter tool | witnessable-gated: not probed by a host yet |
| §D a miss fails closed | `fixtureMissCount`, `passed`, the counter | the suite, through the drift fixture | witnessable-gated: not probed by a host yet |
| §D no egress credential enters a derived entry | nothing on the wire: derived entries are never emitted | only the host's own code | unwitnessable: the entries never leave the host, so no outside party can read them; covered by the proposed invariant's reference-impl tier |
| §E `fixtureRuns` echoed | `eval.started` | the suite | witnessable-gated: not probed by a host yet |
| §E a replay does not re-resolve the source | a `:fork` of the eval run after the source is gone | the suite, on a host that deletes runs | unwitnessable: v2 has no portable run deletion, so the suite cannot remove the source |
| Security: the derived copy shares the source's retention and erasure; a replay whose copy is gone is refused (SHOULD) | a `:fork` of the eval run after the source's content is erased | the suite, on a host that deletes runs | unwitnessable: v2 has no portable run deletion or erasure, so the suite cannot remove the source (as the §E row) |
| §B a client never sends the property to a host without the member | the request on the wire | only a client | claims-check: a client obligation, not a host behaviour |

## Security

- **Tenant isolation.** §C mirrors RFC 0251 §C. Accepting a foreign source would serve another tenant's tool results to the caller's agent and, through the agent's output, onto the caller's wire. One refusal for every unusable source, with no echoed id, keeps "another tenant's run" indistinguishable from "no such run". Proposed invariant at `Active`: `eval-fixture-run-tenant-scoped` (protocol tier; enforced by `0252.source-uniform`).
- **Credentials.** §D reads the agent-side boundary. A tool whose credential the host injects at egress never shows that credential to the agent, so it never enters a derived entry.
- **Retention and erasure of the derived copy.** §E forbids resolving the source again, so a host keeps the derived entries with the eval run, and they hold the source's as-executed tool content. That copy SHOULD be kept under the source's retention and erasure: when the source's tool content is purged or erased, so is every copy derived from it. A replay or fork of an eval run whose copy is gone SHOULD be refused, never derived again from the source and never run against live tools. A host that stores the copy where the source's deletion does not reach keeps personal data past an erasure request.
- **External effects.** Every named task runs fail-closed. A changed agent that calls something new reaches no live tool, which is the point: replaying a production run must not repeat its effects.
- **Threat models.** `SECURITY/threat-model-secret-leakage.md` (cross-tenant read) and `threat-model-replay.md` (recorded outcomes reused) gain a line naming §C and §E at `Active`.

## Alternatives considered

1. **Do nothing.** Each host exports privately; no client can rely on it, and every tool needs its own export.
2. **A client builds the fixtures from the event log.** Rejected: `inputs` and `outcome` are optional and may be redacted, and RFC 0244 §A grades the call as executed. The client's copy would miss where the host's would match.
3. **An export operation (`GET /runs/{runId}/tool-fixtures`).** Rejected: a new bulk read of recorded tool results, outside the event log's access path, that puts as-executed content on the wire. The derivation needs no read at all.
4. **A suite field (`fixtures.fromRun`).** Rejected: suites are portable and carry no host ids (RFC 0244 G5).
5. **Merge the recorded answers with the suite's `toolResponses`.** Rejected for now: the order of the two lists would decide which answer a call gets. Refusing the combination keeps one source per task; a later RFC can define a merge if anyone needs it.

## Unresolved questions

All five were ruled on 2026-10-26 at `Draft → Active` by the steward:

1. **Calls across several invocations:** every call of every invocation of the eval's `agentId`, in sequence order. A client cannot name one invocation; a consuming matcher handles repeats.
2. **`argsMatch` for derived entries:** `exact` only. Relaxing it is a later, additive request field if an agent needs it.
3. **Memory:** not seeded. §D derives tool answers only.
4. **An eval run as the source:** allowed. §C asks only that the run invoked the agent and that the host holds its calls; the derivation reads what the agent saw, live or fixture-served. The scenario's source runs are eval runs.
5. **Model answers:** out of scope; the agent's model calls run live. A recorded model boundary would be a separate RFC.

## Implementation notes (non-normative)

openwop-app already keeps the as-executed tool calls of the scripted agent for its eval fixtures, so derivation is a read of its own store at run-create. What it emits on the wire is a separate choice: a lane whose events carry `argsHash` alone is a usable source as long as the host holds the calls internally. openwop-app's live agent lane keeps its events content-free and gains an opt-in, internal-only record of its calls (ADR 0984). A host that holds only `argsHash`, with no internal record of the inputs, cannot derive `exact` entries and SHOULD NOT advertise `recordedFixtures`. Sequencing: `Draft` → `Active` 2026-10-26 (window waived) with the schema, facet, derived API, scenario, fixtures and invariant → `Accepted` on a certified host cut (openwop-app is implementing the host side). SDKs follow with the property and a facet read (G3).

## Acceptance criteria

- [x] The `createRun` property (derived `api/v2/openapi.yaml`), the facet member (derived capabilities schema) and the `eval.started` property, with the rules in their descriptions.
- [x] `v2-eval-recorded-fixtures`, its three fixtures in `fixtures.md`, judges with self-tests.
- [x] The invariant `eval-fixture-run-tenant-scoped` and the two threat-model lines.
- [ ] A host advertises `recordedFixtures`, and a certified major-2 bundle records the `0252.*` host legs `executed-pass`.
- [x] The three v2 SDKs carry `fixtureRuns` (G3): openwop-sdks #63, re-vendored to v2.46.32.

## References

- [RFC 0244](0244-eval-trajectories-trials-and-recorded-fixtures.md) §A, §D, UQ 7, gap G5; [RFC 0245](0245-eval-fixtures-replay-tool-errors.md); [RFC 0251](0251-eval-run-mode-and-baseline-selection.md) §C; [RFC 0081](0081-agent-evaluation-and-scorecards.md); [RFC 0147](0147-protocol-integrity-and-standards-readiness-program.md) §A.
- [Runs](../spec/v2/core/runs.md), [Compatibility](../COMPATIBILITY.md).
- [Gap register](registers/0252-eval-fixtures-from-a-recorded-run.gaps.md), [risk register](registers/0252-eval-fixtures-from-a-recorded-run.risks.md).
