# RFC 0131: Agent-manifest `role` and the Skill profile

| Field             | Value |
| ----------------- | ----- |
| **RFC**           | 0131 |
| **Title**         | Distinguish a composable, task-scoped **Skill** from a top-level **assistant** agent, first-class on the agent manifest — an additive optional `AgentManifest.role` plus a schema-encoded **Skill profile** (a `role:"skill"` manifest MUST declare `handoff` and constrain `memoryShape` to scratchpad-only) that keeps sub-agent dispatch stateless and replay-clean |
| **Status**        | `Draft` |
| **Author(s)**     | David Tufts (@davidscotttufts) |
| **Created**       | 2026-07-07 |
| **Updated**       | 2026-07-07 (`Draft` — revised per steward review: `role` is **explicit opt-in** (absent ⇒ unconstrained, no inference-from-`handoff`); the Skill profile is a **JSON-Schema `if/then` validation reject**, not a `degraded[]` projection — `degraded[]` keeps its RFC 0072 §C "host lacks a capability" meaning) |
| **Affects**       | `schemas/agent-manifest.schema.json` (additive optional `role` + a conditional `if role==="skill"` subschema) · `spec/v1/agent-runtime.md` (the `role` field + the Skill profile) / `spec/v1/agent-memory.md` (the `memoryShape` constraint) · `SECURITY/invariants.yaml` (the reject invariant) · conformance scenarios · SDKs · `CHANGELOG.md` · `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` (the optional `role` field) + `safety-fix` (the Skill profile — a schema conjunction that binds **only** manifests that opt in with `role:"skill"`, of which there are zero today) |
| **Supersedes**    | — |
| **Superseded by** | — |

## Summary

The agent manifest (RFC 0003) describes both **composable, task-scoped worker agents** (invoked as a `handoff` task→return capability; e.g. code-reviewer, invoice-extractor) and **top-level assistant agents** (conversational orchestrators a client talks to) with the **same shape and the same word — "agent".** Nothing on the wire distinguishes them, so a host, client, or marketplace cannot tell "a capability an orchestrator delegates to" from "an agent you converse with."

This RFC makes the distinction first-class: an **additive optional** `AgentManifest.role` (`"skill" | "assistant"`). **Absent `role` is unconstrained** — the manifest keeps today's exact meaning and is bound by no profile. A manifest **opts in** to the **Skill profile** by declaring `role: "skill"`, which — encoded as a JSON-Schema conditional — then MUST declare `handoff` and MUST constrain `memoryShape` to scratchpad only (no `conversation`, no `longTerm`). The profile is what makes a skill a **stateless, composable, replay-clean capability**; conversation and long-term memory are properties of the composing *assistant/roster* agent (RFC 0039), and a worker that carries them is a stateful principal that undermines replay determinism (RFC 0041). Because the constraint is a schema conjunction, a violating skill manifest **fails validation at publish/install** — deterministically, with no capability advertisement and no runtime host behavior to discover.

## Motivation

1. **"Agent" is overloaded across two wire-distinct things.** `AgentManifest` (RFC 0003, `agent-manifest.schema.json`) carries `persona`, `toolAllowlist`, `memoryShape`, `confidence`, `handoff`, `requiresCapabilities` — the *same* fields whether the manifest is a one-shot worker invoked via `handoff` (RFC 0022 dispatch I/O; RFC 0037 multi-agent execution) or a conversational assistant. A client selecting an agent, a builder wiring a sub-agent into a workflow, and a marketplace labeling a pack all need to know *which kind* this is — from the manifest, not by heuristic.

2. **`handoff` is an interop contract, not a role signal.** `handoff` pins a typed `taskSchemaRef`/`returnSchemaRef` entry contract; the schema itself notes that shipping *without* it is weaker for cross-host interop. A top-level **assistant** can and should ship `handoff`. So role cannot be *inferred* from `handoff` presence — the two are orthogonal. Role must be stated explicitly.

3. **The industry is standardizing on "Agent Skills."** SKILL.md (open standard, Dec 2025) packages a reusable capability; reference hosts already normalize SKILL.md → an OpenWOP agent manifest. OpenWOP has the concept but not the vocabulary — a skill and a worker agent pack are the *same artifact* today, unlabeled.

4. **Composable workers must stay replay-clean.** RFC 0041 (multi-agent replay under nondeterminism) requires a dispatched sub-agent's result to be a recorded fact. A worker that accumulates `longTerm` memory across invocations, or holds a multi-turn `conversation`, is a stateful principal — its behavior depends on history the caller didn't hand it, blurring the pure task→return contract. The profile removes that hazard for the skill role.

The spec is the right place because this is a **cross-host interop + vocabulary** concern: the *declaration* "this manifest is a skill" and its *behavioral floor* must mean the same thing on every host. Per-host implementation is unchanged; this standardizes the declaration + the profile, additively.

## Proposal

### §A — `AgentManifest.role` (additive optional; explicit, never inferred)

Add to `schemas/agent-manifest.schema.json`:

```json
"role": {
  "type": "string",
  "enum": ["skill", "assistant"],
  "description": "The manifest's kind — EXPLICIT, never inferred from other fields. `skill`: a composable, task-scoped capability invoked via `handoff` (task→return) and composed by an assistant/roster agent — stateless and replay-clean (see the Skill profile, which the value opts into). `assistant`: a top-level conversational agent a client talks to and that composes skills. OPTIONAL; when ABSENT the manifest is UNCONSTRAINED — no profile binds it and its meaning is exactly today's."
}
```

- **Explicit, never inferred.** Absent `role` ⇒ the manifest is unconstrained (today's behavior, unchanged). `handoff` presence does NOT imply `skill` — an assistant may carry a typed entry contract.
- `role` is **advisory about kind**, never a grant of authority — it does not widen `toolAllowlist`, `requiresCapabilities`, or any scope.

### §B — The Skill profile (a JSON-Schema conditional; validation-enforced)

The Skill profile is encoded **in `agent-manifest.schema.json` itself** as a conditional subschema — so a manifest that opts in with `role: "skill"` but violates it **fails schema validation** (the same deterministic gate an RFC 0003 §C malformed manifest hits at publish/install), with **no capability advertisement and no runtime host behavior**:

```json
"allOf": [
  {
    "if":   { "properties": { "role": { "const": "skill" } }, "required": ["role"] },
    "then": {
      "required": ["handoff"],
      "properties": {
        "memoryShape": {
          "properties": {
            "conversation": { "const": false },
            "longTerm":     { "const": false }
          }
        }
      }
    }
  }
]
```

Normatively, a `role: "skill"` manifest MUST:
1. **declare `handoff`** — a skill is invoked as a task→return capability (RFC 0003 `handoff.taskSchemaRef`/`returnSchemaRef`; RFC 0022 dispatch);
2. **constrain `memoryShape ≤ scratchpad`** — `conversation` and `longTerm` MUST be `false` or absent; `scratchpad` MAY be `true`. Persistent and multi-turn memory belong to the composing assistant/roster agent (RFC 0039), not the worker;
3. **hold no standing identity or side-channels** — no roster presence, knowledge-base binding, or schedule (none of which are manifest fields; they are host/roster concerns). A skill receives context via its `handoff` task input and reaches credentials only through allowlisted tools.

A registry/host validating the manifest against the schema **MUST reject** a `role:"skill"` manifest that violates (1) or (2) at publish/install — it is an internally-contradictory (malformed) manifest, an *author error*, not a runtime condition. This does **not** use, extend, or overload the RFC 0072 §C `degraded[]` inventory marker (whose sole meaning stays "the host lacks a capability a well-formed agent optionally wants"). No `capabilities.*` advertisement is introduced — schema validation is universal, so "is the profile enforced?" is never a per-host discoverability question.

### Examples

**Skill (explicit; valid).**
```json
{ "agentId": "core.openwop.agents.code-reviewer.default", "role": "skill", "persona": "Code Reviewer",
  "systemPromptRef": "prompts/code-reviewer.md", "toolAllowlist": ["openwop:core.files.read"],
  "memoryShape": { "scratchpad": true, "conversation": false, "longTerm": false },
  "handoff": { "taskSchemaRef": "schemas/task.json", "returnSchemaRef": "schemas/return.json" } }
```

**Assistant with a handoff contract (valid).**
```json
{ "agentId": "acme.assistant", "role": "assistant", "persona": "Chief of Staff",
  "memoryShape": { "scratchpad": true, "conversation": true, "longTerm": true },
  "handoff": { "taskSchemaRef": "schemas/ask.json", "returnSchemaRef": "schemas/reply.json" } }
```
An assistant MAY ship `handoff` for cross-host interop; its conversation + long-term memory are legitimate. **No profile binds it** — `role` is not `skill`.

**No `role` (unconstrained; valid).** A manifest omitting `role` — with or without `handoff`, with any `memoryShape` — is exactly as valid as today. Nothing reclassifies it.

**Skill profile violation (schema-invalid).** `role: "skill"` with `memoryShape.longTerm: true` **fails schema validation** — it cannot be published or installed. Not a runtime degrade.

## Compatibility

`additive` (the optional `role` field — absent ⇒ unconstrained ⇒ byte- and behavior-identical to today; a manifest without `role` stays valid) plus `safety-fix` (the §B conditional binds **only** manifests that opt in with `role:"skill"` — of which there are **zero** on the wire today, since the field is new — so no existing manifest changes classification or validity). No required→optional change, no type change, no event-shape change, and no reuse/overload of the RFC 0072 `degraded[]` semantics. Per `COMPATIBILITY.md` §2.2 this is a non-breaking extension. (The earlier inference-from-`handoff` design — rejected below — would have silently bound pre-existing assistants to §B; the explicit opt-in is what keeps §B a clean safety-fix.)

## Conformance

- `agent-manifest-role-profile.test.ts` (always-on, schema-level — no capability gate): a `role:"skill"` manifest with `handoff` + scratchpad-only memory **validates**; a `role:"skill"` manifest with `memoryShape.longTerm: true` (or missing `handoff`) **fails validation**; a `role:"assistant"` manifest with `conversation`+`longTerm` (and optionally `handoff`) **validates**; a manifest with **no `role`** and any `memoryShape` **validates** (unconstrained); `role` outside the enum fails.
- **SECURITY invariant** (`SECURITY/invariants.yaml`): a `role:"skill"` manifest carrying `conversation`/`longTerm` memory is not publishable/installable — the schema conjunction is the enforcing gate; the always-on test above is its public witness.

## Alternatives considered

- **Infer `role` from `handoff` presence (the original draft).** REJECTED: `handoff` is an interop contract orthogonal to composition role — an assistant may ship it. Inference would reclassify existing assistants as skills and retroactively bind them to §B (flipping any with `conversation`/`longTerm` memory to invalid), i.e. a silent, coordinated migration masquerading as additive. Explicit opt-in decouples the two compat classes so §A stays purely additive and §B applies only where opted in.
- **Enforce §B as a runtime `degraded[]` projection.** REJECTED: RFC 0072 §C fixes `degraded[]` to one meaning — the host lacks a capability a well-formed agent optionally wants — and would need a discoverable `capabilities.*` enforcement advert. A skill with `conversation` memory is a *malformed manifest* (author error), better caught by schema validation at publish/install than surfaced as a runtime tier.
- **A new pack *kind* / registry tier (`skill`).** REJECTED: a "skill pack" duplicates "agent-pack + `handoff`" — two systems for one concept; SKILL.md already normalizes to an agent *manifest*, so the artifact is identical. `role` reuses the existing manifest seam (composes RFC 0003/0022/0037/0039/0041).
- **Rename the `core.openwop.agents.*` namespace to `skills.*`.** REJECTED here: a breaking registry change; `role` + a display alias achieve the distinction without breaking installed pins. A rename waits for a major.

## Unresolved questions

*(The three original open questions are resolved per the steward review.)*
1. **Default — RESOLVED: explicit, never inferred.** Absent `role` = unconstrained; `role:"skill"` opts in.
2. **Enum — RESOLVED: `["skill","assistant"]`, optional, absent = unconstrained.** `agent` is not an enum value (that is the overloaded word the RFC removes).
3. **Scope — RESOLVED: per-*agent*.** `role` is on the `AgentManifest` (agentId-scoped), like `memoryShape`/`handoff`. A crew pack ships several skill agents; internal orchestration is an RFC 0037 concern.
4. **Open:** should a future minor *lint* new manifests to require an explicit `role` (a publish-time nudge, not a wire break)?

## Implementation notes (non-normative)

Reference host: ADR 0312 lands the marketplace label (Phase 0, non-normative — it labels a pack a "Skill" when its agents are all handoff-workers) and normalizes the drifted worker packs' `memoryShape` to scratchpad-only (Phase 2). This RFC is Phase 1 — the wire `role` + the schema-encoded profile. Because §B is schema validation (not a runtime tier), a host needs no new advertisement to be conformant; the reference host's Phase-2 packs will simply add `role:"skill"` and already satisfy the profile.

## Acceptance criteria

- [ ] `schemas/agent-manifest.schema.json` gains the additive optional `role` **and** the `if role==="skill"` conditional (§B); a manifest without `role` stays valid.
- [ ] `spec/v1/agent-runtime.md` (the field) + `spec/v1/agent-memory.md` (the memory constraint) state the Skill profile normatively; no `degraded[]` change.
- [ ] `SECURITY/invariants.yaml` row for the skill-profile reject.
- [ ] `agent-manifest-role-profile.test.ts` (always-on) passes non-vacuously (validate + reject cases above).
- [ ] `CHANGELOG.md` + `INTEROP-MATRIX.md` updated.

## References

- RFC 0003 — Agent packs (the agent manifest; `handoff`, `memoryShape`, §C malformed-manifest reject).
- RFC 0022 — Dispatch input/output mapping (handoff invocation).
- RFC 0037 — Multi-agent execution model (composition).
- RFC 0039 — Multi-agent confidence + memory lifecycle (where persistent memory lives).
- RFC 0041 — Multi-agent replay under nondeterminism (the determinism boundary the profile protects).
- RFC 0072 §C — the `degraded[]` inventory marker (whose "host lacks a capability" meaning this RFC deliberately does NOT overload).
- RFC 0092 — `AgentManifest.requiresCapabilities` (the additive-optional-field precedent).
- ADR 0312 (openwop-app reference host) — Skills vs Agents taxonomy; Phase-0 marketplace label + Phase-2 memory normalization.
