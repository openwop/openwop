# Cross-host parent-child workflow sample

> MA-6 from `plans/openwop-protocol-gap-closure-plan.md` Workstream 6. Runnable evidence of an OpenWOP parent issuing a child task to an A2A peer and projecting the peer's terminal state back to OpenWOP's `run.status` per the canonical state-projection table.

Companion to [`examples/multi-agent-research-assistant/`](../multi-agent-research-assistant/README.md) (in-host multi-agent composition, MA-1). This example covers the **other** boundary — when the worker lives on a **different host** reachable via [A2A v1](https://a2a-protocol.org/).

## What this is

A standalone TypeScript script that boots the conformance suite's [`A2AFakePeer`](../../conformance/src/lib/a2a-fake-peer.ts), drives a complete parent-child workflow across the boundary, and asserts the canonical state-projection rules from [`spec/v1/a2a-integration.md`](../../spec/v1/a2a-integration.md) §"State projection".

Six scenarios cover the projection table end-to-end:

| Scenario | A2A terminal state | OpenWOP `run.status` projection | Reason code |
|---|---|---|---|
| Happy path | `completed` | `completed` | — |
| Drift point #3 | `auth-required` | `waiting-input` | `auth_required_by_remote` |
| Drift point #4 | `rejected` | `failed` | `rejected_by_remote` |
| Plain failure | `failed` | `failed` | — |
| Cancellation | `canceled` (1 `l`) | `cancelled` (2 `l`) | — |
| Replay determinism | `rejected` × 2 | identical projection | — |

## Run

```bash
cd /path/to/openwop
npx tsx examples/multi-agent-cross-host/bridge.ts
```

Expected output:

```
ok multi-agent-cross-host — A2A bridge state-projection verified end-to-end
  happy-path:    A2A=completed → OpenWOP=completed
  AUTH_REQUIRED: A2A=auth-required → OpenWOP=waiting-input (reason=auth_required_by_remote)
  REJECTED:      A2A=rejected → OpenWOP=failed (reason=rejected_by_remote)
  FAILED:        A2A=failed → OpenWOP=failed
  CANCELED:      A2A=canceled → OpenWOP=cancelled
  replay-deterministic: 2 independent invocations produced identical projection
```

## The bridge

[`bridge.ts`](./bridge.ts) ships two reference pieces of code that future OpenWOP hosts implementing `core.a2a.invoke` can adopt:

1. **`projectA2AStateToOpenWop(wireState)`** — pure function applying the canonical projection per `a2a-integration.md` §"A2A → openwop (reverse projection)". Handles drift points #3 and #4 with the documented reason codes; falls through to `failed` with `unknown_remote_state` for forward-compatible unknown states.

2. **`invokeA2APeer(endpoint, skill, message)`** — reference bridge node. Issues `message/send`, polls `tasks/get` until the task reaches a terminal wire state, applies the projection, and returns the projected `run.status` + the full A2A Task. The implementation comment lists the production-grade additions (timeout, retry, OAuth2, OTel propagation, idempotency) that a real host MUST layer on top.

## What this is NOT

This example is NOT a production bridge. Specifically:

- **No timeout / retry / backoff.** The polling loop is tight and ungated; a real bridge MUST respect the host's `OPENWOP_A2A_POLL_TIMEOUT_MS` (or analogue) and back off exponentially.
- **No OAuth2 client-credentials.** The fake peer accepts unauthenticated POSTs; real A2A endpoints typically require an OAuth2 access token per their AgentCard's `securitySchemes`.
- **No OTel trace propagation.** Production hosts MUST inject the parent run's trace context into `Task.metadata.openwop.traceContext` per [`observability.md`](../../spec/v1/observability.md) §"Cross-host trace propagation" so a single trace spans both hosts.
- **No idempotency.** Real bridges MUST key the `message/send` call off `(parentRunId, nodeId)` and reuse the resulting `taskId` on retry — otherwise a retry creates a duplicate task on the peer.
- **No forward projection.** This example only covers A2A → OpenWOP (reverse). When OpenWOP is the agent and A2A clients call IN, the host applies the forward projection per `a2a-integration.md` §"openwop → A2A". The conformance scenario `a2a-task-roundtrip.test.ts` covers both directions.

## How this is verified

The same projection rules are enforced normatively by `conformance/src/scenarios/a2a-task-roundtrip.test.ts` (the suite-tier check, run on every host claiming A2A composition). This example is the runnable narrative an integrator can read end-to-end **before** wiring `core.a2a.invoke` into their own host.

## Related material

- [`spec/v1/a2a-integration.md`](../../spec/v1/a2a-integration.md) — normative integration spec (FINAL v1, 2026-05-05).
- [`examples/multi-agent-research-assistant/README.md`](../multi-agent-research-assistant/README.md) — in-host multi-agent composition (orchestrator + dispatch + AgentRef + reasoning events + HITL + memory).
- [`conformance/src/scenarios/a2a-task-roundtrip.test.ts`](../../conformance/src/scenarios/a2a-task-roundtrip.test.ts) — conformance scenario covering the same projection contract.
- [`conformance/src/lib/a2a-fake-peer.ts`](../../conformance/src/lib/a2a-fake-peer.ts) — the in-process synthetic peer this example reuses.
