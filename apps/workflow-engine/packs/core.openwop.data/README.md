# `core.openwop.data`

Spec-canonical data-utility pack. Five pure, replay-safe nodes for the most common workflow data transformations.

| Pack name | `core.openwop.data` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None |
| License | Apache-2.0 |

## Nodes

| typeId | category | role | capabilities |
|---|---|---|---|
| `core.openwop.data.string-case` | `data` | `pure` | `cacheable` |
| `core.openwop.data.string-split` | `data` | `pure` | `cacheable` |
| `core.openwop.data.array-filter` | `data` | `pure` | `cacheable` |
| `core.openwop.data.array-map` | `data` | `pure` | `cacheable` |
| `core.openwop.data.object-merge` | `data` | `pure` | `cacheable` |

All five are pure functions of (config, inputs) — no side effects, no I/O, no host capabilities required. Replay-safe by construction.

### `string-case`

Upper / lower / title transformation. Title case is naive (first letter of each whitespace-delimited word) — locale-independent.

```json
{ "config": { "mode": "upper" }, "inputs": { "text": "hello" } }
// outputs: { "text": "HELLO" }
```

### `string-split`

Splits on a separator. **Python-style maxsplit semantics** — when `limit` is set, the last piece carries the un-split remainder. This is intentional: JavaScript's `String.prototype.split(sep, limit)` discards the remainder, which is surprising and often unwanted in workflow contexts.

```json
{ "config": { "separator": ",", "limit": 2 }, "inputs": { "text": "a,b,c,d" } }
// outputs: { "parts": ["a", "b,c,d"] }    (JS would give ["a", "b"])
```

### `array-filter`

Simple equality predicate on a dot-notation path. Empty path means "the element itself." For richer predicate languages (JSONPath, JMESPath, jq), downstream packs can layer.

```json
{
  "config": { "path": "status", "equals": "active" },
  "inputs": { "array": [{ "status": "active" }, { "status": "draft" }] }
}
// outputs: { "array": [{ "status": "active" }], "matched": 1, "total": 2 }
```

### `array-map`

Template-substitution mapping. Each element becomes a string with `{{key}}` placeholders replaced from its keys (dot-notation supported).

```json
{
  "config": { "template": "{{name}} ({{role}})" },
  "inputs": { "array": [{ "name": "Alice", "role": "admin" }] }
}
// outputs: { "array": ["Alice (admin)"] }
```

Missing keys produce empty strings; non-string values are JSON-stringified. For richer transformation languages (jq, JSONata), downstream packs can layer.

### `object-merge`

Shallow merge; `override` wins on key collision.

```json
{ "inputs": { "base": { "a": 1, "b": 2 }, "override": { "b": 99 } } }
// outputs: { "merged": { "a": 1, "b": 99 } }
```

Deep-merge is intentionally out of scope; downstream packs can ship that variant.

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md)
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — Phase 1 catalog
- [`docs/PROTOCOL-GAP-CLOSURE-PLAN.md`](../../docs/PROTOCOL-GAP-CLOSURE-PLAN.md) Track 7 — Node-Pack Registry MVP
