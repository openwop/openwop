# vendor.myndhyve.wop-refinement

> MyndHyve WOP feature-refinement node — `wop.feature.refine`. Decides whether a stack item is actionable, splittable, executable as a chain, or should be blocked.

This pack is **Stage 5 PR 2** of the MyndHyve → openwop canvas-pack migration tracked in [openwop/openwop#11](https://github.com/openwop/openwop/pull/11). Lifted from MyndHyve's `src/core/wop/refinement/{featureRefineNode,applyDecision,parseDecision}.ts` (897 LOC). The pack inlines a pure-JS copy of the parse + apply core so a host with only the openwop `ctx.callAI` surface can run it unchanged.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `wop.feature.refine` | control / action | Drives `ctx.callAI` for a `feature.breakdown` decision; parses the response into a typed `RefinementDecision`; applies hard `maxDepth` + `maxGeneratedItems` constraints; emits a `RefinementOutcome` with mutations + telemetry. The downstream consumer (runner OR chain) applies the mutations. |

## Decision branches

Five branches the LLM may emit (discriminator: `decision`):

| Branch | Effect |
|---|---|
| `execute_as_node` | Single-node target; one `update-target` mutation. |
| `execute_as_chain` | Chain target; one `update-target` mutation (or `human` checkpoint when `requireHumanApprovalForNewChains` is set). |
| `split_into_stack_items` | N `create-child` mutations + one `mark-superseded` on the source. |
| `request_clarification` | One `request-clarification` mutation with questions. |
| `block` | One `mark-blocked` mutation with `reason: 'policy-denied'`. |

## Hard constraint failures

Independent of the LLM's response, the executor enforces:

- **Depth ceiling**: a `split_into_stack_items` decision at `currentDepth >= maxDepth` fails with `status: 'depth-exceeded'`. Even at depth, terminal decisions (`block`, `execute_as_node`, etc.) still apply.
- **Item-count cap**: a `split` proposing more than `maxGeneratedItems` fails with `status: 'too-many-items'`. Truncating would silently drop work.

Both failures emit a `mark-blocked` mutation on the source stack item + a terminal-failure telemetry event.

## Configuration

| Field | Default | Use |
|---|---|---|
| `provider` | host default | Override the AI provider routing. |
| `model` | host default | Override the model id. |
| `systemPromptOverride` | embedded fallback | Custom decision rubric. The embedded prompt is a minimal `"decide between five branches"` instruction; production deployments typically supply a longer rubric tailored to their objectives. |
| `temperature` | `0.2` | Refinement is closer to `decide` than `create`. |

## Required host capability

`ctx.callAI` with `responseSchema` support. The pack declares `peerDependencies: { "aiProviders": "supported" }`; hosts that don't advertise `aiProviders` will be refused at pack-register time.

## Authoring source

- `featureRefineNode.ts` — engine wrapper, AI call, prompt builder, output schema
- `applyDecision.ts` — constraint enforcement + mutation construction (pure function)
- `parseDecision.ts` — `feature.breakdown` envelope parser with discriminator + legacy fallback

(Original TypeScript lives in the MyndHyve product source at `src/core/wop/refinement/`. The MyndHyve org GitHub mirror is not public; reference the file paths above against the MyndHyve product tree.)

All three are inlined here. The pack's behavior is byte-equivalent to the MyndHyve in-tree node modulo (1) Zod → JSON Schema validation and (2) `expectedEnvelope` stream → `responseSchema` single-shot.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
