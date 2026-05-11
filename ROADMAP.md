# openwop Roadmap

> **Status:** Living document. Updated as milestones land.
> **Last reviewed:** 2026-05-11 (registry-status reconciled with `PROTOCOL-GAP-CLOSURE-PLAN.md` Track 7; `packs.openwop.dev` confirmed live with 3 published packs).

This roadmap distinguishes **stable v1** (locked contract), **v1.X minor work** (additive, conformance-only), and **post-v1 ecosystem** (extension profiles, infrastructure, governance).

The v1 protocol contract is **frozen**. Implementations validate themselves against `@openwop/openwop-conformance` `1.0` (or any later `1.X.0`) at their own cadence. New scenarios ship as suite minors against the unchanged contract.

## Stable: v1 (released 2026-04-27)

Released and locked:

- 26 prose specs at FINAL v1
- 19 first-class JSON Schemas (compile clean under Ajv2020)
- OpenAPI 3.1 + AsyncAPI 3.1
- 3 reference SDKs: `@openwop/openwop` (TS), `openwop-client` (Python), `github.com/openwop/openwop/sdk/go` (Go)
- `@openwop/openwop-conformance` 1.0 with server-free and server-required scenario groups

See [`CHANGELOG.md`](./CHANGELOG.md) for the release record.

## v1.X minor: conformance suite expansion

These ship as `@openwop/openwop-conformance` minor releases (`1.X.0`) against the unchanged v1 protocol. They do not modify the wire contract. Each line is a tracked trigger; status reflects the most recent suite release.

| Trigger | Closes | Status |
|---|---|---|
| SSE buffering scenarios | S3 | Included in the v1.0 conformance baseline |
| Mixed-mode SSE scenarios | S4 | Included in the v1.0 conformance baseline |
| Sub-workflow node module fixture | F2 | Included in the v1.0 conformance baseline (`subworkflow.test.ts` exercises `core.subWorkflow` parent/child round-trip) |
| Recursion-limit enforcement scenarios | F4 + CC-1 | Included in the v1.0 conformance baseline (`cap-breach.test.ts` asserts `cap.breached` precedes `run.failed`; `RunOptions.configurable.recursionLimit` is the per-run override) |
| Channel TTL reducer fold scenarios | C3 | Included in the v1.0 conformance baseline (`channel-ttl.test.ts` exercises post-TTL writes evicting prior entries) |
| AI cost attribution scenarios | O4 | Included in the v1.0 conformance baseline (e2e content scenario via `conformance.cost.emit` fixture node + `openwop-smoke-cost-emit` fixture workflow; gated on `OPENWOP_CONFORMANCE_FIXTURES=1`) |

## v1.X minor: protocol gap closure queue

These are additive profiles, conformance expansions, or clarifying annexes that close the remaining gaps identified in the 2026-05-10 deep-dive review. They MUST NOT break v1 wire compatibility.

| Track | Gap closed | Deliverable |
|---|---|---|
| Capability handshake hardening | `Capabilities-Etag`, non-HTTP negotiation, per-tenant capability views | Spec annex shipped in `capabilities-change-detection.md`; `discovery.test.ts` covers optional `Capabilities-Etag`; next add auth-scoped discovery variants when a host advertises them. |
| Auth profile | OAuth2 client credentials, API-key rotation/grace period, optional mTLS | Spec annex shipped in `auth-profiles.md`; next add negative/positive conformance cases for rotation and OAuth token shape where advertised. |
| Interrupt profile | Multi-approver quorum, parent/child cancellation, external-event matching, `auth-required` | Spec annex shipped in `interrupt-profiles.md`; next add fixture workflows for quorum and external-event correlation. |
| Replay profile | Fork from arbitrary event types, retention/GC, PII replay policy, determinism scoring | Retention, privacy, and scoring semantics added to `replay.md`; next add arbitrary-event and retention-expiry conformance scenarios. |
| MCP/A2A roundtrip | Integration docs are strong but roundtrip proof is thin | Ship `mcp-tool-roundtrip.test.ts` and `a2a-task-roundtrip.test.ts` with synthetic peer fixtures. |
| Endpoint coverage manifest | Ensure every OpenAPI operation has positive + negative conformance evidence | Manual map shipped in `conformance/coverage.md`; `route-coverage.test.ts` adds direct workflow/artifact/webhook probes; `spec-corpus-validity.test.ts` now verifies every OpenAPI `operationId` appears in the map. |
| Production profile | Queueing/backpressure, retry durability, event retention, high-volume debug bundle behavior | Spec annex shipped in `production-profile.md`; `INTEROP-MATRIX.md` records production-profile claims separately; next add production-profile scenarios. |

Hosts publish which suite version they pass; non-pass on a later suite is **not** a v1 conformance regression.

## Post-v1 ecosystem

These are larger initiatives that expand the openwop ecosystem without modifying the v1 contract.

### Optional capability profiles

Capability profiles are clusters of optional behaviors a host can advertise via `/.well-known/openwop`. They are documented as separate spec annexes. Each profile has its own conformance scenarios shipped as part of `@openwop/openwop-conformance` and run only when the profile is advertised.

| Profile | Status | Notes |
|---|---|---|
| BYOK / secret resolution | Spec landed (`run-options.md` §"Credential references"); conformance coverage includes capability-shape, redaction, adversarial redaction, and positive-path resolve roundtrip via `conformance.secret.echo` fixture node | Optional. Hosts that don't advertise `capabilities.secrets.supported = true` skip these scenarios. |
| Replay / fork | Spec landed (`replay.md`); conformance partial — `replay-fork.test.ts` + `replayDeterminism.test.ts` cover replay-cache hit / divergence-event / receipt-required; fork-from-arbitrary-event-types coverage incomplete | Optional. |
| Channel TTL | Spec landed (`channels-and-reducers.md`); included in the v1.0 conformance baseline (`channel-ttl.test.ts`) | Optional. |
| Cost attribution | Spec landed (`observability.md` §"AI cost"); included in the v1.0 conformance baseline (e2e via `conformance.cost.emit` fixture node) | Optional. |

### Hosted infrastructure

| Item | Status | Notes |
|---|---|---|
| Hosted node-pack registry (`packs.openwop.dev`) | Live (read-only MVP) | Discovery + index + per-pack manifest + tarball endpoints serve from `packs.openwop.dev` per `registry-operations.md`. Three packs published as of 2026-05-10: `core.openwop.examples@1.0.0`, `community.openwop-team.demo@0.1.0`, `vendor.openwop.rust-hello@1.0.0` (WASM reference). Write API and lifecycle ops (yank / deprecate / key rotation) ship via pull-request publishing on GitHub. Public healthcheck: `conformance/src/scenarios/registry-public.test.ts`. |
| Hosted docs + conformance leaderboard site (`openwop.dev`) | Started in `site/` | Static site builds rendered spec docs, conformance page, profiles, sitemap, OG assets, and per-host badges. Remaining work: publish hosting + live leaderboard updates. |
| Public CI for community contributions | In source tree | Workflows exist in `.github/workflows/`; remaining work is public runner validation after repository publication. |

### SDK expansion

Additional SDKs ship only when there is concrete demand. The current set (TS, Python, Go) covers the most common host implementation languages. Candidates if requested: Rust, Java/Kotlin, Ruby, .NET.

### Implementation ecosystem

| Item | Status | Notes |
|---|---|---|
| Production-host conformance certification | In progress | Two reference hosts under `examples/hosts/` (in-memory + SQLite) demonstrate the protocol cross-implements; production-host certifications are tracked via public conformance evidence in `INTEROP-MATRIX.md`. |
| Second independent host implementation (non-steward maintainer) | Not started | Needed to graduate to working-group governance per `GOVERNANCE.md`. The two example reference hosts prove the protocol works cross-implementation; the graduation step is a non-steward org adopting and passing conformance. |
| Third-party node-pack catalog | Not started | Depends on hosted registry. |

### Canonical Domain

Forward-looking domain references in the spec corpus and roadmap use `openwop.dev`.

Three rules for domain usage:

1. **All forward-looking public URLs** (`packs.openwop.dev`, `openwop.dev/openwop-conformance`, etc.) use `openwop.dev`.
2. **Existing GitHub URLs and package names stay verbatim** (`github.com/openwop/openwop`, `@openwop/openwop`, `openwop-client`, `github.com/openwop/openwop/sdk/go`). These are the canonical artifact identifiers and are guaranteed stable through any v1.x release per `PUBLISHING.md`. The Go module path in particular cannot be redirected without a forced rewrite for every importer; the migration plan documents the cost honestly rather than minimizing it.
3. **Internal references in steward-private docs** are not normative and may use any name; this convention applies only to the public spec corpus, this ROADMAP, and the conformance suite.

### Vendor-neutral org migration

The repository is currently at `github.com/openwop/openwop`. Migration to a vendor-neutral org (target name: `openwop-spec/openwop`) is planned but **not on a calendar schedule**. The migration has a single tripwire:

> **Migration to `openwop-spec/openwop` is initiated when `MAINTAINERS.md` lists at least one maintainer not affiliated with the original steward (OpenWOP).**

When the tripwire fires, the migration plan is:

1. Open an RFC per `RFCS/0001-rfc-process.md` proposing the new org name and the mechanics (redirect, DNS, package owner transfer, CHANGELOG entry).
2. Ratify by maintainer lazy consensus (per `GOVERNANCE.md`).
3. Move the repository; configure `github.com/openwop/openwop` as a permanent redirect.
4. Transfer ownership of npm scopes and PyPI/Go module names; old names continue resolving via metadata redirects where the package registry supports it.
5. Update all in-spec links to the new canonical URL in the next minor release.

Until the tripwire fires, the canonical URL remains `github.com/openwop/openwop`. External implementers can rely on this URL through any v1.x release; migration will be announced via CHANGELOG, README banner, and direct outreach to known third-party implementers (per `MAINTAINERS.md` if the maintainer set has expanded).

Recruiting external maintainers is **out of band**. `MAINTAINERS.md` documents the criteria and process; this roadmap does not commit to a recruitment timeline.

## What this roadmap does not commit to

- A specific date for v1 or v2.0.
- Any breaking change to the v1 wire contract.
- Adoption by any specific vendor or platform.
- Hosting infrastructure on any specific cloud. Forward-looking spec/registry/leaderboard URLs use `openwop.dev`; the deployment substrate (cloud provider, runtime) is similarly undecided.
- Migration of the repository to a different organization on a specific timeline (planned but not scheduled — gated on the tripwire described above and in `MAINTAINERS.md`).

## How to influence the roadmap

- **File an issue** with the `roadmap` label. Include the use case, not just the feature request.
- **Open a conformance report** if your implementation needs a scenario that doesn't exist yet.
- **Author an RFC** for a new capability profile. Profile RFCs follow the spec change process in `GOVERNANCE.md`.
