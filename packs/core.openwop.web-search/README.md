# `core.openwop.web-search`

Spec-canonical web-search pack. One capability-advertised node that routes through the host's web-search adapter.

| Pack name | `core.openwop.web-search` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — pack makes NO HTTP calls |
| peerDependencies | `host.webSearch: optional` |
| License | Apache-2.0 |

## Node

| typeId | Label | Role |
| `core.web.search` | Web Search | side-effect, cacheable |

`core.web.search` takes a `query` (and optional `siteFilter`) and returns ranked `results` (`url` + `title` + `snippet` + `rank`).

## Why no HTTP / no SDK deps?

This is a **protocol-layer** node pack, not a host-side `exec` tool. The pack does not know about search-API URLs, keys, scraping policy, rate limits, or caching — it asks the host via `ctx.webSearch(...)` and the host owns all of that. This mirrors how `core.openwop.ai` asks the host via `ctx.callAI(...)`.

A host advertises support by exposing `ctx.webSearch` and advertising the `host.webSearch` capability. Because the peer dependency is `optional`, the node still registers on hosts that don't advertise the surface — see below.

## Demo determinism (stub path)

The OpenWOP demo backend does **not** advertise `host.webSearch`. On a host without the surface, `core.web.search` returns a **deterministic fixture** result — a pure function of the query — instead of a live search. The fixture output is tagged `stub: true` so callers can tell a demo result from a real one. This keeps workflow replays and conformance runs byte-stable without provisioning a real search provider.

A production host wires a real `ctx.webSearch` and the stub path never runs.

## Sample workflow

`sample.web.research` (registered by the demo backend) chains `core.web.search` → `core.ai.chatCompletion` to demonstrate a search-then-summarize research loop on the protocol layer.
