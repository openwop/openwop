# OpenWOP Profile Decision Guide

> DOC-2 from `plans/openwop-protocol-gap-closure-plan.md`. Decision guide for choosing the OpenWOP capability profiles your host should claim.

The protocol is intentionally additive: you claim what you implement and you skip what you don't. Strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`) makes that contract auditable. This guide walks you from "what kind of host are you building?" to "here are the exact profile strings to put in your discovery payload."

The full list of profiles lives in [`spec/v1/profiles.md`](../spec/v1/profiles.md). This page is the **decision** path — what to claim, in what order.

---

## Decision tree

### Are you building a host at all?

If you're building a **client** that talks to OpenWOP hosts, you don't claim profiles — you read them. Skip ahead to the [SDK quickstarts](../sdk/python/QUICKSTART.md).

If you're building a **host**, continue.

### What's your deployment shape?

| Shape | Start here |
|---|---|
| **Educational reference / local demo** | `minimal` — just `openwop-core` + your stream choice. See [`profiles.md`](../spec/v1/profiles.md) §"Minimal". |
| **Single-machine production** (e.g., SQLite-backed) | `minimal` + your stream choice + `openwop-audit-log-integrity` if you care about audit. |
| **Production multi-tenant SaaS** | `production` — claim `openwop-production` end-to-end. Requires backpressure 503 + retention sweep + claim acquisition + every auth profile you actually validate. |
| **High-throughput orchestrator** | `production` + scale-tier `high-throughput` per `scale-profiles.md`. Today no reference host claims this; the bar is operator-defined. |

---

## Decision 1: Pick your stream profile

| You implement | Claim |
|---|---|
| Only `GET /v1/runs/{id}/events/poll` | `openwop-stream-poll` |
| Only SSE on `GET /v1/runs/{id}/events` | `openwop-stream-sse` |
| Both | `openwop-stream-poll` **and** `openwop-stream-sse` |

**Do not claim** `openwop-stream-sse` if your runtime doesn't actually keep an SSE connection open for the duration of a run — pollers will get confused.

---

## Decision 2: Auth profiles

Every host implements API-key bearer auth (the `openwop-core` baseline). The four auth-extension profiles compose:

| Profile | Claim when | Required env / config |
|---|---|---|
| `openwop-auth-api-key-rotation` | You accept BOTH a primary AND a secondary key during an overlap window. | Your host config carries TWO valid keys; the secondary is removed at rotation end. |
| `openwop-auth-oauth2-client-credentials` | You validate OAuth2 JWT bearers via a JWKS issuer. | Issuer + audience configured; JWKS reachable. |
| `openwop-auth-oidc-user-bearer` | You validate OIDC user-bearer JWTs (sub-claim → user identity). | OIDC issuer + audience configured. |
| `openwop-auth-mtls` | Your transport terminates mTLS and verifies client certs. | TLS cert + key + (optional) CA bundle paths. |

**Compose freely.** A production host might claim all four. The conformance suite has a scenario per profile; each gates on the discovery advertisement.

---

## Decision 3: Optional capability profiles

These are advertised separately under `capabilities.*`, not in `auth.profiles[]`. Claim only when you actually implement the behavior.

| Capability | Profile concept | When to claim |
|---|---|---|
| `runs.pauseResume` | Operator pause/resume of in-flight runs | When you implement `POST :pause` + `:resume` with status transitions. Optionally advertise `drainPolicies: ['immediate', 'drain-current-node']`. |
| `memory` | RFC 0004 MemoryAdapter | When you implement `list` + `get` over agent memory with CTI-1 cross-tenant isolation. |
| `memory.compaction` | RFC 0012 host-managed compaction | When you periodically distill long-lived MemoryEntry rows. **MUST honor SR-1 carry-forward** per RFC 0012 §D. |
| `agents` | RFC 0002–0007 Multi-Agent Shift | When you implement AgentRef + reasoning events + orchestrator + dispatch. Reading the RFCs first is recommended. |
| `nodePackRuntimes.wasm` | RFC 0008 WASM ABI | When you execute WASM packs in a sandbox with `memory.grow` cap + fuel + execution-time enforcement. |
| `aiProviders` | BYOK + 4-mode policy enforcement | When you broker LLM API calls and enforce `disabled` / `optional` / `required` / `restricted` policies per provider. |
| `mcpClient` | MCP tool calls with `trustBoundary: untrusted` | When you implement `core.mcp.toolCall` with MCP-1 redaction (args + content hashed, never raw on event payloads). |
| `httpClient` | `core.http.request` with SSRF guard | When you implement an SSRF-guarded outbound HTTP node with a documented response-body cap. |
| `webhooks.signatureAlgorithms` | Signed webhook delivery | When you deliver run events to external receivers with HMAC signing. Always include `v1`. |
| `idempotency.crossRegion` | Multi-region Layer-1 idempotency | When you deploy with cross-region idempotency cache replication. Honest values: `single-region` (default), `best-effort`, `strict`. |
| `discovery.authScoped` | Per-principal narrowed views | When the same `/.well-known/openwop` endpoint returns a STRICT subset for less-privileged principals. |
| `auditLogIntegrity` | Hash-chained event log + signed checkpoints | When you persist a tamper-evident audit log with Ed25519 checkpoint signatures. |
| `production` | RFC 0009 production-profile claim | When you implement backpressure + retention + claim acquisition + audit-log integrity + every claimed auth profile end-to-end. |

---

## Decision 4: Honesty signals

Once you've picked your profile set, the conformance suite has two opt-in modes that make your claim auditable.

### Strict mode (your ground-truth honesty gate)

```bash
OPENWOP_REQUIRE_BEHAVIOR=true \
OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-oidc-user-bearer \
npx openwop-conformance
```

`OPENWOP_REQUIRE_BEHAVIOR=true` flips capability-gated scenarios from skip-when-not-advertised to fail-when-not-advertised. The escape hatch is `OPENWOP_OPTED_OUT_PROFILES` — a comma-separated list of profiles you explicitly chose NOT to implement. Strict mode treats opted-out profiles as PASS (logged as "honest opt-out"), so minimal hosts can still hit a strict-mode green run.

**The honesty failure mode:** a host that advertises a profile in `capabilities.auth.profiles[]` AND lists it in `OPENWOP_OPTED_OUT_PROFILES` gets a loud warning at scenario time. Either implement it or stop advertising it.

### Production profile (RFC 0009)

`openwop-production` is more than a profile string — it's a behavioral contract claimed in `capabilities.production.supported: true`. The conformance suite verifies it mechanically:

- `production-backpressure.test.ts` — saturates inflight, expects 503 + Retry-After.
- `production-retention-expiry.test.ts` — verifies retention sweep emits the documented envelope.
- The host MUST also pass `openwop-audit-log-integrity` AND every claimed auth profile under strict mode.

Don't claim `openwop-production` until all three groups pass.

---

## Reference rows

Existing reference hosts publish their profile choices in [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md). The four reference hosts model four different shapes:

- **In-memory** — educational reference. `openwop-core` + `openwop-stream-sse` + `openwop-stream-poll`. Skips most optional surfaces.
- **SQLite** — durability reference + 4 interrupt profiles + audit-log integrity. Single-machine production claim.
- **Python** — cross-language portability proof. `openwop-core` + stream profiles only; explicit honest opt-outs for everything else.
- **Postgres** — full production reference. Claims `openwop-production`, all four auth-extension profiles (conditional on env), MemoryAdapter + agents + memory compaction + MCP + HTTP + aiProviders + WASM ABI + pack consumption.

Read those rows before you claim a profile your reference doesn't yet honor.

---

## Common mistakes

- **Claiming `openwop-auth-mtls` because TLS is on.** mTLS specifically means client-cert verification at the transport layer. TLS-the-encryption is `openwop-core` baseline; mTLS-the-auth-profile is `openwop-auth-mtls`. Don't conflate them.
- **Claiming `idempotency.crossRegion: 'best-effort'` without implementing reconciliation.** The annex requires the convergence rule (lex-min(runId) wins, loser cancelled with `cross_region_dedup_loss`) at partition-heal time. Single-region hosts MUST advertise `'single-region'`.
- **Claiming `memory.compaction.supported: true` without implementing SR-1 carry-forward.** RFC 0012 §D is the load-bearing security claim — the compactor MUST re-route derived content through the BYOK redaction harness.
- **Claiming `agents.supported: true` because you emit one `agent.*` event.** The advertised profile (`wop-agents-full` or otherwise) names the Phase 1–6 surface. Read the RFCs before claiming.

---

## See also

- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — full implementer path from minimum surface through INTEROP-MATRIX row.
- [`spec/v1/profiles.md`](../spec/v1/profiles.md) — normative profile definitions.
- [`spec/v1/capabilities.md`](../spec/v1/capabilities.md) — discovery payload contract.
- [`spec/v1/positioning.md`](../spec/v1/positioning.md) §"Standards composition matrix" — what OpenWOP composes with vs. what it doesn't duplicate.
- [`conformance/coverage.md`](../conformance/coverage.md) §"Capability-gated scenarios" — which conformance scenarios light up per advertised capability.
