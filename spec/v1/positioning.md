# openwop Spec v1 — Positioning

> **Status: FINAL v1 (2026-05-05).** Honest comparison of openwop against adjacent workflow / orchestration ecosystems. Non-normative — this document doesn't constrain any conforming implementation (zero RFC 2119 keywords by design). Graduated DRAFT → FINAL per GOVERNANCE.md "non-normative addition" rule (one-maintainer-approval direct merge); the doc has no MUST/SHOULD/MAY claims to lock. See `auth.md` for the status legend.

---

## What openwop is

openwop is **an open protocol for portable, durable, AI-native workflow execution across hosts.**

Concretely: openwop standardizes how independent systems define, start, stream, interrupt, resume, replay, validate, and observe durable workflows that include LLM-emitted structured envelopes, human-in-the-loop checkpoints, and conformance-tested cross-host behavior.

## What openwop is not

- A general-purpose batch-job orchestrator. Use Airflow, Argo, or your cloud's batch service.
- A durable-execution runtime SDK. Use Temporal or AWS Step Functions for that level of operational maturity.
- A BPMN-style enterprise process modeling notation. Use BPMN where governance + tooling weight matters.
- A LangChain replacement. Use LangChain or LangGraph for application-level LLM orchestration when host portability isn't a goal.
- A workflow framework. OpenWOP is the wire contract; engines implement that contract.

## Why this doc exists

`the public security review plan` (B- / 82) graded openwop's competitive differentiation as B+, with the warning: "If positioned as a universal workflow engine, openwop will be compared unfavorably to mature incumbents." This document positions openwop precisely so reviewers don't pattern-match it into the wrong category.

---

## Comparison table

| System | Strength | openwop comparison |
|---|---|---|
| **Temporal** | Durable execution runtime; production-mature retries, signals, timers, task queues | Temporal is a runtime; openwop is a protocol. openwop can run on Temporal-backed hosts; the two are complementary, not competing. |
| **Apache Airflow** | Scheduled batch data pipelines; mature ecosystem; cron-driven | openwop is interactive + AI-mediated, not scheduled batch. openwop is not a better Airflow. |
| **Argo Workflows** | Kubernetes-native parallel jobs; container workflows | Argo is k8s-native + container-centric. openwop is host-neutral and AI-aware but much less battle-tested for container orchestration. |
| **AWS Step Functions** | Enterprise trust; AWS-service integrations; ASL state-machine clarity | Step Functions is AWS-distribution and ASL-locked. openwop competes only on portability + AI-native semantics + host neutrality. |
| **BPMN / OMG** | Standards legitimacy; enterprise process-modeling depth; governance history | BPMN is enterprise-standard for human-process modeling. openwop is API/AI-native but lacks BPMN's neutral-standardization weight. |
| **LangGraph** | Closest conceptual competitor in agent-workflow land; durable execution + HITL primitives | LangGraph is a framework. openwop is a protocol + conformance suite. openwop can host LangGraph-built workflows; LangGraph can be a client of an OpenWOP host. |
| **Model Context Protocol (MCP)** | Standardizes tool/resource/prompt access for LLM apps | **Complementary, not competing.** MCP standardizes what tools an LLM can call; openwop standardizes how multi-step LLM workflows run, pause, resume, stream, and validate. Worked example in `mcp-integration.md`. |
| **Agent2Agent Protocol (A2A)** | Standardizes inter-agent discovery + message exchange (Agent Cards, Tasks, Skills) | **Complementary, not competing.** A2A standardizes how independent agents talk to each other; openwop standardizes how a workflow runs *inside* one agent. An OpenWOP host can expose itself as an A2A agent (Workflow → Skill, run → Task); an OpenWOP node can call out to an external A2A agent. Worked example + openwop↔A2A state-projection table in `a2a-integration.md`. |

---

## When to choose openwop

Use openwop when:

- **You need portable AI workflows.** Workflows that can run on multiple hosts (your dev box, your prod cluster, a vendor's managed runtime) without vendor lock-in.
- **You need durable LLM-mediated workflows.** Multi-step LLM execution with structured envelope outputs, human approval checkpoints, refine-feedback loops.
- **You need cross-host interop.** Independent implementations of "the same protocol" that produce comparable behavior — verifiable via the conformance suite.
- **You need standardized observability + replay.** A debug bundle from one host can be ingested by tooling built for another.
- **You want pack-style extensibility.** Workspace operators install signed node packs from a registry; the trust model is part of the protocol.

## When NOT to choose openwop

Use something else when:

- **You're orchestrating non-LLM batch data pipelines.** Airflow / Argo / native cron is better suited.
- **You need a durable-execution runtime with deep production maturity TODAY.** Temporal has a decade of production hardening; openwop has months. Run openwop on top of Temporal where you can.
- **You're running a single-host application that doesn't need cross-host portability.** A framework (LangGraph, LangChain) is lower-overhead than implementing a protocol.
- **Your enterprise compliance posture requires BPMN + an OMG-recognized standardization body.** openwop's governance is documented but not yet at OMG-class neutrality.
- **You need scheduled/cron-driven execution.** openwop is request-driven; scheduling is a host concern, not protocol-defined.

---

## How openwop integrates with the alternatives

### With MCP (Model Context Protocol)

OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside that workflow. An OpenWOP node that needs to "search the web" or "read a file" calls an MCP tool from a registered MCP server. openwop's wire contract advertises MCP-compatibility via `capabilities.mcp` (host-implementation-defined).

See `spec/v1/mcp-integration.md` for the worked example.

### With Temporal / durable-execution runtimes

An OpenWOP host can be implemented on top of Temporal. The host's HTTP layer accepts openwop requests; the host's worker translates each openwop run into a Temporal workflow execution. The Temporal `WorkflowID` corresponds to the openwop `runId`; signals translate to interrupt resolutions; activities translate to node executions.

This gives you Temporal's durability + openwop's portable contract. The example hosts use simpler in-process executors; a Temporal-backed host is a viable independent implementation pattern.

### With LangGraph

A LangGraph application can run inside an OpenWOP node — the LangGraph runtime executes inside `core.langgraph` (a vendor-prefixed node type) and emits envelopes that the openwop engine validates. Conversely, an OpenWOP-compliant host can be the durable backend that LangGraph delegates to for cross-host portability.

### With BPMN

A BPMN process model can be compiled into an OpenWOP `WorkflowDefinition`. The BPMN human-task element becomes an OpenWOP `interrupt` of kind `approval`; BPMN service tasks become OpenWOP nodes. The resulting workflow runs against any OpenWOP host. The BPMN-to-openwop compiler is out of scope for the protocol; the wire contracts make it possible.

### With Step Functions / cloud-vendor orchestrators

An OpenWOP host can be implemented on top of Step Functions. The openwop HTTP surface dispatches each `POST /v1/runs` to a Step Functions execution; events are aggregated from the Step Functions execution log into the openwop event stream. This lets a workspace use Step Functions for billing/operability while exposing the openwop wire contract for client portability.

---

## What openwop solves especially well

The fit-with-problem statement: **"How do independent systems define, start, stream, interrupt, resume, replay, validate, and observe durable AI workflows?"**

In practice, openwop's strongest claims are:

- LLM-driven workflows with structured envelopes (`prd.create` / `theme.create` / `tasks.create` / `clarification.request` / etc.).
- Human approval, clarification, and refinement checkpoints with normative resume semantics.
- Host-neutral workflow execution APIs that two independent hosts can pass the same conformance suite against.
- Conformance-tested protocol behavior, not just framework convention.
- Node-pack extensibility with signing + workspace approval + sandboxed execution.
- Separating protocol semantics from product concepts (host product extensions sit cleanly above the protocol; see `host-extensions.md`).
- Multi-transport ambitions across REST, SSE, MCP, and A2A-style surfaces.

---

## What openwop is underdeveloped at

Honest about gaps (per `the public security review plan`):

- **Standardization maturity.** Governance currently lives in `github.com/openwop/openwop`; migration to a vendor-neutral org is roadmapped, not scheduled.
- **Independent implementations.** As of 2026-05-10: two public reference hosts under `examples/hosts/` (in-memory + SQLite). Cross-vendor interop is not yet evidence-tested at scale.
- **Runtime guarantees.** Public scalability + SLA language is sharper than v1 but not yet at Temporal/Step-Functions enterprise depth.
- **External security review.** Threat models published; commissioned third-party audit gated on governance maturity per `ROADMAP.md`.

These are documentation + ecosystem maturity gaps, not architectural ones.

---

## Recommended public message

```text
openwop is an open protocol for defining, running, streaming, interrupting,
replaying, and validating durable AI workflows across hosts.
```

NOT:

```text
openwop is the universal replacement for Temporal, Airflow, Argo, BPMN, and
Step Functions.
```

Avoiding the second framing avoids a comparison test openwop isn't ready to win and that doesn't represent the actual differentiation.

---

## See also

- `spec/v1/mcp-integration.md` — worked example of OpenWOP + MCP composition.
- `spec/v1/host-extensions.md` — protocol core vs host-specific extensions distinction.
- `INTEROP-MATRIX.md` — cross-host conformance pass record.
- `ROADMAP.md` — v1.x and post-v1 ecosystem roadmap.
