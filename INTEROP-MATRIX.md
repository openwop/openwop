# openwop Interop Matrix

> **Last updated:** 2026-06-02. A live record of OpenWOP-compatible hosts — their advertised compatibility profiles and the conformance evidence behind each claim. A row is a **claim plus evidence**: the claim is the host's advertised profile; the evidence is the conformance result published with the host (or under [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/<name>/conformance.md)).

## Hosts

| Host | Use case | Repo / Path | Compatibility profile claim | Scale claim | Production profile claim | Conformance link |
|---|---|---|---|---|---|---|
| **In-memory** (reference example) | Local development / fastest boot / no persistence | [`examples/hosts/in-memory/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/in-memory) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/in-memory/conformance.md) |
| **SQLite** (reference example) | Single-machine durability / process-restart-safe | [`examples/hosts/sqlite/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/sqlite) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/sqlite/conformance.md) |
| **Python in-memory** (reference example) | Cross-language portability — Python 3.11 stdlib-only port | [`examples/hosts/python/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/python) | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/python/conformance.md) |
| **Postgres** (reference example) | Multi-process durability + first `production-profile` host | [`examples/hosts/postgres/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/postgres) | `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-production` · `openwop-auth-oauth2-client-credentials` · `openwop-auth-oidc-user-bearer` · `openwop-auth-mtls` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped` (auth profiles conditional on env) | `minimal` | Claimed (since 2026-05-11) | [`conformance-full.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/conformance-full.md) |

### Agent Platform profile (RFC 0085 — `openwop-agent-platform`)

The aggregate platform profile defined in `spec/v1/agent-platform-profile.md`. A host populates the status column when it reaches `partial`/`full`; at the profile's current `Active` stage no reference host claims it yet (honest).

| Host | `openwop-agent-platform` status | Notes |
|---|---|---|
| In-memory | **none** | Advertises `feedback` + several floor constituents, not the full floor set. |
| SQLite | **none** | — |
| Python | **none** | — |
| Postgres | **none** (candidate) | Already `production-profile`-satisfying and advertises `memory` / `authorization` / `httpClient` — the natural first `partial`/`full` candidate. |

### Conformance pass rates

Measured against `@openwop/openwop-conformance@1.18.1` in default mode (reference hosts 2026-06-01; workflow-engine harness 2026-06-02). Failures are honest non-claims for surfaces a host does not advertise; the durable reference hosts have **0 deterministic failures**. (The published suite has since advanced to `1.20.0`; its only additions over `1.18.1` — the capability-gated `agent-channel-dispatch` scenario — soft-skip on these hosts, so applicable pass-rates are unchanged.)

| Host | Passed | Failed | Skipped | Todo | Total | Pass rate (default) |
|---|---:|---:|---:|---:|---:|---:|
| Postgres reference | 2068 | 0 | 93 | 0 | 2161 | 95.7% |
| SQLite reference | 2056 | 0 | 105 | 0 | 2161 | 95.1% |
| In-memory reference | 2010 | 46 | 105 | 0 | 2161 | 93.0% |
| Python reference | 2008 | 2 | 151 | 0 | 2161 | 92.9% |
| Workflow-engine reference (in-process) | 1400 | 20 | 107 | 0 | 1527 | 91.7% |

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
