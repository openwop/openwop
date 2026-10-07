# Why Agents Fail in Production — and Which OpenWOP Surfaces Bound Each Failure

> Informative. A rationale note, not a spec: it uses no RFC 2119 keywords and constrains no implementation. It maps the well-known production failure modes of tool-using AI agents onto the OpenWOP v2 surfaces that bound, observe or fail closed against them. For what OpenWOP is and is not, see [`spec/v2/core/overview.md`](../spec/v2/core/overview.md).

---

## Why this doc exists

An AI agent is three plain parts: a model that reasons, a loop that lets it act and then observe the result, and a growing set of tools — increasingly spoken through MCP. That framing is now widespread, and it is accurate. OpenWOP is the wire contract around the loop: it standardizes how a host starts, streams, interrupts, resumes, replays, bounds, and observes that cycle across independent implementations.

The same framing also explains why agents fail in production. The loop that makes an agent powerful is also what makes it fragile: small per-step error rates **compound** across steps, every lap of the loop **costs tokens**, and a model that can call a tool can be **tricked into calling the wrong one** by poisoned input. None of these are model-quality problems that a bigger model fixes — they are properties of the loop. OpenWOP does not make the model more reliable. It bounds the loop, makes it observable, and forces the irreversible steps through a gate.

This note exists so reviewers and adopters can see, in one place, which existing OpenWOP knob maps to which failure mode — rather than re-deriving it from a dozen RFCs. Nothing here is new surface; every row points at a shipped one.

---

## The failure modes, and the surfaces that bound them

| Production failure mode | What goes wrong | OpenWOP surface that bounds it |
| --- | --- | --- |
| **Runaway loop** — the agent never decides it's done | An open-ended reason→act→observe cycle spins without converging | `maxLoopIterations` run bound ([`runs.md`](../spec/v2/core/runs.md)); a breach emits `cap.breached { kind: 'loop-iterations' }` and fails the run with `loop_limit_exceeded`. Every `runOrchestrator.decided` carries a 1-based `iteration` ([`execution.md`](../spec/v2/core/execution.md) §`multiAgent`). |
| **Hangs / stalls** — a step blocks indefinitely | A tool call or model call never returns | `runTimeoutMs`, clamped to `limits.maxRunDurationMs` ([`runs.md`](../spec/v2/core/runs.md)); a breach fails the run with `run_timeout` |
| **Cost blowout** — every lap drags the whole context | Token spend grows 5–30× a chatbot's; some workflows far more | The `budget` family ([`runs.md`](../spec/v2/core/runs.md)): `budget.reserved` / `budget.consumed` / `budget.threshold-crossed` / `budget.exhausted` + `cap.breached`; per-call accounting via `provider.usage` ([`events.md`](../spec/v2/core/events.md) §`providerUsage`). The budget surface is deliberately content-free and pricing-free (`budget-no-pricing-leak`). |
| **Compounding errors** — 90%-per-step ≈ 35% over ten steps | Each additional step is another chance to be wrong; reliability multiplies downward | Self-correction is first-class, not incidental: confidence-threshold escalation interrupts (RFC 0039 / 0044) and the verifier turn + convergence criteria (`multiAgent.executionModel.version: 6`, [`execution.md`](../spec/v2/core/execution.md) §`multiAgent`) let a run check its own work or escalate instead of confidently emitting a wrong result. |
| **Irreversible action taken autonomously** — money out, data deleted | The model proposes a high-blast-radius tool call and it just fires | The model *proposes*; the host *performs* — that split is the architecture, not an add-on. High-risk steps route through an approval interrupt ([`interrupt.md`](../spec/v2/core/interrupt.md) §"Approval"), which suspends **before** the action and resumes deterministically. A resolver outside the advertised approvers is refused (§"Approver enforcement"); sub-run output merges fail closed on the same gate (`subrun-merge-approval-fail-closed`). |
| **Too-broad toolbox** — "the whole drawer, not a tight box" | An agent with every tool has every way to go wrong | The tool catalog and its session contract scope what's callable ([`tool-catalog.md`](../spec/v2/core/tool-catalog.md)); tool-invocation hooks authorize per call ([`host-services.md`](../spec/v2/core/host-services.md) §`toolHooks`); egress policy gates where tool output may go (`egress-credential-audience-bound`). |
| **Prompt injection** — poisoned input redirects the agent | Hostile user text, a poisoned knowledge base, or a malicious tool/MCP response tricks the model into the wrong call | [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) + invariants: external content carries `contentTrust: "untrusted"` markers (`prompt-injection-{input,kb,artifact,mcp}-marker`), and — critically — untrusted tool/MCP output **cannot** advance an approval gate (`prompt-injection-mcp-no-approval`). RFC 0099 extends the same untrusted-by-default rule to external event triggers. |
| **Many-tool / many-agent integration sprawl** — N×M brittle glue | Hand-written connectors per (agent, tool) pair don't scale | OpenWOP composes the relevant standards rather than re-inventing them: MCP for the tool surface and A2A for inter-agent exchange, both as compositions over the REST wire ([`interop.md`](../spec/v2/core/interop.md)). See [`docs/integrations/mcp.md`](./integrations/mcp.md) for how the surfaces line up. |

---

## What this implies for adopters

- **Fencing is configuration, not custom code.** Every lever a production team reaches for — cap the steps, cap the time, cap the dollars, gate the irreversible action, narrow the toolbox — is an existing OpenWOP surface with a defined wire shape and a conformance scenario, not something each host re-invents.
- **The failure modes are loop properties, so the bounds live on the loop.** Iteration count, wall-clock, and budget are orthogonal dimensions (the budget surface has no iteration or time dimension by design); a host can breach any one independently and the others keep accounting.
- **OpenWOP's job is to bound and observe, not to make the model smart.** The compounding-error and cost curves are real and don't go away with a better model. What the protocol guarantees is that when a run goes long, costs too much, or tries something irreversible, that fact is observable on the event stream and — for the irreversible case — stopped at a fail-closed gate.

For what the protocol does **not** yet prove, see [`KNOWN-LIMITS.md`](./KNOWN-LIMITS.md).
