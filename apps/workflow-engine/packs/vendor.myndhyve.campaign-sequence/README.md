# vendor.myndhyve.campaign-sequence

> MyndHyve campaign-sequence step executors — three pure-control nodes (`wait`, `tag`, `condition`) lifted from `src/canvas-types/campaign-studio/sequences/sequenceStepModules.ts`.

This pack is the **Stage 5 pilot** of the MyndHyve → openwop canvas-pack migration tracked in [openwop/openwop#11](https://github.com/openwop/openwop/pull/11). It is intentionally the smallest extractable slice: three executors that touch nothing beyond `ctx.inputs` + `ctx.log`, with no host-capability extensions required.

## Nodes

| typeId | Role | Behavior |
|---|---|---|
| `campaign.sequence.wait` | action | Pure passthrough — the host's enrollment scheduler decides when to fire the node; the executor signals completion so the workflow advances. |
| `campaign.sequence.tag` | action | Validates that `step.tagAction` and `step.tagName` are set on the input step; emits a debug log; returns success. The actual tag-apply side-effect is the host's responsibility. |
| `campaign.sequence.condition` | gate | Evaluates an array of conditions against the enrollment record. Returns `nextStepId = step.yesNextStepId` if all (or any, per `step.conditionLogic`) conditions match, else `step.noNextStepId`. |

The companion integration nodes (`campaign.sequence.email`, `campaign.sequence.sms`, `campaign.sequence.webhook`) ship in a follow-up pack once openwop NodeContext extensions for `host.email`, `host.sms`, and `host.http` land. Those executors are side-effectful and need explicit `peerDependencies`.

## Condition operators

`campaign.sequence.condition` supports the same 17 operators as the MyndHyve source: `equals`, `not_equals`, `contains`, `not_contains`, `greater_than`, `greater_than_or_equals`, `less_than`, `less_than_or_equals`, `is_empty`, `is_not_empty`, `is_set`, `is_not_set`, `starts_with`, `ends_with`, `in_list`, `not_in_list`, `matches_regex`.

`matches_regex` rejects patterns longer than 200 characters to defend against pathological backtracking.

## Inputs

All three executors share the same input shape:

```json
{
  "step": "<SequenceStep>",
  "enrollment": "<SequenceEnrollment>",
  "sequence": "<Sequence>"
}
```

The shapes are open (`additionalProperties: true`) — pack consumers MAY pass the entire MyndHyve `SequenceStep` / `SequenceEnrollment` / `Sequence` records, but the executors only read the fields documented in `schemas/*.input.json`.

## Outputs

```json
{
  "success": true,
  "error": "<optional non-retryable validation error>",
  "nextStepId": "<optional, set by condition>"
}
```

A validation failure (`success: false` with an `error` message) is a per-output flag, NOT a `status: 'error'` envelope. The enrolling host treats these as "step done, do not retry" — same semantics as the original MyndHyve executor.

## Authoring source

Original TypeScript at `myndhyve/src/canvas-types/campaign-studio/sequences/sequenceStepModules.ts` and the adjacent `conditionUtils.ts`. The MyndHyve org GitHub mirror is not public — reference the paths above against the MyndHyve product tree. This pack inlines a pure-JS copy of the relevant helpers (`getNestedFieldValue`, `evaluateCondition`, `looseEquals`, `toNumber`, `isEmpty`) so it runs unchanged on any openwop-compliant host.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
