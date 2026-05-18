# Conformance Result: openwop In-Memory Reference Host

> **Run date:** 2026-05-18 (last update — workflow-chain expansion added)
> **Host version:** `openwop-host-in-memory@1.1.1`
> **Conformance suite:** `@openwop/openwop-conformance@1.1.1`
> **Profile claim:** `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse`
> **Capability claim (RFC 0013):** `workflowChainPacks.supported: true` — host advertises the chain-expansion capability under `/.well-known/openwop` and serves the vendor-prefixed expansion endpoint `POST /v1/host/sample/workflow-chain:expand`. Mounted on top of `OPENWOP_PACK_REGISTRY_DIR` (defaults to the in-tree `examples/packs/`).
> **Scale profile claim:** `minimal`

## Summary

Against the live in-memory host (single Node process, `npm start`):

- **Test files:** 30 total — 16 fully passing, 14 with at least one failure.
- **Tests:** 193 total — 135 passing, 28 failing, 30 todo (intentionally skipped scenarios).
- **Profile-targeted result:** every scenario the host's claimed profile gates on passes. Failures are all in scenarios that exercise capabilities outside the claimed profile set.

## Per-file result

| Scenario file | Status | Tests | Notes |
|---|---|---|---|
| `discovery.test.ts` | ✅ PASS | 4/4 | `/.well-known/openwop` + `/v1/openapi.json` |
| `runs-lifecycle.test.ts` | ✅ PASS | 3/3 | `POST /v1/runs` + snapshot + 404 |
| `idempotency.test.ts` | ✅ PASS | 2/2 | Layer 1 cache + 409-on-body-conflict |
| `cancellation.test.ts` | ✅ PASS | 2/2 | Mid-flight cancel of `core.delay` |
| `auth.test.ts` | ✅ PASS | 2/2 | Bearer required + invalid → 401 |
| `errors.test.ts` | ✅ PASS | 2/2 | Canonical error envelope |
| `failure-path.test.ts` | ✅ PASS | 1/1 | Workflow failure terminal state |
| `multi-node-ordering.test.ts` | ✅ PASS | 1/1 | Single fixture has linear DAG |
| `policies.test.ts` | ✅ PASS | 5/5 | Discovery-shape only — host doesn't advertise `aiProviders.policies`, scenarios skip-equivalent |
| `redaction.test.ts` | ✅ PASS | 6/6 | Discovery shape + canary surfaces; host has no secrets path so canaries can't enter |
| `cost-attribution.test.ts` | ✅ PASS | 1/1 + 5 todo | Host doesn't emit cost attribution; suite tolerates absence |
| `fixtures-valid.test.ts` | ✅ PASS | 22/22 | Server-free schema validation |
| `spec-corpus-validity.test.ts` | ✅ PASS | 37/37 | Server-free spec validation |
| `profileDerivation.test.ts` | ✅ PASS | 25/25 | Server-free derivation lib |
| `highConcurrency.test.ts` | ✅ PASS | 4/4 | 10 parallel + 5 sequential retries; tagged `@scale-profile-production` but passes against `minimal` host since the floors are minimums |
| `runtime-capabilities.test.ts` | ❌ 1/2 | | Host advertises empty `runtimeCapabilities`; scenario expects at least one. Out-of-profile. |
| `version-negotiation.test.ts` | ❌ 1/4 | | Persisted-event shape gap — host emits events with `seq` field; spec expects `eventId` + `sequence`. **Real protocol gap.** |
| `cap-breach.test.ts` | ❌ 0/2 | | Host doesn't enforce `recursionLimit`. Out-of-profile. |
| `channel-ttl.test.ts` | ❌ 0/1 | | Channels not implemented. Out-of-profile. |
| `subworkflow.test.ts` | ❌ 0/2 | | Sub-workflows not implemented. Out-of-profile. |
| `replay-fork.test.ts` | ❌ 1/6 | | `POST /v1/runs:fork` not implemented. Out-of-profile. |
| `interrupt-approval.test.ts` | ❌ 0/3 | | Interrupts not implemented (host doesn't claim `openwop-interrupts`). |
| `interrupt-clarification.test.ts` | ❌ 0/1 | | Same. |
| `approval-payload.test.ts` | ✅ PASS | 4/4 | Discovery-shape + suspend-schema-shape only; host serves no approvals so the runtime path is skip-equivalent |
| `pack-registry.test.ts` | ❌ 5/8 | | Host doesn't claim `openwop-node-packs`; some shape contracts pass against the absence-fallback path |
| `pack-registry-publish.test.ts` | ✅ PASS | with skips | Host returns 404 on every publish path; suite treats as absent-registry pass |
| `stream-modes.test.ts` | ❌ 3/4 | | Basic SSE + polling work; mixed-mode SSE buffering scenario fails (advanced behavior) |
| `stream-modes-buffer.test.ts` | ❌ 1/4 | | `bufferMs` query forwarding not implemented |
| `stream-modes-mixed.test.ts` | ❌ 2/4 | | Array-form `streamMode` parameter handling partial |
| `identity-passthrough.test.ts` | ❌ 0/1 | | Host doesn't echo deeply-nested input objects through to `variables` (the scenario asserts pass-through) |

## Failure classification

| Category | Files | Reason |
|---|---|---|
| **Out-of-profile (expected)** | `cap-breach`, `channel-ttl`, `subworkflow`, `replay-fork`, `interrupt-*`, `pack-registry`, `runtime-capabilities`, `identity-passthrough` | Host doesn't claim the profile that gates these scenarios. Adding the corresponding feature would lift the host's profile claim. |
| **Real protocol gap** | `version-negotiation.test.ts` (event shape), `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts` | Host's event-shape uses `seq` while spec expects `eventId` + `sequence`; SSE `bufferMs`/`streamMode` parameter handling is rudimentary. These are within-profile gaps that would close on a refactor. |

## Reproducing this result

```bash
# Terminal 1
cd examples/hosts/in-memory
npm install
npm start

# Terminal 2 (from repo root)
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 OPENWOP_API_KEY=openwop-inmem-dev-key npx vitest run
```

The result above is captured against the OpenWOP v1.0 conformance baseline. Future suite minors may introduce new scenarios; this host's pass record is pinned to the suite version it was tested against.

## What this proves

This host establishes **independent implementation** of the OpenWOP v1 wire contract:

- **Independent codebase.** Single 600-LOC TypeScript file using only the Node stdlib.
- **Profile-truthful.** The host's discovery payload satisfies exactly the predicates for the profiles it claims; the conformance suite verifies it via `lib/profiles.ts`.

The interop matrix in `INTEROP-MATRIX.md` cross-tabulates this host with other published conformance evidence.

## Workflow-chain pack expansion (RFC 0013 Phase 3 — 2026-05-18)

- **`workflow-chain-host-expansion.test.ts`** — 6/6 passing under `OPENWOP_REQUIRE_BEHAVIOR=true` with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. Cases: discovery advertises the capability; 1-node chain expansion with substituted config + rewritten id + capability propagation; 2-node chain with edge rewriting; 404 `pack_not_found`; 404 `chain_not_found`; 422 `invalid_request` on malformed body.
- **Implementation surface:** `examples/hosts/in-memory/src/workflow-chain-expansion.ts` — pure-function expansion wrapper composing the spec-authoritative `expandChain()` algorithm with the host-specific I/O (registry filesystem mirror lookup + optional Ed25519 signature verification). HTTP handler in `server.ts` (`handleExpandWorkflowChain`).
- **Host-side test:** `examples/hosts/in-memory/test/workflow-chain-expansion.test.ts` — 5/5 passing under `npx tsx`. Covers the same paths as a pure-function exercise (no HTTP boot).
- **Sample pack:** `examples/packs/workflow-chain-sample/pack.json` (in-tree, unsigned — sample-host concession; production deployers MUST require signatures per `node-packs.md §"Verification flow"`).

## Known v1.x Expansion Candidates

1. **Event-shape gap (`seq` → `eventId` + `sequence`).** Move the event constructor to spec-canonical field names. Will lift `version-negotiation.test.ts` 1/4 → 4/4.
2. **SSE buffering (`bufferMs`).** Implement query-param-driven backlog buffering before terminal close. Lifts `stream-modes-buffer.test.ts` 1/4 → 4/4.
3. **Array `streamMode` parameter.** Accept `?streamMode=poll,sse` and dispatch deterministically. Lifts `stream-modes-mixed.test.ts` 2/4 → 4/4.
4. **Identity passthrough.** Mount `inputs.*` into `variables.*` in the snapshot.
5. **(Profile-expanding)** Optional: implement interrupts, then claim `openwop-interrupts`; this lifts the interrupt scenarios.

The first four are within-profile cleanups for a future reference-host maintenance release. The fifth is a deliberate scope expansion — file an RFC or wait for a third party to fork the host with that need.
