# `openwop-client` — Python SDK for the Multi-Agent Workflow Orchestration Protocol

**openwop is an open, wire-level protocol for multi-agent workflow orchestration** — a single contract for runs in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself. This package is the reference Python client: synchronous, zero runtime deps, typed dataclasses for every spec'd REST endpoint plus a pure-stdlib SSE iterator.

```bash
pip install openwop-client
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Status:** FINAL v1 (2026-04-27) · **Mirrors:** the TypeScript SDK at [`sdk/typescript/`](https://github.com/openwop/openwop/tree/main/sdk/typescript)

This SDK is hand-authored rather than codegen'd from OpenAPI. Same rationale as the TypeScript SDK — see [`sdk/typescript/README.md`](https://github.com/openwop/openwop/blob/main/sdk/typescript/README.md) §rationale.

---

## Quickstart

> New here? **[`QUICKSTART.md`](./QUICKSTART.md)** is a 5-minute end-to-end walkthrough that boots the in-memory reference host on your laptop and runs a workflow against it. No managed-service setup. The snippet below is the same flow against an arbitrary OpenWOP host.

```python
from openwop_client import (
    OpenwopClient,
    CreateRunRequest,
    ForkRunRequest,
    ResolveInterruptRequest,
)

client = OpenwopClient(
    base_url="https://api.example.com",
    api_key="hk_test_abc123",
)

# Discovery (no auth required)
caps = client.discovery_capabilities()
print(caps.protocolVersion, caps.limits.envelopesPerTurn)

# Run lifecycle
resp = client.runs_create(CreateRunRequest(workflowId="my-wf", inputs={"foo": "bar"}))
run_id = resp.runId

# Poll for completion (or use SSE — see below)
while True:
    snap = client.runs_get(run_id)
    if snap.status in {"completed", "failed", "cancelled"}:
        break
    import time; time.sleep(0.5)

# HITL approval (run-scoped)
client.interrupts_resolve_by_run(
    run_id, "gate",
    ResolveInterruptRequest(resumeValue={"action": "accept"}),
)

# Replay / fork
fork = client.runs_fork(run_id, ForkRunRequest(fromSeq=5, mode="branch"))

# SSE stream (synchronous generator)
for event in client.runs_events(run_id, stream_mode="updates"):
    print(event.type, event.payload)
```

---

## Install (dev, from local checkout)

```bash
cd sdk/python
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
```

## What's Covered In v1.0

| Endpoint | SDK method |
|---|---|
| `GET /.well-known/openwop` | `client.discovery_capabilities()` |
| `GET /v1/openapi.json` | `client.discovery_openapi()` |
| `GET /v1/workflows/{id}` | `client.workflows_get(id)` |
| `POST /v1/runs` | `client.runs_create(body, idempotency_key=..., dedup=...)` |
| `GET /v1/runs/{id}` | `client.runs_get(id)` |
| `GET /v1/runs/{id}/events` (SSE) | `client.runs_events(id, stream_mode=...)` (sync generator) |
| `GET /v1/runs/{id}/events/poll` | `client.runs_poll_events(id, last_sequence=..., timeout_seconds=...)` |
| `POST /v1/runs/{id}/cancel` | `client.runs_cancel(id, body=..., idempotency_key=...)` |
| `POST /v1/runs/{id}:fork` | `client.runs_fork(id, body, idempotency_key=...)` |
| `POST /v1/runs/{id}/interrupts/{nodeId}` | `client.interrupts_resolve_by_run(id, node_id, body)` |
| `GET /v1/interrupts/{token}` | `client.interrupts_inspect_by_token(token)` |
| `POST /v1/interrupts/{token}` | `client.interrupts_resolve_by_token(token, body)` |

**Idempotency-Key** is supported via the `idempotency_key=` keyword argument on every mutation method.

**Trace-ID surfacing**: `WopError` captures the W3C `traceparent` from response headers and exposes `error.trace_id` (32-hex). `str(error)` auto-suffixes `(trace=<id>)` so logs are searchable against backend traces per `observability.md` §Trace context propagation.

## Error Handling

```python
from openwop_client import HTTP_ERROR_CODES, WopError, is_http_error_code

try:
    client.runs_create(CreateRunRequest(workflowId="my-wf"))
except WopError as error:
    if error.envelope and is_http_error_code(error.envelope.error):
        print(error.envelope.error, error.envelope.details)
```

`HTTP_ERROR_CODES` is the canonical REST/MCP error-envelope vocabulary (`unauthenticated`, `validation_error`, `run_already_active`, etc.). Contextual fields live under `ErrorEnvelope.details`; for example retry hints are `details["retryAfter"]`, not a top-level response field.

---

## v1.x Additions

| Feature | Why |
|---|---|
| Async client (`AsyncOpenwopClient` via httpx) | Sync stdlib API is the v1.0 baseline; async needs a non-stdlib HTTP lib. |
| Webhook subscription helpers | v1 specifies webhook delivery, but the SDK keeps endpoint coverage focused on the run lifecycle and conformance-critical surfaces. |
| Hosted registry publishing helpers | Node-pack registry publishing needs operator-specific credentials and policy; use direct HTTP until a dedicated package workflow is warranted. |
| Auto-retry with exponential backoff | Retry policy is application-specific. The SDK exposes structured errors so callers can implement their own retry envelope. |

---

## Layout

```
sdk/python/
  README.md                 — this file
  pyproject.toml            — PEP 621 packaging (hatchling)
  src/openwop_client/
    __init__.py             — public exports + __version__
    types.py                — dataclasses + Literal aliases
    errors.py               — WopError (with traceparent capture)
    client.py               — OpenwopClient sync API
    sse.py                  — generator-based SSE consumer (pure stdlib)
```

---

## Versioning

Tracks the OpenWOP protocol major. The v1 SDK line is intended to remain backward-compatible across v1.x releases, with additive features and bug fixes landing as minor or patch releases.

## References

- Spec corpus: `../../README.md`
- OpenAPI: `../../api/openapi.yaml` (the SDK mirrors this surface)
- AsyncAPI: `../../api/asyncapi.yaml` (the SSE consumer follows these channels)
- TypeScript counterpart: `../typescript/`
- **[`../PARITY.md`](../PARITY.md)** — cross-SDK feature-parity matrix (TS/Python/Go).
- **[`../smoke/`](../smoke/)** — runnable wire-smoke scripts against a reference host.
