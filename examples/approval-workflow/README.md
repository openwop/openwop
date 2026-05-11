# Approval Workflow

Full HITL approval-gate lifecycle: start a workflow that suspends at an approval gate, resolve it via the canonical resume endpoint, observe terminal completion.

| Profile required | `openwop-interrupts` |
| Host target      | Any host claiming the profile |
| Run modes        | Default (skip-equivalent without `OPENWOP_BASE_URL`) |

## Run

```bash
OPENWOP_BASE_URL=https://your-host.example \
OPENWOP_API_KEY=$YOUR_KEY \
  npm start
```

Override the workflow used:

```bash
OPENWOP_WORKFLOW_ID=launch-studio-brief-approval npm start
```

Without env vars set, the example exits 0 with a `skip-equivalent` message — CI uses this to keep the matrix green when external-host credentials aren't available.

## Output

```
→ Discovery: https://.../.well-known/openwop
  ✓ Host claims openwop-interrupts
→ POST /v1/runs { workflowId: "conformance-approval" }
  runId: run-...
→ Polling until waiting-approval...
  ✓ Suspended at node approval-1
→ POST /v1/runs/run-.../approvals/approval-1 { action: 'accept' }
  ✓ accept dispatched
→ Polling until terminal...
  ✓ status: completed
✓ Approval workflow round-trip complete
```

## What this teaches

- **Profile-gated execution.** The example reads `/.well-known/openwop`'s `supportedEnvelopes` and refuses to run against a host that doesn't claim `openwop-interrupts`.
- **Discovery → run → suspend → resolve → terminal.** The five-stage HITL workflow shape per `spec/v1/interrupt.md`.
- **Suspended-snapshot semantics.** When the run is suspended, `GET /v1/runs/{runId}` returns `status: 'waiting-approval'` and `currentNodeId` identifies which gate is open.
- **Idempotency under retry.** The example uses `Idempotency-Key` derived from `GITHUB_RUN_ID` so CI re-runs on the same PR collapse to one run server-side, avoiding production-data pollution.
- **decidedBy is host-derived.** Per `SECURITY/threat-model-prompt-injection.md` `prompt-injection-decidedby-host-only`, the `decidedBy` field on the resolution event is populated by the host's auth layer, NOT by the client. The client doesn't need to send it.

## Workflow requirement

The default `OPENWOP_WORKFLOW_ID` is `conformance-approval` — the fixture from `conformance/fixtures/openwop-conformance-approval.json`. For this example to run live, the target host must seed that fixture (the in-memory and SQLite reference hosts load it automatically).

If your host has a richer approval-gate workflow you want to demo (Launch Studio brief approval, Campaign Studio strategy approval, etc.), set `OPENWOP_WORKFLOW_ID` to that ID. The example only depends on the workflow's behavior matching `conformance-approval`'s shape (suspends at one gate, completes after one accept).

## Why no `--auto-resolve` flag

The example is designed for CI run-through. CI accepts the gate immediately because the fixture's gate exists only as a protocol-shape demonstration — there's no semantic content to "approve." A production approval workflow would have a UI or human reviewer; the example shows the wire path that reviewer's UI takes.

## See also

- [`../../spec/v1/interrupt.md`](../../spec/v1/interrupt.md) — full HITL contract
- [`../../spec/v1/profiles.md`](../../spec/v1/profiles.md) `#openwop-interrupts` — predicate definition
- [`../../SECURITY/threat-model-prompt-injection.md`](../../SECURITY/threat-model-prompt-injection.md) — refine-quorum + decidedBy invariants
