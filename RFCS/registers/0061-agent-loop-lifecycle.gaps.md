# RFC 0061 — Gap Register

Companion to [`RFCS/0061-agent-loop-lifecycle.md`](../0061-agent-loop-lifecycle.md). Open questions / deferred decisions / missing inputs beyond the in-template Unresolved questions.

> **Location note:** under `RFCS/registers/` (not `RFCS/0061-*.gaps.md`) because the protocol-status RFC counter (`scripts/generate-protocol-status.mjs`, regex `^RFCS/\d{4}-.+\.md$`) would otherwise miscount it as an RFC.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | §E / Compatibility | **RFC 0058 gating correction.** RFC 0058 (committed `37de47c`, pushed) gates `maxLoopIterations` on the nonexistent `capabilities.agents.loop.supported`. The reframe makes the correct gate `capabilities.multiAgent.executionModel.supported` (orchestrator turns exist at `version >= 1`). Must update `run-options.md` row, RFC 0058 text, and `run-execution-bounds-shape.test.ts`. | Spec Architect | Small companion edit; apply when this RFC's framing is accepted. | Cohort consistency / `Active` |
| G2 | CHANGELOG / README | The cohort CHANGELOG bullet for 0061 still describes the superseded `agents.loop` + `agent.loop.iterated` surface. Update to the `version: 5` framing. | Spec Architect | One-line CHANGELOG edit. | Doc consistency |
| G3 | §C.3 | "Recent transcript" window is undefined (fixed event count / token budget / host-advertised). Proposed `executionModel.transcriptWindow`. | Spec Architect | Decision before `Active`. | Schema finalization |
| G4 | §D | Is `statefulResume` a distinct claim from RFC 0037's replay re-entrancy, or implied? Proposed distinct (live HITL suspend vs. deterministic replay of a completed prefix). | Conformance Architect | Confirm separability in a conformance scenario. | `Active` |
| G5 | §C.2 | Workspace-write vs. memory-write visibility ordering when a single turn writes both — confirm RFC 0059 workspace follows RFC 0039's "visible next turn, never retroactively" rule with no new race. | Schema + Spec | Cross-check with RFC 0059 author. | `Active` |
| G6 | §A | Does `version: 5` need a paired `multiAgent.executionModel` documentation row in `multi-agent-execution.md`'s version table (currently lists 1–4)? Yes — must extend the table. | Spec Architect | Editorial, lands with spec text. | Spec text merge |
| G7 | Implementation | `apps/workflow-engine` executor must surface the iteration counter + workspace snapshot load; depends on RFC 0059 landing for the workspace half. Counter + stateful-resume half are 0059-independent and implementable now. | Implementer | Sequence after 0059. | `Accepted` |
