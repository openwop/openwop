# Tiny Workflow

Smallest possible openwop run lifecycle: discover → create run → poll until terminal.

## Run

Against the in-memory reference host (start it in another terminal first — see `examples/hosts/in-memory/`):

```bash
npm start
```

Output:

```
→ Discovery: http://127.0.0.1:3737/.well-known/openwop
  protocolVersion: 1.0
  implementation:  openwop-host-in-memory
→ POST /v1/runs { workflowId: "conformance-noop" }
  runId:  run-...
  status: pending
→ Polling until terminal...
  status: completed
  ended:  2026-05-01T12:34:56.000Z
✓ Run completed successfully
```

Against any other OpenWOP host:

```bash
OPENWOP_BASE_URL=https://your-host.example OPENWOP_API_KEY=your-key npm start
```

## What this teaches

- Discovery (`GET /.well-known/openwop`) is the entrypoint to any OpenWOP host.
- Run creation is `POST /v1/runs` with `{ workflowId }`.
- Snapshot polling via `GET /v1/runs/{runId}` is the lowest-common-denominator way to track a run.
- Terminal statuses are `completed` / `failed` / `cancelled`.

## ~80 lines, zero dependencies

The example uses only Node 20+'s built-in `fetch`. No SDK, no transport library. The point is to show the protocol is small enough to write a client in a single file.

For a more production-grade client, use `@openwop/openwop` (TypeScript), `openwop-client` (Python), or the Go SDK at `github.com/openwop/openwop/sdk/go`.
