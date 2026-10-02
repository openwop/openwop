# RFC 0231: a host says which budget exhaustion behaviours it serves

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0231                                                            |
| **Title**         | a host says which budget exhaustion behaviours it serves        |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-02                                                      |
| **Updated**       | 2026-10-02 — **`Draft → Active`. Comment window waived** (7-day, 0 days elapsed, not run) by the steward under `GOVERNANCE.md` §"Sole-steward operation" (steward direction 2026-10-02: "waive the window and go Active now"), logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC adds a capability facet and a create-time refusal with an existing code, and changes no identity, authorization, isolation, idempotency, replay, external-effect or certification decision; `budget` is on no profile floor. The schema, prose and scenario land with the flip. The evidence gate is not waived. · 2026-10-02 — G1 and G5 decided by the maintainer: an absent facet means both values, as today, and the facet lands in both majors. Unresolved questions 1 and 4 are closed. · 2026-10-02 — filed `Draft`. The 7-day comment window opens with the pull request and closes 2026-10-09. |
| **Affects**       | the `budget` capability record: a new optional facet `onExhaustion` in `schemas/capabilities.schema.json` (the v1 seed, from which `schemas/v2/capabilities.schema.json` is derived) · `spec/v1/budget-policy.md` §D and `spec/v1/capabilities.md` §budget · `spec/v2/core/runs.md` §`budget` section (one bullet) · one new conformance scenario (major 2) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2): one optional facet. A host that does not advertise it is bound exactly as it is today. See §Compatibility for the one point a reviewer should check. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A run's `budget` names what happens when a hard dimension is exhausted: `onExhaustion: "fail"` or `"interrupt"`. A host that advertises `budget` can say which dimensions it enforces and whether it enforces them, and nothing about which of those two behaviours it serves. This RFC adds an optional facet, `budget.onExhaustion`, that lists them. A host that lists only `fail` refuses a run asking for `interrupt` with `422 capability_not_provided`, and never accepts the run and applies a different behaviour.

## Motivation

**The spec states both behaviours and gates neither.** `spec/v2/core/runs.md` §`budget` section says that hard exhaustion under `fail` fails the run, and that "under `interrupt` it raises an approval whose `resumeValue` adds budget". `spec/v1/budget-policy.md` §D says the same. The `budget` record has `dimensions`, `enforce` and `scopes`. None of them can express "`fail` only".

**No host serves `interrupt`, and each handles that differently.**

- The v2 reference host advertises `budget { dimensions: ["toolCalls"], enforce: "hard", scopes: ["run"] }`. It refuses `onExhaustion: "interrupt"` at create with `422 capability_not_provided`, and its README records this as a deviation (openwop-examples #146; certified on suite 2.45.5, #1846).
- MyndHyve advertises `budget` at major 2 with all five dimensions and `enforce: "hard"`. Its session reports, from source and not from a run, that it has no budget-extending approval.

So a client that reads either advertisement cannot tell that `interrupt` is unavailable until a run is refused, or worse, until an exhausted run fails where the client expected an approval.

**The dangerous case is the silent one.** A host that accepts `interrupt` and then fails the run has at least stopped the spend. A host that accepts it and does neither has removed the cap the client set. The spec has no rule that separates "refuse" from "ignore" here, because it assumes every advertising host serves both.

**Why the spec.** Which request values a host serves is a wire fact a client needs before it sends the request. `enforce` and `dimensions` already narrow the same record for the same reason.

## Proposal

### §A. The facet

The `budget` capability record gains one optional member:

```json
"budget": {
  "dimensions": ["toolCalls"],
  "enforce": "hard",
  "scopes": ["run"],
  "onExhaustion": ["fail"]
}
```

- `onExhaustion` is an array of the `BudgetPolicy.onExhaustion` values the host serves: `"fail"`, `"interrupt"`.
- It has at least one item and no duplicates.
- It MUST contain `"fail"`. `fail` is the default when a run names no `onExhaustion`, so a host that cannot fail an exhausted run does not enforce the budget.

The facet takes the request field's own name, as `dimensions` and `enforce` name what they narrow.

### §B. What the facet means

1. **Present.** The list is exact. The host serves each listed value and no other.
2. **Absent.** Nothing changes: the host is taken to serve both values, as `runs.md` and `budget-policy.md` state today.
3. **Under `enforce: "advisory"`.** An advisory host never stops a run, so no exhaustion behaviour applies. Such a host SHOULD omit the facet, and a consumer MUST ignore it there.

### §C. Refusing an unserved value

1. A host that advertises the facet MUST refuse a `createRun` whose `budget.onExhaustion` is not in the list with `422 capability_not_provided`. It creates no run and emits no event.
2. A host MUST NOT accept such a run and apply a different behaviour, and MUST NOT accept it and ignore the field.
3. Where the host records `onExhaustion` in `budget.reserved`'s effective budget, the recorded value MUST be the behaviour it will apply.

§C.1 and §C.2 give a client one of two outcomes for the value it asked for: the run is refused before it spends, or the run gets that behaviour.

### §D. Schema

`schemas/capabilities.schema.json`, in the `budget` record (derived unchanged into `schemas/v2/capabilities.schema.json`):

```diff
   "enforce": { "type": "string", "enum": ["hard", "advisory"], "description": "…" },
+  "onExhaustion": {
+    "type": "array",
+    "minItems": 1,
+    "uniqueItems": true,
+    "items": { "type": "string", "enum": ["fail", "interrupt"] },
+    "contains": { "const": "fail" },
+    "description": "The `BudgetPolicy.onExhaustion` values the host serves under `enforce: \"hard\"`. Exact when present. Absent: both. A value not listed is refused `422 capability_not_provided` at create, never applied as another behaviour and never ignored (RFC 0231)."
+  },
```

- **Valid:** `["fail"]`, `["fail", "interrupt"]`.
- **Invalid:** `[]`, `["interrupt"]`, `["fail", "fail"]`, `"fail"`.

`budget-policy.schema.json` does not change. No endpoint, event or error code is added: `capability_not_provided` is registered, and `runs.md` already uses it for `mode: "eval"` on a host that does not advertise `agents.evalSuite`.

### §E. Prose

- **`spec/v2/core/runs.md` §`budget` section** gains one bullet: a host that lists `onExhaustion` serves exactly those values and refuses any other `422 capability_not_provided`. The existing bullet that describes `interrupt` is reworded to apply where the host serves it. This is about 40 words against a kernel budget with 516 to spare.
- **`spec/v1/budget-policy.md` §D** and **`spec/v1/capabilities.md` §budget** gain the same rule for the overlap period.
- The refusal joins the list of create-time refusals wherever each major keeps it.

### §F. Conformance

One scenario file, `v2-budget-exhaustion-facet.test.ts` (major 2), over `lib/exhaustion-facet-witness.ts`.

| Requirement id | Assertion | Gate |
| --- | --- | --- |
| `openwop.requirement.runs.budget-exhaustion-facet-contains-fail` | an advertised `onExhaustion` is a non-empty list of `fail` and `interrupt` that contains `fail` | facet present, `enforce: "hard"` |
| `openwop.requirement.runs.budget-unserved-exhaustion-refused` | `createRun` with `onExhaustion: "interrupt"` answers `422 capability_not_provided` | facet present, without `interrupt`, `enforce: "hard"`, and a fixture advertised to name in the create |

**No major-1 twin.** The suite's major-1 profile gives a run budget no `createRun` surface it drives (`lib/major-profile.ts`); the v1 budget scenario goes through a host seam. The v1 rule is stated in `budget-policy.md` §D and is unwitnessed (gap G7).

**Dispositions.**
- `budget` not advertised, `enforce: "advisory"`, or the facet absent: `inapplicable`.
- No fixture advertised: the refusal row is `inapplicable`, because the suite has no workflow to name in an otherwise valid create.
- The facet lists `interrupt`: the refusal row is `inapplicable`. The served path has no witness yet (gap G2).

**Sabotage.** `lib/exhaustion-facet-witness.test.ts` proves it both ways against the scratch host. A conforming `["fail"]` host passes. The refusal row fails against a host that accepts the run, one that answers `400 validation_error`, and one that answers `422` with another code. A list without `fail`, an empty list and a bare string fail the first row.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A the list contains `fail` | the discovery document | anyone, by reading it | witnessable — unaided |
| §B.1 the host serves `fail` where listed | `cap.breached` and a `budget_exhausted` failure, as `v2-budget-enforcement` already asserts | the suite, with the budget fixture | witnessable — gated |
| §B.1 the host serves `interrupt` where listed | an approval on exhaustion, then a second `budget.reserved` after the resume | nobody yet | unwitnessable — the resume that extends the budget has no specified shape, so no suite can drive it (G2) |
| §C.1 an unlisted value is refused | `422 capability_not_provided`, no `runId` | the suite, unaided | witnessable — gated (the facet) |
| §C.2 never applied as another behaviour, never ignored | follows from §C.1 on the same request: a refused create has no run to mis-handle | the suite, unaided | witnessable — gated, through §C.1 |
| §C.3 the recorded value is the applied one | `budget.reserved`'s effective budget against the run's terminal | the suite, with the budget fixture | witnessable — gated, where the host records the field |

### §G. Security argument

- **No credential or tenant surface.** The facet is a list of two enum values. The refusal is an existing code, raised before a run exists.
- **Spend control.** §C.2 is the rule with a security edge. A client sets a cap and asks for a human decision at the cap. A host that ignores the field can leave the run uncapped. Refusing at create is the fail-closed answer.
- **No pricing.** The refusal carries no rate card, price or cost, so `budget-no-pricing-leak` is untouched.
- **Invariants.** No new `SECURITY/invariants.yaml` row: the rule is a capability refusal, witnessed by the row in §F.

## Compatibility

`additive`.

- **No field changes type or becomes required.** The facet is optional, and `BudgetPolicy` is untouched.
- **No event or endpoint changes.**
- **No error code changes meaning.** `capability_not_provided` is already "the host does not provide what the request needs".
- **A host that does not advertise the facet is bound as today** (§B.2).
- **A client that does not read the facet** sends `interrupt` to a `["fail"]` host and gets a `422` at create, before any spend.

**The point to check.** Today's text binds every advertising host to serve `interrupt`. This RFC lets a host stop serving it by advertising `["fail"]`. That narrows what a client may assume from a `budget` advertisement. The argument that it is still additive:

- the narrowing is visible in discovery, before the request;
- `dimensions` and `enforce` narrow the same record the same way;
- no host is known to serve `interrupt` (one measured, one reported from source; gap G6), so no client is known to depend on it.

The maintainer decided this on 2026-10-02 (G1): an absent facet keeps today's meaning, and the RFC is additive. A reviewer who reads the narrowing as relaxing a MUST should say so in the window.

## Alternatives considered

1. **Do nothing; hosts implement the approval.** This is the other closure the TODO names. It leaves the spec with a behaviour every host must build, though the resume payload that extends the budget was never pinned (RFC 0084, Unresolved question 5). It also leaves no honest advertisement for a host that enforces a budget and has no interrupt family.
2. **Absent means `["fail"]`.** Simpler for clients: `interrupt` is served only where listed. It changes what today's advertisements mean, so it relaxes an existing rule for every host at once. Rejected for this RFC, and kept as Unresolved question 1 because it matches what hosts actually do.
3. **A boolean, `interruptOnExhaustion`.** Smaller, but it cannot take a third behaviour, and it invents a name where the request field already has one.
4. **Tie `interrupt` to the `interrupts` family.** A host with no approval interrupts plainly cannot serve it. But a host can serve approvals and still not wire them to budgets, so the inference fails in the direction that matters.
5. **Remove `interrupt` from the enum.** No host serves it. Removal is a v2 retirement (RFC 0197) of a surface one production host may yet build, and v1 would keep it through the overlap.

## Unresolved questions

1. ~~**What should an absent facet mean?**~~ **Resolved 2026-10-02 (maintainer decision, G1): both values, as today.** The RFC stays additive. "`fail` only" matches every host measured, but it would change what today's advertisements mean.
2. **Should the refusal say what is served?** `unsupported_stream_mode` carries `details.supported`. `capability_not_provided` has no registered details schema, and registering one binds every use of the code. The facet already answers the question in discovery.
3. **Is the `interrupt` path specified well enough to witness?** `runs.md` says the `resumeValue` "adds budget" and does not give its shape. Until it does, no suite can drive the resume (G2). That is RFC 0084's open question, not this RFC's, but this RFC is where a reader will look for it.
4. ~~**Does a v1 host need the facet?**~~ **Resolved 2026-10-02 (maintainer decision, G5): yes.** The facet goes in the v1 seed and is derived into v2, so both majors carry it through the overlap.

## Implementation notes (non-normative)

**The v2 reference host** already behaves as §C requires. It needs only `onExhaustion: ["fail"]` in its advertisement, and its README's "deviation" note can go.

**MyndHyve** enforces `budget` only behind a v1 seam at major 2, by its session's report. Advertising `["fail"]` is honest once the v2 path enforces at all.

**The suite.** The refusal leg sends one `createRun` and reads the status and code, so it needs no fixture. `v2-budget-enforcement` sends only `fail` and does not change.

**Sequencing.** Schema and prose first, then the scenario with its sabotage proof, then the reference host's advertisement, then a certified cut.

## Acceptance criteria

- [x] `Active` (2026-10-02, window waived by the steward, not closed): the comment window closes (2026-10-09) with no unresolved objection. Unresolved questions 1 and 4 are decided (2026-10-02).
- [x] The facet is in the v1 seed and derived into `schemas/v2/capabilities.schema.json`; the prose of §E is merged; `CHANGELOG.md` records it.
- [x] The scenario file ships, each row failing on its sabotage (suite 2.45.6; `lib/exhaustion-facet-witness.test.ts`, nine cases).
- [ ] `Accepted`: `openwop.requirement.runs.budget-unserved-exhaustion-refused` is `executed-pass` on a certified bundle from a host that advertises `onExhaustion: ["fail"]`.

## References

- `spec/v2/core/runs.md` §`budget` section; `spec/v1/budget-policy.md` §D; `spec/v1/capabilities.md` §budget.
- `schemas/budget-policy.schema.json`; `schemas/capabilities.schema.json`.
- RFC 0084 (budget, quota and cost policy), Unresolved question 5; RFC 0051 (approval interrupts); RFC 0197 (v2 retirement).
- `TODO.md` §7: "The spec gives a host no way to decline `onExhaustion: "interrupt"`".
- openwop-examples #146 and #147; openwop #1836 (the v2 budget witness) and #1846 (the certified 2.45.5 cut).
- Registers: [`gaps`](./registers/0231-budget-exhaustion-facet.gaps.md), [`risks`](./registers/0231-budget-exhaustion-facet.risks.md).
