# openwop Examples

Runnable example projects that demonstrate the openwop wire contract. Each example is self-contained — drop into the directory, `npm install`, `npm start`.

## Quick reference

| Example | Profile required | Host target | CI runs against |
|---|---|---|---|
| [`tiny-workflow/`](./tiny-workflow/) | `openwop-core` | Any | in-memory host |
| [`streaming-client/`](./streaming-client/) | `openwop-stream-sse` | Any | in-memory host |
| [`idempotent-runs/`](./idempotent-runs/) | `openwop-core` | Any | in-memory host |
| [`approval-workflow/`](./approval-workflow/) | `openwop-interrupts` | Any host claiming the profile | skip-equivalent without `OPENWOP_BASE_URL` |
| [`branch-fork/`](./branch-fork/) | `openwop-replay-fork` (with `branch` mode) | Any host claiming the profile | skip-equivalent without `OPENWOP_BASE_URL` |
| [`mcp-tool/`](./mcp-tool/) | host-extension probe<sup>†</sup> | Any host advertising MCP | skip-equivalent without `OPENWOP_BASE_URL` |
| [`node-pack-publishing/`](./node-pack-publishing/) | `openwop-node-packs` | n/a — defaults to dry-run | always passes (dry-run) |

<sup>†</sup> `mcp-tool` probes for an MCP advertisement under any vendor prefix in `/.well-known/openwop` (e.g., `capabilities.openwop.mcp`, `capabilities.mcp`, `capabilities.<vendor>.mcp`). When no `openwop-mcp` profile exists in the catalog yet, this is a vendor-extension probe-and-skip per `spec/v1/host-extensions.md`.

## Env-var taxonomy

Each example reads from a small set of well-defined env vars. Defaults target the in-memory reference host so most examples "just work" with `npm start` after that host is up.

| Variable | Default | Used by |
|---|---|---|
| `OPENWOP_BASE_URL` | `http://127.0.0.1:3737` | All in-memory-targeting examples (tiny / streaming / idempotent) |
| `OPENWOP_API_KEY` | `openwop-inmem-dev-key` | Same as above |
| `OPENWOP_BASE_URL` | (unset) | External-host examples (approval, branch-fork, mcp-tool); when unset, those examples skip-equivalent. Any conformant host URL works. |
| `OPENWOP_API_KEY` | (unset) | Same |
| `OPENWOP_WORKFLOW_ID` | (per-example default) | Override the workflow used by that example |
| `OPENWOP_PACK_REGISTRY_URL` | (unset) | `node-pack-publishing` `--live` mode only |
| `OPENWOP_PACK_PUBLISH_KEY` | (unset) | `node-pack-publishing` `--live` mode only (super-admin Bearer) |

## Running locally

```bash
# Terminal 1 — start the in-memory reference host (most examples use this)
cd examples/hosts/in-memory && npm install && npm start

# Terminal 2 — run any in-memory-targeting example
cd examples/tiny-workflow && npm install && npm start

# To exercise external-host examples, supply credentials:
OPENWOP_BASE_URL=https://your-host.example \
OPENWOP_API_KEY=$YOUR_KEY \
  npm start --prefix examples/approval-workflow
```

## CI behavior

`.github/workflows/examples.yml` runs every example end-to-end. Each example declares its `host:` target in the matrix:

- `host: in-memory` — CI starts the in-memory reference host, runs the example.
- `host: external` — CI runs only when the external host secrets are set. Default: skip-equivalent.
- `host: dry-run` — example needs no host; runs always.

Examples that hit an external host use `Idempotency-Key` so CI re-runs don't multiply runs against the target deployment.

## Adding an example

1. Drop a new dir under `examples/<name>/` with `package.json` + `README.md` + the example source.
2. README header MUST include the standard table:

   ```markdown
   | Profile required | <profile name> |
   | Host target      | <in-memory / external / dry-run> |
   | Run modes        | <default / --live / etc> |
   ```

3. Add a row to the matrix in `.github/workflows/examples.yml`.
4. The example MUST `process.exit(1)` on any unexpected status code or shape mismatch — silent success is forbidden.

## See also

- [`hosts/in-memory/`](./hosts/in-memory/) — reference host that powers most examples.
- [`hosts/sqlite/`](./hosts/sqlite/) — durable reference host; "build your own host" walkthrough.
- [`../QUICKSTART-10MIN.md`](../QUICKSTART-10MIN.md) — fastest "hello world" path.
- [`../spec/v1/profiles.md`](../spec/v1/profiles.md) — closed catalog of compatibility profiles examples gate on.
