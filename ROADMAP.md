# openwop Roadmap

> **Status:** Living document. Updated as milestones land.
> **Last reviewed:** 2026-05-12 (Phase H launch-blockers + Phase I enterprise-blockers 9/11 closed — Postgres reference host gains BYOK / aiProviders 4-mode policy / core.llm.* / core.mcp.toolCall / core.http.request / cap-breach / configurable-schema / MemoryAdapter / agents capability / API-key rotation / auth-scoped discovery / **OAuth2-CC + OIDC user-bearer JWT validators** / subworkflow outputMapping + parent linkage. Postgres conformance reaches 728/797 (91.3%). 10 new protocol-tier SECURITY invariants land alongside; 17 new HTTP error codes in TS/Python/Go SDK catalogs. Only pack-registry consumption (I.7) remains, tripwire-gated on first non-built-in pack landing).

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

### Phases H + I close-out (2026-05-12 — myndhyve.ai launch-readiness)

The 2026-05-12 architect review framed the remaining gap-closure work as **myndhyve.ai launch-readiness** on the Postgres reference host. Two phased batches landed:

- **Phase H — launch-blockers (9/9 closed):** BYOK / `aiProviders` with 4-mode policy enforcement (`disabled` / `optional` / `required` / `restricted`) + `core.llm.chat` + `core.llm.completion`; MCP client (`core.mcp.toolCall` over HTTP/JSON-RPC, `trustBoundary: "untrusted"` per `threat-model-prompt-injection.md` §UNTRUSTED); HTTP client (`core.http.request` with SSRF guard + 1 MiB response cap); cap-breach + configurable-schema enforcement; SECURITY invariants `mcp-toolcall-payload-redaction` + `http-client-ssrf-guard`; SDK wire-type + error-code catalog additions (TS/Python/Go).
- **Phase I — enterprise-blockers (9/11 closed):** MemoryAdapter (RFC 0004) read-side `list` + `get` with CTI-1 cross-tenant isolation + TTL enforcement; `capabilities.agents` advertisement (Phase 1–6) + reasoning verbosity governance helpers; API-key rotation (two-key overlap + canary-redaction; conditional advertisement); auth-scoped discovery (tenant2 narrowed view, strict subset); **OAuth2-CC + OIDC user-bearer JWT validators** (RS256 + ES256 via `node:crypto`; JWKS fetch + 10-minute cache with re-fetch on `kid` miss; `alg: "none"` rejected; canary-redaction; 10-path smoke); subworkflow outputMapping + parent linkage (G3); 3 new protocol-tier SECURITY invariants (`agent-memory-cti-1` + `agent-memory-sr-1-redaction` + `auth-key-rotation-no-canary-echo`); SDK wire types for MemoryAdapter + agents + auth profiles. **Remaining deferred items (2) with tripwire conditions:** pack-registry consumption (gated on first non-built-in pack landing on `packs.openwop.dev`); reasoning-event emission wiring (helpers in place; needs LLM-driven typeId integration).

**Postgres host conformance pass rate: 728/797 (91.3%)** — up from 89.4% baseline at the start of the architect review. The single remaining failure (`webhook-signed-delivery`) is test-isolation residue between scenarios sharing a long-lived pglite host, not a host bug. See `INTEROP-MATRIX.md` for the full evidence claim.



| Track | Gap closed | Deliverable |
|---|---|---|
| Capability handshake hardening | `Capabilities-Etag`, non-HTTP negotiation, per-tenant capability views | Spec annex shipped in `capabilities-change-detection.md`; `discovery.test.ts` covers optional `Capabilities-Etag`. **Auth-scoped discovery (RFC 0011 §A "Scoped capability views") verified end-to-end** on the Postgres host (2026-05-12 Phase I.5) — `OPENWOP_TENANT2_API_KEY` activates a narrowed view (orchestrator + dispatch omitted, strict subset per the spec annex line 69) alongside the existing SQLite host implementation. |
| Auth profile | OAuth2 client credentials, API-key rotation/grace period, OIDC user-bearer, optional mTLS | Spec annex shipped in `auth-profiles.md`. **API-key rotation verified end-to-end** on the Postgres host (2026-05-12 Phase I.6). **OAuth2-CC + OIDC user-bearer verified end-to-end** on the Postgres host (2026-05-12 Phase I.3 + I.4) via `examples/hosts/postgres/src/jwt-validator.ts` — JWKS fetch + RS256/ES256 verification with `node:crypto`, 10-minute cache with re-fetch on `kid` miss, explicit `alg: "none"` rejection, canary-redaction in 401 envelope; 10-path smoke (`test/oauth2-oidc.test.ts`) covers positive + 6 negative + canary paths. Conditional advertisement when `OPENWOP_OAUTH2_ISSUER_URL` + `OPENWOP_OAUTH2_AUDIENCE` (and/or the OIDC equivalents) are set. **mTLS** remains spec-FINAL but unimplemented at the reference host level — TLS termination is typically a reverse-proxy concern. |
| Interrupt profile | Multi-approver quorum, parent/child cancellation, external-event matching, `auth-required` | Spec annex shipped in `interrupt-profiles.md`; four fixtures shipped 2026-05-10 (`conformance-interrupt-{quorum,external-event,auth-required,parent-child-cancel}.json`) + matching conformance scenarios (`interrupt-{quorum-resolution,external-event-correlation,auth-required-resume,parent-child-cascade}.test.ts`). Track closed. |
| Replay profile | Fork from arbitrary event types, retention/GC, PII replay policy, determinism scoring | Retention, privacy, and scoring semantics added to `replay.md`; arbitrary-event fork shipped (`replay-fork-arbitrary.test.ts`) + deterministic replay shipped (`replayDeterminism.test.ts`); next add retention-expiry conformance scenario. |
| MCP/A2A roundtrip | Integration docs are strong but roundtrip proof is thin | `mcp-tool-roundtrip.test.ts` + `a2a-task-roundtrip.test.ts` shipped with synthetic peer fixtures; real-impl interop env vars (`OPENWOP_MCP_REAL_SERVER_URL`, `OPENWOP_A2A_REAL_PEER_URL`) wired 2026-05-11; next publish cross-impl evidence as a "Composition partners" subsection in `INTEROP-MATRIX.md` (out-of-band operator step). |
| Endpoint coverage manifest | Ensure every OpenAPI operation has positive + negative conformance evidence | Manual map shipped in `conformance/coverage.md`; `route-coverage.test.ts` adds direct workflow/artifact/webhook probes; `spec-corpus-validity.test.ts` now verifies every OpenAPI `operationId` appears in the map. |
| Production profile | Queueing/backpressure, retry durability, event retention, high-volume debug bundle behavior | Spec annex shipped in `production-profile.md`; `INTEROP-MATRIX.md` records production-profile claims separately; next add production-profile scenarios. |

Hosts publish which suite version they pass; non-pass on a later suite is **not** a v1 conformance regression.

## v1.2 outlook (projected)

A projection of what would land in a v1.2 minor — each item carries a **gate condition** that determines whether it ships. The list is descriptive, not a commitment: surfaces only ship when their gate condition is met. Items can move to "Withdrawn" if no implementer adoption signal arrives within the RFC comment window.

| Candidate | Gate | Status |
|---|---|---|
| **RFC 0012 — Memory compaction profile** | RFC 0012 reaches `Active` after the 7-day additive comment window; at least one reference host implements §A advertisement + §B `memory.compacted` event + §D carry-forward; three conformance scenarios from §Conformance land capability-gated | `Draft` (filed 2026-05-13). The compaction profile extends [RFC 0004](./RFCS/0004-memory-layer.md) §D — host-side memory distillation — preserving the SR-1 secret-redaction invariant across compaction. Live open question: whether §D belongs in this RFC or folds into a clarifying revision of RFC 0004 — see RFC 0012 §Unresolved questions #4. |
| **WASM Component Model sub-RFC** | First adopter requests `runtime.language: "wasm-component"` packs; manifest enum already reserved in `node-pack-manifest.schema.json`; capability already declared in `capabilities.schema.json` `nodePackRuntimes.wasmComponent` | Reserved. The hand-rolled imports/exports of [RFC 0008 §C](./RFCS/0008-wasm-abi.md) get replaced by WIT-defined interfaces. Loader implementation gated on Wasmtime ≥ 14 (Component Model GA). |
| **Rust SDK v0.1** | Concrete adopter asks for it OR a non-steward host implementation lands in Rust | `Demand-gated`. The conformance suite is language-agnostic, so a Rust client tests against the same wire contract; the question is whether anyone is writing one. No flip without adopter pull. |
| **4 audit-gated `core.openwop.*` packs** | External security audit completes per `SECURITY/external-audit-engagement.md`; the `community-openwop-team-demo-1`-style namespace-scoped per-tier key for the steward team is operational | Built + signed in-tree at `registry/v1/packs/core.openwop.{ai,http,mcp,triggers}/-/1.0.0.{tgz,sig,sbom.json,json}`. Publication to `packs.openwop.dev` is the only blocked step. Audit outreach drafts ready at `SECURITY/outreach/external-audit/` for Trail of Bits / NCC Group / Doyensec / Cure53 / Latacora. |
| **Cross-host SSE replay verification** | `core.subWorkflow` advertised + capability-gated trace-propagation scenario added | Captured in the "Remaining" column of `conformance/coverage.md` §"Observability" — extends `otel-trace-propagation.test.ts` with a cross-host parent → child propagation assertion. ~half-day of work. |
| **mTLS termination on Postgres reference host** | Operator generates a CA/server/client-cert triple; host advertises `capabilities.auth.mtls` when `OPENWOP_HTTPS_CERT_PATH` is set | Currently every reference host's INTEROP-MATRIX row says "Not claimed" for `openwop-auth-mtls`. The conformance scenario `auth-mtls.test.ts` is opt-in via `OPENWOP_TEST_MTLS=1`. ~1 day to flip Postgres from "Not claimed" to verified end-to-end. |
| **Multi-region idempotency end-to-end fixture** | Host advertises `capabilities.idempotency.crossRegion: "best-effort"` (or `"strict"`) | Spec is in `idempotency.md` §"Multi-region idempotency (annex)"; existing scenario `multi-region-idempotency.test.ts` covers capability-shape only. ~half-day to add behavior assertion against the documented MUSTs. |

v1.2 ships when 1-2 of these mature; the rest move to the next minor or to `Withdrawn`. No fixed calendar.

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
| Memory compaction | `Draft` — RFC 0012 (`RFCS/0012-memory-compaction-profile.md`, 2026-05-13). Defines optional `capabilities.memory.compaction` advertisement, `memory.compacted` event, and the SR-1 carry-forward invariant that extends RFC 0004 §D through host-side memory distillation. Three conformance scenarios planned, all gated on advertisement. Live open question: whether §D belongs in this RFC or folds into a clarifying revision of RFC 0004 — see RFC 0012 §Unresolved questions #4. May close `Withdrawn` if no implementer adoption signal arrives within the comment window. | Optional. Drives no v1 contract change; lands in a v1.X conformance minor. |

### Hosted infrastructure

| Item | Status | Notes |
|---|---|---|
| Hosted node-pack registry (`packs.openwop.dev`) | Live | Discovery + index + per-pack manifest + tarball endpoints serve from `packs.openwop.dev` per `registry-operations.md`. **48 packs published as of 2026-05-13** across four trust tiers: 8 `core.openwop.*` (framework primitives), 1 `community.openwop-team.*` (community demo), 1 `vendor.openwop.*` (rust-hello WASM reference), 38 `vendor.myndhyve.*` (canvas-vertical reference packs). Categorized inventory: [`docs/PACK-CATALOG.md`](./docs/PACK-CATALOG.md). Reference compositions: [`examples/market-intel-pipeline/`](./examples/market-intel-pipeline/) (9 packs) + [`examples/ads-publish-pipeline/`](./examples/ads-publish-pipeline/) (8 packs × 3 platform variants). Stage 1–4 (operational maturity) shipped 2026-05-12: WIF auto-deploy, CycloneDX SBOMs, registry CVE feed + OSV scanning, Cloud Monitoring uptime check. Write API and lifecycle ops (yank / deprecate / key rotation) ship via pull-request publishing on GitHub. Public healthcheck: `conformance/src/scenarios/registry-public.test.ts`. |
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
