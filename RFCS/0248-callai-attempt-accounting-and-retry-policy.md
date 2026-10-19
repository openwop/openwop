# RFC 0248: `ctx.callAI` reports its provider attempts and takes a per-call retry policy

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0248                                                            |
| **Title**         | `ctx.callAI` reports its provider attempts and output tokens, and takes a per-call retry policy |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | openwop-app host steward (for the Book AI pack, upstream proposal P7 items 2–3) |
| **Created**       | 2026-10-19                                                      |
| **Updated**       | 2026-10-19                                                      |
| **Affects**       | `spec/v2/core/host-services.md` §`aiProviders` · `spec/v2/facets/aiProviders.schema.json` (one optional object) · `spec/v1/host-capabilities.md` §`ctx.callAI` (the same fields, for v1 readers) · one new conformance scenario + one fixture node · CHANGELOG |
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

New scenario `callai-attempt-accounting`. It runs only when the matching flag is
advertised. It drives the existing mock-AI program seam
(`POST …/test/mock-ai/program`, used by `envelope-refusal-shape`) and a fixture
node, `conformance.callai.echo-attempts`, that writes its `ctx.callAI` result's
`attempts` to its output.

| Case | Program | Expect |
| --- | --- | --- |
| §A.1/A.2 | invalid JSON, then valid | `attempts.count: 2`; `outputTokens` = the two programmed usages summed |
| §A.2 | an attempt without usage | `usageComplete: false` |
| §B.1 | `maxAttempts: 1`, invalid JSON | one mock request; `envelope.retry.exhausted.totalAttempts: 1` |
| §B.2 | `growMaxTokens: false`, truncation, then valid | the second request's `maxTokens` equals the first |
| §B.5 | `maxAttempts: 0` | node fails `validation_error`, `details.field: retry.maxAttempts` |
| §A.5 | replay fork of the §A.1 run | `attempts` byte-equal to the source |

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 count = requests | the mock seam's request count vs `attempts.count` in the fixture node's output | the suite, via the mock-AI program seam | seam-gated |
| §A.2 summed tokens / `usageComplete` | programmed usages vs the echoed `attempts` | the suite, via the seam | seam-gated |
| §A.3 `structuredOutput` | the echoed value, for a provider the host maps natively | the suite, only where the mock declares a native mode | seam-gated |
| §A.5 replay equality | source vs fork `node.completed` outputs | the suite (`:fork` replay) | witnessable |
| §B.1 cap | the mock request count; `envelope.retry.exhausted.totalAttempts` | the suite, via the seam | seam-gated |
| §B.2 no budget growth | `maxTokens` on each mock request (the seam records requests) | the suite, via the seam | seam-gated |
| §B.5 malformed refused | `node.failed.error.code` + `details.field` | the suite, unaided | witnessable |

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
