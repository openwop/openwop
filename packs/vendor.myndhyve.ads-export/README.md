# vendor.myndhyve.ads-export

> Pure-logic `ads.export.pack` executor. Bundles ad copy + creative assets + tracking links into a structured `AdExportPack` record.

## Node

| typeId | Behavior |
|---|---|
| `ads.export.pack` | Validates item count + total asset size against configurable maxima, returns a JSON-serializable `AdExportPack` record. Optional config flags emit JSON and CSV string representations alongside the record. Optional `inputs.campaignName` triggers `ExportManifest` generation. |

## Pure-logic guarantees

- Reads only `ctx.inputs` + `ctx.config` + optional `ctx.log`
- No `ctx.callAI`, no `ctx.chat`, no host capabilities
- Deterministic output (modulo `crypto.randomUUID()` + `new Date()`)

## Differences vs MyndHyve source

- **In-memory pack store dropped**: MyndHyve's `AdExportPackService` keeps `this.packs: Map<string, AdExportPack>` for `getPack`/`listPacks` retrieval. The pack consumer stores the returned record themselves (or pipes to a downstream `core.openwop.http.fetch` upload). Removes per-process state.
- **Service-factory + ScopedLogger** → plain functions + `ctx.log` shim.
- **`exportAsJSON` / `exportAsCSV` / `generateManifest`** kept as pure helpers, surfaced via config flags / optional input.

## Config knobs

| Field | Default | Notes |
|---|---|---|
| `maxItemsPerPack` | 50 | Rejects packs with more items |
| `maxTotalAssetSize` | 524288000 (500 MiB) | Rejects packs with larger total |
| `manifestVersion` | `"1.0.0"` | Stamped into `manifest.version` when emitted |
| `emitJson` | false | When true, output `json` = pretty-printed JSON |
| `emitCsv` | false | When true, output `csv` = CSV rows |

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| All | `ads-studio/export/AdExportPackService.ts` | 296 |

~296 LOC of TS → ~200 LOC of pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
