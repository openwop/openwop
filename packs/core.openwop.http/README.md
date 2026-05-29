# `core.openwop.http`

Spec-canonical HTTP fetch node. Single typeId `core.openwop.http.fetch` covering the universal "call an HTTP endpoint" use case with retry, backoff, and deterministic idempotency.

| Pack name | `core.openwop.http` |
| Version | `2.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| Runtime requires | `net.dns`, `net.outbound` (RFC 0076 §A — for the fallback path; satisfied trivially when the host mediates via `safeFetch`) |
| External deps | None (uses Node 20's built-in `fetch`) |
| Declares secrets? | No — auth is the workflow author's concern via `config.headers` |
| License | Apache-2.0 |

## v2.0 — host-mediated safe-fetch (RFC 0076 §B)

Every outbound call in this pack flows through one wrapper that, when the host exposes **`ctx.http.safeFetch`** (advertised as `capabilities.httpClient.safeFetch`), delegates to it — the host performs the resolve→pin→connect SSRF guard + the cloud-metadata blocklist (one audited, host-maintained defense, audit-logged via RFC 0064 tool-hooks) and the fetch itself. When the host does **not** expose `safeFetch`, the pack falls back to its own `assertPublicUrl` (a `node:dns` resolution + private-range blocklist) + `globalThis.fetch`.

Because of that fallback, the pack declares `runtime.requires: ["net.dns", "net.outbound"]` (RFC 0076 §A). A sandbox host that denies `net.outbound` and does **not** expose `safeFetch` refuses to install this pack at install time (`pack_runtime_requirement_unmet`) rather than failing at first fetch — and a host that mediates egress via `safeFetch` is the path that unblocks such sandboxes. Feature-detection means the same pack runs unchanged on hosts with or without `safeFetch`.

## Why no `requiresSecrets`?

Other pack designs declare an `Authorization` Bearer as a `requiresSecrets` entry. That makes the pack only runnable on hosts advertising `Capabilities.secrets.supported: true`, which is unnecessarily strict for a generic fetch node. Workflows that need authenticated requests can inject the resolved value through `config.headers.Authorization` at dispatch — using the host's existing secret-injection / templating mechanism. Workflows that hit public endpoints pass no auth header and work everywhere.

If a pack DOES want spec-mandated secret resolution, it can wrap this node in a domain-specific pack (e.g., `vendor.acme.api`) that declares the secrets it needs and templates them into the fetch.

## Behaviour

### Retry policy

- **5xx + network errors:** retry with exponential backoff. Delay = `min(maxDelayMs, initialDelayMs * 2^(attempt-1))`. Defaults: 3 attempts, 500ms → 1000ms → 2000ms (capped at 8000ms).
- **4xx:** NEVER retried. 4xx is a terminal client error.
- **Caller abort:** propagates immediately, no retry.

### Idempotency

For non-idempotent methods (POST/PUT/PATCH/DELETE), the node sends a deterministic `Idempotency-Key` header derived from `(runId, nodeId, SHA-256(body))`. Replays of the same run produce the same key, so remote servers that respect idempotency can dedupe.

Format: `openwop-<hex-16>` (~64 bits uniqueness, plenty for per-run dedup).

Suppress with `config.idempotency.mode: 'disabled'` for endpoints that reject unknown headers.

### Replay safety

Declared `side-effectful` capability + cached via the engine's Layer-2 invocation log keyed on `(runId, nodeId, idempotencyKey)`. **Replays do NOT re-issue the HTTP request** — the host returns the cached `node.completed` payload directly. See `spec/v1/replay.md` §"Replay determinism."

## Schemas

- [`schemas/fetch.config.json`](./schemas/fetch.config.json) — url, method, headers, timeout, retry policy, idempotency mode
- [`schemas/fetch.input.json`](./schemas/fetch.input.json) — URL template variables, body
- [`schemas/fetch.output.json`](./schemas/fetch.output.json) — status, headers, body, durationMs, attempts, idempotencyKey, networkError

## Example workflow node

```json
{
  "id": "fetch-user",
  "typeId": "core.openwop.http.fetch",
  "config": {
    "method": "GET",
    "url": "https://api.example.com/users/{{userId}}",
    "headers": {
      "Accept": "application/json"
    },
    "timeoutMs": 5000,
    "retry": { "maxAttempts": 5, "initialDelayMs": 200, "maxDelayMs": 4000 }
  },
  "inputs": {
    "variables": { "userId": "u-42" }
  }
}
```

POST with idempotency:

```json
{
  "id": "create-order",
  "typeId": "core.openwop.http.fetch",
  "config": {
    "method": "POST",
    "url": "https://api.example.com/orders",
    "headers": { "Authorization": "Bearer ..." },
    "idempotency": { "mode": "auto" }
  },
  "inputs": {
    "body": { "sku": "abc-123", "qty": 2 }
  }
}
```

## Verification

```bash
# Validate manifest
node -e "
import('ajv/dist/2020.js').then(({default:A}) =>
import('ajv-formats').then(({default:F}) => {
  const fs = require('fs');
  const a = new A({ allErrors: true, strict: false });
  F(a);
  const s = JSON.parse(fs.readFileSync('schemas/node-pack-manifest.schema.json'));
  const v = a.compile(s);
  const d = JSON.parse(fs.readFileSync('packs/core.openwop.http/pack.json'));
  console.log(v(d) ? 'PASS' : v.errors);
}));"

# Build the tarball
tar -czf core.openwop.http-1.0.0.tgz pack.json index.mjs schemas/ README.md LICENSE
```

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md)
- [`spec/v1/idempotency.md`](../../spec/v1/idempotency.md) — Layer-1 (HTTP) and Layer-2 (engine) idempotency contracts
- [`spec/v1/replay.md`](../../spec/v1/replay.md) — why side-effect nodes are safe under replay
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md)
