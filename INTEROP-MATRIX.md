# openwop Interop Matrix

> **Last updated:** 2026-06-09. A live record of OpenWOP-compatible hosts — their advertised compatibility profiles and the conformance evidence behind each claim. A row is a **claim plus evidence**: the claim is the host's advertised profile; the evidence is the conformance result published with the host (or under [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/<name>/conformance.md)).

## Hosts

| Host | Use case | Repo / Path | Compatibility profile claim | Scale claim | Production profile claim | Conformance link |
|---|---|---|---|---|---|---|
| **In-memory** (reference example) | Local development / fastest boot / no persistence | [`examples/hosts/in-memory/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/in-memory) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/in-memory/conformance.md) |
| **SQLite** (reference example) | Single-machine durability / process-restart-safe | [`examples/hosts/sqlite/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/sqlite) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/sqlite/conformance.md) |
| **Python in-memory** (reference example) | Cross-language portability — Python 3.11 stdlib-only port | [`examples/hosts/python/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/python) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/python/conformance.md) |
| **Postgres** (reference example) | Multi-process durability + first `production-profile` host | [`examples/hosts/postgres/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/postgres) | `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-production` · `openwop-auth-oauth2-client-credentials` · `openwop-auth-oidc-user-bearer` · `openwop-auth-mtls` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped` (auth profiles conditional on env) | `minimal` | Claimed (since 2026-05-11) | [`conformance-full.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/conformance-full.md) |
| **MyndHyve `workflow-runtime`** (steward-affiliated sibling host — separate deployment, same maintainer org; **not** an independent-organization host, per the `GOVERNANCE.md` §"Acceptance evidence tiers" taxonomy this is tier-2 evidence) | Production agent-platform deployment whose live advertisements drove the RFC 0078–0092 `Active → Accepted` graduations | Closed source; live discovery: `https://api.myndhyve.ai/.well-known/openwop` | `openwop-core` · `openwop-interrupts` · `openwop-stream-sse` · plus the operational-annex claims `openwop-core-standard` (RFC 0088) and `openwop-agent-platform` **full** (RFC 0085) in its live `profiles[]` | Not published | Not claimed | Per-RFC graduation evidence in the `Updated` fields of [`RFCS/0078`](./RFCS/0078-portable-tool-catalog-and-tool-session-contract.md)–[`0092`](./RFCS/0092-agent-capability-requirements.md) + the `CHANGELOG.md` 1.1.7/1.1.8 graduation entries (gated scenarios pass non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`; steward-curl-verified; the steward independently re-derived the profile predicates from the public discovery document) |

### Agent Platform profile (RFC 0085 — `openwop-agent-platform`)

The aggregate platform profile defined in `spec/v1/agent-platform-profile.md` (RFC 0085, **`Accepted` 2026-06-01**). A host populates the status column when it reaches `partial`/`full`. MyndHyve — the steward-affiliated sibling host whose graduation evidence accepted the RFC — derives **full**; no example reference host claims it yet (honest).

| Host | `openwop-agent-platform` status | Notes |
|---|---|---|
| MyndHyve `workflow-runtime` | **full** | Advertises the profile in its live `profiles[]`; the steward independently re-derived `isAgentPlatformFull` from the public discovery doc (all 16 §B terms) and the aggregate-evidence scenario passes non-vacuously at tier `full` — see RFC 0085's `Updated` field. Steward-affiliated sibling host (same maintainer org). |
| In-memory | **none** | Advertises `feedback` + several floor constituents, not the full floor set. |
| SQLite | **none** | — |
| Python | **none** | — |
| Postgres | **none** (candidate) | Already `production-profile`-satisfying and advertises `memory` / `authorization` / `httpClient` — the natural first `partial`/`full` candidate. |

### Conformance pass rates

Measured against `@openwop/openwop-conformance@1.21.0` — the four example reference hosts re-measured 2026-06-09 (in-memory/python in default mode, SQLite under strict mode with honest profile/fixture opt-outs, Postgres via the pglite entry point). Failures are honest non-claims for surfaces a host does not advertise: SQLite, Postgres, and Python have **0 deterministic host failures**, and the in-memory host's 45 failures are all advertised-fixture surfaces the minimal host doesn't implement (bulk-cancel, BYOK, interrupts, stream-modes-buffer, dispatch, subworkflow). Test totals shifted from the 1.18.1 baseline (2161 → 1954 applicable) because 1.21.0's capability-gated scenarios — including the 6 RFC 0090/0091/0092 additions — gate on advertisement and soft-skip on these hosts. Pass rate is passed/total. (The **Workflow-engine** row is retained from the 2026-06-02 measurement against `1.18.1` — that host lives in `openwop-app`; its re-measure against `1.21.0` is tracked separately.) The suite has since advanced to `1.22.0` (+5 scenario files from the RFC 0093/0094 cycle: `i18n-negotiation`, `grpc-transport`, and `webhook-tenant-isolation` are capability-gated and soft-skip on hosts that don't advertise those surfaces; `version-fold` and `stream-text-fixture` gate on the host's advertised test fixtures) — a re-measure is pending and the rates above remain the `1.21.0` measurement.

| Host | Passed | Failed | Skipped | Todo | Total | Pass rate (default) |
|---|---:|---:|---:|---:|---:|---:|
| Postgres reference | 1746 | 0 | 208 | 0 | 1954 | 89.4% |
| SQLite reference | 1742 | 0 | 212 | 0 | 1954 | 89.1% |
| In-memory reference | 1780 | 45 | 129 | 0 | 1954 | 91.1% |
| Python reference | 1742 | 0 | 212 | 0 | 1954 | 89.1% |
| Workflow-engine reference (in-process, 1.18.1 / 2026-06-02) | 1400 | 20 | 107 | 0 | 1527 | 91.7% |

### Composition partners — interop evidence

The conformance suite's MCP and A2A probes run against live reference implementations of the adjacent protocols. See [A2A vs MCP vs OpenWOP](https://openwop.dev/comparisons/a2a-openwop-mcp/) for how the three layers compose.

| Partner | Reference impl | Result |
|---|---|---|
| **MCP** | `@modelcontextprotocol/sdk@1.29.0` (all three transports) | ✅ pass |
| **A2A** | `@a2a-js/sdk@0.3.13` reference peer (echo skill, JSON-RPC) | ✅ 1/1 pass (`a2a-task-roundtrip.test.ts`) |

## Reading Rows

- **Compatibility profile claim** is derived from `/.well-known/openwop` according to `spec/v1/profiles.md`.
- **Scale claim** follows `spec/v1/scale-profiles.md`.
- **Production profile claim** follows `spec/v1/production-profile.md` and is recorded separately because durability, retention, backpressure, and observability are operational evidence, not discovery-payload predicates.
- **Conformance evidence** should name the suite version, command used, target URL class, and pass/fail/skip counts. Do not include private deployment identifiers, secrets, or internal result paths.

## Add A Host

1. Implement the openwop v1 wire contract.
2. Run `@openwop/openwop-conformance` against the host.
3. Publish a result file or Markdown summary in a public repository.
4. Add a row above with compatibility, scale, production-profile, and evidence claims.

## See Also

- `conformance/README.md` — how to run the suite.
- `spec/v1/profiles.md` — compatibility profile predicates.
- `spec/v1/scale-profiles.md` — scale tier definitions.
- `spec/v1/production-profile.md` — public-release operational profile.
