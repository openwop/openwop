# For host implementers

You're implementing OpenWOP against a runtime — your own engine, a customer's stack, a managed service you're building. This page tells you what the conformance suite expects, what the advertise-honestly principle costs you, and which reference implementation to mine first.

## The contract in one sentence

A host advertises a set of capabilities at `GET /.well-known/openwop`, implements the REST endpoints + SSE streams + signed webhooks for the capabilities it claims, and passes the conformance scenarios gated on those capabilities. Anything you don't claim, you don't have to implement.

## Read these first

- [Host capabilities](/spec/v1/host-capabilities.html) — the canonical advertisement shape. Every capability has a `supported: boolean` and additional fields documenting the host's posture (BYOK policy modes, signing algorithms, scale claims, etc.).
- [Capabilities](/spec/v1/capabilities.html) — how clients should treat absent vs. `false` vs. `true` advertisements, ETag semantics, and the discovery → handshake flow.
- [Profiles](/profiles/) — the named capability bundles a host can claim. Each profile is a predicate over `/.well-known/openwop` plus a set of conformance scenarios.
- [REST endpoints](/spec/v1/rest-endpoints.html) — every endpoint with request/response shapes and the canonical error codes.

## The advertise-honestly principle

If you advertise `capabilities.X.supported: true`, the conformance scenarios under `openwop-X` will run against your host, and you must pass them. If you advertise `false` or omit the block, those scenarios are skipped, and you owe nothing.

Do **not** advertise capabilities you don't actually behave correctly under. The Python reference host explicitly does NOT claim `openwop-audit-log-integrity` because Python's stdlib has no Ed25519 — that omission is the correct posture per the principle. The Postgres host claims `openwop-production` only because the [production-profile](/spec/v1/production-profile.html) predicates (backpressure, retention, claim acquisition, orphan recovery) have all been mechanically proven.

The leaderboard at [/conformance/](/conformance/) is the public record. A host that overclaims will fail in someone else's CI before it fails for an end user.

## Start from a reference host

The four reference hosts are all under [`examples/hosts/`](https://github.com/openwop/openwop/tree/main/examples/hosts) on GitHub. Pick the one closest to your storage tier:

| Reference | Language | Storage | Use case |
|---|---|---|---|
| `in-memory` | Node TypeScript | RAM | Local dev / fastest boot / read the wire shape end-to-end |
| `sqlite` | Node TypeScript | SQLite | Single-machine durability + audit-log integrity demo |
| `postgres` | Node TypeScript | Postgres | Production-shaped — backpressure, retention sweeper, OAuth2/OIDC/mTLS, claim acquisition |
| `python` | Python (stdlib-only) | RAM | Cross-language portability proof — no third-party packages |

Each has a `conformance.md` documenting which profiles it claims, the pass/fail/skip counts against the conformance suite, and the host-private invariants it's been hardened against.

## Run the conformance suite

The conformance suite is published as `@openwop/openwop-conformance` on npm. Point it at your host:

```bash
OPENWOP_BASE_URL=https://my-host.example.com \
OPENWOP_API_KEY=… \
npx @openwop/openwop-conformance
```

Scenarios are gated on the capabilities your host advertises. You'll see PASS / FAIL / SKIP per scenario. The leaderboard wants the full run output committed to your repo as `conformance.md`.

## Common implementation surfaces

- Event log + suspend/resume: see [Storage adapters](/spec/v1/storage-adapters.html).
- BYOK secret resolution: see [Auth](/spec/v1/auth.html) and the [secret-leakage threat model](https://github.com/openwop/openwop/blob/main/SECURITY/threat-model-secret-leakage.md).
- Signed webhooks: see [Webhooks](/spec/v1/webhooks.html); the HMAC recipe is `HMAC-SHA256({timestamp}.{rawBody})`.
- Interrupts: see [Interrupts](/spec/v1/interrupt.html) for the 4 kinds and the shared resume contract.

## What you owe the matrix

When you ship an OpenWOP host (your own or for a customer), open a PR that:

1. Adds a row to [`INTEROP-MATRIX.md`](https://github.com/openwop/openwop/blob/main/INTEROP-MATRIX.md).
2. Includes a `conformance.md` with the suite version, command line, target URL class, and pass/fail/skip counts.
3. Lists the profiles you claim and the ones you explicitly don't.

The leaderboard rebuilds automatically. Honesty is enforced socially, not algorithmically — but the conformance scenarios catch most over-claims for you.

## Next steps

| Action | Where |
|---|---|
| Read the host capabilities spec | [/spec/v1/host-capabilities.html](/spec/v1/host-capabilities.html) |
| Browse profile predicates | [/profiles/](/profiles/) |
| Check the leaderboard | [/conformance/](/conformance/) |
| Clone a reference host | [examples/hosts](https://github.com/openwop/openwop/tree/main/examples/hosts) |
| Run the conformance suite | `npx @openwop/openwop-conformance` |
