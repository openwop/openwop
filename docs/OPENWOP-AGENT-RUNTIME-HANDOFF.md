# Handoff — Agent Packs, the (missing) Agent Registry, and the case for a best-in-class agent runtime

Date: 2026-05-26
From: a sibling Claude Code session (analysis pass)
To: the next session that picks up agent work
Status: brief + direction, **not** an approved plan. Run `/prd` or `/plan` before writing code — see §6.

---

## 0. TL;DR

OpenWOP already ships **~26 agent packs** with **~30 fully-populated agent manifests**
(`packs/core.openwop.agents.*/pack.json`), and the spec for how agents behave is
**Accepted** (RFCs 0002/0003/0006/0007/0037/0059, 0061 Active). The CLI, AI Chat, and
demo app gained an agent *surface* in the #256–#266 cohort.

**But the agent packs are inert.** Nothing in the demo host reads their `agents[]`
arrays. There is no AgentRegistry. `routes/agents.ts` fakes an inventory from three
hard-coded node roles. No host advertises the `host.agentRuntime` capability every pack
declares a peer-dependency on. So you can publish, sign, and list an agent pack — and
then nothing can actually *instantiate or run* the agent it describes.

The task: **build the agent runtime that closes this loop, and make it best-in-class** —
on par with or better than LangGraph Supervisor / CrewAI hierarchical process (the
patterns the packs explicitly cite).

---

## 1. What an agent pack actually is (it's real and complete)

A `pack.json` carries an `agents[]` array of `AgentManifest` entries
(`schemas/agent-manifest.schema.json`, `$id .../agent-manifest.schema.json`). Concrete
example — `packs/core.openwop.agents.supervisor/pack.json`:

```jsonc
{
  "name": "core.openwop.agents.supervisor",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "peerDependencies": { "aiProviders": "supported", "host.agentRuntime": "supported" },
  "agents": [{
    "agentId": "core.openwop.agents.supervisor.default",
    "persona": "Supervisor",
    "modelClass": "reasoning",
    "systemPromptRef": "prompts/supervisor.md",      // tarball-relative
    "toolAllowlist": [],                              // <scope>:<tool-id>, host MUST enforce
    "memoryShape": { "scratchpad": true, "conversation": true, "longTerm": false },
    "handoff": {                                      // input/output contracts
      "taskSchemaRef": "schemas/supervisor.task.schema.json",
      "returnSchemaRef": "schemas/supervisor.return.schema.json"
    },
    "confidence": { "defaultThreshold": 0.75 }        // RFC 0002 §F escalation
  }],
  "runtime": { "language": "remote", "entry": "pack.json" }
}
```

Inventory of what's already on disk:
- ~26 packs under `packs/core.openwop.agents.*`; singletons (react, classifier,
  code-reviewer, deep-research, sdr, …) ship 1 agent; **crews** ship several
  (`research-crew` 4, `support-crew` 3, `devops-crew` 3).
- Each manifest declares: persona/label/description, `modelClass` (reasoning|writing|
  coding|research|classification|general), system prompt (inline `systemPrompt` XOR
  `systemPromptRef` — enforced by the schema `oneOf`), `toolAllowlist`, `memoryShape`,
  optional `handoff` task/return JSON-Schema refs, `confidence.defaultThreshold`, and
  optional RFC 0029 `promptLibraryRef` / `promptOverrides`.
- The packs are also published in `registry/` and `registry/v1/packs/` (signed). The
  registry side works; consumption does not.

**These manifests are first-class spec surface** (RFC 0003 + `node-packs.md`). They are
not placeholders. The data is there waiting for a runtime.

---

## 2. What exists today (the surface), and why it doesn't close the loop

| Layer | What's there | File | Verdict |
|---|---|---|---|
| Agent inventory endpoint | `GET /v1/host/sample/agents` + `/:agentId` | `apps/workflow-engine/backend/typescript/src/routes/agents.ts` | **Faked.** Returns 3 hard-coded `AGENT_ROLES` (supervisor / dispatch / chat-responder) filtered by node-type presence. Does **not** read any pack `agents[]`. |
| Orchestrator + dispatch | `core.orchestrator.supervisor`, `core.dispatch` nodes | `src/bootstrap/nodes.ts:78,124` | Real (RFC 0006/0007/0037). But they route between **workflow nodes / sub-workflows**, not between *manifest-declared agents*. |
| Agent.* events | `agent.reasoned/toolCalled/toolReturned/handoff/decided` | `src/bootstrap/nodes.ts`, `conformanceMockAgent.ts` | Emitted by the chat-responder + mock agent. Front-end renders them (`AgentEventCards.tsx`). |
| Provider dispatch (BYOK) | anthropic / openai / google / minimax | `src/providers/dispatch.ts` | Real. This is how an agent reaches an LLM. |
| Agent **registry** | — | — | **Does not exist.** No `getAgentRegistry()`, no manifest parsing. `tarballLoader.ts` / `nodePackResolver.ts` only read `manifest.nodes`, never `manifest.agents`. |
| `host.agentRuntime` capability | — | `schemas/capabilities.schema.json` | **Not defined, not advertised.** Every agent pack peer-depends on it; install-time gating can never succeed. |

Net: agents are **node-attributed identities** (an agentId stamped on events emitted by a
node) — not **instantiable units loaded from a pack**. The gap-doc and the prior analysis
treated the role-inventory as a deliberate "don't invent normative surface" choice, and
for a *read-only listing* it is fine. It is **not** enough to run a published agent.

---

## 3. The gap, stated precisely

To go from "publish an agent pack" → "run that agent," the host must, at minimum:

1. **Load `agents[]` at pack-install time** into an in-process `AgentRegistry`
   (parallel to `getNodeRegistry()`), resolving `systemPromptRef` and `handoff.*SchemaRef`
   from the tarball. Touch points: `src/packs/tarballLoader.ts`,
   `src/bootstrap/nodePackResolver.ts`.
2. **Advertise a capability** (`host.agentRuntime` or `agents.runtime`) in
   `capabilities.schema.json` + `discovery.ts`, so pack `peerDependencies` resolve and
   conformance can gate on it. *(This is the part that likely needs an RFC — see §6.)*
3. **Make `routes/agents.ts` real** — list/info from the registry, not 3 constants.
4. **Dispatch a manifest agent**: resolve its system prompt (honoring the RFC 0029
   resolution chain), enforce `toolAllowlist` when handing tools to the provider, validate
   the inbound task against `handoff.taskSchemaRef` and the result against
   `returnSchemaRef`, run the loop (RFC 0061 lifecycle), emit properly-attributed
   `agent.*` events, and apply `confidence.defaultThreshold` escalation (RFC 0002 §F).
5. **Wire memory** per `memoryShape` (scratchpad / conversation / longTerm) against the
   `MemoryAdapter`, honoring the SR-1 redaction + CTI-1 cross-tenant invariants when
   `longTerm: true`.

---

## 4. What "best-in-class" should mean

Don't just make it work — make it the reference other runtimes measure against. The packs
themselves cite LangGraph Supervisor and CrewAI hierarchical process; match and beat them:

- **Manifest-driven, zero-glue.** Install a signed agent pack → it's immediately
  listable, dispatchable, and composable into a workflow with no host code changes.
- **Multi-agent first.** Crews (`research-crew`, `support-crew`, `devops-crew`) run as a
  supervisor + sub-agents via existing RFC 0006/0007/0037 dispatch — real handoffs with
  `handoff` schema validation on the wire, full `agent.handoff` causation chains, and
  correct `runs ancestry` (fix the §5 cause-labeling bug so dispatched sub-agents are
  distinguishable from sub-workflows).
- **Safe by construction.** `toolAllowlist` enforced at the dispatch boundary (RFC 0002
  §A14 `ToolPermissionService.filterTools` pattern); BYOK credentials never leak into
  events/handoff payloads; `longTerm` memory passes the redaction harness.
- **Confidence + escalation.** Sub-threshold `agent.decided` triggers the RFC 0002 §F
  interrupt instead of silently proceeding — surfaced in chat UI + CLI.
- **Observable + replayable.** Every agent turn emits `openwop.*` OTel spans; a run with
  agents forks/replays deterministically (don't break `POST /v1/runs/{runId}:fork`).
- **Visible across all three surfaces.** App (run an agent from a pack, see its reasoning/
  tools/handoffs), AI Chat (`@agent` dispatch, not just `@workflow`), CLI (`openwop agents
  run`, not just `list/info`).

---

## 5. Known follow-ups to fold in (don't re-discover these)

- **`runs ancestry` mislabels children.** `routes/runs.ts:474` hard-codes
  `cause: 'core.subWorkflow'` because `RunRecord` doesn't persist which primitive
  (`core.subWorkflow` vs `core.dispatch`) created the child. Persist the composition
  mechanism on `RunRecord` (`src/executor/types.ts`) so agent dispatch is distinguishable.
- **RFCs 0067/0068/0069 are `Draft`, spec-only.** 0068 (memory consolidation + standing
  commitments) overlaps the `memoryShape.longTerm` story — coordinate, don't duplicate.
- **`peerDependencies.host.agentRuntime`** has no resolver. Whatever capability name you
  pick must be the one pack install checks against.

---

## 6. Before you write code — governance gate

This is **not** pure implementation. Two parts touch the wire contract:
- a **new capability** (`host.agentRuntime`/`agents.runtime`) in `capabilities.schema.json`
  + `/.well-known/openwop`, and
- possibly a **new list/run surface** if you expose more than the existing sample-extension
  `/v1/host/sample/agents`.

Per `CONTRIBUTING.md`, capability advertisement and any normative endpoint are RFC
surface. RFC 0003 declared the `agents[]` *manifest* but explicitly deferred the *runtime*
contract (RFC 0004 memory-shape was Phase 3). So:

1. Run **`/prd`** to decide: does the agent-runtime capability + dispatch contract need a
   new RFC (likely **additive**: new optional capability flag + new optional event
   attribution), or can it ride on existing Accepted RFCs as reference-host implementation?
   My read: the **capability flag needs a short additive RFC**; the registry/loader/CLI/UI
   is implementation-only against it.
2. Then **`/plan`** the phased build: capability/RFC → AgentRegistry + loader → real
   `routes/agents.ts` → dispatch path + toolAllowlist + handoff validation → conformance
   scenarios (gate on the new capability) → CLI `agents run` → chat `@agent` → reference
   host evidence + INTEROP-MATRIX.

---

## 7. Parallel-session hygiene (this repo bites)

- Work in your **own worktree** off `origin/main`: `git fetch && git worktree add
  ../openwop-agent-runtime origin/main`. Never `git checkout -b` in the shared checkout.
- **Never `git stash` / `git reset --hard` / `git clean`** the shared tree — other
  sessions' unpushed work lives there.
- Branch from `origin/main` (it advances under you — this whole cohort merged mid-session).
- Provision the worktree with a real `npm install` (the old `node_modules` symlink trap is
  fixed on main via #257, but don't symlink as a shortcut).
- Gate before merge with `npm run openwop:check` (8 steps). Adding RFC files means syncing
  README counts + `npm run protocol:status` or step 7 fails. Sign commits (DCO).

## 8. Definition of done

- [ ] An installed agent pack's `agents[]` are loaded into an AgentRegistry and survive a restart.
- [ ] `host.agentRuntime` (or chosen name) advertised + conformance-gated; pack peerDeps resolve.
- [ ] `GET /v1/host/sample/agents` reflects real installed agents, not 3 constants.
- [ ] A manifest agent dispatches end-to-end: prompt resolved, tools allowlisted, task/return validated, `agent.*` events attributed, confidence escalation honored.
- [ ] A crew (e.g. `research-crew`) runs supervisor→sub-agents with handoff validation and correct `runs ancestry`.
- [ ] Runnable from the app, addressable from chat (`@agent`), invokable from CLI (`openwop agents run`).
- [ ] Conformance scenarios + reference-host evidence + INTEROP-MATRIX updated; `openwop:check` green.
