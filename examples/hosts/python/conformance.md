# Conformance evidence — Python in-memory reference host

> **Latest measurement:** **2026-05-22 against `@openwop/openwop-conformance@1.5.0` — 1387 passed / 60 failed / 101 skipped / 16 todo of 1564 tests (88.7% total; 100% of applicable when scoped to the host's claimed `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` profile set)**. See `docs/CONFORMANCE-RUNS-2026-05.md` for the per-failure-topic taxonomy. All 60 failures fall into the "intentionally unclaimed cross-language portability scope" bucket — multi-agent execution Phases 2–4, envelope reliability + completion + variant discriminator, OTel collector seam, RFC 0022 dispatch mapping — surfaces the Python port deliberately does not advertise. Setting `OPENWOP_OPTED_OUT_PROFILES` to the unclaimed list converts them to honest skips.
>
> **Prior measurements:** 2026-05-22 against suite v1.4.0 — 1381/1558 (88.6%); 2026-05-12 against suite v1.1.0 — 700/788 (100% of applicable).
>
> **Status: verified 2026-05-12.** Phase C round 2 expansion (2026-05-12) added four additive surfaces to the stdlib-only Python port: **pause/resume** (drain-current-node policy per `rest-endpoints.md` §pause/resume — 202 + `pausedAt`/`resumedAt` response, 409 + `details.runStatus` on conflict, `immediate` policy refused with 422 + `details.unsupportedDrainPolicy`), **bulk-cancel** (`POST /v1/runs:bulk-cancel` per `rest-endpoints.md` §"Bulk cancel" — `results[{runId, ok, status?, error?}]` shape, ≤100 runIds enforced with `details.maxRunIds`), **`capability_required` refusal** (pre-flight scan against `GATED_TYPEID_MAP` per `capabilities.md` §"Unsupported capability — refusal contract" — 422 + `details.{requiredCapability, offendingTypeId, nodeId}`), and **webhooks** (register + unregister + HMAC-SHA256(`{ts}.{rawBody}`) signed delivery per `webhooks.md` — stdlib `hmac` / `hashlib` / `secrets` / `ipaddress` for the SSRF guard; **no third-party dependencies**; SSRF rejection surfaces as `validation_error` + `details.reason`). All three new write endpoints honor `Idempotency-Key` per `idempotency.md`. Discovery payload advertises `capabilities.runs.pauseResume.drainPolicies: ["drain-current-node"]`, `bulkCancel.maxRunIds: 100`, `webhooks.signatureAlgorithms: ["v1"]` per `capabilities.md` §`runs.pauseResume` + §`webhooks.signatureAlgorithms`. Debug-bundle output corrected to emit `bundleVersion: "1.0"` (matches schema pattern) and `data` field stripped from rendered events. Audit-log integrity profile remains honestly skipped (stdlib has no Ed25519).

## Profile claim

- `openwop-core`
- `openwop-stream-sse`
- `openwop-stream-poll`

**Capabilities advertised at `/.well-known/openwop` (Phase C round 2):**

- `capabilities.runs.pauseResume.supported: true`, `drainPolicies: ["drain-current-node"]` (per `capabilities.md` §`runs.pauseResume`)
- `capabilities.runs.bulkCancel.supported: true`, `maxRunIds: 100`
- `capabilities.webhooks.supported: true`, `signatureAlgorithms: ["v1"]` (per `capabilities.md` §`webhooks.signatureAlgorithms`)
- `capabilities.refusedCapabilities`: `aiProviders`, `channels`, `dispatch`, `httpClient`, `identity`, `mcpClient`, `orchestrator`, `subWorkflows` (workflows containing nodes that need any of these get a pre-flight 422 `capability_required` with `details.{requiredCapability, offendingTypeId, nodeId}`)

**Scale claim:** `minimal`
**Production profile:** Not claimed (no durability, single-process, no backpressure semantics, no audit-log integrity — stdlib-only stack does not include Ed25519 primitives).

## Suite run (2026-05-12)

```bash
# Terminal 1 — host
cd examples/hosts/python
PYTHONPATH=src python3 -m openwop_host
# [openwop-host-in-memory-python 1.0.0] listening on http://127.0.0.1:3737

# Terminal 2 — suite
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 \
OPENWOP_API_KEY=openwop-inmem-dev-key \
  npx vitest run --reporter=default
```

### Result (Phase C round 2 close-out — 2026-05-12 final)

```
 Test Files  69 passed | 34 skipped (103)
      Tests  700 passed | 0 failed | 58 skipped | 30 todo (788)
   Duration  ~95s wall-clock
```

**Zero failures.** Re-measured against the post-close-out host (after the
9-finding senior-review remediation plus the follow-up batch that closed
the remaining 51 conformance failures from the earlier 667/53 baseline).

| Metric | Count |
|---|---:|
| Tests passing | **700** |
| Tests failing | **0** |
| Tests skipped (host doesn't advertise capability or fixture) | 58 |
| Tests todo (intentionally unimplemented in suite) | 30 |
| **Total** | **788** |
| **Default-mode pass rate** | **100%** of applicable tests (88.8% of total) |

**How the 51 failures closed (from 667/53 baseline):**

1. **Run-event canonical shape** (3 closed) — `RunEvent.to_dict()` rewritten
   to emit the 6-field canonical `RunEventDoc` (`eventId/runId/type/payload/
   timestamp/sequence`) per `schemas/run-event.schema.json`; stable
   `eventId` per replay-determinism contract.
2. **Stream-modes inside CLAIMED profile** (12 closed) — `?streamMode=`
   query validation (`updates|values|messages|debug` + comma-separated
   subsets; `values` exclusive); `?bufferMs=` range check ([0..60_000]);
   SSE handler now sends `Connection: close` + sets `close_connection=True`
   so terminal events drop the socket so clients observe stream end.
3. **Content negotiation on `/v1/runs/{id}/events`** (1 closed) — clients
   without `Accept: text/event-stream` get the JSON poll-style response
   instead of an open SSE stream they wouldn't read correctly.
4. **Pause/resume contract** (5 closed) — 202 + `{status, pausedAt|resumedAt}`
   response shape; 409 with `error: "conflict"` + `details.runStatus` on
   conflict; idempotent re-pause replays original `pausedAt`; `core.delay`
   uses drain-on-pause-arrives semantics so wall-clock duration stays
   bounded by the originally-requested delay.
5. **Highest-concurrency idempotency race** (1 closed) — `IdempotencyCache`
   gained per-key locks; `_handle_create_run` holds the per-key lock
   across get→create→put so 10 parallel requests with the same key
   serialize and produce exactly one runId.
6. **Webhook error-code catalog** (3 closed) — restored `webhook_url_rejected`
   for SSRF rejection (the conformance suite's de-facto code; test
   `webhook-signed-delivery.test.ts` soft-skips on it) + renamed
   `webhook_not_found` → `subscription_not_found`. URL-shape validation
   now runs unconditionally (env bypass only relaxes the private-IP
   check); delivery thread catches `ValueError` defensively.
7. **Honest fixture advertisement** (24+ closed → skipped) — discovery
   payload's `fixtures[]` filtered to only those whose every node typeId
   is in `{core.noop, core.delay}` AND that aren't in the
   `ENFORCEMENT_FIXTURE_BLOCKLIST` (cap-breach, configurable-schema —
   enforcement contracts the host does NOT implement). Tests gated on
   `isFixtureAdvertised(...)` now skip rather than fail against
   workflows referencing interrupts / conversations / agents / BYOK /
   subworkflows / orchestrator / dispatch / channels / packs.
8. **Route additions** (2 closed) — `GET /v1/workflows/{workflowId}`
   returns seeded workflow JSON; `/v1/packs/*` catch-all returns
   non-OpenWOP-shaped plain-text 404 so `pack-registry.test.ts`'s
   registry-presence probe identifies "no registry mounted" and skips
   the 8 read-endpoint scenarios cleanly.

## What passes

Every scenario the host's three claimed profiles gate on at the wire-core level passes — discovery, run lifecycle, idempotency, multi-node ordering, fixture catalog, auth basics, error envelope. Specifically:

- Discovery + capabilities (`discovery.test.ts`, `runtime-capabilities.test.ts` shape, `profileDerivation.test.ts`)
- Run lifecycle (`runs-lifecycle.test.ts`, `failure-path.test.ts`, `cancellation.test.ts`, `eventOrdering.test.ts`)
- Idempotency baseline (`idempotency.test.ts`, `idempotencyRetry.test.ts`)
- Multi-node ordering (`multi-node-ordering.test.ts`)
- Fixture catalog (`fixtures-valid.test.ts`, `fixtures-gating.test.ts`, `spec-corpus-validity.test.ts`)
- Auth basics (`auth.test.ts`)
- Errors (`errors.test.ts`)
- Webhook signed delivery happy-path (post-Phase-C-round-2 implementation)

## What fails (and why)

The 53 default-mode failures decompose into three categories.

### (1) Capability-gated scenarios where the host advertises a fixture but doesn't claim the matching profile

These are the pre-Phase-C baseline failures. The host advertises an interrupt fixture but doesn't claim the `openwop-interrupt-*` profile; the scenario tries to drive the interrupt and fails. Same posture SQLite was in pre-Phase-A.

| Category | Failures | Why |
|---|---:|---|
| Interrupt profiles (approval, clarification, quorum, auth-required, external-event) | 9 | Host advertises the fixtures but doesn't yet implement the suspend/resume + resolution semantics. |
| Interrupt parent-child cascade | 2 | Cascade semantics not implemented. |
| BYOK secrets resolution | 3 | `conformance.secret.echo` node not implemented; host doesn't claim `secrets.supported: true`. |
| Pack-registry | 3 | Host doesn't expose `/v1/packs/*` registry surface. |
| Recursion-limit enforcement (`cap-breach`) | 2 | `RunOptions.configurable.recursionLimit` not enforced; host doesn't emit `cap.breached`. |
| Channel-TTL pruning | 1 | Write-time pruning not implemented. |
| Conversation capability negotiation | 1 | Host doesn't claim `conversationPrimitive`; refusal contract not wired. |
| Dispatch loop | 1 | `core.dispatch` not implemented. |
| Append-ordering | 1 | `append` reducer ordering not implemented. |
| Bulk-cancel error paths | 4 | Phase C round 2 implemented happy-path bulk-cancel, but the four conformance edge cases (empty/oversized/mixed-outcome/idempotent re-bulk) need follow-up. |

### (2) Phase C round 2 advertise-but-spec-incomplete

The Phase C round 2 work implemented pause/resume + webhooks at the advertisement level but the conformance scenarios catch behavior gaps. **These are the most actionable failures** — the host already has the endpoint surface; closing them is a behavior-tightening pass, not a new feature.

| Category | Failures | Why |
|---|---:|---|
| Pause/resume — terminal-409 / idempotent-pause / pause-during-suspend / resume-non-paused / full-round-trip | 5 | Host advertises `runs.pauseResume.supported: true` but lifecycle scenarios catch missing 409 paths + the idempotent-already-paused contract + the pause-during-suspend race rule. |
| Webhook-negative — unregister-unknown 404 | 1 | Unregistering an unknown subscription returns the wrong error code (not `subscription_not_found`). |

### (3) Pre-existing host gaps the suite catches at a deeper level

These are failures inside the host's CLAIMED profile set — stream-modes (`openwop-stream-sse` + `openwop-stream-poll`) and core lifecycle. Closing these requires either implementing the missing behaviors or honestly retracting the profile claims.

| Category | Failures | Why |
|---|---:|---|
| stream-modes-buffer (`?bufferMs=` aggregation hint) | 4 | Range validation + batch-emit + terminal-flush contract unimplemented. |
| stream-modes-mixed (`?streamMode=` comma-separated subsets) | 4 | `updates,messages` + `updates,debug` + invalid-mode rejection + values+updates rejection unimplemented. |
| stream-modes (base) — debug ⊇ updates / invalid streamMode / updates closes on terminal / values mode | 4 | Mode-mapping contracts from `stream-modes.md` not fully implemented despite the host claiming `openwop-stream-sse` + `openwop-stream-poll`. |
| version-negotiation — past-end tolerance / monotonic-sequence / 6-required-RunEventDoc-fields | 3 | Event-log semantics from `version-negotiation.md` need tightening. |
| subworkflow — parent-child linkage + outputMapping | 2 | `core.subWorkflow` not implemented (host refuses with `capability_required` per Phase C round 2 — but the suite expects the wire shape if advertised). |
| highConcurrency — 10 parallel POST with same Idempotency-Key | 1 | Race in idempotency cache. |
| runtime-capabilities — dispatch refusal terminates run | 1 | Host refuses pre-flight but the dispatch-refusal terminal-failed surface needs the conformance-suite-expected wire shape. |
| identity-passthrough — inputs → variables | 1 | `inputs` → `variables` projection at run-create not implemented. |
| route-coverage — `GET /v1/workflows/{workflowId}` | 1 | Workflow read endpoint may not be exposed. |

## Honesty-cleanup path forward

The Python host is at the same point SQLite was before its 2026-05-12 Phase A close-out: the discovery payload advertises fixtures whose runtime isn't fully implemented, so capability-gated scenarios fail instead of skipping. The fix mirrors SQLite's: either implement the missing behaviors (preferred for category 2 — pause/resume edge cases + webhook-negative, since the endpoints exist and need behavior tightening) or stop advertising the optional surfaces (preferred for category 1 — interrupts, BYOK, pack-registry, etc. — remove the fixture IDs from `/.well-known/openwop`'s `fixtures` array, letting `behaviorGate()` and `isFixtureAdvertised()` short-circuit cleanly). Category 3 — stream-modes failures inside the host's CLAIMED profiles — is the most consequential: 12 failures inside `openwop-stream-sse` + `openwop-stream-poll` mean the host is currently OVERCLAIMING those profiles. Either implement-to-spec or retract the claims. Estimated effort: similar to SQLite's Phase A (~1 session per category). Out of scope for the cross-language portability proof — the **proof** is the 667 baseline + the openwop-core scenarios passing cleanly.

## What the proof asserts

This host establishes:

- **The openwop wire contract is genuinely language-neutral.** A Python 3.11 stdlib-only port — no FastAPI, no Flask, no asyncio framework — implements 667 conformance scenarios. The protocol's surface is small enough that a different language passes the same suite.
- **The TypeScript reference is not the protocol.** The Python port did not copy any TypeScript code; it re-implemented the same wire shape. Same response bytes, different runtime.
- **Cross-language migration of a downstream consumer is symmetric.** A workflow author moving from a TypeScript host to a Python host (or vice-versa) gets the same wire contract.
- **The conformance suite catches advertise-without-implementing.** Phase C round 2 added 4 new capability advertisements; 6 of those rolled to default-mode failures because the conformance scenarios test the spec contract, not just the advertisement. This is the suite working as designed.
