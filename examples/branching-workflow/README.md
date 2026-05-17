# Branching Workflow

Demonstrates the openwop DAG executor: a single workflow with **two parallel paths** that fan out from one source, run concurrently, then fan back in at a merge node. Exercises `core.flow.router`, `core.flow.iterator`, `core.flow.aggregate-array`, and `core.flow.merge` from `core.openwop.flow@1.1.0`.

This is the canonical "branching is real" demo. Hosts whose executor is linear-only (e.g., the workflow-engine sample at HEAD~5) reject the workflow at submit time; DAG-capable hosts run it end-to-end.

| Profile required | None (uses default `core.openwop.flow` + `core.openwop.data` packs) |
| Host target      | Any DAG-capable host (workflow-engine sample, Postgres reference host) |
| Run modes        | Default (skip-equivalent without `OPENWOP_BASE_URL`) |

## What the workflow does

```
         ┌─────────────┐
         │   source    │ (passthrough, emits the run's inputs)
         └──────┬──────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│  branchA    │   │  branchB    │  ← parallel paths
│ (uppercase) │   │ (mock-ai)   │
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                │
                ▼
         ┌─────────────┐
         │    merge    │ (mode: combine-by-position)
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │    sink     │ (passthrough)
         └─────────────┘
```

- **`source`** receives the run inputs. `{ message: "hello" }`.
- **`branchA`** uppercases the message → `{ message: "HELLO" }`.
- **`branchB`** runs a mock-AI completion → `{ completion: "Mock response to: hello" }`.
- **`merge`** combines both branch outputs by position into a single record.
- **`sink`** terminates the workflow with the merged payload.

The two branches MUST run concurrently — the run completes when both upstream paths finish AND the merge's default `triggerRule: 'all_success'` fires the sink.

## Run

```bash
OPENWOP_BASE_URL=http://localhost:8080 \
OPENWOP_API_KEY=sample-token \
  npm start
```

Without env vars set, the example exits 0 with a `skip-equivalent` message so CI doesn't fail when no host is available.

## Output

```
→ Discovery: http://localhost:8080/.well-known/openwop
  ✓ Host supports DAG execution (branching workflows accepted)
→ Registering workflow: branching-demo
  ✓ Workflow registered
→ POST /v1/runs { workflowId: "branching-demo", inputs: { message: "hello" } }
  ✓ Run started: run_abc123
→ Polling for terminal state…
  ✓ Run completed in 240ms
→ Event log (10 events):
    seq=1  run.started
    seq=2  node.started      source
    seq=3  node.completed    source
    seq=4  node.started      branchA      ┐
    seq=5  node.started      branchB      │ interleaved — parallel paths
    seq=6  node.completed    branchA      │
    seq=7  node.completed    branchB      ┘
    seq=8  node.started      merge
    seq=9  node.completed    merge
    seq=10 node.started      sink
    seq=11 node.completed    sink
    seq=12 run.completed
  ✓ Both branches emitted node.started before either branch completed
    (proves concurrent execution — not sequential)
```

## How to know it really branched

The `node.started` events for `branchA` and `branchB` both appear in the log **before** either branch's `node.completed`. Under a linear executor (or a host that serialized the DAG into a chain), one branch would always complete before the other started:

```
linear:        started_A → completed_A → started_B → completed_B   ❌
concurrent:    started_A → started_B → completed_A → completed_B   ✓
```

The example asserts this interleaving and exits non-zero if it doesn't hold.

## What this exercises

- `core.flow.router` fan-out semantics (one input → N outputs, each labelled with its own branch).
- `core.flow.merge` fan-in with `mode: 'combine-by-position'` (zip branchA's output with branchB's).
- The DAG scheduler's bounded-concurrency knob (`OPENWOP_MAX_CONCURRENT_NODES`) — try `=1` to force serialization and watch the assertion fail.
- The canonical `WorkflowEdge.triggerRule` default (`all_success`) waits for both upstreams before firing the merge.

## See also

- `spec/v1/workflow-definition.schema.json` §`WorkflowEdge` — canonical edge shape + `triggerRule` enum
- `spec/v1/channels-and-reducers.md` — typed shared state for richer fan-in semantics
- `packs/core.openwop.flow/README.md` — every flow primitive with examples
- `examples/multi-agent-research-assistant/` — production-shape multi-agent DAG with channels
