# openwop Interop Matrix

> **Last updated:** 2026-05-12
> **Conformance suite:** `@openwop/openwop-conformance`

This matrix records public, reproducible compatibility evidence for openwop-compatible hosts. A row is a claim plus evidence: the host advertises a profile set, runs the conformance suite, and links to a result that another implementer can inspect.

## Hosts

| Host | Use case | Repo / Path | Compatibility profile claim | Scale claim | Production profile claim | Conformance link |
|---|---|---|---|---|---|---|
| **In-memory** (reference example) | Local development / fastest boot / no persistence | `examples/hosts/in-memory/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | `examples/hosts/in-memory/conformance.md` |
| **SQLite** (reference example) | Single-machine durability / process-restart-safe walkthrough | `examples/hosts/sqlite/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped`. **Conformance posture (updated 2026-05-12 after Phase D close-out):** `openwop-auth-api-key-rotation` is **verified end-to-end** (two-key overlap + canary-redaction + grace-window advertisement, exercised via `OPENWOP_SECONDARY_API_KEY` against the host's constant-time dual-candidate `checkAuth`). `openwop-discovery-auth-scoped` is **verified end-to-end** (same-endpoint mode; `OPENWOP_TENANT2_API_KEY` wires a synthetic second principal whose discovery view OMITS `orchestrator` + `dispatch` — strict subset of primary's view per `capabilities-change-detection.md` §"Scoped capability views" line 69; 3-subtest behavior probe in `discovery.test.ts` passes under `OPENWOP_REQUIRE_BEHAVIOR=true` + `OPENWOP_TEST_UNAUTHORIZED_API_KEY=<tenant2-key>`). RFC 0006 + RFC 0007 (`core.orchestrator.supervisor` + `core.dispatch` with causationId propagation per §E) verified end-to-end via `dispatchLoop.test.ts`. The host explicitly does NOT claim `openwop-production`, `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, or `openwop-auth-mtls` — those profiles require backpressure/retention enforcement, JWT validation, or TLS termination that the reference HTTP listener does not implement (per the honesty principle: advertise only what behavior exists). | `minimal` | Not claimed | `examples/hosts/sqlite/conformance.md` |
| **Python in-memory** (reference example) | Cross-language portability proof / Python 3.11 stdlib-only port of the TypeScript in-memory host | `examples/hosts/python/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | `examples/hosts/python/conformance.md` |
| **Postgres** (reference example) | Multi-process durability path + first host advertising `production-profile.md`. Wire-surface parity with SQLite (audit + 4 interrupt profiles + webhooks + SSE + observability + debug-bundle + pause/resume) plus production-shape guarantees (session-level advisory-lock claim acquisition + orphan recovery, 503/Retry-After backpressure, 7-day event retention sweeper, structured terminal logs). | `examples/hosts/postgres/` | `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-production` (audit + interrupts since 2026-05-11; `openwop-production` added 2026-05-11 under RFC 0009) | `minimal` (operational-readiness claim is independent of throughput — see `production-profile.md:74`; single-`pg.Client` design serializes writes) | Claimed (since 2026-05-11) — see `examples/hosts/postgres/conformance-full.md`; mechanically verified via `capabilities.production.supported: true` advertisement + `production-backpressure.test.ts` + `production-retention-expiry.test.ts` passing under `OPENWOP_REQUIRE_BEHAVIOR=true` per RFC 0009 | `examples/hosts/postgres/README.md` + `conformance-full.md` + in-process `test/{lifecycle,audit-tamper,pause-resume,interrupts,webhooks,sse,review-fixes,claim,backpressure}.test.ts` via pglite |

### External conformance suite — pass rates (2026-05-12)

Latest `npx vitest run` against each running reference host.

| Host | Passed | Failed | Skipped | Todo | Total | Pass rate (default) |
|---|---:|---:|---:|---:|---:|---:|
| Postgres reference | 610 | 1-2 (flake) | 41 | 30 | 682 | **89.4%** (measured 2026-05-11) |
| SQLite reference | 669 | **0** | 32 | 30 | 731 | **91.5%** (Phase A close-out, 2026-05-12) |
| In-memory reference | — | — | — | — | — | not measured this round |
| Python reference | — | — | — | — | — | not measured this round |

SQLite's 9 pre-Phase-A failures (`core.dispatch`, `channel-ttl` pruning, conversation-capability refusal, subworkflow `outputMapping`, identity-fixture variable echo, events/poll forward-compat tolerance, and runtime-capabilities `capability_not_provided`) are all closed; the host now passes 100% of applicable default-mode scenarios. Postgres's 1-2 failures are unchanged from 2026-05-11: `webhook-signed-delivery` (flake; passes in isolation) and `pause/resume running→paused→terminal` (fixture-coupled — 30s default delay vs 10s post-resume timeout). None of the failures on either host block the production-profile MUSTs.

**Strict-mode posture (`OPENWOP_REQUIRE_BEHAVIOR=true`).** SQLite runs at 669 pass / 10 strict-fail / 32 skip / 30 todo. The 10 strict-fails are intentional honesty opt-outs — the host explicitly does NOT claim `openwop-production`, OAuth2-CC, OIDC, mTLS, auth-scoped discovery, or replay-retention profiles, so `behaviorGate` correctly flips skip→fail under strict mode. Per the host's design these are not bugs; they are the price of advertising only what the host implements. Future strict-mode green requires either implementing those surfaces or relaxing `behaviorGate` to distinguish "host opted out" from "host claims but doesn't deliver."

Third-party hosts can append rows by opening a PR with their advertised profiles, suite version, and a public conformance result.

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
