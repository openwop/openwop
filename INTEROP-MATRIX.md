# openwop Interop Matrix

> **Last updated:** 2026-05-11
> **Conformance suite:** `@openwop/openwop-conformance`

This matrix records public, reproducible compatibility evidence for openwop-compatible hosts. A row is a claim plus evidence: the host advertises a profile set, runs the conformance suite, and links to a result that another implementer can inspect.

## Hosts

| Host | Use case | Repo / Path | Compatibility profile claim | Scale claim | Production profile claim | Conformance link |
|---|---|---|---|---|---|---|
| **In-memory** (reference example) | Local development / fastest boot / no persistence | `examples/hosts/in-memory/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | `examples/hosts/in-memory/conformance.md` |
| **SQLite** (reference example) | Single-machine durability / process-restart-safe walkthrough | `examples/hosts/sqlite/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` (all since 2026-05-11) | `minimal` | Not claimed | `examples/hosts/sqlite/conformance.md` |
| **Python in-memory** (reference example) | Cross-language portability proof / Python 3.11 stdlib-only port of the TypeScript in-memory host | `examples/hosts/python/` | `openwop-core` · `openwop-stream-sse` · `openwop-stream-poll` | `minimal` | Not claimed | `examples/hosts/python/conformance.md` |
| **Postgres** (reference example, PARTIAL) | Multi-process durability path + the eventual `production`-profile claimant. Run-lifecycle slice works (discovery + run create + terminal poll + cancel + events poll + idempotency replay) plus `openwop-audit-log-integrity` profile (hash chain + Ed25519 checkpoints + tamper detection). Interrupts / webhooks / observability / SSE are deferred to follow-up sessions per module. | `examples/hosts/postgres/` | `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` (all since 2026-05-11) | `minimal` (until production-profile ports land) | Not claimed | `examples/hosts/postgres/README.md` + in-process `test/lifecycle.test.ts` + `test/audit-tamper.test.ts` + `test/pause-resume.test.ts` + `test/interrupts.test.ts` + `test/webhooks.test.ts` + `test/sse.test.ts` via pglite |

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
