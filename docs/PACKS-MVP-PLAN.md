# `packs.openwop.dev` — Initial Pack Catalog Plan

> Status: draft for review. Last reviewed: 2026-05-10.
> Closes Track 7 work bullet _"Publish one signed example pack"_ in `PROTOCOL-GAP-CLOSURE-PLAN.md` and stages content for the read-only registry deployment.

This document plans the **first batch of packs** that will live at `https://packs.openwop.dev/`. It covers what to ship, what to defer, and how each pack is built, signed, and validated.

## Why this plan now

Track 7's acceptance criteria:

- Public registry returns registry-operation examples from `registry-operations.md`.
- At least one pack can be fetched, verified, and used in a reference host.

Without a concrete catalog, "publish one pack" is ambiguous. This doc fixes the catalog so the registry deploy, the signing infra, and the conformance fixtures can all anchor against named, scoped, versioned packs.

The phasing follows Phase 1 #3 from the gap-closure plan sequencing (`Phase 1 — Credibility`, ≤ 6 weeks).

---

## Phase 1 catalog (MVP — ships with registry launch)

Four packs, three namespace tiers exercised. Each pack is intentionally small. The point of MVP is **proving the path**, not flooding the registry.

| Pack                          | Namespace tier      | Kind         | Nodes | Agents | Signed                  |
| ----------------------------- | ------------------- | ------------ | ----- | ------ | ----------------------- |
| `core.openwop.examples`       | core (steward-only) | Node         | 3     | —      | Sigstore (keyless OIDC) |
| `core.openwop.http`           | core (steward-only) | Node         | 1     | —      | Sigstore (keyless OIDC) |
| `core.openwop.agent-examples` | core (steward-only) | Agent        | —     | 2      | Sigstore (keyless OIDC) |
| `community.openwop-team.demo` | community           | Node + Agent | 1     | 1      | Manual ed25519          |

Rationale for tier coverage:

- **`core.*`** — exercises the steward namespace + Sigstore signing path
- **`community.*`** — exercises the open-publish namespace + manual ed25519 path (so independent contributors with no OIDC infra can publish)
- **No `vendor.*` at MVP** — vendor packs require a vendor org to claim. Add later when first non-steward implementer onboards (Track 9's "recruit one non-steward host" prerequisite).
- **No `private.*`** — by spec, `private.*` and `local.*` MUST NOT appear in `packs.openwop.dev` (`node-packs.md` §Naming). Excluded by design.

### Pack 1 — `core.openwop.examples` (v1.0.0)

Minimal node-pack proof. Three nodes that exist primarily to be runnable and to demonstrate the conformance categories.

**Nodes:**

- `core.openwop.examples.echo` — `category: data`, `role: pure`. Echoes input verbatim. Replay-safe.
- `core.openwop.examples.coin-flip` — `category: data`, `role: pure`. Deterministic from a seed input; demonstrates the `cacheable` capability marker.
- `core.openwop.examples.delay-with-progress` — `category: control`, `role: streaming-output`. Streams a `node.progress` event every 100ms; demonstrates `streamable` capability + bounded duration.

**Runtime:** `language: javascript`, `format: esm`, `entry: ./dist/index.js`. Engine ≥ Node 20.
**Dependencies:** none (zero npm deps; built from `node:crypto` + standard library).
**Schemas:** `schemas/{echo,coin-flip,delay-with-progress}.{config,input,output}.json` (9 files).
**License:** Apache-2.0.

### Pack 2 — `core.openwop.http` (v1.0.0)

The most-requested ecosystem node: HTTP fetch with retry + idempotency.

**Nodes:**

- `core.openwop.http.fetch` — `category: integration`, `role: side-effect`, `capabilities: ['cacheable', 'side-effectful']`. Config: method, URL template, headers, body, retry policy, idempotency-key derivation. Output: status, headers, body.

**Secrets:** declares `requiresSecrets: [{ id: 'http-bearer', kind: 'api-key', scope: 'tenant' }]` as an optional dependency — workflows that need authenticated requests resolve it via the host's `SecretResolver`. Unauthenticated requests are still supported (the secret is optional).

**Runtime:** `language: javascript`, `format: esm`, `entry: ./dist/index.js`. Engine ≥ Node 20. Uses `undici`'s built-in fetch (no npm dep needed — Node 20 ships it).
**Schemas:** `schemas/fetch.{config,input,output}.json`.
**License:** Apache-2.0.

### Pack 3 — `core.openwop.agent-examples` (v1.0.0)

First **agent pack**. Validates the `agents[]` extension to `pack.json` (per `node-packs.md` §`agents[]` extension and `agent-manifest.schema.json`). Two minimal agents.

**Agents:**

- `core.openwop.agent-examples.echo-agent` — `persona: "Echo"`, `modelClass: 'general'`, `systemPrompt: "Echo the user's last message verbatim. No analysis, no embellishment."`, `toolAllowlist: []`. Vendor-neutral: the manifest doesn't pin a specific model — the host's BYOK aiProviders resolves.
- `core.openwop.agent-examples.summarizer` — `persona: "Summarizer"`, `modelClass: 'writing'`, `systemPromptRef: 'prompts/summarizer.md'` (external file, ~200 words). `toolAllowlist: []`. Demonstrates the `systemPromptRef` (vs inline `systemPrompt`) path.

**Nodes:** none — pure agent pack.
**Memory shape:** both agents declare `memoryShape: { longTerm: false }` — stateless. Demonstrates the canonical opt-in opt-out for the memory layer (RFC 0004 surface, currently in flight per Track 10).
**Runtime:** `language: remote` (no runtime artifact; agents are interpreted by the host).
**License:** Apache-2.0.

### Pack 4 — `community.openwop-team.demo` (v0.1.0)

The first **community-namespace** pack. Demonstrates that non-steward contributors can publish without OIDC. Combines one node + one agent so it exercises both extension paths.

**Nodes:**

- `community.openwop-team.demo.uppercase` — `category: data`, `role: pure`. Trivial: uppercase the input string.

**Agents:**

- `community.openwop-team.demo.greeter` — `persona: "Greeter"`, `modelClass: 'general'`, `systemPrompt: "Greet the user in a different language each turn..."`, `toolAllowlist: []`.

**Runtime:** `language: javascript`, `format: esm`, `entry: ./dist/index.js`.
**Signing:** **manual ed25519** (not Sigstore). Public key lands at a known location in this repo + at `packs.openwop.dev/keys/community.openwop-team.json` for verifiers.
**License:** MIT (so the catalog has SPDX diversity — Apache-2.0 + MIT).

---

## Phase 2 catalog (post-MVP — adds breadth)

Ships once the MVP four are live and the publish path is exercised end-to-end. Targets the gaps remaining in Track 7 and the "ecosystem proof" half of Track 9.

| Pack                              | Purpose                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `core.openwop.approval-gate`      | Standalone approval-gate node packaged separately from host built-ins; demonstrates the `gate` role + `interrupt` integration            |
| `core.openwop.llm`                | Generic LLM-call node (multi-provider) with envelope-contract support; depends on `core.openwop.http`                                    |
| `core.openwop.mcp-bridge`         | `language: remote` node that bridges a remote MCP server; demonstrates the MCP composition path documented in `mcp-integration.md`       |
| `community.openwop-team.cookbook` | Bundle of small example packs (one entry per workflow pattern in `examples/`); demonstrates per-node versioning within a multi-node pack |
| `vendor.<first-partner>.<pack>`   | First vendor-namespace claim — gated on Track 9's non-steward host recruitment                                                           |

These are sketched here for catalog continuity but **not in MVP scope**. They land after the MVP four are verified.

---

## Build pipeline

A single `scripts/build-pack.sh <pack-dir>` produces the canonical artifact. Drop into `~/dev/openwop/scripts/`:

```text
1. Read pack.json from <pack-dir>/pack.json
2. Validate against schemas/node-pack-manifest.schema.json
3. Build runtime artifact:
   - JS packs: `tsc` -> dist/index.js (esm); copy schemas/
   - Remote packs: skip (no artifact)
4. Compute canonical JSON of pack.json (sort keys recursively)
5. Sign:
   - core.* -> Sigstore keyless via cosign sign-blob
   - community.* -> Ed25519 detached signature via openssl pkeyutl
6. Tar + gzip -> dist/<name>-<version>.tgz
7. Compute SHA-256 -> base64 -> .sha256
8. Output: dist/<name>-<version>.tgz + .sig + .sha256
```

Outputs land under `dist/packs/<scope>/<name>/<version>/`. CI (a new `.github/workflows/packs-build.yml`) runs the script on every PR that touches `packs/` and uploads the artifacts. CI does NOT publish — publish is a separate authorized workflow that runs on tag push to a `packs-v*` tag.

**Source layout** (proposed; lives at repo root):

```text
packs/
  README.md                                 — catalog overview
  core.openwop.examples/
    pack.json
    src/{echo,coin-flip,delay-with-progress}.ts
    schemas/{*}.config.json …
    README.md
  core.openwop.http/
    pack.json
    src/fetch.ts
    schemas/fetch.{config,input,output}.json
    README.md
  core.openwop.agent-examples/
    pack.json
    prompts/summarizer.md
    README.md
  community.openwop-team.demo/
    pack.json
    src/uppercase.ts
    keys/community.openwop-team.pub.pem
    README.md
```

`pack.json` lives at each pack's root; `dist/` is `.gitignored` and built by the script.

---

## Registry deployment (`packs.openwop.dev`)

The registry is read-only at MVP. Authoring uploads happen out-of-band (operator runs `curl PUT` against an authenticated endpoint OR via a published GitHub Action that calls the same endpoint).

**Reference deployment (proposed):**

- **Storage:** GCS bucket `packs-openwop-dev` (or similar). Three folder layouts:
  - `tarballs/<name>/-/<version>.tgz` — the published artifact
  - `signatures/<name>/-/<version>.{sig,bundle}` — detached signature or Sigstore bundle
  - `metadata/<name>.json` — aggregated pack metadata (per `node-packs.md` GET shape)
- **Edge:** Cloud Run service `packs-api` serving the read endpoints (`GET /v1/packs/{name}`, `GET /v1/packs/{name}/-/{version}.tgz`, `GET /v1/packs/-/search`). Returns from GCS via signed-URL redirect or proxy.
- **Auth:** read endpoints unauthenticated (anyone can fetch). Write endpoints (`PUT /v1/packs/{name}/-/{version}.tgz`) require API key with `packs:publish` scope per `auth.md`. MVP: scope is hand-issued to steward + community.openwop-team account.
- **CDN:** GCS bucket already CDN-fronted; tarballs cached by SHA. Hot path is `GET /v1/packs/-/index.json` (the registry index).

**Conformance:**

- Hosts that claim `openwop-node-packs` profile point their resolver at `packs.openwop.dev` (or a host-private mirror).
- The conformance test `pack-registry-publish.test.ts` (already in `conformance/src/scenarios/`) runs the publish lifecycle against a host's local copy of the registry's behavior.

---

## Conformance fixtures + verification path

After Phase 1 packs are published, two new fixtures land:

1. **`pack-fetch-verify.test.ts`** (new conformance scenario) — given a host advertising `openwop-node-packs`, fetch `core.openwop.examples@1.0.0` from the configured registry, verify the Sigstore bundle, register the pack with the host's engine, dispatch a workflow that uses `core.openwop.examples.echo`, assert terminal `completed`. Gated on `capabilities.nodePacks.registry.url` (must point at a reachable openwop-compliant registry).
2. **`pack-fetch-verify-community.test.ts`** — same but for `community.openwop-team.demo@0.1.0`, using manual ed25519 verification with the published key.

Both fixtures cite `registry-operations.md` §"Validation flow" + `node-packs.md` §"Trust model" via `driver.describe()`.

The existing `pack-registry-publish.test.ts` scenario continues to cover author-side flow (PUT lifecycle).

---

## What this plan does NOT cover

These are explicitly **out of scope** for Phase 1:

- **Vendor namespace claim** (`vendor.*` packs) — gated on first non-steward implementer (Track 9 work).
- **WASM runtime ABI** (`language: wasm` packs) — Track 7 Phase 3 work; no MVP pack uses WASM.
- **Pack mirroring / private-registry deployment recipes** — single hosted registry at MVP; mirrors come later.
- **Dependency-graph resolution + lockfiles** — Phase 1 packs have zero `dependencies` (except `core.openwop.llm` later which depends on `core.openwop.http`). Lockfile work waits for that.
- **Deprecation / yank operator UX** — registry implements the endpoints (per `registry-operations.md`) but no pack is deprecated/yanked at launch. Test paths are covered by `pack-registry-publish.test.ts`.
- **Marketplace surfacing / ratings / discovery UI** — out of protocol scope; up to the registry operator.

---

## Decisions needed before build

These need explicit greenlight before `packs/` source lands:

1. **Sigstore OIDC subject for `core.*` packs** — typically a GitHub Actions workflow identity (e.g., `https://github.com/openwop/openwop/.github/workflows/packs-publish.yml@refs/heads/main`). Confirm the publishing repo + workflow path.
2. ✅ **Community.openwop-team ed25519 keypair** — landed 2026-05-13 (commit `0bf08cc`). Public key committed at `packs/community.openwop-team.demo/keys/community.openwop-team.pub.pem` AND `registry/keys/community-openwop-team-demo-1.pub` (served at `/keys/community-openwop-team-demo-1.pub` by Firebase Hosting per the canonical key URL convention in `registry/.well-known/openwop-registry.json` `endpoints.publicKey`). The **private key** lives at `~/.openwop-keys/community-openwop-team-demo-1.private.pem` on the steward's workstation (mode 0600); never committed. Authorized for the `community.openwop-team.demo` namespace only per the `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` — cannot cross-sign for `core.*` or `vendor.*`.
3. **`packs.openwop.dev` DNS + storage bucket name** — proposed `packs-openwop-dev`; confirm.
4. **GCP project / billing account** for the Cloud Run service backing `packs.openwop.dev`. Steward-owned for MVP; transitions with Track 9's vendor-neutral org migration.
5. **License selection for `core.openwop.*` packs** — proposed Apache-2.0 (matches OpenWOP spec license); confirm.

---

## Acceptance signal (Track 7 closure)

When all of the following are true, Track 7's `Publish one signed example pack` work bullet flips to ✅:

- [ ] All four Phase 1 packs build cleanly via `scripts/build-pack.sh`.
- [ ] All four packs upload to `packs.openwop.dev` and respond to `GET /v1/packs/{name}` with valid metadata.
- [ ] Sigstore-signed packs verify via `cosign verify-blob --bundle`; manual-signed pack verifies via `openssl pkeyutl -verify` against the published public key.
- [ ] `pack-fetch-verify.test.ts` + `pack-fetch-verify-community.test.ts` pass against a host configured to use `packs.openwop.dev`.
- [ ] The conformance suite README scenario-file count is bumped (currently 46 → 48 after these two land).
- [ ] `INTEROP-MATRIX.md` adds a "Registry conformance" column showing the steward in-memory host + SQLite host both consume from `packs.openwop.dev`.

The other Track 7 work bullets (`Document client verification UX and registry failure modes`, `Specify dependency resolution and lockfile behavior`, `Draft WASM ABI for language: wasm`) are tracked separately from this plan — they're spec-side and unblock as Phase 2 packs land.

---

## Forward-look

After MVP, the natural Phase 2 work is:

1. **Recruit one non-steward implementer** (Track 9). They publish under `vendor.<their-org>.*` — first real vendor pack.
2. **`core.openwop.llm` lands** + depends on `core.openwop.http` → first multi-pack dependency. Forces the lockfile work.
3. **`core.openwop.mcp-bridge` lands** → exercises Track 6's MCP composition path concretely.
4. **WASM ABI draft** (`spec/v1/wasm-abi.md` annex) → opens the language: wasm runtime variant.

Each Phase 2 pack should be its own ~½-day implementation slice once the build pipeline + registry are live.
