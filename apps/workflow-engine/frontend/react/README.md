# workflow-engine — React frontend

Sample React UI consuming `@openwop/openwop`. See [`../../README.md`](../../README.md) for the full sample overview.

## Run locally

```bash
npm install
npm run dev   # http://localhost:5173
```

The frontend connects to `http://localhost:8080` by default. Override with:

```bash
echo 'VITE_OPENWOP_BASE_URL=http://localhost:9000' > .env.local
```

## Surfaces

| Path | Component | Demonstrates |
|---|---|---|
| `/` | `runs/RunsIndexPage` | List runs, create new |
| `/runs/:runId` | `runs/RunDetailPage` | Status, SSE stream, interrupt resolution, cancel/fork |
| `/capabilities` | `discovery/CapabilitiesPanel` | Live `/.well-known/openwop` rendering |
| `/byok` | `byok/KeyEntryForm` | Paste a key, scope it (tenant/user/run), explainer for resolution order |

## Build

```bash
npm run build   # outputs to dist/
npm run preview # serve dist/ locally for smoke
```
