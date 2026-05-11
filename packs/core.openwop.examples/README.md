# `core.openwop.examples`

Spec-canonical examples pack. Three minimal nodes used as smoke probes in conformance fixtures and as the simplest end-to-end demonstration of the OpenWOP pack contract.

| Pack name | `core.openwop.examples` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None (uses `node:crypto` only) |
| License | Apache-2.0 |
| Signing | Sigstore keyless (production builds) |

## Nodes

| typeId | category | role | capabilities |
|---|---|---|---|
| `core.openwop.examples.echo` | `data` | `pure` | `cacheable` |
| `core.openwop.examples.coin-flip` | `data` | `pure` | `cacheable` |
| `core.openwop.examples.delay-with-progress` | `control` | `streaming-output` | `streamable` |

### `core.openwop.examples.echo`

Returns the input port `value` verbatim. Pure / replay-safe / no side effects.

**Schemas:** [`schemas/echo.config.json`](./schemas/echo.config.json), [`schemas/echo.input.json`](./schemas/echo.input.json), [`schemas/echo.output.json`](./schemas/echo.output.json).

**Example workflow node:**
```json
{
  "id": "echo-1",
  "typeId": "core.openwop.examples.echo",
  "inputs": { "value": "hello" }
}
```

### `core.openwop.examples.coin-flip`

Deterministic SHA-256 derived heads/tails. Same seed → same result across replays, hosts, and language reimplementations.

**Determinism rule (normative for this pack):**
```
result = SHA-256(seed)[0] % 2 === 0 ? 'heads' : 'tails'
```

A non-JavaScript port of this pack (Python, Go, WASM) MUST honour the same rule so cross-language hosts return identical results for the same seed. The fixture `pack-fetch-verify.test.ts` asserts this property on every conformant host.

**Schemas:** [`schemas/coin-flip.config.json`](./schemas/coin-flip.config.json), [`schemas/coin-flip.input.json`](./schemas/coin-flip.input.json), [`schemas/coin-flip.output.json`](./schemas/coin-flip.output.json).

### `core.openwop.examples.delay-with-progress`

Sleeps for `config.delayMs`, streaming a `node.progress` event every `config.tickMs` (default 100). Demonstrates the `streamable` capability and bounded duration (`delayMs` capped at 60_000 by the config schema).

On replay, per `spec/v1/replay.md` §"Replay determinism," the host returns the cached `{ actualDelayMs, tickCount }` directly — the function is NOT re-executed, so replay cost is near-zero.

**Schemas:** [`schemas/delay-with-progress.config.json`](./schemas/delay-with-progress.config.json), [`schemas/delay-with-progress.input.json`](./schemas/delay-with-progress.input.json), [`schemas/delay-with-progress.output.json`](./schemas/delay-with-progress.output.json).

## Building the tarball

```bash
# From the pack root.
tar -czf core.openwop.examples-1.0.0.tgz \
  pack.json index.mjs schemas/ README.md LICENSE
```

(`scripts/build-pack.sh` automates this once the build pipeline lands per [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md).)

## Verifying the pack locally

Validate `pack.json` against the manifest schema:

```bash
npx -y ajv-cli@5 validate \
  -s schemas/node-pack-manifest.schema.json \
  -d packs/core.openwop.examples/pack.json
```

Run the runtime smoke (no host needed):

```bash
node --input-type=module -e "
  import { echo, coinFlip, delayWithProgress } from './packs/core.openwop.examples/index.mjs';
  console.log(await echo({ inputs: { value: 'hi' } }));
  console.log(await coinFlip({ inputs: { seed: 'openwop-seed' } }));
  console.log(await delayWithProgress({ config: { delayMs: 50 }, emit: () => {} }));
"
```

## Usage from a workflow

```json
{
  "id": "smoke-workflow",
  "version": "1.0",
  "nodes": [
    {
      "id": "flip",
      "typeId": "core.openwop.examples.coin-flip",
      "inputs": { "seed": { "$ref": "$.run.runId" } }
    },
    {
      "id": "pause",
      "typeId": "core.openwop.examples.delay-with-progress",
      "config": { "delayMs": 500, "tickMs": 50 }
    },
    {
      "id": "report",
      "typeId": "core.openwop.examples.echo",
      "inputs": { "value": { "$ref": "$.nodes.flip.outputs.result" } }
    }
  ],
  "edges": [
    { "id": "f-p", "sourceNodeId": "flip", "targetNodeId": "pause" },
    { "id": "p-r", "sourceNodeId": "pause", "targetNodeId": "report" }
  ]
}
```

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md) — the pack format and runtime contract.
- [`spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) — how packs are published.
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — the broader catalog plan.
- [`examples/node-pack-publishing/`](../../examples/node-pack-publishing/) — end-to-end publish walkthrough.
