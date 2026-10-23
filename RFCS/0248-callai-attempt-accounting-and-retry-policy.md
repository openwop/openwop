# RFC 0248: `ctx.callAI` reports its provider attempts and takes a per-call retry policy

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0248                                                            |
| **Title**         | `ctx.callAI` reports its provider attempts and output tokens, and takes a per-call retry policy |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts), for the Book AI pack (upstream proposal P7 items 2–3) |
| **Created**       | 2026-10-19                                                      |
| **Updated**       | 2026-10-23 — **`Active → Accepted`**; RFC 0156 §B review deferred by steward exemption (2026-10-17). Evidence tier: tier-1 — openwop-app's certified 2.46.19 production cut (build `commit:f17ee3753`, revision `openwop-app-backend-01025-lg2`, 468/0/0, `--verify --host-key` VERIFIED) advertises `aiProviders.callAccounting {attempts, retryPolicy}`, lists the fixture, and records all eight `0248.*` rows `executed-pass`, as pre-registered. Known host tensions stay with the host (app ADR 0966): a `usage: false` attempt emits no `provider.usage`, and a replay fork re-dispatches the mock instead of reusing recorded facts. · 2026-10-22 — **suite 2.46.19: the legs land, witnessed without a seam.** The mock-AI program seam this RFC named exists only at the frozen v1 path, and declaring it at v2 would raise the seam count, which `conformance.md` §Witness class forbids. So the fixture `conformance-callai-attempt-accounting` scripts the mock through its node's inputs, as RFC 0244's scripted agent does. The suite reads `provider.usage` (one per provider invocation, `events.md` §`providerUsage`), `envelope.retry-exhausted` and the node's outputs, all normative, so every row is `witnessable-gated` and no MUST is demoted. The rules live in the `aiProviders.callAccounting` facet descriptions: the core budget is at its cap, and RFC 0244/0245 set the precedent. The `spec/v1/host-capabilities.md` row is dropped, because `spec/v1/` is frozen. The wire in §A–§C is unchanged. · 2026-10-22 — **`Draft` → `Active`**, comment window waived by the maintainer (2026-10-22: "Waive the comment window on RFC 0248 and proceed to active"). **STEWARD OVERRIDE of RFC 0147 §A.6**, which forbids shortening the window for an RFC affecting replay: §A.5 makes `attempts` part of the recorded outcome that a replay MUST reproduce. Recorded in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0001 §5 note: the cross-organization approval rule is not yet active (one maintainer, one organization; `GOVERNANCE.md` §"Sole-steward operation"). The wire shape in §A–§C is now locked. The evidence gate is not waived: `Accepted` needs a deployed host advertising `aiProviders.callAccounting` and passing the `callai-attempt-accounting` legs. · 2026-10-19 — filed `Draft`. |
| **Affects**       | `spec/v2/facets/aiProviders.schema.json` (one optional object; its descriptions carry the §A and §B rules) · `spec/v2/core/host-services.md` §`aiProviders` (a one-line pointer, word-neutral) · `spec/v2/declaration.json` (`aiProviders` facets) · conformance: `v2-callai-attempt-accounting.test.ts`, fixture `conformance-callai-attempt-accounting` with node `conformance.callai.echo-attempts` · CHANGELOG |
| **Compatibility** | `additive`                                                      |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

One `ctx.callAI` call can make several provider requests. Under RFC 0032 a host
retries a schema violation, retries a truncation with a larger budget (RFC 0033),
and may add a natural-language-to-JSON fallback. The pack sees none of this: the
result's `usage` describes one attempt, so a node that budgets by calls or tokens
under-counts what the provider was sent. This RFC adds an optional `attempts`
record to the result (request count, summed output tokens, structured-output
mode). It also adds an optional per-call `retry` policy, so a node that already
repairs its own output can turn host retries off, or stop the budget from growing
on truncation. Both are advertised under `aiProviders.callAccounting`.

## Motivation

The Book AI pack (`openwop/bookai`) shows an author an estimate before every run
and enforces a per-node call budget (`maxCalls`). Both count `ctx.callAI` calls.
On the reference host (openwop-app), a structured call can make up to three
provider requests by default. A truncated reply is retried with `maxTokens`
doubled, and one natural-language fallback may follow. So the provider can
receive more requests, and produce more output tokens than the author's
`maxTokens`, than either the estimate or the budget shows.

The pack already validates every reply closed-world and does one error-fed
repair of its own. The host's retries are a second, invisible loop around the
pack's loop. This is spec surface rather than host choice because the pack
author cannot observe the loop (the result's shape is the contract) and cannot
control it (the request's shape is the contract). And every host that implements
RFC 0032 retries has the same gap.

The reliability events RFC 0032 defines (`envelope.retry.*`) are on the run event
log, not in the result. A node would have to read its own run's log mid-execution
to count its attempts, which no pack ABI offers.

## Proposal

### §A Attempt accounting on the result

A host advertising `aiProviders.callAccounting.attempts: true` MUST add an
`attempts` record to every `ctx.callAI` result:

```typescript
attempts?: {
  count: number,            // integer ≥ 1: the provider requests this call made, retries and fallbacks included
  outputTokens?: number,    // integer ≥ 0: output tokens summed over every attempt that reported usage
  usageComplete: boolean,   // false when any attempt reported no usage (so outputTokens is a floor)
  structuredOutput?: 'native' | 'prompt',  // only when `responseSchema` was supplied: which mode the FINAL attempt used
}
```

- **A.1** `count` MUST equal the number of requests the host sent to a provider
  for this call. It includes schema-violation retries, truncation retries and a
  natural-language fallback. A request refused before it reached the provider
  (a policy denial) is not an attempt.
- **A.2** `outputTokens` MUST be the sum of the output tokens each attempt's
  provider response reported. When any attempt reported none, `usageComplete`
  MUST be `false`.
- **A.3** `structuredOutput` is `native` when the final attempt used the
  provider's own structured-output mechanism (a JSON-schema response format, a
  forced tool call), and `prompt` when it used a prompt-embedded schema.
- **A.4** `usage` keeps its current meaning: it describes the attempt whose
  output the result carries. Existing readers are unaffected.
- **A.5** On replay, `attempts` MUST equal the recorded value. It is part of the
  call's recorded outcome, like `envelope.retry.exhausted.totalAttempts` (RFC 0032
  §D).
- **A.6** A call that fails (throws) carries no result. The count for a failed
  call is already on `envelope.retry.exhausted.totalAttempts`, so this RFC adds
  nothing to the error.

### §B Per-call retry policy on the request

A host advertising `aiProviders.callAccounting.retryPolicy: true` MUST honour an
optional `retry` field on the `ctx.callAI` request:

```typescript
retry?: {
  maxAttempts?: number,     // integer 1..16: the most provider requests this call may make
  growMaxTokens?: boolean,  // default true; false = a truncation retry keeps the request's maxTokens
}
```

- **B.1** The host MUST NOT send more than `maxAttempts` provider requests for
  the call. `maxAttempts: 1` turns host retries off. A host MAY make fewer
  requests than the cap.
- **B.2** With `growMaxTokens: false`, the host MUST NOT send any attempt with a
  `maxTokens` above the request's `maxTokens`, or above the host default when the
  request names none.
- **B.3** The policy narrows; it never widens. A `maxAttempts` above the host's
  own ceiling is clamped to that ceiling, not refused. RFC 0032 §B.3 (no retry
  after a refusal) is unaffected.
- **B.4** RFC 0032 events still fire. With `maxAttempts: 1`, a failed call emits
  `envelope.retry.exhausted` with `totalAttempts: 1`, as §B.2 there already
  requires of a host that does not retry.
- **B.5** A malformed `retry` (a non-integer, or out of range) MUST be refused
  with `validation_error` and `details.field` naming the key. It MUST NOT be
  ignored.

### §C Advertisement

```diff
 // spec/v2/facets/aiProviders.schema.json — properties
+    "callAccounting": {
+      "type": "object",
+      "properties": {
+        "attempts": { "type": "boolean", "description": "RFC 0248 §A — ctx.callAI results carry `attempts`." },
+        "retryPolicy": { "type": "boolean", "description": "RFC 0248 §B — ctx.callAI honours a per-call `retry`." }
+      },
+      "additionalProperties": false
+    }
```

The two flags are independent. A pack MUST NOT rely on either field unless the
flag is `true`. A host that does not advertise `retryPolicy` is not bound by
§B.5, and an older host ignores an unknown request field.

### Examples

Positive, with both flags advertised. The first attempt truncates and the second
completes:

```json
{ "data": { "scene": "…" }, "usage": { "outputTokens": 1800 },
  "attempts": { "count": 2, "outputTokens": 3800, "usageComplete": true, "structuredOutput": "native" } }
```

The same call with `retry: { maxAttempts: 1 }` makes one request, and on
truncation throws with `envelope.retry.exhausted { totalAttempts: 1 }`.

Negative: `retry: { maxAttempts: 0 }` and `retry: { maxAttempts: 2.5 }` are both
refused with `validation_error`, `details.field: "retry.maxAttempts"`.

## Compatibility

`additive` (`COMPATIBILITY.md` §4, "new optional field"):

- both new fields are optional;
- `usage` is unchanged;
- a host that does not advertise `callAccounting` neither emits `attempts` nor
  reads `retry`;
- a pack that does not send `retry` gets today's behaviour.

## Conformance

New scenario `v2-callai-attempt-accounting`. It needs no seam. The fixture `conformance-callai-attempt-accounting`, listed in discovery `fixtures`, has one node, `conformance.callai.echo-attempts`. That node makes one `ctx.callAI` call through the host's conformance mock, which serves the run's `script` (one reply per provider request, contract in `fixtures.md`). It then writes the result's `attempts` to its output. The suite wrote the script, so it knows what each request returned. Where the host advertises `providerUsage`, `provider.usage` (exactly one per provider invocation) corroborates it. The mock clamps each reported `outputTokens` to that request's `maxTokens`, which makes budget growth visible. Judges live in `lib/callai-attempts-witness.ts`.

| Id | Case | Expect |
| --- | --- | --- |
| `0248.attempts-count` | invalid JSON, then valid | `attempts.count` equals the `provider.usage` count |
| `0248.output-tokens-sum` | the same run | `outputTokens` equals the scripted usages summed and the summed `provider.usage`; `usageComplete: true` |
| `0248.usage-incomplete` | one reply with `usage: false` | `usageComplete: false` |
| `0248.structured-output` | no `responseSchema`; then a mock declaring `native` | absent; then `"native"` |
| `0248.attempts-replayed` | a replay fork of the count run | `attempts` byte-equal to the source |
| `0248.max-attempts-cap` | `maxAttempts: 1`, invalid first reply | the call fails; at most one `provider.usage`; `retry-exhausted.totalAttempts: 1` when emitted |
| `0248.no-budget-growth` | `growMaxTokens: false`, truncated, then a reply that fits only a grown budget | the call does not complete; no `provider.usage.outputTokens` above `maxTokens` |
| `0248.retry-malformed-refused` | `maxAttempts: 0` | node fails `validation_error`, `details.field: retry.maxAttempts` |

Each leg is gated on its `callAccounting` flag and the fixture, and the replay leg also on `replay.modes` including `replay`. A count run that fails because the host does not retry a schema violation is `blocked`, not judged.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 count = requests | `attempts.count` vs the `provider.usage` count | the suite, through the fixture's script | witnessable-gated |
| §A.2 summed tokens | `outputTokens` vs the scripted usages and the summed `provider.usage` | the suite, through the script | witnessable-gated |
| §A.2 `usageComplete` | a scripted no-usage reply vs the echoed flag | the suite, through the script | witnessable-gated |
| §A.3 `structuredOutput` | absent without `responseSchema`; the mode the script declared | the suite, through the script | witnessable-gated |
| §A.5 replay equality | source vs fork `node.completed` outputs | the suite (`:fork` replay) | witnessable-gated |
| §B.1 cap | the call's outcome; the `provider.usage` count; `retry-exhausted.totalAttempts` | the suite, through the script | witnessable-gated |
| §B.2 no budget growth | the call's outcome; `provider.usage.outputTokens` against `maxTokens` (the mock clamps) | the suite, through the script | witnessable-gated |
| §B.5 malformed refused | `node.failed.error.code` + `details.field` | the suite, unaided | witnessable-gated |

## Acceptance criteria

- [x] `spec/v2/facets/aiProviders.schema.json` carries optional `callAccounting {attempts, retryPolicy}` with the §A and §B rules in its descriptions; `spec/v2/declaration.json` lists the facet. *(2026-10-22, suite 2.46.19.)*
- [x] The fixture `conformance-callai-attempt-accounting`, with its contract in `fixtures.md`. *(2026-10-22, suite 2.46.19.)*
- [x] The eight legs in `v2-callai-attempt-accounting.test.ts`, with the judges in `lib/callai-attempts-witness.ts` (self-tests fail each wrong host answer). *(2026-10-22, suite 2.46.19.)*
- [x] CHANGELOG entry.
- [x] A host advertises `callAccounting` and passes all eight `0248.*` legs non-vacuously. *(2026-10-23: openwop-app, 2.46.19 cut `f17ee3753`, 22 assertions.)*

## Security considerations

`attempts` carries counts and an enum only, never text from an attempt, so it
adds no redaction surface. `retry` can only reduce the requests a host makes,
which cannot raise spend or open a circumvention path. The RFC 0032 rule against
retrying a refusal still holds when a cap is higher.

## Unresolved questions

1. Should `attempts` also carry `inputTokens`? Prompt caching makes a per-attempt
   input sum misleading. Left out until a consumer needs it.
2. Should `ctx.callAIWithTools` get the same record? Its loop is the pack's, not
   the host's, so it is out of scope here.

## Status history

- 2026-10-19 — Draft.
- 2026-10-22 — Active (comment window waived; STEWARD OVERRIDE of RFC 0147 §A.6, see Updated).
- 2026-10-23 — Accepted (tier-1, openwop-app cut `f17ee3753`; §B review deferred by steward exemption).
