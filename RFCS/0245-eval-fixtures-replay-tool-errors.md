# RFC 0245: Eval fixtures replay a recorded tool error as an error

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0245                                                            |
| **Title**         | Eval fixtures replay a recorded tool error as an error          |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-15                                                      |
| **Updated**       | 2026-10-18 — **erratum, suite 2.46.18:** the success leg asked the second `agent.tool-returned` to carry `outcome`. `outcome` is optional on a success (`run-event-payloads` `agentToolReturned`; RFC 0064 §F lets a host omit it), and this RFC owns only that the error entry is recorded as an error and the success entry is not. The leg now asserts the second return carries no `error` (and no `status: "error"` under tool hooks). Found by openwop-app's implementation (ADR 0929), before any host was judged by it. · 2026-10-18 — suite 2.46.17: the fixture `conformance-eval-fixture-error` and the three legs land in `v2-eval-trajectory-trials.test.ts`, with the judge in `lib/eval-fixture-error-witness.ts` (self-tests fail each wrong host answer). Two changes from the Conformance text below: the replay leg also gates on `agents.evalSuite.fixtureMatching`, because its error-then-success sequence needs RFC 0244 §D's first-unconsumed selection; and the server-free leg carries its own id, `openwop.requirement.0245.fixture-error-shape`. Still open for `Accepted`: a host witness. · 2026-10-15 — **`Draft` → `Active` in the filing PR, comment window waived by the maintainer (user instruction 2026-10-15)**; STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. Wire surface in this PR: optional v2 `toolResponses[].isError` and the `agents.evalSuite.fixtureErrors` member. The fixture `conformance-eval-fixture-error` and the two gated legs follow in the next suite cycle. `Accepted` waits on a host advertising `fixtureErrors` and passing `0245.fixture-error-replayed` non-vacuously. |
| **Affects**       | `schemas/v2/agent-eval-suite.schema.json` (optional `fixtures.toolResponses[].isError`) · `spec/v2/facets/agents.schema.json` (optional `agents.evalSuite.fixtureErrors`) · `RFCS/0244` §D (extended, not amended) · conformance: `v2-eval-trajectory-trials.test.ts` (one new gated leg), one new eval-suite fixture |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4. One optional item field and one optional capability member. A suite without `isError` is served exactly as RFC 0244 §D serves it today. No field is renamed, removed or narrowed, and no MUST relaxes. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

An RFC 0244 §D fixture entry is `{tool, args?, argsMatch?, response}`. It has no way to say that the call it records **failed**. This RFC adds an optional `isError` boolean to a `fixtures.toolResponses[]` entry. A host that serves an `isError: true` entry **MUST** return it to the agent as a tool error and record it as one, exactly as it would a live tool call that failed, never as a success. A capability member, `agents.evalSuite.fixtureErrors`, says the host implements this, and a suite that uses `isError` on a host that does not advertise it is refused.

## Motivation

The practice RFC 0244 §D enables is record-and-replay: promote a real run's tool boundary into a suite and grade the agent against it offline. Real tool boundaries contain failures. An upstream service is down, a tool returns `isError: true`, a rate limit answers.

Today such a call can only be stored as a plain `response`. On replay the host serves it as a **success**. The agent then sees a successful result carrying an error payload, takes the success branch, and the trajectory is graded against a world that never happened. Worse, the most valuable eval case (does the agent recover from a failing tool?) cannot be written at all. A host's only safe option today is to refuse or drop errored calls when it promotes a run, which loses exactly the cases worth testing.

The fix is small because the wire already has the concept twice:
- MCP's `CallToolResult.isError`, which `spec/v2/core/host-services.md` §`callTool` pins (`isError` MUST pass through unaltered);
- `agent.tool-returned`, which carries `error` (an `_errorObject`) mutually exclusive with `outcome`, and `status: "error"` under RFC 0064 tool hooks.

The fixture shape is the only place the distinction is missing.

## Proposal

### §A — The fixture field

A `fixtures.toolResponses[]` entry gains one optional member:

```jsonc
{ "tool": "billing:lookup", "args": { "id": "c-1" }, "argsMatch": "exact",
  "isError": true,
  "response": { "content": [{ "type": "text", "text": "{\"error\":\"upstream_down\"}" }] } }
```

- `isError`: boolean, default `false`. Absent or `false`, the entry is served exactly as RFC 0244 §D serves it.
- `response` stays opaque. With `isError: true` it is the error payload the failing tool returned.

Selection and consumption are unchanged (RFC 0244 §D): an `isError` entry is matched, served and consumed like any other entry, so a scripted sequence can fail on its second call and succeed on its third.

### §B — Serving an error entry

A host serving an entry with `isError: true` **MUST**:
- return it to the agent as a **tool error**, the same way it returns a live tool call that failed (for an MCP-shaped tool, a `CallToolResult` with `isError: true` and `response` as its content);
- emit `agent.tool-returned` for the call with `error` set and **no** `outcome`, and, when it advertises `toolHooks.prePostEvents`, `status: "error"`. `error.code` is the code the host uses for a failed tool execution (a registered code or a vendor code, `errors.md` §The registry); `error.message` is non-empty;
- **MUST NOT** count the call as a fixture miss: it was served, so `fixtureMissCount` is unchanged.

A host **MUST NOT** serve an `isError: true` entry as a success, and **MUST NOT** retry it against a live tool, whatever `onMiss` says. `onMiss` governs calls that match no entry, and this call matched one.

Trajectory grading (RFC 0244 §A) is unchanged: it grades the agent's **calls** (`agent.tool-called`), and a call answered with an error is still a call. What changes is what the agent saw, and therefore what it does next.

### §C — Capability and refusal

`agents.evalSuite` gains one optional member, `fixtureErrors: true`. A host **MUST** advertise it only if it implements §B (RFC 0031).

At run create, a suite carrying any `toolResponses[]` entry with `isError: true` on a host that does not advertise `fixtureErrors` **MUST** be rejected with `400 validation_error` naming the field. This is the RFC 0244 §G rule, extended to one more feature. A host **MUST NOT** silently serve the entry as a success.

The schema closes the same hole from the other side: the item object is `additionalProperties: false`, so a host that validates suites against the RFC 0244 schema already refuses an `isError` suite. The capability exists for the host that does not validate strictly. For that host, ignoring the field is exactly the bug this RFC fixes, so an explicit advertisement is the only honest signal a suite author can check.

### §D — Safety

- **Error payloads are untrusted tool output.** RFC 0244 §H applies unchanged: an injected error payload reaches the model like any tool result and gets the same untrusted-content handling.
- **Content-free summary, unchanged.** No new field reaches `EvalSummary` or an `eval.*` event. `agent.tool-returned.error` already exists on the wire, and the RFC 0244 rule that suite content never echoes onto the wire covers `response`. A host **SHOULD** put a short, fixed `error.message` on the event rather than echo the payload.
- **Replay.** A served error is a recorded fact on the event log (`replay.md` §Recorded-fact events). A replay or fork re-reads the `agent.tool-returned` event and never re-serves or re-judges.

### Examples

**Positive.** On a host advertising `fixtureErrors`, a task's fixtures script `billing:lookup` twice: first `isError: true` (`upstream_down`), then a success. The scripted agent calls it twice. The log carries two `agent.tool-called` events and two `agent.tool-returned` events: the first with `error` and no `outcome`, the second with no `error` (`outcome` is optional). `fixtureMissCount` is 0.

**Negative (capability).** The same suite on a host advertising `evalSuite` without `fixtureErrors` → `400 validation_error` naming `fixtures.toolResponses[0].isError`.

**Negative (schema).** `isError: "true"` (a string) fails the type.

**Negative (behaviour).** A host that serves the `upstream_down` entry and emits `agent.tool-returned` with `outcome` set has replayed a failure as a success, and violates §B.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4). One optional item field and one optional capability member.

- **Old suites are unaffected.** A suite without `isError` is served exactly as before.
- **Old hosts fail closed, both ways.** A host validating against the RFC 0244 schema refuses the unknown member. A host that advertises `evalSuite` without `fixtureErrors` is refused by the suite author's own pre-check and by §C on hosts that implement it.
- **No event shape changes.** `agent.tool-returned` already carries `error` and `status`; this RFC only says when a fixture-served call uses them.
- **Event-log version.** No `eventLogSchemaVersion` bump.

## Conformance

**Existing coverage:** `v2-eval-trajectory-trials.test.ts` (server-free legs plus four host legs gated on `agents.evalSuite` members and fixtures).

**New, in `v2-eval-trajectory-trials.test.ts`:**
- **Server-free.** A suite with `isError: true` validates; `isError: "true"` fails; the new fixture validates.
- **Host leg, `openwop.requirement.0245.fixture-error-replayed`.** Gated on `agents.evalSuite.fixtureErrors`, `agents.evalSuite.fixtureMatching` (the sequence needs RFC 0244 §D's first-unconsumed selection) and the fixture `conformance-eval-fixture-error` in discovery `fixtures`. One task scripts `core.conformance.agents.scripted` to call the same tool twice, with fixtures serving an `isError: true` entry and then a success. The leg asserts:
  - two `agent.tool-called` and two `agent.tool-returned` events for the task;
  - the first `agent.tool-returned` carries `error` (non-empty `code` and `message`) and no `outcome`, plus `status: "error"` when `toolHooks.prePostEvents` is advertised;
  - the second carries no `error` (and no `status: "error"` under tool hooks); `outcome` is optional;
  - the summary's `fixtureMissCount` is 0.
- **Host leg, `openwop.requirement.0245.unadvertised-refused`.** On a host advertising `evalSuite` without `fixtureErrors` that lists `conformance-eval-fixture-error`, `createRun` → `400 validation_error`. It is `inapplicable` on every host that advertises the member.

Like the RFC 0244 host legs, both drive the scripted conformance agent, so they are `inapplicable` on a host that does not list its fixtures (for example openwop-app in its authenticated production posture).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B an `isError` entry is recorded as a tool error | the served call's `agent.tool-returned` has `error`, no `outcome` (and `status: "error"` under tool hooks) | the suite, via the scripted agent and `conformance-eval-fixture-error` (`openwop.requirement.0245.fixture-error-replayed`) | witnessable (seam-gated: the scripted agent) |
| §B a served error is not a miss | `fixtureMissCount` is 0 | the suite, same fixture (`openwop.requirement.0245.fixture-error-replayed`) | witnessable (seam-gated) |
| §B the agent receives it as a tool error | what the model saw, and the branch it took | needs an agent that really reads tool results and exposes its branch; the scripted agent's results are scripted | **seam-gated** (G1, the RFC 0244 G2 gap) |
| §B never retried live | the live tool's invocation count | needs a conformance tool with an effect counter | **seam-gated** (RFC 0244 G2) |
| §C refusal without `fixtureErrors` | `400 validation_error` | the suite, given a host advertising `evalSuite` without `fixtureErrors` that lists the fixture (`openwop.requirement.0245.unadvertised-refused`) | witnessable — gated: `inapplicable` on every host that advertises it |
| §A schema | an `isError` suite validates; a string `isError` fails | the suite, unaided (`openwop.requirement.0245.fixture-error-shape`, server-free) | witnessable |

## Alternatives considered

1. **Amend RFC 0244 §D in place.** Rejected. 0244 is `Accepted` and this adds a MUST and a capability member. An in-place amendment is reserved for corrections no host could have relied on (RFCS/README §"When a correction needs a new number"), and two hosts implement 0244 today.
2. **Encode the error inside `response` by convention** (for example, a `CallToolResult` with `isError: true` inside `response`). Rejected. `response` is opaque by RFC 0244; a host cannot tell a recorded failure from a successful result that happens to carry an `isError` key, which is the ambiguity this RFC exists to remove.
3. **A fixture-level `error: {code, message}` object instead of a boolean.** Considered. It would let a suite pin the `error.code` the host emits. Rejected for now: no registered code for a failed tool execution exists, and pinning a vendor code in a portable suite would make it host-specific. Recorded as UQ 1.
4. **No capability member; rely on `additionalProperties: false`.** Rejected (§C): it fails closed only on hosts that validate strictly.

## Unresolved questions

1. **A portable tool-failure error code.** Should `errors.json` register one (for example `tool_execution_failed`), so a suite can assert `error.code` across hosts? Out of scope here; the leg asserts only that `code` is non-empty.
2. **Non-MCP tools.** For a host-native tool with no `CallToolResult` shape, "the same way it returns a live failing call" is host-defined. Is that enough, or should §B name the agent-facing shape?

## Implementation notes (non-normative)

**openwop-app** refuses or omits errored calls when it promotes a run into a suite (a typed reason), as a stopgap until this RFC is `Active`; it then implements §B and advertises `fixtureErrors`. **MyndHyve** advertises `fixtureMatching` and is the likely first witness in conformance posture.

## Acceptance criteria

- [x] `schemas/v2/agent-eval-suite.schema.json` carries optional `toolResponses[].isError` (boolean); the item stays `additionalProperties: false`.
- [x] `spec/v2/facets/agents.schema.json` carries `agents.evalSuite.fixtureErrors` with the §B and §C rules in its description.
- [x] The fixture `conformance-eval-fixture-error` under `fixtures/eval-suites/`, with its contract in `fixtures.md`. *(2026-10-18, suite 2.46.17.)*
- [x] The server-free legs and the two gated host legs in `v2-eval-trajectory-trials.test.ts`. *(2026-10-18, suite 2.46.17; judge `lib/eval-fixture-error-witness.ts`.)*
- [x] CHANGELOG entry.
- [ ] A host advertises `fixtureErrors` and passes `0245.fixture-error-replayed` non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`.

## References

- `RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md` §D (fixture matching), §G (refusal), §H (safety); its G2 (no conformance tool with an effect counter) and G5 (portable "fixtures = run X").
- `RFCS/0081-agent-evaluation-and-scorecards.md`; `RFCS/0064` (tool hooks, `status`); `RFCS/0031` (advertise only what you implement).
- `spec/v2/core/host-services.md` §`callTool` (MCP `CallToolResult.isError` passes through unaltered).
- `schemas/v2/run-event-payloads.schema.json` `agentToolReturned` (`error` mutually exclusive with `outcome`).
- Reported by openwop-app's eval grade pass, finding AEV-6 (2026-10-15).
