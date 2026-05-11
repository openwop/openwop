# Conformance evidence — Python in-memory reference host

> **Status: provisional 2026-05-10.** Awaits a full pass of `@openwop/openwop-conformance` against this host. The TypeScript reference host's conformance.md is the structural template.

## Tested manually

The boot smoke test (see `README.md` §Quickstart) exercises:

- `GET /.well-known/openwop` returns the discovery shape with `fixtures` array.
- `POST /v1/runs` with `workflowId: "conformance-noop"` returns `{runId, status: "completed", workflowId, startedAt}` and transitions through `run.started → node.started → node.completed → run.completed`.
- `GET /v1/runs/{runId}` returns the snapshot with terminal `status: "completed"`.
- `GET /v1/runs/{runId}/events/poll?since=-1` returns the four lifecycle events in sequence order.

Verified 2026-05-10.

## Awaiting full suite

The intent is to add a row to `INTEROP-MATRIX.md` once the public `@openwop/openwop-conformance` suite runs against this host and reports its pass/skip counts. Until then, this file documents the expected scope:

**Profile claim:** `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll`
**Scale claim:** `minimal`
**Production profile:** Not claimed (no durability, single-process, no backpressure semantics).

**Scenarios expected to pass** (same set the TypeScript in-memory host passes):

- `discovery.test.ts`, `runtime-capabilities.test.ts`, `profileDerivation.test.ts`
- `runs-lifecycle.test.ts`, `failure-path.test.ts`, `cancellation.test.ts`, `eventOrdering.test.ts`
- `idempotency.test.ts`, `idempotencyRetry.test.ts`, `highConcurrency.test.ts`
- `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts`, `streamReconnect.test.ts`
- `multi-node-ordering.test.ts`, `route-coverage.test.ts`
- `fixtures-valid.test.ts`, `fixtures-gating.test.ts`, `spec-corpus-validity.test.ts`
- `debugBundle.test.ts` (basic shape)

**Scenarios expected to skip** (host does not advertise the capability):

- `auth.test.ts` — host accepts only bearer-token equality; richer auth scenarios skip
- All `agent*` / `conversation*` / `orchestrator*` / `memory*` (multi-agent extensions)
- Interrupt-profile cluster (quorum, external-event, auth-required, parent-child)
- `pause-resume.test.ts`, `rate-limit-envelope.test.ts`, `configurable-schema.test.ts`, `append-ordering.test.ts`, `webhook-sig-algorithm.test.ts`, `audit-log-integrity.test.ts`, `multi-region-idempotency.test.ts`
- `otel-emission.test.ts`, `otel-trace-propagation.test.ts` — host does not emit OTel
- `mcp-tool-roundtrip.test.ts`, `a2a-task-roundtrip.test.ts` — host does not integrate MCP/A2A
- `byok-roundtrip.test.ts`, `redaction.test.ts`, `redactionAdversarial.test.ts` — host does not advertise secrets
- `pack-registry*.test.ts`, `maliciousManifest.test.ts` — host does not load packs

## How to reproduce

```bash
# Terminal 1 — host
cd examples/hosts/python
PYTHONPATH=src python3 -m openwop_host

# Terminal 2 — suite
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 \
OPENWOP_API_KEY=openwop-inmem-dev-key \
  npx vitest run
```

Update this file with the captured pass/skip counts after the run.
