# Migration request — adopt RFC 0070 (`agents.manifestRuntime`) to graduate it Active → Accepted

**To:** MyndHyve workflow-runtime team
**From:** OpenWOP steward (David Tufts)
**Date:** 2026-05-26
**Re:** RFC 0070 *Agent Manifest Runtime Capability* — now `Active`; one non-steward advertisement closes `Active → Accepted`

## Why we're asking

RFC 0070 landed `Active` on 2026-05-26 (steward waived the 7-day comment window; the wire surface + the reference `workflow-engine` host implement it end-to-end — see PR #268/#269). It adds the **floor that makes packaged agent manifests runnable** — `capabilities.agents.manifestRuntime`. Per `RFCS/0001` §"Promotion to Accepted," it needs **one non-steward host advertising the capability + honoring the contract**.

You are the live non-steward adopter, and this is squarely in your lane: `host.agentRuntime` in `spec/v1/host-capabilities.md` is already attributed to your `vendor.myndhyve.agent-orchestration` pack, and RFC 0070 §B makes `host.agentRuntime` **imply** `manifestRuntime` — so you likely already satisfy the behavior and mostly need to advertise the explicit flag.

## The ask (one capability flag + a behavioral confirmation)

**1. Advertise** on `https://api.myndhyve.ai/.well-known/openwop`:

```jsonc
"capabilities": {
  "agents": {
    // … your existing version:5 / statefulResume / etc …
    "manifestRuntime": { "supported": true, "handoffValidation": true }
  }
}
```

It's additive — it slots into your existing `capabilities.agents` block (which is `additionalProperties: true`), changes nothing you already advertise, and `host.agentRuntime ⇒ manifestRuntime` means it's consistent with your orchestration pack. We advertise the explicit flag (not just rely on the implication) because `host.agentRuntime` is prose-only in `host-capabilities.md` and not yet in `capabilities.schema.json`, so the machine-readable gate + conformance read `agents.manifestRuntime` directly.

**2. Confirm the floor contract** (RFC 0070 §A; you almost certainly do this already):

- Load each installed pack's `agents[]` into your agent registry (RFC 0003 `installAgents`), resolving `systemPromptRef` + `handoff.*SchemaRef` from the tarball at install (RFC 0003 §C/§D).
- When dispatching a manifest agent: resolve its system prompt, **enforce its `toolAllowlist`** (RFC 0002 §A14), validate the task against `handoff.taskSchemaRef` and the result against `returnSchemaRef` when `handoffValidation` (RFC 0003 §D), apply **confidence-threshold escalation** (RFC 0002 §F — a sub-threshold decision escalates, it does not proceed), emit attributed `agent.reasoned` / `agent.decided` events, and never leak BYOK material into events/handoff payloads (SR-1).
- For an agent that needs an unmet tier, follow the §D graceful-degradation ladder (install degraded + advertise honestly, **or** refuse with `pack_peer_dependency_missing`).

## Evidence we need (same pattern as your prior rounds)

1. **Advertisement** — we'll openwop-side `curl` your `/.well-known/openwop` and confirm `capabilities.agents.manifestRuntime.supported: true` (exactly as we verified `version: 5` + `statefulResume` for RFC 0058/0061).
2. **Behavioral** — one dispatch of a manifest agent on your surface showing: a `toolAllowlist`-filtered tool surface, handoff task/return validation, a §F escalation on a sub-threshold decision, and attributed `agent.*` events. A short `docs/openwop-adoption/0070-agent-manifest-runtime.md` on your side (like your `0037-multi-agent-phase-1.md` / `0044-vendor-kind-mapping.md`) with the Cloud Run revision + commit is the ideal record.

## One honest wrinkle to coordinate on

The conformance scenario `agent-manifest-runtime.test.ts` (suite `@openwop/openwop-conformance@1.9.0`) currently drives the **sample-extension** seam `POST /v1/host/sample/agents/{agentId}/dispatch`, which your production host won't expose — so it will **soft-skip** the behavioral leg against you (the advertisement-gate leg still passes once you advertise the flag). Two ways forward, your call:

- **(a) Bootstrap-phase pattern (no work for you beyond the above):** advertise + we curl-verify + you attach the behavioral evidence on your own surface — exactly how RFC 0037/0058/0061 graduated. Fastest.
- **(b) Promote a normative endpoint:** we file a small additive follow-on (RFC 0070 §Unresolved #3) promoting the agent inventory + dispatch to a normative `/v1/agents` surface, so the scenario can exercise your host fully black-box. Cleaner long-term; a bit more coordination.

We recommend **(a)** now to close acceptance, with **(b)** as a tracked follow-on.

## Optional, while you're in here (not required for 0070)

If useful to your product, the 0067–0069 Draft cohort is also available — most relevant to you is **RFC 0067** (`capabilities.aiProviders.authModes` + an additive provider-name vocabulary) as your provider catalog grows. These are `Draft` (no reference-host implementation yet), so they're adopt-if-interested, not part of this acceptance ask.

## References

- `RFCS/0070-agent-manifest-runtime.md` (`Active`), `docs/OPENWOP-AGENT-RUNTIME-ANALYSIS.md`
- `schemas/capabilities.schema.json` → `agents.manifestRuntime`
- Contract refs: RFC 0002 §A14 (toolAllowlist) + §F (confidence), RFC 0003 §B/§C/§D (manifest install + ref resolution)
- Steward-side evidence: PR #268 (floor), PR #269 (review fixes + Draft → Active); reference host dispatches a manifest agent end-to-end (`apps/workflow-engine/backend/typescript/test/agent-dispatch-route.test.ts`)
