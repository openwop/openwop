# RFC 0131: Agent-manifest `role` and the Skill profile

| Field             | Value |
| ----------------- | ----- |
| **RFC**           | 0131 |
| **Title**         | Distinguish a composable, task-scoped **Skill** from a top-level **assistant** agent, first-class on the agent manifest — an additive optional `AgentManifest.role` plus a normative *Skill profile* (handoff required, `memoryShape ≤ scratchpad`) that keeps sub-agent dispatch stateless and replay-clean |
| **Status**        | `Draft` |
| **Author(s)**     | David Tufts (@davidscotttufts) |
| **Created**       | 2026-07-07 |
| **Updated**       | 2026-07-07 (`Draft`) |
| **Affects**       | `schemas/agent-manifest.schema.json` (additive optional `role`) · `spec/v1/agent-runtime.md` / `multi-agent-execution.md` (skill semantics + the profile) · conformance scenarios · SDKs · `CHANGELOG.md` · `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` (the field) + `safety-fix` (the Skill profile tightens memory for the skill role → *more* replay-deterministic) |
| **Supersedes**    | — |
| **Superseded by** | — |

## Summary

The agent manifest (RFC 0003) describes both **composable, task-scoped worker agents** (a `handoff` task→return contract; e.g. code-reviewer, invoice-extractor) and **top-level assistant agents** (conversational orchestrators a client talks to) with the **same shape and the same word — "agent".** Nothing on the wire distinguishes them, so a host, client, or marketplace cannot tell "a capability an orchestrator delegates to" from "an agent you converse with."

This RFC makes the distinction first-class, additively: an optional `AgentManifest.role` (`"skill" | "assistant"`), **defaulted by inference** (`handoff` present ⇒ `skill`, absent ⇒ `assistant`, so an omitted field is exactly today's behavior), plus a normative **Skill profile** — a `role: "skill"` manifest MUST declare `handoff` and MUST constrain `memoryShape` to scratchpad only (no `conversation`, no `longTerm`). The profile is what makes a skill a **stateless, composable, replay-clean capability**; conversation and long-term memory are properties of the *assistant/roster* agent that composes skills, and a worker that carries them is a stateful principal that undermines replay determinism (RFC 0041).

## Motivation

1. **"Agent" is overloaded across two wire-distinct things.** `AgentManifest` (RFC 0003, `agent-manifest.schema.json`) carries `persona`, `toolAllowlist`, `memoryShape`, `confidence`, `handoff`, `requiresCapabilities` — the *same* fields whether the manifest is a one-shot worker invoked via `handoff` (RFC 0022 dispatch I/O; RFC 0037 multi-agent execution) or a conversational assistant. A client selecting an agent, a builder wiring a sub-agent into a workflow, and a marketplace labeling a pack all need to know *which kind* this is — from the manifest, not by heuristic.

2. **The industry is standardizing on "Agent Skills."** SKILL.md (open standard, Dec 2025) packages a reusable capability; reference hosts already normalize SKILL.md → an OpenWOP agent manifest. OpenWOP has the concept but not the vocabulary — a skill and a worker agent pack are the *same artifact* today, unlabeled.

3. **Composable workers must stay replay-clean.** RFC 0041 (multi-agent replay under nondeterminism) requires a dispatched sub-agent's result to be a recorded fact. A worker that accumulates `longTerm` memory across invocations, or holds a multi-turn `conversation`, is a stateful principal — its behavior depends on history the caller didn't hand it, blurring the pure task→return contract and the determinism boundary. The constraint below removes that hazard for the skill role.

The spec is the right place because this is a **cross-host interop + vocabulary** concern: the *declaration* of "this manifest is a skill" and its *behavioral floor* must mean the same thing on every host. Per-host implementation is unchanged; this standardizes the declaration + the profile, additively.

## Proposal

### §A — `AgentManifest.role` (additive optional)

Add to `schemas/agent-manifest.schema.json`:

```json
"role": {
  "type": "string",
  "enum": ["skill", "assistant"],
  "description": "The manifest's kind. `skill`: a composable, task-scoped capability invoked via `handoff` (task→return) and composed by an assistant/roster agent — stateless and replay-clean (see the Skill profile). `assistant`: a top-level conversational agent a client talks to and that composes skills. OPTIONAL; when absent a host MUST infer it — `handoff` present ⇒ `skill`, else `assistant` — so an omitted field is byte-identical to today's behavior."
}
```

- **Default by inference**, never a hard default value: absent `role` ⇒ inferred from `handoff` presence. An existing manifest is unchanged (no `role`, inferred).
- `role` is **advisory about kind**, never a grant of authority — it does not widen `toolAllowlist`, `requiresCapabilities`, or any scope.

### §B — The Skill profile (normative, `role: "skill"` — inferred or explicit)

A manifest that is a skill (explicit `role: "skill"`, or inferred via `handoff`) MUST satisfy:

1. **`handoff` present.** A skill is invoked as a task→return capability (RFC 0003 `handoff.taskSchemaRef` / `returnSchemaRef`; RFC 0022 dispatch). A `role: "skill"` manifest without `handoff` is invalid.
2. **`memoryShape ≤ scratchpad`.** `memoryShape.conversation` and `memoryShape.longTerm` MUST be `false` or absent; `scratchpad` MAY be `true` (ephemeral working memory for the single task). Persistent and multi-turn memory belong to the composing assistant/roster agent (RFC 0039 memory lifecycle), not the worker.
3. **No standing identity or side-channels of its own.** A skill has no roster presence, no knowledge-base binding, and no schedule — none of which are agent-manifest fields (they are host/roster concerns). A skill receives context via its `handoff` task input and reaches credentials only through its allowlisted tools.

A host that recognizes `role` and finds a `role: "skill"` manifest violating (1) or (2) MUST NOT present it as a plain runnable skill: it MUST surface it as **degraded** on the agent inventory (`GET /v1/agents`, reusing the RFC 0072 §C / RFC 0092 `degraded[]` marker) with a stated reason, and MAY refuse to dispatch it as a skill. This is a `safety-fix`: it tightens the skill role toward the replay-clean contract RFC 0041 already assumes, and leaves `role: "assistant"` (and every absent-role manifest) unchanged.

### Examples

**Skill (inferred; valid).**
```json
{ "agentId": "core.openwop.agents.code-reviewer.default", "persona": "Code Reviewer",
  "systemPromptRef": "prompts/code-reviewer.md",
  "toolAllowlist": ["openwop:core.files.read"],
  "memoryShape": { "scratchpad": true, "conversation": false, "longTerm": false },
  "handoff": { "taskSchemaRef": "schemas/task.json", "returnSchemaRef": "schemas/return.json" } }
```
Inferred `role: "skill"` (has `handoff`); profile satisfied.

**Assistant (explicit).**
```json
{ "agentId": "acme.assistant", "role": "assistant", "persona": "Chief of Staff",
  "memoryShape": { "scratchpad": true, "conversation": true, "longTerm": true } }
```
No `handoff`; conversation + long-term memory are legitimate for an assistant.

**Skill profile violation (degraded).** `role: "skill"` with `memoryShape.longTerm: true` — a host surfaces it `degraded: ["x-openwop.skill-profile.stateful-memory"]`, not plainly runnable.

## Compatibility

`additive` (the optional `role` field — absent ⇒ inferred ⇒ today's behavior; a manifest without `role` stays valid) plus `safety-fix` (the Skill profile's memory constraint, which only tightens the skill role toward the replay-clean contract RFC 0041 already presumes, and touches no `assistant` or absent-role manifest). No required→optional change, no type change, no event-shape change. Per `COMPATIBILITY.md` §2.2 this is a non-breaking extension.

## Conformance

- `agent-manifest-role-shape.test.ts` (always-on): a manifest with `role: "skill"` + `handoff` + scratchpad-only memory validates; `role` outside the enum fails; an absent `role` validates (inference is a host behavior, not a schema requirement).
- `skill-profile-degraded-projection.test.ts` (capability-gated on a `capabilities.agents.roleProfile` advertisement): a seeded `role: "skill"` manifest that declares `longTerm: true` surfaces with a non-empty `degraded[]` on `GET /v1/agents`; a profile-clean skill omits it. Mirrors the RFC 0092 degraded-projection scenario.

## Alternatives considered

- **A new pack *kind* / registry tier (`skill`).** Rejected: a "skill pack" duplicates "agent-pack + `handoff`" — two systems for one concept that will drift; and SKILL.md already normalizes to an agent *manifest*, so the artifact is identical. A `role` on the existing manifest reuses the seam.
- **Host-only marketplace relabel, no wire.** Insufficient alone: leaves the vocabulary ambiguous cross-host and the memory constraint unenforceable off-host. (It is the correct *non-normative first step* — see ADR 0312 Phase 0 in the reference host — but not a substitute for the wire role.)
- **Rename the `core.openwop.agents.*` namespace to `skills.*`.** Rejected here: a breaking registry change; the `role` field + a display alias achieve the distinction without breaking installed pins. A rename waits for a major.

## Unresolved questions

1. **Explicit vs inferred default.** This RFC infers `role` from `handoff` when absent. Should a future minor require `role` explicitly on new manifests (a lint, not a wire break)?
2. **`assistant` vs a third label.** Is `"assistant"` the right term for the top-level role, or should it be `"agent"` (accepting the overloaded word for the composing layer)? 
3. **Crew/multi-agent packs.** A pack shipping several handoff workers (a "crew") is still all-skills; its internal orchestration is an RFC 0037 concern. Confirm no `role` is needed at the *pack* level (it is per-agent).

## Implementation notes (non-normative)

Reference host: ADR 0312 lands the marketplace label (Phase 0, non-normative) and normalizes the drifted worker packs' `memoryShape` to scratchpad-only (Phase 2). This RFC is Phase 1 — the wire `role` + profile — which unblocks a host advertising `capabilities.agents.roleProfile` and the degraded projection.

## Acceptance criteria

- [ ] `schemas/agent-manifest.schema.json` gains the additive optional `role`; a manifest without it stays valid.
- [ ] `spec/v1/agent-runtime.md` (and/or `multi-agent-execution.md`) states the `role` inference rule + the Skill profile (§B) normatively.
- [ ] `agent-manifest-role-shape.test.ts` (always-on) passes non-vacuously.
- [ ] A reference host advertises `capabilities.agents.roleProfile` and passes `skill-profile-degraded-projection.test.ts` under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- [ ] `CHANGELOG.md` + `INTEROP-MATRIX.md` updated.

## References

- RFC 0003 — Agent packs (the agent manifest; `handoff`, `memoryShape`).
- RFC 0022 — Dispatch input/output mapping (handoff invocation).
- RFC 0037 — Multi-agent execution model (composition).
- RFC 0039 — Multi-agent confidence + memory lifecycle (where persistent memory lives).
- RFC 0041 — Multi-agent replay under nondeterminism (the determinism boundary this profile protects).
- RFC 0092 — `AgentManifest.requiresCapabilities` + the degraded projection (the additive-field + degraded precedent this RFC follows).
- ADR 0312 (openwop-app reference host) — Skills vs Agents taxonomy; Phase-0 marketplace label + Phase-2 memory normalization.
