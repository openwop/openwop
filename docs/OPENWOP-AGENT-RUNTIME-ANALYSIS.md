# Deep-dive analysis — agent packs, the runtime gap, and corrections to the handoff

Date: 2026-05-26
Companion to: `docs/OPENWOP-AGENT-RUNTIME-HANDOFF.md`
Status: analysis only — verification of the handoff's claims against `origin/main`. **Not** an approved plan; `/prd` still gates any code (see §F).

## 0. Bottom line

The handoff's central thesis is **correct and well-evidenced**: OpenWOP ships **31 fully-populated agent manifests** across ~24–26 packs, and **no host runtime consumes them** — they are publishable, signable, and listable, but inert. Building that runtime is the right next track.

Two of the handoff's framing claims are **wrong or imprecise in ways that change the plan**, the most consequential being that the runtime capability is *not* undefined — `host.agentRuntime` is **already FINAL normative spec**. This makes the work "implement + schematize an existing contract, plus one real design decision," not "invent and RFC a new capability."

Every claim below was checked against a worktree on `origin/main` (post the #256–#266 cohort).

## A. Handoff claims that verify TRUE

| Claim | Evidence |
|---|---|
| Agent packs are **inert** | `src/packs/tarballLoader.ts:100` and `src/bootstrap/nodePackResolver.ts:33` read only `manifest.nodes`, never `manifest.agents`. No `AgentRegistry` exists (grep across backend: zero hits, vs `getNodeRegistry()` in `src/executor/nodeRegistry.ts`). `src/bootstrap/installRegistryPacks.ts` default-installs only node packs (`core.openwop.ai`, `core.openwop.http`). |
| **31 manifests**, first-class | 24 `packs/core.openwop.agents.*` packs (+1 root primitives pack). 21 singletons + 3 crews (research‑4, support‑3, devops‑3) = 31 manifests. `schemas/agent-manifest.schema.json` (`$id: https://openwop.dev/spec/v1/agent-manifest.schema.json`) enforces required `agentId`/`persona`/`modelClass`, `systemPrompt` XOR `systemPromptRef` (`oneOf`), `toolAllowlist`, `memoryShape`, `handoff` task/return refs, `confidence.defaultThreshold`. 100% schema-compliant. |
| `routes/agents.ts` is **faked** | Returns 3 hard-coded `AGENT_ROLES` filtered by `getNodeRegistry().listTypeIds()`; reads no pack `agents[]`. (Created in PR #262; its docblock has been corrected alongside this doc.) |
| `runs ancestry` mislabels children | `src/routes/runs.ts:474` hard-codes `cause: 'core.subWorkflow'` with a comment admitting the deferral; `src/types.ts RunRecord` carries `parentRunId` but no field for the composition primitive (`core.subWorkflow` vs `core.dispatch`). |
| Cited RFCs are landed | 0002/0003/0004/0006/0007/0037/0039/0040/0059/0061 are all **Accepted**; 0067/0068/0069 are **Draft**. |

## B. Handoff claims that are wrong / imprecise

1. **"`host.agentRuntime` — Not defined, not advertised."** Only half true. It **is defined** — as a **Stable / FINAL v1.1**, RFC‑2119‑clean contract in `spec/v1/host-capabilities.md §host.agentRuntime`: six required methods (`spawn`, `delegate`, `consensus`, `messageSend`, `skillInvoke`, `swarmExecute`), `AgentManifest` references (`manifestId`), `escalationThreshold` per RFC 0007 §F, and defined failure modes (`host_capability_missing`, `agent_not_found`, …). What is actually missing: it is **not in the machine-readable `capabilities.schema.json`** (0 hits), and the demo host has **zero `agentRuntime` references** (unadvertised, unimplemented). Posture: *defined and FINAL, but unschematized and unimplemented* — materially different from "undefined."
2. **"every agent pack peer-depends on `host.agentRuntime`."** 21 of 24. The 3 that don't (`classifier`, `expense-categorizer`, `support-triage`) are exactly the **zero-tool** agents — the peer-dep tracks *tool use*, not agent-ness (consistent with `docs/PACK-CATALOG.md`: "tool-using packs additionally require `host.agentRuntime`").
3. **"RFC 0003 explicitly deferred the runtime contract."** RFC 0003 defines the manifest; it does not contain that deferral. The runtime lives separately in `host-capabilities.md` as a defined-but-unimplemented capability. The deferral is *de facto*, not a documented carve-out.
4. **"RFC 0061 Active."** It is **Accepted** (minor).

## C. Gaps the handoff underweights

1. **The install path would strip the agent's own files.** `src/packs/registryInstaller.ts` allowlists `ALLOWED_FILES = {pack.json, index.mjs}`. So even after parsing `agents[]`, the tarball-relative `systemPromptRef` (`prompts/*.md`) and `handoff.*SchemaRef` (`schemas/*.json`) **would not be extracted**. Resolving those refs is real loader work, not a footnote.
2. **A capability scope-mismatch — a genuine design decision.** A single-agent tool pack (e.g. `code-reviewer`) peer-depends on the **full 6-method swarm/consensus runtime** that `host-capabilities.md` attributes to `vendor.myndhyve.agent-orchestration`. A host should not need `swarmExecute`/`consensus` to run one code-reviewer. This argues for a **lighter capability tier** (e.g. `agents.dispatch`) distinct from the heavyweight `host.agentRuntime`.
3. **21 of 25 agent packs are unpublished** to `registry/v1` (only `agents`, `deep-research`, `react`, `supervisor` are signed). The DoD's "an installed agent pack" implies publishing the rest.
4. **`capabilities.schema.json` does not define `agentRuntime`,** so the machine-readable gate cannot enforce the peer-dep that 21 packs declare — additive schema work.

## D. What the #256–#266 cohort got wrong

- PR #262 (`cli-agents`) reported *"there is no agent-pack concept"* — false; 31 manifests sit in `packs/`. It then shipped a `routes/agents.ts` docblock asserting *"OpenWOP has no `/v1/agents` surface — agents are not a first-class registry,"* which a FINAL capability + 31 manifests contradict. (Corrected in the same PR as this doc.)
- **Root cause:** the gap-analysis scope and the `cli-agents` task pointed at the *node catalog* and the RFC 0037/0040 *event-attribution* model — never at `packs/core.openwop.agents.*` or `host-capabilities.md §host.agentRuntime`. The cohort built agent **surface** (CLI `list/info`, a chat-UI attribution chip) over a runtime that does not exist, and the "don't invent normative surface" rationale obscured the real, already-specified surface.
- **Disposition:** #262 is fine as a *read-only listing* but is a dead-end — it should be **replaced** by a registry-backed inventory once the runtime lands.

## E. Risk assessment for the build

- **Replay determinism (highest).** RFC 0037 + 0061 §C require snapshot-immutable per-iteration inputs (memory / workspace / transcript). Agent dispatch must reproduce deterministically across replay and `POST /v1/runs/{runId}:fork` — taming nondeterministic model output is the reason RFC 0037 exists.
- **BYOK leakage (SR-1).** Credentials must never reach `agent.*` events or handoff payloads.
- **`toolAllowlist` enforcement** at the dispatch→provider boundary (RFC 0002 §A14 `ToolPermissionService.filterTools`).
- **Cross-tenant memory (CTI-1)** when `memoryShape.longTerm: true` — overlaps **Draft RFC 0068** (memory consolidation + standing commitments): coordinate, don't duplicate.
- **The two meanings of `agentRuntime`** (vendor swarm vs core single-agent) must be resolved before peer-dep gating means anything.

## F. Governance read (narrower than handoff §6)

- Implementing `host.agentRuntime` in the reference host is **implementation-only against FINAL spec** — arguably no new *capability* RFC is required for the contract itself.
- What does warrant `/prd`: (a) **lifting `host.agentRuntime` into `capabilities.schema.json`** (additive schema → governance + conformance touch); (b) the **capability-tiering decision** — should a simple agent pack require the full 6-method runtime, or a lighter `agents.dispatch` subset?; (c) **coordinating with Draft RFC 0068** on `longTerm` memory.

## G. Recommended next step

1. `/prd` focused on the **capability-tiering question** + schematizing the existing FINAL `host.agentRuntime` contract.
2. Then `/plan` the phased build: pack loader (incl. the tarball-extraction fix in §C.1) → `AgentRegistry` → real `routes/agents.ts` → dispatch + `toolAllowlist` + handoff validation → conformance gated on the new schema flag → CLI `agents run` → chat `@agent` → fix the ancestry `RunRecord` (§A) so dispatched sub-agents are distinguishable from sub-workflows.

See `docs/OPENWOP-AGENT-RUNTIME-HANDOFF.md` §3–§8 for the loop touch-points and Definition of Done; this doc supersedes its §2 ("`host.agentRuntime` … does not exist") and §6 framing per §B/§F above.
