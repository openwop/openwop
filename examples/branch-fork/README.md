# Branch Fork

Demonstrates `POST /v1/runs/{runId}:fork` with `mode: 'branch'` — diverges a run's execution from a chosen sequence, optionally with a `runOptionsOverlay`.

| Profile required | `openwop-replay-fork` (with `'branch'` in `replay.modes`) |
| Host target      | Any host claiming the profile |
| Run modes        | Default (skip-equivalent without `OPENWOP_BASE_URL`) |

## Branch vs replay — IMPORTANT

The fork endpoint accepts two modes per `spec/v1/replay.md`:

- **`mode: 'branch'`** — re-execute from `fromSeq` with optional overlay. **Divergent by design** — different runs may produce different events.
- **`mode: 'replay'`** — re-execute from `fromSeq` with deterministic guarantees. **The new run's events MUST match the original modulo timestamps + IDs.** Used for time-travel debugging.

This example uses **branch mode only**. When a host advertises `replay` in `replay.modes`, the conformance scenario `replayDeterminism.test.ts` exercises the determinism contract.

If you want determinism, you don't want this example yet — wait for replay-mode to land in your target host.

## Run

```bash
OPENWOP_BASE_URL=https://your-host.example \
OPENWOP_API_KEY=$YOUR_KEY \
  npm start
```

## Output

```
→ Discovery: https://.../.well-known/openwop
  ✓ Host claims openwop-replay-fork; modes: [branch]
→ POST /v1/runs (parent) — workflowId: "conformance-noop"
  parentRunId: run-...
  ✓ parent reached terminal
→ POST /v1/runs/run-...:fork { mode: 'branch', fromSeq: 0 }
  forkRunId: run-...
  ✓ fork reached terminal: completed
✓ Branch fork lifecycle complete

Note: branch mode permits divergent execution by design.
For deterministic replay, see spec/v1/replay.md mode=replay
and the conformance scenario replayDeterminism.test.ts.
```

## What this teaches

- **Profile-gated execution.** Reads `replay.supported` + `replay.modes` from `/.well-known/openwop` and skip-equivalents on hosts that don't advertise.
- **Two-step fork lifecycle.** Create + complete a parent run; fork from `fromSeq: 0` (start) in branch mode.
- **Fork is a distinct run.** The fork's `runId` is new; the parent is preserved unchanged.
- **Branch is permitted to diverge.** A workflow with non-deterministic side effects (LLM calls, current-time queries, network results) can produce a different event sequence on each fork.

## What this does NOT teach

- **Determinism.** Branch mode doesn't guarantee it. See `replayDeterminism.test.ts` in the conformance suite for the determinism contract that gates on `mode: 'replay'`.
- **runOptionsOverlay.** Branch supports per-fork `configurable` overrides; this example doesn't exercise that surface to keep it focused. Add `{ mode: 'branch', fromSeq: 0, runOptionsOverlay: {...} }` to fork the parent with different model/temperature/etc.

## See also

- [`../../spec/v1/replay.md`](../../spec/v1/replay.md) — full fork contract
- [`../../spec/v1/profiles.md`](../../spec/v1/profiles.md) `#openwop-replay-fork` — predicate definition
- [`../../conformance/src/scenarios/replayDeterminism.test.ts`](../../conformance/src/scenarios/replayDeterminism.test.ts) — determinism contract for `mode: 'replay'` (skip-equivalent until a host advertises that mode)
