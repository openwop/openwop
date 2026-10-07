# `@openwop/openwop-conformance`

The black-box conformance suite for **OpenWOP**, an open wire-level protocol for multi-agent workflow orchestration. Point it at any OpenWOP host — your own or a third party's — and it sends real HTTP requests to the specified endpoints and checks the answers against the protocol.

The suite does not depend on any particular implementation. A host written in any language can run it.

- Spec and source: [github.com/openwop/openwop](https://github.com/openwop/openwop)
- Release history: [`CHANGELOG.md`](./CHANGELOG.md)
- Scenario-by-spec coverage map: [`coverage.md`](./coverage.md)
- Fixture workflows a host seeds: [`fixtures.md`](./fixtures.md)

## Install

The suite has an exact-pinned peer, `@openwop/spec-artifacts`, which carries the machine-readable contract (OpenAPI, AsyncAPI, JSON Schemas, registries). Install both packages, at the same version:

```bash
npm install --legacy-peer-deps @openwop/openwop-conformance @openwop/spec-artifacts
```

- Both packages are published together on every release, so the `latest` of each is a matching pair. If you pin, pin both to the same version.
- `--legacy-peer-deps` is required: npm's default resolver refuses the exact peer pin.
- Use npm 11 or later. npm 10.9 crashes on this install with `Cannot read properties of null (reading 'edgesOut')`.
- Installing the suite alone does not pull the peer. Without it the suite refuses to start.

To run without installing:

```bash
npx @openwop/openwop-conformance --base-url https://api.example.com --api-key hk_test_... --target-major 2
```

## Protocol majors

v2 is the current protocol major. Its normative spec is [`spec/v2/core/`](https://github.com/openwop/openwop/tree/main/spec/v2/core); [`conformance.md`](https://github.com/openwop/openwop/blob/main/spec/v2/core/conformance.md) defines requirement ids, witness classes, bundles and certification.

One package runs either major:

- `--target-major 2` runs the scenarios for a v2 host.
- `--target-major 1` runs the scenarios for a v1 host. v1 reached end of support on 2026-10-04 ([RFC 0234](https://github.com/openwop/openwop/blob/main/RFCS/0234-maintainer-set-v1-end-of-support.md)); its scenarios stay in the package for hosts that still measure against the frozen v1 tree.
- With no flag, the suite reads the host's `/.well-known/openwop`: `preferredVersion` first, then the highest of `protocolVersions[]`, else major 1. A dual-stack host whose `preferredVersion` is 1.x resolves to major 1, and the CLI says so. Pass `--target-major 2` to measure its v2 surface.

[`scenario-majors.json`](./scenario-majors.json) lists the major(s) each scenario file targets. It is generated: a file named `v2-*` targets major 2, a short allow-list targets both, and every other file targets major 1.

## Quickstart

### CLI

```bash
# Server-free subset (no host needed)
npx openwop-conformance --offline

# Full suite against a host
npx openwop-conformance \
  --base-url https://api.example.com \
  --api-key hk_test_abc123 \
  --target-major 2 \
  --impl acme-openwop-server --impl-version 1.0

# Only scenarios whose test name matches a pattern
npx openwop-conformance --base-url ... --api-key ... --target-major 2 --filter "discovery|errors"
```

`npx openwop-conformance --help` prints the full flag reference, including `--certify` (write a signed certification bundle), `--verify`, `--require-behavior` and `--max-workers`. The env vars `OPENWOP_BASE_URL`, `OPENWOP_API_KEY` and `OPENWOP_IMPLEMENTATION_*` apply only when the matching flag is unset.

From a checkout of this repository, build the CLI first:

```bash
cd conformance
npm install
npm run build:cli
./dist/cli.js --offline
```

### Direct vitest

```bash
export OPENWOP_BASE_URL="https://api.example.com"
export OPENWOP_API_KEY="hk_test_..."
export OPENWOP_TARGET_MAJOR=2

npx vitest run                                    # all files, in parallel
npx vitest run src/scenarios/v2-run-cancel.test.ts # one file
npm run test:strict                               # all files, one at a time
```

When you drive vitest yourself, set `OPENWOP_TARGET_MAJOR` (see the table below). The CLI selects the scenario files for the major; plain `vitest run` runs every file and each one gates itself on the major.

**`test:strict` vs `test`.** `test` runs files in parallel, which is several times faster and safe for most scenarios. Two groups need `--no-file-parallelism` (`npm run test:strict`) for a full result:

- **`production-backpressure.test.ts`** saturates the host's `inflightCap`. Under parallel execution, neighbouring scenarios that create runs during the saturation window hit the cap and see `503`. The scenario then soft-skips its envelope assertions and logs a warning.
- **OTel scenarios** (`otel-emission.test.ts`, `otel-trace-propagation.test.ts`, `metric-emission.test.ts`, `otel-emission-grpc.test.ts`): each vitest worker starts its own collector, and only one can bind the configured OTLP port.

### Auditing someone else's bundle

```bash
npx @openwop/openwop-conformance --verify bundle-v3.json --host-key host.pub.pem
```

No host and no clone needed. Exit codes: `0` verified · `1` rejected · `2` coherent but not independently verified · `3` not a bundle.

Exit `2` matters most. Without `--host-key` the signature is unchecked, and a bundle that merely hangs together has not been verified. `--verify` never re-runs anything, so a host that measured itself wrongly and signed the result still verifies clean. It audits an attestation, not a host.

### Exit codes for a host run

A run exits non-zero on any failed assertion. With `--certify <out.json>`:

- `0` — every claimed profile is certifiable.
- `1` — assertion failures.
- `3` — **rejected**: a claimed profile has an unclassified result, such as a floor requirement with no ledger row, or an `executed-pass` with zero assertions. The bundle is still written so the rejection is auditable, and the reasons print per profile.

Each scenario file records its disposition and assertion count in `<report-dir>/requirement-ledger.jsonl`. A file that made no assertions and gave no reason (`softSkip`, `seamAbsent`, `behaviorGate`) is recorded `blocked`, not passed. A runtime-derived profile (for example `openwop-node-packs`) is claimed only when the host holds it — every floor row a witnessed pass; otherwise the summary prints `not held` and drops the claim.

## Environment flags

| Variable | Effect |
| --- | --- |
| `OPENWOP_TARGET_MAJOR` | Selects the scenario lane when you drive vitest directly. **Only the literal `"2"` selects major 2**; any other value, including empty, falls back to major 1. The runner and every vitest worker must see the same value. Prefer `--target-major`, which validates its input and sets this for you. |
| `OPENWOP_REQUIRE_BEHAVIOR=true` | Strict mode (`--require-behavior`). A capability-gated scenario FAILS instead of skipping when the host advertises a behaviour the suite cannot witness. See [`coverage.md`](./coverage.md) §"Capability-gated scenarios". |
| `OPENWOP_HOST_RELAXATIONS` | Declares that the HOST runs relaxed; it writes `host.relaxations[]` into the bundle and **relaxes nothing in the suite**. JSON array of `{obligation, durability, reason}`; `obligation` is `<family>.<name>` and denies every profile whose predicate lists that family; `durability` is `session`, `deployment` or `persisted`. A profile carrying a relaxation cannot certify. Unparseable JSON exits 2. The suite detects one undeclared relaxation on its own: `v2-webhook-egress-refusal` registers destinations `webhooks.md` §SSRF says a host must refuse, and an accepted one with no `webhooks.*` relaxation declared is recorded as a failure. |
| `OPENWOP_TEST_PUBLIC_REGISTRY=true` | Runs `registry-public.test.ts` against the hosted registry at `packs.openwop.dev`. Off by default so the suite needs no outbound connectivity. |
| `OPENWOP_OTEL_COLLECTOR=true` | Starts the in-suite OTLP collector for the OTel scenarios. It accepts OTLP/HTTP JSON and protobuf. The host exports with `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `http/protobuf` or `grpc`. Run these scenarios with `--no-file-parallelism`. |
| `OPENWOP_OTEL_COLLECTOR_PORT=14318` | Port for the OTLP/HTTP collector (default `4318`). Point the host's `OTEL_EXPORTER_OTLP_ENDPOINT` at `http://127.0.0.1:<port>`. |
| `OPENWOP_OTEL_COLLECTOR_GRPC=true` | Also starts an OTLP/gRPC collector (h2c on its own port), sharing the HTTP collector's span and metric store. Requires `OPENWOP_OTEL_COLLECTOR=true`. |
| `OPENWOP_OTEL_COLLECTOR_GRPC_PORT=4317` | Port for the OTLP/gRPC collector (default `4317`). The host needs `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` and the matching endpoint. |
| `OPENWOP_WEBHOOK_RECEIVER_URL=<https-url>` | **The preferred route to webhook witnesses.** A public `https:` front (tunnel or TLS-terminating proxy) for the suite's own in-process receiver. It must forward to this process: the scenarios assert on what the suite received, so pointing it elsewhere would make them vacuous. Zero deliveries with it set is a hard failure, not a skip. Pair with `OPENWOP_WEBHOOK_RECEIVER_PORT`. |
| `OPENWOP_WEBHOOK_RECEIVER_PORT=<port>` | Pins the receiver to a known port (default: ephemeral), so a tunnel can be aimed at it in advance. |
| `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` | Test-only posture for the loopback receiver at `http://127.0.0.1:{port}/`, used by `webhook-signed-delivery`, `webhook-negative` and `replay-fanout-suppression`. `webhooks.md` forbids that URL three ways — non-`https:` scheme, a private address at registration, and a private address at delivery-time re-resolution — so the host-side opt-in must relax all three. A host whose opt-in covers only some cannot witness these scenarios; that is a property of the test posture, not a defect. When the host refuses, the scenario records `blocked`. Prefer `OPENWOP_WEBHOOK_RECEIVER_URL`, which relaxes nothing; see `SECURITY/threat-model-secret-leakage.md` §4.9. |
| `OPENWOP_WEBHOOK_RETRY_WAIT_MS=<ms>` | Raises how long `v2-webhook-durable-delivery` waits for a retry schedule (default `90000` per wait, at most `3600000`). Set it above the sum of your backoff intervals. It can be raised, never lowered. A window that closes before the advertised `maxAttempts` arrive records `blocked`, naming this variable. |
| `OPENWOP_DURABILITY_OBSERVATION_CEILING_MS=<ms>` | Raises how long the durability kill scenarios watch for resumption (default `240000`). A host with a long declared recovery bound sets this above that bound. Raisable, never lowerable. |
| `OPENWOP_MCP_FAKE_SERVER=true` | Starts the synthetic MCP server for the MCP scenarios. |
| `OPENWOP_MCP_REAL_SERVER_URL=<base-url>` | Points the MCP wire-shape probe at a real MCP server over streamable HTTP in single-response mode. stdio and SSE-streamed responses are not supported. Assertions relax to shape-only. Wins over the fake when both are set. |
| `OPENWOP_A2A_FAKE_PEER=true` | Starts the synthetic A2A peer for the A2A scenarios. |
| `OPENWOP_A2A_FAKE_PEER_URL=<https-url>` / `OPENWOP_MCP_FAKE_SERVER_URL=<https-url>` | Public `https:` fronts for the two fakes, with the same rules as `OPENWOP_WEBHOOK_RECEIVER_URL`. The fake still listens on loopback; pin it with the matching `_PORT`. The front is the URL handed to the host (invoke-seam `peerUrl` / `serverUrl`, AgentCard `url` fields), so a host can be measured without relaxing its egress guard. |
| `OPENWOP_A2A_REAL_PEER_URL=<base-url>` | Points the A2A AgentCard and task-lifecycle probe at a real A2A peer. The state-forcing subtests (`AUTH_REQUIRED`, `REJECTED`) stay fake-peer-only. |
| `OPENWOP_FORCE_RATE_LIMIT=true` | Asks the host (test-only key) to fabricate a `429` so `rate-limit-envelope.test.ts` can check the envelope deterministically. |
| `OPENWOP_TEST_PROMPT_PACK_INSTALLED=true` | Turns the `prompt-pack-install.test.ts` existence check from a soft-skip into a hard assertion. Set it when the host is known to have at least one prompt pack installed at boot; the spec does not require one. |
| `OPENWOP_CORS_ORIGIN=<origin>` | The origin `v2-cors-preflight` preflights with (default `https://conformance.invalid`). The scenario is `inapplicable` when no operation's preflight grants it. |

## What's Covered

The current suite has 649 scenario files under `src/scenarios/`. By target major ([`scenario-majors.json`](./scenario-majors.json)): 209 files run against a v2 host and 455 against a v1 host; 15 of them run at both.

The v2 scenarios (`src/scenarios/v2-*.test.ts`) cover, by area:

| Area | What is witnessed | Example scenarios |
| --- | --- | --- |
| Discovery and versioning | The root discovery document, its ETag, the `OpenWOP-Version` header, version negotiation, minimum client version, profiles derived only from advertised families | `v2-capabilities-root-closed`, `v2-discovery-etag`, `v2-version-header-honored`, `v2-dual-stack-negotiation`, `v2-profiles-derived-only` |
| Runs | Create, read, list, cancel, bulk cancel, pause/resume, run options and limits, outputs on completion, snapshots | `v2-created-run-readable`, `v2-run-cancel`, `v2-run-pause-resume`, `v2-run-options-limits`, `v2-run-completed-outputs` |
| Events and streaming | Closed event types, SSE projection, `Last-Event-ID` resumption, poll cursors, terminal-event-once | `v2-stream-sse-projection`, `v2-sse-last-event-id-cursor`, `v2-poll-cursor-v2`, `v2-terminal-event-once` |
| Errors and headers | The error registry and envelope, malformed bodies, CORS preflight, header scheme | `v2-error-registry`, `v2-malformed-body-envelope`, `v2-cors-preflight`, `v2-header-scheme` |
| Idempotency | Key grammar, in-flight concurrency, effect identity | `v2-idempotency-key-grammar`, `v2-idempotency-in-flight`, `v2-effect-identity-business-key` |
| Interrupts and approvals | Resolve after terminal, token scheme, approver enforcement, reject disposition, credential interrupts | `v2-interrupt-resolve-terminal`, `v2-approver-enforced`, `v2-credential-interrupt` |
| Replay and fork | Fork prefix and ancestry, refusals, replay side-effect suppression, forking a v1 run | `v2-run-fork-prefix`, `v2-run-fork-refusals`, `v2-replay-suppression-ordinal` |
| Identity, auth and OAuth | Auth challenges, bound ids, workspace scope from identity, OIDC audience, protected-resource metadata, PKCE | `v2-auth-challenge`, `v2-bound-id-kinds`, `v2-oidc-id-token-audience`, `v2-oauth-client-pkce-state-iss` |
| Security defaults | SSRF refusal, filesystem sandbox, cross-tenant isolation for storage, memory and queues, secret canaries | `v2-safefetch-ssrf-refused`, `v2-fs-sandbox-escape-refused`, `v2-storage-cross-tenant-isolation`, `v2-secret-canary-absent` |
| Webhooks | Delivery shape, Standard Webhooks signing, durable retries, secret rotation, egress refusal, endpoint verification | `v2-webhook-delivery-shape`, `v2-webhook-durable-delivery`, `v2-webhook-secret-rotation`, `v2-webhook-egress-refusal` |
| Durability and execution | Recovery after a kill, effect seams that never re-fire, execution bounds, budgets | `v2-durability-recovery`, `v2-effect-seam-no-refire`, `v2-run-execution-bounds`, `v2-budget-enforcement` |
| Packs and composition | Pack isolation, peer dependencies, sub-workflow dispatch and input mapping, chain pins, WASM memory caps, registry lifecycle | `v2-pack-isolation`, `v2-subworkflow-linkage`, `v2-chain-pin-exact`, `v2-wasm-memory-cap` |
| AI, prompts and agents | AI envelopes, providers and usage, prompt libraries and rendering, model capabilities, conversations, multi-party councils | `v2-prompt-render-deterministic`, `v2-provider-usage-emission`, `v2-conversation-turn-parts`, `v2-multi-party-council` |
| Interop | A2A agent cards and operation map, MCP mounts and tasks, A2UI v0.9 surfaces, trace context | `v2-a2a-operation-map`, `v2-mcp-mount-map`, `v2-a2ui-v09-surface`, `v2-interop-trace-context` |
| Family advertisements | Each optional capability family's discovery record validates against its schema seat | `v2-*-advertisement` |
| Certification | Signed v3 bundles, recorded relaxations, corpus-coherence rows never entering a bundle | `v2-bundle-v3-signed`, `v2-relaxation-recorded`, `v2-coherence-not-in-bundle` |

Three kinds of scenario share the tree:

- **Server-free** checks validate fixtures, vectors and documents against the packaged contract. `fixtures-valid.test.ts` is the declared `--offline` set.
- **Host** checks drive a live host over HTTP.
- **Gated** checks run only when the host advertises the family, profile or fixture they need, and otherwise record `inapplicable` or `blocked` with a reason. `--require-behavior` turns an advertised-but-unwitnessable behaviour into a failure.

Current source tree: 649 scenario files. [`coverage.md`](./coverage.md) maps each spec document and every OpenAPI operation to its scenarios. [`CHANGELOG.md`](./CHANGELOG.md) records when each scenario landed.

## How the 2.x suite is built

- **The contract is a peer package.** The suite does not vendor `api/` or the JSON Schemas. It resolves the installed `@openwop/spec-artifacts` through Node's resolver and refuses to start when the peer's version or its `CORPUS-STAMP.json` digests differ from `dist/spec-artifacts.lock.json`.
- **`req()` is the only assertion form.** Every assertion message carries a requirement id. [`requirements.json`](./requirements.json) lists every id; [`requirement-aliases.json`](./requirement-aliases.json) maps a reworded id to its successor.
- **Corpus-coherence checks never run against a host.** They live in `src/coherence/`, run in the spec repository's CI, and are not in the published package. A host bundle never contains them.

### `--offline` — a declared set

`openwop-conformance --offline` runs exactly **`src/scenarios/fixtures-valid.test.ts`**: the server-free scenario that ships in the package and runs in the published layout. The set is declared, not "whatever skips cleanly". The corpus-coherence checks in `src/coherence/` (including `spec-corpus-validity.test.ts`) read the spec tree and assert nothing about a host; run them from a checkout of the spec repository with `npm run openwop:check`.

### The contract is digest-checked

`@openwop/spec-artifacts` ships `CORPUS-STAMP.json`: its version, the corpus commit and tag, and a SHA-256 for every file in the package. The suite was packed against one stamp, recorded in `dist/spec-artifacts.lock.json`. At start, in the published layout, it compares the two and refuses to run when:

- a file is missing, altered or extra (it names each one), or
- the installed peer is a different version from the one the suite was packed against.

A hand-patched schema therefore cannot produce evidence. In a checkout of the spec repository there is no installed peer to check, and the log says `corpus stamp not checked`.

## Resolving the contract: depend on the package, don't hand-copy it

A host that validates its own discovery document, events or manifests should read the schemas from the installed `@openwop/spec-artifacts` package rather than copying files into its own tree.

A hand-copied schema goes stale silently. One host validated its `/.well-known/openwop` document against a copied `capabilities.schema.json` that was several properties behind the corpus; its check stayed green while validating against an older contract. Depending on the package makes staleness a lockfile fact: the version shows up in `package.json`, the lockfile, `npm outdated` and any dependency bot.

```js
// stale and silent — the copy has no version
import caps from './vendor/capabilities.schema.json' with { type: 'json' };

// stale and visible — the version is in your lockfile
import caps from '@openwop/spec-artifacts/schemas/v2/capabilities.schema.json' with { type: 'json' };
```

The peer's layout: `api/v2/` (OpenAPI and AsyncAPI), `schemas/v2/` (v2 JSON Schemas), `spec/v2/` (registries such as errors, profiles and the declaration), with the frozen v1 contract beside them (`api/openapi.yaml`, the flat `schemas/*.schema.json`, `spec/v1/`).

**If you must copy files, check them against a stamp.** This package's `schemas/` directory holds one file, `CORPUS-STAMP.json`, a copy of the peer's stamp. It sits at a stable path so you can compare a copied tree's digests against the stamp of the version you have installed — a plain file read, no network. The packaging gate (`scripts/check-npm-pack-contents.sh`) pins that path so a packaging change cannot quietly remove it. This narrows the failure but does not remove it: a host that keeps hand-copying still gets no warning.

## Where the suite runs changes what it can witness

The suite makes assumptions about its execution context. Two are false in some places:

| Assumption | True where | False where |
| --- | --- | --- |
| The spec prose (`spec/`, `RFCS/`, `docs/`) sits above the package | a checkout of the spec repository | the published package — prose is not bundled, and checks that need it skip |
| `127.0.0.1` reaches the suite | the suite's own process | any host in a separate network namespace (container, VM, remote origin) |

Paths resolve from `import.meta.url`, not the working directory, and the suite writes only to a temporary report directory and to the bundle path you pass to `--certify`. The package runs from any working directory.

### Callback-shaped scenarios need a route back

Some scenarios require the **host to call back into the suite**: an outbound webhook the suite receives, an OIDC issuer or AI provider endpoint the host fetches, OTLP spans the host exports. In-process, the suite advertises those endpoints on loopback. From a container, VM or remote origin, `127.0.0.1` is that environment, so the call never lands — the scenario fails for lack of a route, not because the host is non-conformant.

When the host runs outside the suite's process:

- Give the host a route back to the suite — for example `--add-host host.docker.internal:host-gateway` for Docker — or use the public-front variables above (`OPENWOP_WEBHOOK_RECEIVER_URL`, `OPENWOP_A2A_FAKE_PEER_URL`, `OPENWOP_MCP_FAKE_SERVER_URL`).
- Bind the suite's doubles to an address the host can reach, and advertise a URL it can resolve.
- **Assert a floor on collected files**, not just on passes. A file that fails to load reports nothing, and a run that silently loses files still prints a green count.

### Each callback is declared

A scenario that needs the host to open a connection back to the suite declares it, naming the connection:

```ts
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP spans to the suite's collector";
```

A scenario that uses a suite double but drives both ends itself declares the opposite, with its reason:

```ts
export const HOST_CALLBACK_NOT_REQUIRED = 'the suite posts synthetic payloads to its own collector; no host participates';
```

`host-callback-declaration.test.ts` enforces this and requires a sentence rather than a boolean, so the declaration says what a consumer has to route. The check is a floor, not an oracle: it catches scenarios that import a module standing up a suite-hosted server, but a scenario that builds a reachable URL some other way can slip past it.

Before an off-process run, list the scenarios that need a route back:

```sh
grep -l REQUIRES_HOST_CALLBACK node_modules/@openwop/openwop-conformance/src/scenarios/*.ts
```

Do not opt callback-shaped profiles out to turn an off-process lane green. One host would then have two materially different results depending on where it was measured.

## Package layout

```text
@openwop/openwop-conformance/
  README.md                 this file
  CHANGELOG.md              release history
  coverage.md               spec docs and OpenAPI operations → scenarios
  fixtures.md               the fixture workflows a host seeds, and their contracts
  fixtures/                 fixture JSON (workflow definitions, pack manifests,
                            prompt templates, interrupt payloads, WASM packs,
                            pinned upstream schemas, ...)
  vectors/                  test vectors (JCS, audit checkpoints, request digests)
  scenario-majors.json      the protocol major(s) each scenario file targets (generated)
  requirements.json         every requirement id the scenarios assert (generated)
  requirement-aliases.json  reworded id → successor id
  schemas/CORPUS-STAMP.json copy of the @openwop/spec-artifacts stamp
  dist/                     the compiled CLI and spec-artifacts.lock.json
  vitest.config.ts          runner configuration
  src/
    cli.ts                  the openwop-conformance CLI
    global-setup.ts         corpus-stamp check, collectors, fakes
    lib/                    driver, discovery helpers, req(), soft-skip,
                            bundle emit/verify, witness libraries, test doubles
    scenarios/              the scenario files (*.test.ts); v2-*.test.ts are major 2
```

In the spec repository the `conformance/` directory also holds `src/coherence/` (corpus-coherence checks, not published), `scripts/` (the generators for `requirements.json` and `scenario-majors.json`) and the unit tests under `src/lib/`.

## How to extend

Add a scenario file under `src/scenarios/`. Name it `v2-<topic>.test.ts` to target major 2. A minimal server-free scenario, modelled on `v2-implementation-informational.test.ts`:

```ts
/**
 * What this witnesses, in one paragraph.
 *
 * @see spec/v2/core/capabilities.md §3.1
 */
import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: validates documents against the packaged v2 capabilities schema';

const ID = 'openwop.requirement.<rfc-or-area>.<short-name>';
const DOC = 'spec/v2/core/capabilities.md §3.1';
const ROOT = { protocolVersions: ['2.0'], preferredVersion: '2.0' };

describe('v2-my-topic (server-free)', () => {
  it('implementation stays a closed object', () => {
    const validate = v2Validator('capabilities');
    expect(
      validate({ ...ROOT, implementation: { name: 'x', homepage: 'https://example.org' } }).ok,
      req(ID, DOC, 'an unknown key on implementation MUST fail validation'),
    ).toBe(false);
  });
});
```

A host scenario reads discovery through `v2Discovery()` / `familyAdvertised()` from `../lib/v2.js` and records why it did not run with `softSkip('inapplicable' | 'blocked', reason)` from `../lib/soft-skip.js` — see `v2-prompt-library-advertisement.test.ts`.

Rules the gate enforces:

- Every assertion message goes through `req(id, specSection, requirement)`. `scripts/check-req-only.mjs` fails a scenario that passes a plain string as an `expect` message, cites two different explicit ids in one `it`, or returns early from an `it` without `softSkip(...)` / `seamAbsent(...)`.
- Every scenario declares `REQUIRES_HOST_CALLBACK` or `HOST_CALLBACK_NOT_REQUIRED` when it uses a suite double.
- After adding or renaming a file or an `it()`, regenerate the derived files: `node conformance/scripts/generate-scenario-majors.mjs --write` and `node conformance/scripts/generate-requirement-registry.mjs --write`. Renaming a requirement id needs a row in `requirement-aliases.json`.
- Update the scenario count in this README and add the scenario to [`coverage.md`](./coverage.md).

## References

- v2 core spec: [`spec/v2/core/`](https://github.com/openwop/openwop/tree/main/spec/v2/core), including [`conformance.md`](https://github.com/openwop/openwop/blob/main/spec/v2/core/conformance.md)
- OpenAPI: [`api/v2/openapi.yaml`](https://github.com/openwop/openwop/blob/main/api/v2/openapi.yaml)
- AsyncAPI: [`api/v2/asyncapi.yaml`](https://github.com/openwop/openwop/blob/main/api/v2/asyncapi.yaml)
- JSON Schemas: [`schemas/v2/`](https://github.com/openwop/openwop/tree/main/schemas/v2)
- The contract package: [`@openwop/spec-artifacts`](https://www.npmjs.com/package/@openwop/spec-artifacts)
