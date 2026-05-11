# openwop reference host — Python in-memory

A Python 3.11 stdlib-only port of `examples/hosts/in-memory/`. Same wire contract, same conformance target, different language. Anchors the **cross-language portability proof** referenced in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 12 and (once landed) the corresponding `INTEROP-MATRIX.md` row.

## Why this exists

Two reasons:

1. **Cross-language portability proof.** The TypeScript reference host is helpful but doesn't prove anything beyond "this protocol can be implemented in Node." A working Python host is the smallest credible signal that openwop's wire contract is genuinely language-neutral.
2. **Template for production hosts.** The TS host is also the de-facto template for new hosts; a Python sibling halves the friction for the next implementer who reaches for Python (data-platform shops, ML teams).

This host is dependency-free except for the Python 3.11 stdlib (`http.server`, `threading`, `urllib`, `json`, `hashlib`, `dataclasses`). No FastAPI, no Flask, no asyncio framework. The TypeScript reference host's structure ports cleanly because the protocol's surface is small.

## Quickstart

```bash
cd examples/hosts/python
PYTHONPATH=src python3 -m openwop_host
# [openwop-host-in-memory-python 1.0.0] listening on http://127.0.0.1:3737 (api key: openwop-inmem-dev-key, 42 fixtures loaded)
```

Probe with curl:

```bash
# Discovery (no auth)
curl -s http://127.0.0.1:3737/.well-known/openwop | python3 -m json.tool

# Create and complete a noop run
curl -s -X POST http://127.0.0.1:3737/v1/runs \
  -H "Authorization: Bearer openwop-inmem-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-noop"}'
```

Configurable via environment:

| Env var | Default | Effect |
|---|---|---|
| `OPENWOP_HOST` | `127.0.0.1` | Bind address |
| `OPENWOP_PORT` | `3737` | TCP port |
| `OPENWOP_API_KEY` | `openwop-inmem-dev-key` | Bearer token the host requires |

## What it implements

Mirrors `examples/hosts/in-memory/` exactly:

- **Discovery** — `GET /.well-known/openwop` (per `spec/v1/capabilities.md`)
- **OpenAPI stub** — `GET /v1/openapi.json`
- **Run lifecycle** — `POST /v1/runs`, `GET /v1/runs/{runId}`, `POST /v1/runs/{runId}/cancel`
- **Streaming** — `GET /v1/runs/{runId}/events` (SSE w/ `Last-Event-ID` resume) + `GET /v1/runs/{runId}/events/poll` (polling)
- **Debug bundle** — `GET /v1/runs/{runId}/debug-bundle`
- **Layer-1 idempotency** — `Idempotency-Key` header with 24-hour cache + body-hash conflict detection
- **Two node types** — `core.noop` and `core.delay` (matches TS host)
- **Fixture seeding** — walks up the filesystem to find `conformance/fixtures/` (just like the TS host)

What it does *not* do (intentional, mirrors the TS reference host):

- Persistence (process restart drops state)
- Multi-tenant scoping (single hardcoded tenant)
- BYOK / provider policy / node-pack loading
- Layer-2 invocation idempotency
- Real JWT verification (bearer-token equality check only)
- OTel emission (the OTel conformance scenarios will skip against this host)

Profile claim: `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll`. Scale tier: `minimal`.

## Running the conformance suite against this host

From the repo root with the host running on port 3737:

```bash
# In one terminal:
PYTHONPATH=examples/hosts/python/src python3 -m openwop_host

# In another:
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 \
OPENWOP_API_KEY=openwop-inmem-dev-key \
  npx vitest run
```

The expected scenario set matches what the TypeScript reference host passes: discovery, run lifecycle, idempotency, cancellation, multi-node ordering, stream modes, fixture validity. Optional profiles (interrupts, agents, conversation, replay/fork, node packs, audit-log integrity) are gated on host advertisement and skip honestly against this minimal host.

The captured result lives in `conformance.md` alongside this file once an end-to-end CI run lands.

## Code shape

```
src/openwop_host/
├── __init__.py        # version export
├── __main__.py        # CLI entry: env parse + signal handling
├── server.py          # HTTP handlers + routing (ThreadingHTTPServer)
├── runs.py            # Run/RunEvent dataclasses + executor (threads + Condition)
├── idempotency.py     # Layer-1 cache (sha256 key, 24h TTL, body-hash conflict)
└── fixtures.py        # Walks up to conformance/fixtures/ and loads *.json
```

Total ~600 LOC of Python. Threading model: each HTTP request gets its own thread (via `ThreadingHTTPServer`); each run gets a daemon thread for execution; SSE handlers park on a per-run `threading.Condition` until new events arrive.

## See also

- `examples/hosts/in-memory/` — the TypeScript reference host this is a port of
- `examples/hosts/sqlite/` — the durable TypeScript reference host
- `INTEROP-MATRIX.md` — where conformance evidence lands
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 12 — the cross-language SDK/host parity work item this closes
