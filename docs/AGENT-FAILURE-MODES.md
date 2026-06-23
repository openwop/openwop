# Why Agents Fail in Production — and Which OpenWOP Surfaces Bound Each Failure

> **Status: Non-normative (2026-06-23).** A rationale note, not a spec. Zero RFC 2119 keywords by design — this document doesn't constrain any conforming implementation; it maps the well-known production failure modes of tool-using AI agents onto the OpenWOP surfaces that already exist to bound, observe, or fail-closed against them. Graduated per GOVERNANCE.md "non-normative addition" rule. See `spec/v1/auth.md` for the status legend, and `spec/v1/positioning.md` for what OpenWOP is and is not.

---

## Why this doc exists

An AI agent is three plain parts: a model that reasons, a loop that lets it act and then observe the result, and a growing set of tools — increasingly spoken through MCP. That framing is now widespread, and it is accurate. OpenWOP is the wire contract around the loop: it standardizes how a host starts, streams, interrupts, resumes, replays, bounds, and observes that cycle across independent implementations.

The same framing also explains why agents fail in production. The loop that makes an agent powerful is also what makes it fragile: small per-step error rates **compound** across steps, every lap of the loop **costs tokens**, and a model that can call a tool can be **tricked into calling the wrong one** by poisoned input. None of these are model-quality problems that a bigger model fixes — they are properties of the loop. OpenWOP does not make the model more reliable. It bounds the loop, makes it observable, and forces the irreversible steps through a gate.

This note exists so reviewers and adopters can see, in one place, which existing OpenWOP knob maps to which failure mode — rather than re-deriving it from a dozen RFCs. Nothing here is new surface; every row points at a shipped one.

---

## The failure modes, and the surfaces that bound them

| Production failure mode | What goes wrong | OpenWOP surface that bounds it |
| --- | --- | --- |
| **Runaway loop** — the agent never decides it's done | An open-ended reason→act→observe cycle spins without converging | `maxLoopIterations` run-execution bound (RFC 0058); breach emits `loop_limit_exceeded` + `cap.breached { kind: 'loop-iterations', limit, observed }`. At `multiAgent.executionModel.version: 5` the per-turn counter is observable on `runOrchestrator.decided.iteration` (RFC 0061). |
| **Hangs / stalls** — a step blocks indefinitely | A tool call or model call never returns | `runTimeoutMs` wall-clock bound (RFC 0058) |
| **Cost blowout** — every lap drags the whole context | Token spend grows 5–30× a chatbot's; some workflows far more | Budget / quota / cost policy (RFC 0084): `budget.reserved` / `budget.consumed` / `budget.threshold` / `budget.exhausted` + `cap.breached`; per-call accounting via `provider.usage` (RFC 0026). The budget surface is deliberately content-free and pricing-free (`budget-no-pricing-leak`). |
| **Compounding errors** — 90%-per-step ≈ 35% over ten steps | Each additional step is another chance to be wrong; reliability multiplies downward | Self-correction is first-class, not incidental: confidence-threshold escalation interrupts (RFC 0039 / 0044) and the verifier turn + convergence criteria (`multiAgent.executionModel.version: 6`, RFC 0090) let a run check its own work or escalate instead of confidently emitting a wrong result. |
| **Irreversible action taken autonomously** — money out, data deleted | The model proposes a high-blast-radius tool call and it just fires | The model *proposes*; the host *performs* — that split is the architecture, not an add-on. High-risk steps route through the `interrupt` primitive (`kind: 'approval'`, Stable) and the `core.openwop.governance.approvalGate` node (RFC 0051), which suspends **before** the action, enforces `requiredRole` / `requiredScope` fail-closed, and resumes deterministically. Approver routing is portable (RFC 0104); sub-run output merges fail closed on the same gate (`subrun-merge-approval-fail-closed`). |
| **Too-broad toolbox** — "the whole drawer, not a tight box" | An agent with every tool has every way to go wrong | Portable Tool Catalog + session contract scopes what's callable (RFC 0078); per-tool authorization via tool-invocation hooks (RFC 0064); credential-provenance + egress policy gates where tool output may go (RFC 0079, incl. `egress-credential-audience-bound`). |
| **Prompt injection** — poisoned input redirects the agent | Hostile user text, a poisoned knowledge base, or a malicious tool/MCP response tricks the model into the wrong call | `SECURITY/threat-model-prompt-injection.md` + invariants: external content carries `contentTrust: "untrusted"` markers (`prompt-injection-{input,kb,artifact,mcp}-marker`), and — critically — untrusted tool/MCP output **cannot** advance an approval gate (`prompt-injection-mcp-no-approval`). RFC 0099 extends the same untrusted-by-default rule to external event triggers. |
| **Many-tool / many-agent integration sprawl** — N×M brittle glue | Hand-written connectors per (agent, tool) pair don't scale | OpenWOP composes the relevant standards rather than re-inventing them: MCP for the tool surface (`spec/v1/mcp-integration.md`, RFC 0020), A2A for inter-agent exchange (`spec/v1/a2a-integration.md`, RFC 0100 for async/durable handoffs). See `spec/v1/positioning.md` §"Standards composition matrix" for the do-not-duplicate posture. |

---

## What this implies for adopters

- **Fencing is configuration, not custom code.** Every lever a production team reaches for — cap the steps, cap the time, cap the dollars, gate the irreversible action, narrow the toolbox — is an existing OpenWOP surface with a defined wire shape and a conformance scenario, not something each host re-invents.
- **The failure modes are loop properties, so the bounds live on the loop.** Iteration count, wall-clock, and budget are orthogonal dimensions (the budget surface has no iteration or time dimension by design); a host can breach any one independently and the others keep accounting.
- **OpenWOP's job is to bound and observe, not to make the model smart.** The compounding-error and cost curves are real and don't go away with a better model. What the protocol guarantees is that when a run goes long, costs too much, or tries something irreversible, that fact is observable on the event stream and — for the irreversible case — stopped at a fail-closed gate.

For the deliberately-disagreeable catalog of what the protocol does **not** yet prove, see `docs/KNOWN-LIMITS.md`.
