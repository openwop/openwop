# OpenWOP Implementer Path

> One-page path from "what is OpenWOP" to "my host has a published row in the v2 table of INTEROP-MATRIX.md".

The full corpus is large. This page is the thin path, and it targets **v2**, the current protocol major ([`spec/v2/README.md`](../spec/v2/README.md)). Follow it in order; each step has a single primary artifact and a single check that proves the step landed. For the shortest version of the bar itself, read [`IMPLEMENT-CORE.md`](./IMPLEMENT-CORE.md).

> **Must you implement v1 instead?** v1 is the maintained parallel track until v1 end-of-support ([`spec/v2/core/overview.md`](../spec/v2/core/overview.md) §"v1 end-of-support"). The v1 path is the one this page described before the rewrite: [`spec/v1/capabilities.md`](../spec/v1/capabilities.md), [`spec/v1/rest-endpoints.md`](../spec/v1/rest-endpoints.md), [`spec/v1/profiles.md`](../spec/v1/profiles.md), [`api/openapi.yaml`](../api/openapi.yaml), the `/v1/…` path space, the 1.x SDKs, and the suite with `--target-major 1`. Its host rows are the non-v2 `## Hosts` table in `INTEROP-MATRIX.md`. If you already run a v1 host in production, migrate with [`docs/runbooks/V2-HOST-MIGRATION.md`](./runbooks/V2-HOST-MIGRATION.md) and [`docs/migration/v1-to-v2.md`](./migration/v1-to-v2.md) rather than this page.

---

## Step 0: Read 3 things and skip the rest

- [`README.md`](../README.md) — what OpenWOP is, who it is for, what it does NOT standardize.
- [`spec/v2/core/overview.md`](../spec/v2/core/overview.md) — the reading order for `spec/v2/core/`, the axioms, and what a profile claim means.
- [`spec/v2/core/versioning.md`](../spec/v2/core/versioning.md) §1 — how a major is selected, and why v2 paths carry no `/v2/` prefix.

Bookmark these for reference; do not read the rest of the corpus yet:

- [`spec/v2/core/`](../spec/v2/core/) — the twenty normative documents, under a 25,000-word budget (`scripts/check-core-budget.mjs`). Each opens with a "Why this exists" section.
- [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) — machine-generated snapshot of the corpus. Cite this when claiming compatibility.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host list; your row lands in its v2 table at the end.

**Check:** you can explain in two sentences what `POST /runs` returns (`runs.md` §Create: `201 { runId, status, eventsUrl, statusUrl? }`) and how a client reads run events (`events.md`: SSE on `/runs/{runId}/events`, or the poll cursor on `/runs/{runId}/events/poll`).

---

## Step 1: Pick your minimum profile

v2 has no `profiles[]` field on the discovery root and no `auth.profiles`. A profile is a predicate over the families you advertise, published in [`spec/v2/profiles.json`](../spec/v2/profiles.json); the suite derives your claims from your discovery document ([`capabilities.md`](../spec/v2/core/capabilities.md) §7).

| Profile | When you hold it |
| --- | --- |
| `openwop-discovery-core` | Your v2 root carries `protocolVersions` and `preferredVersion`. Discovery only; a claim MUST say so (`overview.md` §"Profile claim vocabulary"). |
| `openwop-core-standard` | Your root advertises the families `interrupt`, `replay`, `webhooks`, `idempotency` and `eventLog`, and you pass its 13 floor scenarios. This is what an unqualified "OpenWOP conformant" statement MUST mean. |
| `openwop-conformance-seams-v2` | You mount the test seams at `/conformance/seams/…` (`api/seams-v2.yaml`) and advertise a root `conformance` block naming it (`spec/v2/profiles.json` note). A test instrument, not a capability (`conformance.md` §"The seams profile"). |
| Optional families | `agents`, `memory`, `packs`, `compensation`, `a2a`, `mcp`, `runList` and the rest of `capabilities.md` §5 — 71 core families and 13 `ext/` families. Advertise only what you implement. |

The v1 profile strings `openwop-core`, `openwop-stream-poll`, `openwop-stream-sse`, `openwop-audit-log-integrity`, `openwop-production` and the `openwop-auth-*` family have **no entry in `spec/v2/profiles.json`**. `openwop-core` is deleted (`capabilities.md` §4). Streams are part of the run surface (`events.md`: a host MUST implement `updates`); auth is expressed as lanes in `auth.lanes[]` (`identity.md`), each binding its own obligations.

**The honesty principle.** In v2 a family is either present as a record or omitted — there is no `supported: false` (`capabilities.md` §2) — and advertising a surface binds its security behaviour (`security-defaults.md` §"The rule"). A host MUST NOT advertise a surface whose obligation it has relaxed; a legitimate relaxation is recorded in the bundle's `host.relaxations[]` and stops that profile certifying. The strict-mode gate `OPENWOP_REQUIRE_BEHAVIOR=true` and the opt-out list `OPENWOP_OPTED_OUT_PROFILES` still exist in the suite ([`conformance/coverage.md`](../conformance/coverage.md)).

**Check:** you have the list of family keys you intend to put at your v2 discovery root, AND nothing else.

---

## Step 2: Implement the minimum surface

Build against [`api/v2/openapi.yaml`](../api/v2/openapi.yaml) and [`api/v2/asyncapi.yaml`](../api/v2/asyncapi.yaml), with schemas in [`schemas/v2/`](../schemas/v2/). [`spec/v2/path-manifest.json`](../spec/v2/path-manifest.json) lists all 52 operations with their `operationId`. v2 paths are unversioned on a bare origin; send and honour `OpenWOP-Version` (`versioning.md` §1.3–§1.4).

Order that works for `openwop-core-standard`:

1. `GET /.well-known/openwop` — one resource; `OpenWOP-Version: 2` selects the closed v2 root (`capabilities.md` §1), with `ETag` / `If-None-Match`
2. `GET /workflows/{workflowId}` — workflow lookup
3. `POST /runs` — create run (`Idempotency-Key` grammar per `idempotency.md` Layer 1)
4. `GET /runs/{runId}` — run snapshot (`owner.subject`, `eventLogSchemaVersion: 3`)
5. `GET /runs/{runId}/events/poll` — poll with `afterSequence`
6. `GET /runs/{runId}/events` — SSE, `updates` mode at minimum, `Last-Event-ID` resume
7. `POST /runs/{runId}/cancel`, `POST /runs:bulk-cancel`, `POST /runs/{runId}:pause` + `:resume` — core operations, not gated (`runs.md` §Surface)
8. `POST /runs/{runId}/interrupts/{nodeId}` — run-scoped resolve (MUST); `GET`/`POST /interrupts/{token}` — signed-token surface (SHOULD)
9. `POST /webhooks`, `DELETE /webhooks/{webhookId}` — with durable delivery (`webhooks.md`)
10. `POST /runs/{runId}:fork` and `GET /host/effect-seams` — required once you advertise `replay` (`replay.md` §"The surface")
11. `GET /runs/{runId}/effects` — the Layer-2 effect read, bound by advertising `idempotency`

The v1 version of this list marked pause/resume, bulk-cancel and fork as optional. In v2 items 7–11 are on the `openwop-core-standard` path, which makes it the larger bar. `openwop-discovery-core` needs only item 1.

The v2 reference host is [`examples/hosts/v2-reference/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference), written from `spec/v2/core/` rather than from v1 host code. The in-memory and SQLite examples cannot reach the v2 floor and stay on the 1.x line (`INTEROP-MATRIX.md` v2 section); the Python and Postgres examples have no row in the v2 table.

**Check:** your host returns `200` on discovery with `OpenWOP-Version: 2` and `201` on `POST /runs` for the fixture `conformance/fixtures/conformance-noop.json` (the fixture the v2 run scenarios use).

---

## Step 3: Pick an SDK and write a smoke

The 2.x client SDKs are v2-only and ship from [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks) (`README.md` §"Published artifacts"):

- TypeScript: [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) 2.x
- Python: [`openwop-client`](https://pypi.org/project/openwop-client/) 2.x
- Go: `github.com/openwop/openwop-sdks/go/v2`

Method names are not repeated here; this repo does not carry the SDK sources. Use each SDK's own README, and [`sdk/PARITY.md`](https://github.com/openwop/openwop-sdks/blob/main/sdk/PARITY.md) for the shared surface. The 1.x SDKs keep publishing for callers on `/v1/…`.

**Check:** an SDK smoke against your host completes a run end-to-end: `POST /runs` → poll until `isTerminal` → assert the event types are registered v2 types (`events.md` §Types).

---

## Step 4: Run the conformance suite

Install the suite and its exact-pinned contract peer at the same version ([`conformance/README.md`](../conformance/README.md)); the suite refuses to start on a mismatch (`conformance.md` §"Two products, two ledgers"):

```bash
npm install @openwop/openwop-conformance@<version> @openwop/spec-artifacts@<version>
```

Run against major 2:

```bash
npx openwop-conformance \
  --base-url https://your-host.example.com \
  --api-key your-test-key \
  --target-major 2
```

`--target-major` defaults to your `preferredVersion`, which MUST stay `1.x` while you also serve v1, so a dual-stack host must pass `2` explicitly. There is no fixed scenario count to quote; each file's majors are listed in `conformance/scenario-majors.json`.

**Strict mode** is the production gate:

```bash
OPENWOP_REQUIRE_BEHAVIOR=true \
OPENWOP_OPTED_OUT_PROFILES=<profiles you honestly do not implement> \
npx openwop-conformance --base-url … --api-key … --target-major 2
```

Read `blocked` as *not measured*, not *met*: a bundle with any `blocked` row does not certify (`conformance.md` §"Bundle v3"). Your INTEROP-MATRIX row should reflect the strict-mode result honestly.

**Check:** the run prints totals you can record in your host's `conformance.md`.

---

## Step 5: Publish your conformance evidence

Produce a signed bundle v3 (`--certify`; v3 is the CLI default) and a `conformance.md` beside it. The v2 reference host's [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/v2-reference/conformance.md) and [`bundle-v3.json`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/v2-reference/bundle-v3.json) are the pattern.

```bash
npx openwop-conformance --base-url … --api-key … --target-major 2 \
  --certify bundle-v3.json \
  --host-build commit:<sha> --signing-key key.pem --signing-key-id <keyId>
```

The bundle records, by schema (`schemas/v2/certification-bundle.schema.json`):

- Suite name, version, `targetMajor` and `specArtifactsVersion`
- Host name, version and `build` (`image-digest`, `commit` or `artifact-sha256`)
- The discovery URL, its `sha256`, `protocolVersions` and `preferredVersion`
- `claimedProfiles[]` with `evidenceTier`, `witnessCount` and `certified`
- Per-requirement results and totals, signed with Ed25519

Publish `keyId` in your discovery `signingKeys[]`; otherwise the signature proves integrity only, not who signed. Also record in `conformance.md` the command you ran, including opt-outs, and the date.

**Check:** a third party can verify your bundle with `node scripts/check-cut-gates.mjs --host-bundle <bundle>` and re-run your command.

---

## Step 6: Land your row in INTEROP-MATRIX.md

Open a PR adding a row to the **v2** table in [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) and your bundle under `evidence/v2-host-bundles/<host>.json`. The v2 table's columns are:

- Host (name, version, build)
- Implemented from (spec prose, or a migrated v1 host)
- Suite / artifacts versions and the command flags
- Advertised profiles, with `witnessCount`
- Discovery (`protocolVersions`, `preferredVersion`, `eventLogSchemaVersion`)
- pass / fail / blocked / inapplicable / skipped
- Bundle pointer, evidence tier, certified

A row carries the suite version that measured it and is never rewritten to a suite that did not run. The date your bundle is committed there is also an input to the v1 end-of-support clock (`overview.md`).

**Check:** PR merges; your host has a public row in the v2 table.

---

## Optional: Implement packs

If your host wants to execute packs, read [`spec/v2/core/packs.md`](../spec/v2/core/packs.md) (manifests, registry tree, peer-dependency identifiers, signing), then the per-kind documents: [`connection-packs.md`](../spec/v2/core/connection-packs.md), [`form-content-packs.md`](../spec/v2/core/form-content-packs.md), [`workflow-chain-packs.md`](../spec/v2/core/workflow-chain-packs.md). Advertising `packs` binds the eight `node-pack-sandbox-*` isolation invariants (`security-defaults.md`).

This page no longer walks the v1 pack-consumer code: the Postgres example's `pack-consumer.ts` is v1 host code, and no v2 pack-consumer example is referenced from this repo.

---

## Common gotchas

- **Don't advertise what you don't implement.** Omit the family. Advertising it binds its obligations, and strict mode fails a surface with no witness.
- **No `/v2/` prefix.** v2 paths are unversioned. A major you advertise must answer every manifest operation you also serve under the other major (`versioning.md` §1.2).
- **`preferredVersion` stays `1.x` through the overlap** if you serve v1, so a header-less request gets v1. Clients that want v2 send `OpenWOP-Version: 2`.
- **Tenant-bound ids must survive your front door.** `identity.md` §5 defines the path projection; a proxy that decodes `%2F` makes ids unreachable.
- **Idempotency-Key has a grammar.** `^[A-Za-z0-9._~-]{22,128}$`, else `400 idempotency_key_invalid` (`idempotency.md`).
- **Consumers tolerate unknown registered members** of closed enums and do not act on them; producers emit only registered ones (`overview.md` §0).
- **Errors use the closed envelope.** `{ error, message, details? }` with a code from `spec/v2/errors.json`; retry timing only in `Retry-After` (`errors.md`).

---

## What OpenWOP does NOT standardize

This is what you keep host-private. Don't try to make it normative.

- **Model SDK shape.** How you call OpenAI/Anthropic/etc. is yours.
- **Internal runtime topology.** Workers, queues, schedulers — OpenWOP doesn't care.
- **Tool protocol.** MCP is the wire surface; you choose how tools execute inside.
- **Cross-process agent messaging.** A2A is the wire surface; you choose internal RPC.
- **Storage engine.** `persistence.md` fixes what a store must mean (era key, v1 reader rule); you choose Postgres / DynamoDB / etc.

---

## References

- [`README.md`](../README.md) — corpus root
- [`spec/v2/README.md`](../spec/v2/README.md) — the v2 tree and its layout
- [`spec/v2/core/`](../spec/v2/core/) — normative v2 specs
- [`spec/v2/profiles.json`](../spec/v2/profiles.json) — profile predicates and floors
- [`api/v2/openapi.yaml`](../api/v2/openapi.yaml), [`api/v2/asyncapi.yaml`](../api/v2/asyncapi.yaml) — wire contract
- [`schemas/v2/`](../schemas/v2/) — JSON Schemas
- [`conformance/`](../conformance/) — black-box suite (`--target-major 2`)
- [`examples/hosts/v2-reference/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference) — v2 reference host
- [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks) — three client SDKs
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host roster
- [`docs/migration/v1-to-v2.md`](./migration/v1-to-v2.md) — for existing v1 hosts and clients
- [`spec/v1/`](../spec/v1/) — the v1 parallel track
- [`MAINTAINERS.md`](../MAINTAINERS.md) — review + waiver tables
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — full contribution guide
