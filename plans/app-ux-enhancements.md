# Reference-App UX Enhancements

> **Scope:** the reference workflow-engine app at [`apps/workflow-engine/`](../apps/workflow-engine/) (deployed as `app.openwop.dev`). This is **sample / template code**, not the protocol and not the production Postgres host. Recommendations here build on what already ships and enhance UX; none require breaking the frozen v1 wire contract.
> **Companion RFCs:** [`RFCS/0055`](../RFCS/0055-multimodal-envelope-variants-and-rendering-hints.md) (multimodal rendering) and [`RFCS/0056`](../RFCS/0056-run-feedback-and-annotation-event.md) (feedback/annotation) — the only two protocol additions these recommendations lean on. Everything in Track A needs neither.
> **Design source of truth:** [`DESIGN.app.md`](../DESIGN.app.md). All new UI uses its tokens/components — no hard-coded colors, spacing, or type. User-facing copy spells out "server"/"frontend" etc. per the no-jargon rule.
> **Derived from:** the 2026-05-25 deep-dive of the "OpenWOP Expansion PRD" — which proposed 15 app features, ~8 of which already exist here in whole or part. This plan distinguishes *finish/strengthen* from *net-new*.

---

## 0. What the app already has (baseline — don't rebuild)

The PRD's §7 reads as if the app is greenfield. It isn't. Current frontend surface (`apps/workflow-engine/frontend/react/src/`):

| Surface | Files | PRD §7 equivalent |
|---|---|---|
| Visual workflow builder (DAG, branch/merge, triggerRules, inspector) | `builder/` | 7.1 Visual Workflow Builder ✅ |
| Run timeline / agent trace / handoff map | `runs/RunTimeline.tsx`, `RunAgentTrace.tsx`, `RunHandoffMap.tsx` | 7.2 Command Center · 7.4 Debugging Studio (partial) |
| Protocol packet inspector | `devtools/NetworkPanel.tsx`, `networkRecorder.ts` | 7.5 Packet Inspector ✅ |
| HITL approval inbox | `runs/HitlInboxPage.tsx` | 7.9 Approval Queues ✅ |
| Replay / fork + run compare | `runs/RunDetailPage.tsx`, `RunComparePage.tsx` | 7.12 Replay Engine ✅ |
| Cost panel | `runs/RunCostPanel.tsx` | 7.14 Analytics (partial) |
| Capabilities discovery panel | `discovery/CapabilitiesPanel.tsx` | 6.4 / capability UX ✅ |
| Pack browser | `registry/PackBrowser.tsx` | 7.6 Marketplace (partial) |
| Chat + reasoning/envelope inspection | `chat/` (MessageRenderer, EnvelopeInspector, ReasoningDisclosure) | 7.4 / 7.11 (partial) |
| BYOK key wizard + policy explainer | `byok/` | secrets UX ✅ |
| MCP tools panel | `mcp/McpToolsPanel.tsx` | 7.11 IDE integration (partial) |
| Prompt library | `prompts/PromptLibraryPage.tsx` | prompt UX ✅ |

**The job is to deepen these, not start over.** Recommendations below are sorted by protocol dependency.

---

## Track A — Buildable now on the frozen v1 protocol (no RFC)

These need **zero** new wire surface. They compose existing events, endpoints, and capabilities. Highest ROI because they ship without waiting on RFC promotion.

### A1 — Consolidate the "Command Center" live view (finish PRD §7.2)
**What:** a single mission-control page that aggregates *all in-flight runs* for the tenant — live status, current node, agent handoffs, interrupt-pending badges — instead of today's per-run detail pages. A left rail lists active runs; selecting one streams its `RunAgentTrace` + `RunHandoffMap` inline.
**Why:** the pieces exist per-run (`RunAgentTrace`, `RunHandoffMap`, `RunsIndexPage`) but there's no cross-run live dashboard. This is the single biggest "feels like an operating layer" win and needs no protocol change — multiplex the existing SSE streams.
**How:** new `runs/CommandCenterPage.tsx`; subscribe to `streamsClient` for each active run (mode `updates`); reuse `agent.reasoned` / `agent.handoff` / interrupt events already on the wire.
**Depends on:** nothing. **Effort:** M.

### A2 — Intervention/quality metrics from existing events (partial PRD §7.14)
**What:** extend `RunCostPanel` into a `RunAnalyticsPanel` (or a tenant-level dashboard) computing **intervention rate** (interrupts raised ÷ runs), **approval/rejection mix**, **cancellation rate**, **mean run latency**, and **retry/failure counts** — all derivable from events the app already receives (`interrupt.*`, `run.failed`, `provider.usage`, cost events).
**Why:** the PRD wants "agent analytics"; cost already lands. Intervention rate is the highest-value metric and is purely a roll-up of interrupt events — no new signal needed. (Accuracy/correction-rate is the part that *does* need RFC 0056 — see C2.)
**How:** aggregate over the run-event log already persisted; new `runs/RunAnalyticsPanel.tsx` + a tenant rollup on `RunsIndexPage`.
**Depends on:** nothing. **Effort:** M.

### A3 — Memory inspector (partial PRD §7.3, honest scope)
**What:** a read-only panel that lists a run's resolved `memoryRef` entries and their TTL/visibility, using the existing RFC 0004 `MemoryAdapter` read-side (`list` + `get`) already wired in the host. Show which node read/wrote which memory key on the timeline.
**Why:** the PRD's "memory visualization" (Neo4j/D3 graph) is over-built for what the protocol exposes. A truthful, useful version is a *memory ledger* keyed off the read-side that already exists. A force-directed graph can come later if relationships are ever modeled.
**How:** new `runs/RunMemoryPanel.tsx` consuming the host's memory list/get; annotate `RunTimeline` nodes with memory read/write markers.
**Depends on:** nothing (RFC 0004 read-side is shipped). **Effort:** M. **Scope honestly** — label it "memory ledger," not "knowledge graph."

### A4 — Deepen the Debugging Studio (finish PRD §7.4)
**What:** turn the existing reasoning/envelope/network surfaces into a coherent "DevTools": step-through a replayed run event-by-event (scrub the timeline), with synchronized panels — current envelope (`EnvelopeInspector`), reasoning (`ReasoningDisclosure`), the packet that carried it (`NetworkPanel`), and channel state at that step.
**Why:** all four panels exist but aren't linked to a single "playhead." Replay/fork is already in the protocol (`replay.md`); this is a UI binding exercise.
**How:** a shared `useReplayPlayhead` store (the app already uses a lightweight state pattern); wire `RunTimeline` scrub position to the inspector panels; "fork from here" reuses the existing `:fork` call.
**Depends on:** nothing. **Effort:** M–L.

### A5 — Builder quality-of-life (strengthen PRD §7.1)
**What:** (a) live validation in the builder against the host's advertised capabilities — dim/flag nodes whose `peerDependencies` the host doesn't advertise (the catalog already marks these; surface it in the canvas, not just the inspector); (b) a "dry-run / validate" button that posts the workflow for cycle-detection + schema check before a real run; (c) template gallery seeded from `registry/PackBrowser` compositions (`examples/market-intel-pipeline`, `examples/ads-publish-pipeline`).
**Why:** reduces the "build → run → cryptic failure" loop. The capability data and example pipelines already exist.
**Depends on:** nothing. **Effort:** S–M.

### A6 — Marketplace polish (partial PRD §7.6, in-charter subset)
**What:** in `PackBrowser`, show signing-trust tier (core / community / vendor), Ed25519 verification status, SBOM link, and the deprecation/yank state from `registry-operations.md`. Add a "use in builder" action that drops a pack's nodes onto the canvas.
**Why:** the registry already serves trust tiers, SBOMs, and lifecycle state. Ratings/reviews/revenue-sharing are **out of scope** here (registry-policy territory — RFC 0043 Draft); don't build them speculatively.
**Depends on:** nothing (consumes live `packs.openwop.dev`). **Effort:** S.

### A7 — Accessibility, mobile, and i18n pass (cross-cutting; supports PRD §7.15 without a separate app)
**What:** responsive breakpoints for the builder/runs surfaces, keyboard nav for the timeline scrubber and approval cards, `Accept-Language` wiring (the protocol has `i18n.md` + `locale` on interrupts/errors — surface localized interrupt copy), and a "mobile approvals" responsive view of `HitlInboxPage` so approvals work on a phone *without* a separate native app.
**Why:** the PRD wants a "mobile companion app" for approvals; a responsive HITL inbox delivers 80% of that value with 5% of the cost, and the protocol already carries `locale`.
**Depends on:** nothing. **Effort:** M.

---

## Track B — Unlocked by RFC 0055 (multimodal envelope rendering)

Ships when RFC 0055 reaches `Active` and the demo host advertises the new identifiers + emits `meta.rendering`. Until then, build behind a feature flag against the proposed shape.

### B1 — Rich chat rendering (finish PRD §7.10's display half)
**What:** `chat/MessageRenderer.tsx` switches on `meta.rendering.display` to render **images inline**, **audio with a player**, **code with syntax highlighting + copy**, **cards** for structured payloads, and **file chips** for `media.file` — with `alt` text wired for screen readers. Falls back to today's text/JSON rendering when no hint is present.
**Why:** today the renderer drops everything non-text to a raw JSON dump. This is the headline UX win of the whole plan once the hint exists.
**Depends on:** RFC 0055 §B (`meta.rendering`) + §C (`media.*` URL convention). **Effort:** M.

### B2 — Vision-aware model/BYOK picker
**What:** the model picker (`builder/inspector/ModelPickerInput.tsx`) and BYOK wizard surface the model's advertised `modelCapabilities` — show a "📷 vision" / "🔊 audio" badge, and *disable image attachment in chat* when the active model lacks `vision-input`, with an inline explainer instead of a downstream `host_capability_missing` error.
**Why:** turns a confusing runtime failure into a pre-flight affordance. Reads the capability vocabulary RFC 0055 §A formalizes.
**Depends on:** RFC 0055 §A. **Effort:** S.

### B3 — Envelope inspector renders the hint
**What:** `EnvelopeInspector` shows `meta.rendering` (display/mimeType/alt) and, for `media.*`, a thumbnail + the tenant-scoped asset URL + inline-vs-URL indicator (against `maxInlineMediaBytes`).
**Why:** keeps the DevTools surface (A4) honest about multimodal payloads.
**Depends on:** RFC 0055. **Effort:** S.

---

## Track C — Unlocked by RFC 0056 (feedback / annotation)

Ships when RFC 0056 reaches `Active` and the demo host advertises `host.feedback`. Build behind a flag against the proposed shape meanwhile.

### C1 — Feedback affordances in chat + run detail (closes the quality loop)
**What:** thumbs-up/down + "suggest a correction" + "flag for review" + free-form label on chat bubbles (`MessageBubble`) and on individual nodes in `RunDetailPage`. Each posts `POST /v1/runs/{runId}/annotations`; the resulting `run.annotated` event shows inline.
**Why:** this is the loop the app has no way to capture today. Portable signal (any consumer can read it), not app-private state.
**Depends on:** RFC 0056 §C. **Effort:** M.

### C2 — Real quality analytics (completes PRD §7.14)
**What:** extend A2's analytics panel with **correction rate**, **mean rating**, **flag rate**, and a "most-corrected nodes" list — computed from `run.annotated` events. Tenant rollup on the runs index.
**Why:** A2 covers intervention rate from interrupts; C2 adds the *quality* dimension that needs the new signal. Together they deliver the PRD's "agent analytics" honestly.
**Depends on:** RFC 0056 §B. **Effort:** S (builds on A2).

### C3 — "Flagged" filter in the HITL inbox + debugging
**What:** `HitlInboxPage` gains a "flagged / low-rated / corrected" filter sourced from annotations; the Debugging Studio (A4) can jump to "runs annotated as wrong" for triage. Forking a flagged run carries the source back-reference (RFC 0056 §D).
**Why:** turns scattered feedback into a review queue — the operational payoff of capturing the signal.
**Depends on:** RFC 0056 §B/§D. **Effort:** S–M.

---

## Prioritized rollout

| Phase | Items | Gate | Rationale |
|---|---|---|---|
| **1 — now** | A1, A2, A5, A6 | none (frozen v1) | Highest-ROI, zero protocol risk. Command Center + intervention analytics + builder QoL + marketplace polish make the app feel like a platform immediately. |
| **2 — now** | A3, A4, A7 | none | Memory ledger, linked DevTools playhead, a11y/mobile/i18n. Deepens the debugging + governance story. |
| **3 — on RFC 0055 Active** | B1, B2, B3 | RFC 0055 promoted + demo host advertises | Rich multimodal chat — the headline visual upgrade. Build behind a flag in Phase 1–2. |
| **4 — on RFC 0056 Active** | C1, C2, C3 | RFC 0056 promoted + demo host advertises `host.feedback` | Feedback loop + real quality analytics + review queue. |

## Explicitly out of scope (and why)

- **Live A/V / screen-share / cursor co-presence (PRD §7.10 transport half)** — out of protocol charter; OpenWOP streams events, not media frames (composes with WebRTC/media servers). RFC 0055 covers *emitted multimodal artifacts*, not a real-time transport.
- **Native mobile app (PRD §7.15)** — A7's responsive HITL inbox delivers the approvals use case without a second codebase. Revisit only on real demand.
- **Memory knowledge-graph (Neo4j/D3, PRD §7.3 full)** — the protocol exposes a memory *ledger* (list/get), not modeled relationships. A3 ships the honest version; a graph waits until relationships are a protocol concept.
- **Marketplace ratings / reviews / revenue-sharing (PRD §7.6 full)** — registry-policy territory (RFC 0043 Draft), not app UX. A6 ships the trust/SBOM/lifecycle subset that already exists on the wire.
- **Trust scores, consensus swarms, cross-app memory roaming** — flagged in the deep-dive as out-of-charter / contested; no app work proposed.

## Cross-references
- [`apps/workflow-engine/README.md`](../apps/workflow-engine/README.md) · [`apps/workflow-engine/ARCHITECTURE.md`](../apps/workflow-engine/ARCHITECTURE.md) — current app scope.
- [`DESIGN.app.md`](../DESIGN.app.md) — tokens/components all new UI must use.
- [`plans/app-buildable-now-on-existing-protocol.md`](app-buildable-now-on-existing-protocol.md) · [`plans/openwop-sample-chat-improvements-plan.md`](openwop-sample-chat-improvements-plan.md) — prior app-scope analyses this builds on.
- [`RFCS/0055`](../RFCS/0055-multimodal-envelope-variants-and-rendering-hints.md) · [`RFCS/0056`](../RFCS/0056-run-feedback-and-annotation-event.md) — the protocol additions Tracks B and C depend on.
