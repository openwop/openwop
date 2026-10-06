# OpenWOP Roadmap

> **Status:** Living document. Updated as milestones land.
> **Last reviewed:** 2026-10-05 (v2 is the current major; v1 is in its overlap period).

This roadmap covers the current **v2** major, the gated candidates for later v2 minors, and the ecosystem work around the protocol (infrastructure, SDKs, governance).

## Current: v2 (released 2026-09-05)

`v2.0.0` was tagged on 2026-09-05. Every v2 minor since is additive under [`COMPATIBILITY.md`](./COMPATIBILITY.md) §2.4; removals inside the major follow §3a.

- **Contract:** the documents in `spec/v2/core/`, with optional extensions in `spec/v2/ext/`. Schemas are in `schemas/v2/`, and the HTTP and event APIs are `api/v2/openapi.yaml` and `api/v2/asyncapi.yaml`.
- **Conformance:** `@openwop/openwop-conformance` 2.x. `openwop-core-standard` is the floor listed in `spec/v2/profiles.json`.
- **SDKs:** `@openwop/openwop` (TypeScript), `openwop-client` (Python) and `github.com/openwop/openwop-sdks/go` (Go), at 2.x in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks).
- **Hosts:** [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) lists each host's newest certified bundle.

See [`CHANGELOG.md`](./CHANGELOG.md) for the release record and [`docs/PROTOCOL-STATUS.md`](./docs/PROTOCOL-STATUS.md) for the live tally.

**The v1 overlap.** v1.x receives only additive and safety-fix releases until v1 end-of-support. `evidence/v1-end-of-support.json` computes that date from the host-inventory rule in `COMPATIBILITY.md` §5; it is no earlier than 2026-12-04.

## Candidates (gated)

Each candidate ships only when its gate condition is met. The list is descriptive, not a commitment. A candidate is not an RFC and has no comment window running. The list is re-read at each corpus minor. A candidate with no adoption signal across two consecutive corpus minors is reviewed for withdrawal at the next one, and a maintainer removes any candidate whose gate no longer makes sense, noting the removal in the CHANGELOG.

| Candidate | Gate |
| --- | --- |
| **WASM Component Model sub-RFC** | A first adopter requests `runtime.language: "wasm-component"` packs |
| **Rust SDK v0.1** | An adopter asks for it, or a non-steward host lands in Rust |
| **Post-audit obligations for the published `core.openwop.*` packs** | The external security audit completes |
| **mTLS certificate-matrix hardening** | Operators need documented certificate recipes |
| **Multi-region idempotency end-to-end fixture** | A host advertises `capabilities.idempotency.crossRegion` |
| **Structured handoff context on `agent.handoff`** | openwop-app's host-extension handoff record is stable for 30 days in two real workflows, and a second host asks for it |
| **Shared intent record** | openwop-app's team intent ledger runs in production for 30 days on two real projects, with every bound run stamping the ledger version it acted on, and a second host asks to read it across host boundaries |

Notes on the candidates:

- **WASM Component Model.** The manifest enum is reserved in `node-pack-manifest.schema.json`, and `capabilities.schema.json` declares `nodePackRuntimes.wasmComponent`. WIT-defined interfaces would replace the hand-rolled imports and exports of [RFC 0008](./RFCS/0008-wasm-abi.md) §C. The loader needs Wasmtime ≥ 14 (Component Model GA).
- **Rust SDK.** The conformance suite is language-agnostic, so a Rust client tests against the same wire contract. It is demand-gated.
- **Post-audit obligations.** `core.openwop.{ai,http,mcp,triggers}` are already published on `packs.openwop.dev` (1.1.0, see [`docs/PACK-CATALOG.md`](./docs/PACK-CATALOG.md)). The steward published them before the external review completed, a decision recorded on 2026-05-17 in `SECURITY/external-audit-engagement.md` §2.1.1. The audit requirement still stands: when the review completes, its findings bind every pack published early, and the steward team still needs a namespace-scoped signing key.
- **mTLS.** `openwop-auth-mtls` is verified end-to-end when configured. What remains is operator documentation (CA, server and client certificates, reverse-proxy deployment) and broader certificate-matrix coverage.
- **Multi-region idempotency.** The rule is in the idempotency spec's multi-region annex. `multi-region-idempotency.test.ts` covers the capability shape only; the candidate adds behavior assertions for `"best-effort"` and `"strict"`.
- **Structured handoff context.** Today `agent.handoff` carries `fromAgentId`, `toAgentId` and a free-text `reason`. RFC 0002 sketched an open `context` field that v2 does not carry. The candidate is an optional, typed handoff context with five parts: the intent, the decisions made (each with who decided), open questions, what was tried, and a confidence value. It would also cover agent-to-human escalation, where the same record would ride the clarification or approval interrupt. It is additive: a receiver that ignores it loses nothing it has today. openwop-app prototypes it first under the `openwop-` extension prefix the event schema already admits (see the app's ROADMAP, "Collaborative orchestration program").
- **Shared intent record.** A run can already be paused for a human decision, and the decision is attributed. Nothing on the wire says what the work is *for*: the current intent, the decisions that shaped it, and what changed. openwop-app is building a team intent ledger as a host extension, with drift detection and decision capture from chat on top. Only the record itself is a protocol candidate, and only if it needs to cross hosts: a stable reference a run can stamp ("acted on ledger version N") and a way for a host to read it. Drift detection and decision capture stay host behavior.

## Ecosystem

These initiatives expand the openwop ecosystem without changing the wire contract.

### Optional capability profiles

A capability profile is a cluster of optional behaviors a host advertises at `/.well-known/openwop`. Each profile has its own conformance scenarios in `@openwop/openwop-conformance`, which run only when the host advertises the profile. `spec/v2/profiles.json` lists the v2 profiles and their floors, and [`docs/PROFILE-DECISION-GUIDE.md`](./docs/PROFILE-DECISION-GUIDE.md) helps a host choose.

### Hosted infrastructure

| Item | Status | Notes |
| --- | --- | --- |
| Hosted node-pack registry (`packs.openwop.dev`) | Live | Discovery, index, manifest and tarball endpoints |
| Hosted docs + conformance leaderboard site (`openwop.dev`) | **Live** | Built from [`openwop/openwop-site`](https://github.com/openwop/openwop-site) |
| Public CI for community contributions | Live for steward PRs | `pr-checks.yml` and `openwop-spec.yml` run on every PR on GitHub-hosted runners, without secrets for forks. It is proven once the first PR from a fork runs green |

- **Registry.** It serves per `registry-operations.md`. The pack inventory is [`docs/PACK-CATALOG.md`](./docs/PACK-CATALOG.md). Publishing, yanking, deprecation and key rotation go through pull requests on GitHub. `conformance/src/scenarios/registry-public.test.ts` is its public healthcheck.
- **Site.** It renders this corpus at a pinned commit and tracks `main` through a daily pin bump.
- **CI.** The workflows are in `.github/workflows/`.

### SDK expansion

Additional SDKs ship only when there is concrete demand. The current set (TS, Python, Go) covers the most common host implementation languages. Candidates if requested: Rust, Java/Kotlin, Ruby, .NET.

### Implementation ecosystem

| Item | Status | Notes |
| --- | --- | --- |
| Production-host conformance certification | In progress | Two production hosts (openwop-app, MyndHyve) and the v2 reference host certify `openwop-core-standard` |
| Second independent host implementation (non-steward maintainer) | Not started | Needed for working-group governance |
| Third-party node-pack catalog | Not started | Depends on hosted registry |
| Certification bundle cut by someone other than the steward | Not started | Needs the independent host above |

- **Certification.** [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) records each host's certified profiles and signed bundle. Every bundle is steward-cut (`self`).
- **Independent host.** `GOVERNANCE.md` requires a maintainer from a genuinely independent organization before the project moves to working-group governance. MyndHyve is a steward-affiliated sibling host (tier-2 evidence per `GOVERNANCE.md` §"Acceptance evidence tiers"), so it does not count.
- **Independent certification.** All three certified hosts today (the v2 reference host, openwop-app and MyndHyve) are run by or affiliated with the steward, and every bundle is evidence tier `self`. "Open by design" becomes demonstrated, not just claimed, when a host we do not run publishes a certified bundle it cut itself against a released suite and it appears in `INTEROP-MATRIX.md`. Until then, public writing should say the protocol is open to any host and that independent implementations are wanted. It should not say they exist.

### Canonical Domain

Forward-looking domain references in the spec corpus and roadmap use `openwop.dev`.

Three rules for domain usage:

1. **All forward-looking public URLs** (`packs.openwop.dev`, `openwop.dev/openwop-conformance`, etc.) use `openwop.dev`.
2. **Published package names stay verbatim** (`@openwop/openwop` on npm, `openwop-client` on PyPI) and are guaranteed stable within a major per `PUBLISHING.md`. The SDK source lives in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks), so the Go module path is `github.com/openwop/openwop-sdks/go/v2` for v2 and `github.com/openwop/openwop-sdks/go` for v1, never the frozen pre-split `github.com/openwop/openwop/sdk/go`.
3. **Internal references in steward-private docs** are not normative and may use any name; this convention applies only to the public spec corpus, this ROADMAP, and the conformance suite.

### Vendor-neutral org migration

The repository is at `github.com/openwop/openwop`. Migration to a vendor-neutral org (target name: `openwop-spec/openwop`) is planned but **not on a calendar schedule**. The migration has a single tripwire:

> **Migration to `openwop-spec/openwop` is initiated when `MAINTAINERS.md` lists at least one maintainer not affiliated with the original steward (OpenWOP).**

When the tripwire fires, the migration plan is:

1. Open an RFC per `RFCS/0001-rfc-process.md` proposing the new org name and the mechanics (redirect, DNS, package owner transfer, CHANGELOG entry).
2. Ratify by maintainer lazy consensus (per `GOVERNANCE.md`).
3. Move the repository; configure `github.com/openwop/openwop` as a permanent redirect.
4. Transfer ownership of npm scopes and PyPI/Go module names; old names continue resolving via metadata redirects where the package registry supports it.
5. Update all in-spec links to the new canonical URL in the next minor release.

Until the tripwire fires, the canonical URL remains `github.com/openwop/openwop`. The migration will be announced in the CHANGELOG, the README banner, and directly to known third-party implementers.

Recruiting external maintainers is **out of band**. `MAINTAINERS.md` documents the criteria and process; this roadmap does not commit to a recruitment timeline.

## Research & publications

- **OpenWOP: A Vendor-Neutral Protocol for Durable, Portable Agentic Workflow Orchestration** — published on Zenodo, [DOI 10.5281/zenodo.20576239](https://doi.org/10.5281/zenodo.20576239) (CC BY 4.0). A protocol-level position paper with a reproducible cross-language portability result: the same workflow definition yields identical terminal state and `RunEvent` type-sequence across an independent TypeScript and a Python reference host. Source and evidence are in [`openwop/openwop-paper`](https://github.com/openwop/openwop-paper).
  - The paper is steward-authored and says so. Independent external review and a non-steward host remain the decisive validation steps.

## What this roadmap does not commit to

- A specific date for any v2 minor or for v3.
- Any breaking change inside the v2 major.
- Adoption by any specific vendor or platform.
- Staying on any specific cloud. Forward-looking spec, registry and leaderboard URLs use `openwop.dev`, so the services behind them can move without changing a public URL.
- Migration of the repository to a different organization on a specific timeline (planned but not scheduled — gated on the tripwire described above and in `MAINTAINERS.md`).

## How to influence the roadmap

- **File an issue** with the `roadmap` label. Include the use case, not just the feature request.
- **Open a conformance report** if your implementation needs a scenario that doesn't exist yet.
- **Author an RFC** for a new capability profile. Profile RFCs follow the spec change process in `GOVERNANCE.md`.
