# OpenWOP Implementer Path

> One-page path from "what is OpenWOP" to "my host has a published conformance row in INTEROP-MATRIX.md".

The full corpus is large. This page is the thin path. Follow it in order; each step has a single primary artifact and a single check that proves the step landed.

---

## Step 0: Read 3 things and skip the rest

- [`README.md`](../README.md) — what OpenWOP is, who it is for, what it does NOT standardize.
- [`spec/v1/capabilities.md`](../spec/v1/capabilities.md) — the discovery payload your host emits at `/.well-known/openwop`.
- [`spec/v1/rest-endpoints.md`](../spec/v1/rest-endpoints.md) — the wire contract you implement.

Bookmark these for reference; do not read the rest of the corpus yet:

- [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) — machine-generated snapshot (spec/schema/operation counts, RFC ladder, conformance pass rates per reference host). Cite this when claiming compatibility.
- [`docs/PROTOCOL-GAP-CLOSURE-PLAN.md`](./PROTOCOL-GAP-CLOSURE-PLAN.md) — archived gap-closure plan; useful for "why does this exist" archaeology.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host list; your row lands here at the end.

**Check:** you can explain in two sentences what `POST /v1/runs` returns and how a client reads run events.

---

## Step 1: Pick your minimum profile

Every host starts with `openwop-core`. Pick the additional profiles you actually intend to implement; advertise nothing else.

| Profile | When to claim |
|---|---|
| `openwop-core` (required) | Always. Discovery + run lifecycle + event poll + interrupts + error envelope. |
| `openwop-stream-poll` | When you implement `GET /v1/runs/{id}/events/poll`. Most hosts. |
| `openwop-stream-sse` | When you implement Server-Sent Events. Real-time UIs want this. |
| `openwop-audit-log-integrity` | When you persist a hash-chained event log with signed checkpoints. |
| `openwop-production` | When you implement backpressure 503 + retention sweep + claim acquisition. Production-only. |
| `openwop-auth-api-key-rotation` | When you accept two API keys during a rotation overlap. |
| `openwop-auth-oauth2-client-credentials` | When you validate OAuth2 JWT bearers. |
| `openwop-auth-oidc-user-bearer` | When you validate OIDC user-bearer tokens. |
| `openwop-auth-mtls` | When you terminate mTLS. |
| Optional capabilities | `runs.pauseResume`, `idempotency.crossRegion`, `memory`, `memory.compaction`, `agents`, `webhooks.signatureAlgorithms`, etc. Advertise only what you implement. |

**The honesty principle.** Advertise only profiles you mechanically pass. The conformance suite ships a strict-mode gate (`OPENWOP_REQUIRE_BEHAVIOR=true`); if you advertise a profile you don't implement, your scenarios fail in strict mode. Hosts may declare honest opt-outs via `OPENWOP_OPTED_OUT_PROFILES=name1,name2` — see [`conformance/coverage.md`](../conformance/coverage.md) §"Capability-gated scenarios".

**Check:** you have a list of profile strings you intend to put in `capabilities.auth.profiles[]` AND nothing else.

---

## Step 2: Implement the minimum surface

The core wire surface is ~15 endpoints. Build them against [`api/openapi.yaml`](../api/openapi.yaml) as the canonical contract — every endpoint has an `operationId`, request schema, response schema, and error envelope.

Order that works:

1. `GET /.well-known/openwop` — discovery (returns your capabilities object)
2. `GET /v1/workflows/{id}` — workflow lookup
3. `POST /v1/runs` — create run (idempotency-key support)
4. `GET /v1/runs/{id}` — run snapshot
5. `GET /v1/runs/{id}/events/poll` — event polling
6. `POST /v1/runs/{id}/cancel` — cancel
7. `POST /v1/runs/{id}/interrupts/{nodeId}` — HITL approval/clarification resolution
8. SSE: `GET /v1/runs/{id}/events` — real-time stream

Optional but high-value:
9. `POST /v1/runs/{id}:pause` + `:resume` — operator pause/resume
10. `POST /v1/runs:bulk-cancel` — multi-run cancellation
11. `POST /v1/runs/{id}:fork` — replay/fork

The four reference hosts under [`examples/hosts/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts) — in-memory (~570 LOC), SQLite (~700 LOC), Python (~600 LOC), Postgres (~4300 LOC) — exist as canonical reference implementations. The in-memory host is the educational reference; SQLite is the durability reference; Python is the cross-language portability proof; Postgres is the production reference with full claim coverage.

**Check:** your host returns 200 on discovery and 201 on `POST /v1/runs` with a fixture from `conformance/fixtures/conformance-noop.json`.

---

## Step 3: Pick an SDK and write a smoke

Use the language that matches your host. The three reference SDKs ship typed clients that mirror every endpoint as one method.

- TypeScript: [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) — `client.runs.create({...})`, `client.runs.events(id)`, etc.
- Python: [`openwop-client`](https://pypi.org/project/openwop-client/) — `client.runs_create(...)`, `client.runs_events(...)`, etc.
- Go: [`github.com/openwop/openwop/sdk/go`](https://pkg.go.dev/github.com/openwop/openwop/sdk/go) — `client.CreateRun(ctx, ...)`, `client.StreamEvents(ctx, ...)`, etc.

See [`sdk/python/QUICKSTART.md`](https://github.com/openwop/openwop-sdks/blob/main/sdk/python/QUICKSTART.md), [`sdk/go/QUICKSTART.md`](https://github.com/openwop/openwop-sdks/blob/main/sdk/go/QUICKSTART.md), or the in-tree TypeScript SDK README for 5-minute walkthroughs.

**Check:** an SDK smoke against your host completes a run lifecycle end-to-end. Same pattern as the [`examples/hosts/postgres/test/lifecycle.test.ts`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/test/lifecycle.test.ts) smoke — `POST /v1/runs` → poll until terminal → assert event types include the canonical core lifecycle.

---

## Step 4: Run the conformance suite

Install:

```bash
npm install -g @openwop/openwop-conformance
```

Run:

```bash
OPENWOP_BASE_URL=https://your-host.example.com \
OPENWOP_API_KEY=your-test-key \
npx openwop-conformance
```

The suite ships ~108 scenarios. Capability-gated scenarios skip when your discovery doesn't advertise the relevant profile — that's the honesty signal. Scenarios that fail are real bugs; address them OR explicitly opt out via `OPENWOP_OPTED_OUT_PROFILES`.

**Strict mode** is the production gate:

```bash
OPENWOP_REQUIRE_BEHAVIOR=true \
OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-mtls \
npx openwop-conformance
```

Strict mode FAILS skip outcomes that lack an opt-out entry. Your `INTEROP-MATRIX.md` row should reflect strict-mode posture honestly.

**Check:** `npx openwop-conformance` produces a pass-count table you can paste into your host's `conformance.md`.

---

## Step 5: Publish your conformance evidence

Create a `conformance.md` in your host's repo (mirror the pattern in [`examples/hosts/postgres/conformance-full.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/conformance-full.md)). Include:

- Suite version run (e.g., `@openwop/openwop-conformance@1.1.2`)
- Command invoked (with env vars including any opt-outs)
- Pass / fail / skipped / todo counts
- Date measured
- Pinned commit hash of your host at measurement time

**Check:** a third party can read your `conformance.md` and run the same command against your host.

---

## Step 6: Land your row in INTEROP-MATRIX.md

Open a PR adding a row to [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md). Required fields:

- Host name + one-sentence positioning
- Source pointer (your repo or example dir)
- Profiles claimed (the exact strings from `capabilities.auth.profiles[]`)
- Scale tier (`minimal` / `production` / `high-throughput`)
- `openwop-production` claim status (Claimed / Not claimed — be honest)
- Evidence pointer (your `conformance.md`)

The row is reviewed against your `conformance.md` evidence + the canonical conformance suite version. Maintainers verify the claim chain is auditable end-to-end.

**Check:** PR merges; your host has a public row in `INTEROP-MATRIX.md`.

---

## Optional: Implement node-pack runtime

If your host wants to execute typeIds from the public `packs.openwop.dev` registry:

1. Implement the pack-consumer pattern — see [`examples/hosts/postgres/src/pack-consumer.ts`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/src/pack-consumer.ts). Required checks: lockfile parse → SRI integrity → Ed25519 signature → version drift. Fail closed on any.
2. Honor a workspace lockfile per [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) §"Dependency resolution + lockfile".
3. Wire a typeId dispatch table that maps `(packName, version, typeId)` to your executor.

The conformance suite has a registry-public scenario that verifies the public registry's tarball + signature end-to-end ([`conformance/src/scenarios/registry-public.test.ts`](../conformance/src/scenarios/registry-public.test.ts)).

---

## Common gotchas

- **Don't advertise what you don't implement.** Strict-mode scenarios will fail you. Opt-out honestly via `OPENWOP_OPTED_OUT_PROFILES`.
- **Idempotency-Key is per mutation.** Every `POST` that creates state MUST accept the header.
- **Event types are forward-compatible.** Consumers MUST tolerate unknown event types per [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1.
- **Errors use the canonical envelope.** `{ error: <code>, message, details? }` — never bare status codes.
- **Trust boundaries are real.** MCP tool output is `contentTrust: "untrusted"` per [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) §UNTRUSTED. BYOK secrets are `[REDACTED:<id>]` per [`spec/v1/auth.md`](../spec/v1/auth.md).

---

## What OpenWOP does NOT standardize

This is what you keep host-private. Don't try to make it normative.

- **Model SDK shape.** How you call OpenAI/Anthropic/etc. is yours.
- **Internal runtime topology.** Workers, queues, schedulers — OpenWOP doesn't care.
- **Tool protocol.** MCP is the wire surface; you choose how tools execute inside.
- **Cross-process agent messaging.** A2A is the wire surface; you choose internal RPC.
- **Storage adapter shape.** OpenWOP defines `RunEventLogIO` + `SuspendIO` contracts; you choose Postgres / DynamoDB / etc.

---

## References

- [`README.md`](../README.md) — corpus root
- [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) — generated snapshot
- [`spec/v1/`](../spec/v1/) — normative specs
- [`api/openapi.yaml`](../api/openapi.yaml) — wire contract
- [`schemas/`](../schemas/) — JSON Schemas
- [`conformance/`](../conformance/) — black-box suite
- [`examples/hosts/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts) — four reference hosts
- [`sdk/{typescript,python,go}/`](https://github.com/openwop/openwop-sdks/tree/main/sdk) — three reference SDKs
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host roster
- [`MAINTAINERS.md`](../MAINTAINERS.md) — review + waiver tables
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — full contribution guide
