# core.openwop.flow

Spec-canonical flow-control primitives. Every workflow editor (Make.com, n8n, Zapier, Temporal-as-DSL) ships these; openwop hosts have lacked them until this pack.

All 25 nodes are pure-or-suspending (no external I/O). Side-effects are limited to suspending the run (`flow.wait`, `flow.sub-workflow.invoke`) or terminating it (`flow.stop-and-error`, error handlers). No host capabilities are required beyond the baseline runtime.

## TypeIds

| typeId | role | purpose |
|---|---|---|
| `core.flow.if` | pure | Two-branch conditional on expression. |
| `core.flow.switch` | pure | N-way routing on a value lookup table. |
| `core.flow.router` | pure | Fan-out to labelled branches with per-branch filters. |
| `core.flow.filter` | pure | Predicate drop (passes items matching, blocks the rest). |
| `core.flow.merge` | pure | Combine N inputs. Modes: `append`, `combine-by-key`, `combine-by-position`, `multiplex`, `choose-branch`. |
| `core.flow.iterator` | pure | Array → N bundles, one per element. |
| `core.flow.aggregate-array` | pure | N bundles → one bundle with the values as an array. |
| `core.flow.aggregate-numeric` | pure | Reduce a numeric field across bundles: `sum`/`count`/`avg`/`min`/`max`. |
| `core.flow.aggregate-text` | pure | Concatenate a field across bundles with a separator. |
| `core.flow.aggregate-table` | pure | Bundles → CSV-shaped rows×cols. |
| `core.flow.split-in-batches` | pure | Chunk a stream into batches of N with `done`/`continue` ports. |
| `core.flow.sort` | pure | Sort an array by key path. |
| `core.flow.limit` | pure | Take first N items. |
| `core.flow.distinct` | pure | Drop duplicates by key path. |
| `core.flow.compare-datasets` | pure | Diff two collections by primary key. |
| `core.flow.repeater` | pure | Generate N bundles with an incrementing counter. |
| `core.flow.noop` | pure | Pass-through placeholder. |
| `core.flow.stop-and-error` | side-effect | Abort the workflow with a custom error. |
| `core.flow.wait` | side-effect | Suspend up to N seconds, or until a webhook fires. |
| `core.flow.sub-workflow-invoke` | side-effect | Synchronous call to another workflow via reserved `core.subWorkflow` (per `node-packs.md`). |
| `core.flow.error-handler-resume` | side-effect | On upstream failure, substitute a fallback bundle and continue. |
| `core.flow.error-handler-ignore` | side-effect | On upstream failure, drop the bundle and continue silently. |
| `core.flow.error-handler-break` | side-effect | Stop and mark the run incomplete (re-processable). |
| `core.flow.error-handler-commit` | side-effect | Stop and commit transactional side effects upstream. |
| `core.flow.error-handler-rollback` | side-effect | Stop and request rollback of transactional side effects upstream. |

## Reserved-typeId aliases

`spec/v1/node-packs.md` §"Reserved Core OpenWOP node typeIds" reserves a set of bare `core.*` names. This pack provides concrete implementations of the four that line up cleanly:

| Reserved typeId | Implementation | Notes |
|---|---|---|
| `core.conditional` | alias of `core.flow.if` | Routing on an edge predicate. |
| `core.delay` | alias of `core.flow.wait` | Wall-clock pause. |
| `core.loop` | alias of `core.flow.iterator` | Array iteration. |
| `core.parallel` | alias of `core.flow.router` | Fan-out / parallel execution. |

**Not aliased** (semantics diverge):
- `core.merge` reserved as "fan-in / synchronization point" — this pack's `core.flow.merge` is an *array combine* node. A future `core.flow.fan-in-sync` (or a host-provided `core.merge`) should cover the synchronization meaning.
- `core.start`, `core.end` — workflow entry/terminal sentinels owned by the engine, not pack-shipped.
- `core.setVariable`, `core.getVariable` — host-side variable scope; covered by `core.openwop.data.{object-get-path, object-set-path}` for object-shaped state and by `core.openwop.storage.kv-*` for cross-run state.
- `core.interrupt` — interrupt primitive owned by the engine per `spec/v1/interrupt.md`; HITL surfaces in `core.openwop.hitl`.
- `core.subWorkflow` — engine-owned sub-workflow contract per `spec/v1/node-packs.md` §"`core.subWorkflow` contract". `core.flow.sub-workflow-invoke` is the workflow-author-facing wrapper.

## Intentionally not in this pack

Two flow-adjacent primitives from comparable workflow editors were considered and deliberately excluded from `core.openwop.flow`. They are not "forgotten" — they each need protocol surface that doesn't exist yet, and shipping them here would either lie about that or paper over it.

| Primitive | Source | Why not here | Where it should land |
|---|---|---|---|
| **Execute Command** (shell) | n8n core | Needs a `host.shell` capability with a `shell-command-injection` SECURITY invariant + sandbox model. The `core.openwop.files.ssh-run` node already covers remote-host shell via SSH; local shell is the missing piece and requires its own RFC (host-side capability + invariant + threat-model entry under `SECURITY/threat-model-*.md`). | Future RFC + new capability + future `core.openwop.shell` pack. |
| **Evaluation** (AI test harness) | n8n core (recent) | Pairs with the Evaluation Trigger to run assertion blocks against AI output. The semantic is closer to a test framework than a workflow primitive — it belongs alongside `agent.run` + the agents/RAG cluster, not core flow. | Future `core.openwop.eval` pack alongside `core.openwop.agents`. |

If you reach for one of these and don't find it: that's the spec's "open spec gap" — file an RFC against the relevant capability surface rather than reaching into `core.openwop.flow` for it.

## Compatibility

- Engine: `openwop >=1.0.0 <2.0.0`.
- Side-effecting nodes (`flow.wait`, `flow.sub-workflow-invoke`) cooperate with the existing replay invocation log (`replay.md` §"Layer-2 invocation log") via the `cacheable` + `side-effectful` capability markers.
- `flow.sub-workflow-invoke` requires the host to honor reserved `core.subWorkflow` typeId per `node-packs.md` §"`core.subWorkflow` contract".
- Error-handler nodes are advisory: a host without transactional adapters MUST treat `commit`/`rollback` as `break`.
- `flow.merge` mode `sql-query` requires the host to advertise `host.sql` per RFC 0018; absent that surface, the runtime throws `HOST_CAPABILITY_MISSING` at execution time (the workflow stays portable — only the run on a sql-less host fails).

## See also

- `spec/v1/node-packs.md` — reserved Core typeIds, `core.subWorkflow` contract.
- `spec/v1/interrupt.md` — suspension mechanism (used by `flow.wait`).
- `spec/v1/replay.md` — invocation log + caching semantics.
- `docs/PACK-AUTHOR-QUICKSTART.md` — authoring pattern this pack follows.
