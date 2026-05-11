# `@openwop/openwop` — TypeScript SDK for the Multi-Agent Workflow Orchestration Protocol

**openwop is an open, wire-level protocol for multi-agent workflow orchestration** — a single contract for runs in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself. This package is the reference TypeScript client: typed methods for every spec'd REST endpoint plus an async-iterable SSE consumer, zero runtime deps.

```bash
npm install @openwop/openwop
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Status:** FINAL v1 (2026-04-27) · **Mirrors:** [`api/openapi.yaml`](https://github.com/openwop/openwop/blob/main/api/openapi.yaml)

The SDK is hand-authored rather than codegen'd from OpenAPI for two reasons:

1. **Idiomatic shape.** OpenAPI codegen produces verbose accessors (`api.runs.runs_create()`, etc.) that are nicer if hand-curated. A v1 reference SDK should set the API style other ecosystems (Python, Go) follow.
2. **Stays close to the spec.** Each method maps 1:1 to a documented endpoint, and types come from the spec's JSON Schemas (referenced via the OpenAPI doc), not from a generator's intermediate representation.

---

## Quickstart

```typescript
import { OpenwopClient } from '@openwop/openwop';

const client = new OpenwopClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'hk_test_abc123',
});

// Discovery
const caps = await client.discovery.capabilities();
console.log(caps.protocolVersion, caps.limits);

// Workflows
const wf = await client.workflows.get('my-workflow-id');

// Run lifecycle
const { runId } = await client.runs.create({
  workflowId: 'my-workflow-id',
  inputs: { foo: 'bar' },
});

// Poll (or use SSE — see below)
let snap = await client.runs.get(runId);
while (snap.status !== 'completed' && snap.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 500));
  snap = await client.runs.get(runId);
}

// Cancel mid-flight
await client.runs.cancel(runId, { reason: 'user request' });

// HITL approval (run-scoped)
await client.interrupts.resolveByRun(runId, 'gate', { resumeValue: { action: 'accept' } });

// Replay / fork
const fork = await client.runs.fork(runId, { fromSeq: 5, mode: 'branch' });

// SSE stream
for await (const event of client.runs.events(runId, { streamMode: 'updates' })) {
  console.log(event.type, event.payload);
}
```

---

## Quickstart (Node)

```bash
cd sdk/typescript
npm install        # installs @openwop/openwop deps locally (NOT in parent monorepo)
npx tsc --noEmit   # typecheck the SDK source
```

---

## What's Covered In v1.0

| Endpoint | SDK method |
|---|---|
| `GET /.well-known/openwop` | `client.discovery.capabilities()` |
| `GET /v1/openapi.json` | `client.discovery.openapi()` |
| `GET /v1/workflows/{id}` | `client.workflows.get(id)` |
| `POST /v1/runs` | `client.runs.create(body, opts?)` |
| `GET /v1/runs/{id}` | `client.runs.get(id)` |
| `GET /v1/runs/{id}/events` (SSE) | `client.runs.events(id, opts?)` (async iterable) |
| `GET /v1/runs/{id}/events/poll` | `client.runs.pollEvents(id, opts?)` |
| `POST /v1/runs/{id}/cancel` | `client.runs.cancel(id, body?)` |
| `POST /v1/runs/{id}:fork` | `client.runs.fork(id, body)` |
| `POST /v1/runs/{id}/interrupts/{nodeId}` | `client.interrupts.resolveByRun(id, nodeId, body)` |
| `GET /v1/interrupts/{token}` | `client.interrupts.inspectByToken(token)` |
| `POST /v1/interrupts/{token}` | `client.interrupts.resolveByToken(token, body)` |

**Idempotency-Key** is supported via the `idempotencyKey` option on every mutation method.

**Typed `RunConfigurable`** — `client.runs.create(...).configurable` is now a typed surface with reserved keys (`recursionLimit`, `model`, `temperature`, `maxTokens`, `promptOverrides`) plus pass-through for impl extensions.

## Error Handling

```typescript
import { HTTP_ERROR_CODES, isHttpErrorCode, WopError } from '@openwop/openwop';

try {
  await client.runs.create({ workflowId: 'my-workflow-id' });
} catch (err) {
  if (err instanceof WopError && isHttpErrorCode(err.envelope?.error)) {
    console.error(err.envelope.error, err.envelope.details);
  }
}
```

`HTTP_ERROR_CODES` is the canonical REST/MCP error-envelope vocabulary (`unauthenticated`, `validation_error`, `run_already_active`, etc.). Contextual fields live under `ErrorEnvelope.details`; for example retry hints are `details.retryAfter`, not a top-level response field. `RUN_ERROR_CODES` is separate and applies to `RunSnapshot.error.code` after a run itself fails.

---

## Not In The v1.0 SDK

| Feature | Why |
|---|---|
| Webhook subscription helpers | v1 specifies webhook delivery, but the SDK keeps endpoint coverage focused on the run lifecycle and conformance-critical surfaces. |
| Hosted registry publishing helpers | Node-pack registry publishing needs operator-specific credentials and policy; use direct HTTP until a dedicated package workflow is warranted. |
| Auto-retry with exponential backoff | Retry policy is application-specific. The SDK exposes structured errors so callers can implement their own retry envelope. |
| Separate browser entrypoint (`@openwop/openwop/browser`) | The default ESM build uses standard `fetch`/`ReadableStream` primitives and can be bundled by modern tools; a dedicated browser subpath can ship later without changing the v1 surface. |

---

## Layout

```
sdk/typescript/
  README.md                  — this file
  package.json               — @openwop/openwop package manifest
  tsconfig.json              — strict TS, ESM
  src/
    index.ts                 — public surface (OpenwopClient + types)
    client.ts                — OpenwopClient class (auth, request helper)
    types.ts                 — request/response types mirrored from the OpenAPI spec
    sse.ts                   — async-iterable SSE consumer
```

---

## Versioning

This SDK tracks OpenWOP v1. SDK majors match the protocol major; v1.x SDK releases remain forward-compatible with the v1 wire contract. Mismatch behavior is forward-compat tolerant — see `../../version-negotiation.md`. Breaking spec changes will increment the SDK major.

## References

- Spec corpus: `../../README.md`
- OpenAPI: `../../api/openapi.yaml` (the SDK mirrors this surface)
- AsyncAPI: `../../api/asyncapi.yaml` (the SSE consumer follows these channels)
- **[`../PARITY.md`](../PARITY.md)** — cross-SDK feature-parity matrix (TS/Python/Go).
- **[`../smoke/`](../smoke/)** — runnable wire-smoke scripts against a reference host.
