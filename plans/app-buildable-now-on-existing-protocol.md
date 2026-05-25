# app.openwop.dev — Features Buildable Now on Existing Protocol

> **Status: substantially executed (audit 2026-05-25)** — ~54 frontend commits landed against this backlog in the ~28 hours after authoring. Per-item markers added inline below: **✅ done · 🟡 partial · ❌ not shipped · ❓ not verified** (~16 ✅ · 5 🟡 · 2 ❌ · 2 ❓ across the 25 items).
>
> **Pivot to follow-up plan.** The work expanded substantially beyond this backlog into a parallel track tracked at [`plans/app-ux-enhancements.md`](./app-ux-enhancements.md) (§A1–A7) — Mission Control / Command Center page (§A1), per-run health analytics (§A2), memory ledger (§A3, paired with RFC 0057), debugging-studio playhead (§A4), canonical workflow import + validate-button (§A5), the in-builder pack-drop ("A6 use in builder"), and the accessibility / mobile / i18n pass (§A7). The notification-system rewrite (Web Push + OS notifications + preferences + quiet hours + flagged review queue) replaced the originally-planned item 8 "HITL inbox" with something materially bigger. Multimodal rendering (RFC 0055 §C consumer) + feedback annotations (RFC 0056 consumer) shipped despite neither RFC existing when this plan was authored.
>
> **Remaining clearly-open items.** From the original list: **#14** (debug-bundle download — single-button UI on shipped protocol surface), **#21** (in-app conformance / interop badge — credibility surface), **#23** (SSE stream-mode switcher — small but visible), and the SDK-migration finish of **#22** (`streamsClient.ts` / `runsClient.ts` are still hand-rolled). Lower-priority unverified: **#11** (auto-generated JSON-Schema → config-form), **#13** (audit-log viewer with `verify()` button), **#16** (A2A-peer-side of MCP+A2A browser — MCP half shipped).
>
> **Body preserved.** Item descriptions, protocol-surface citations, and the "why now" framing are kept as-authored for traceability; markers were added to each section heading. Where the body's "App adds" text predicts work that has since shipped, the description still reads as future tense — read the marker first.

**Purpose:** A comprehensive, prioritized backlog for the reference app (`apps/workflow-engine/`) that requires **no new RFC**. Every item builds on an OpenWOP protocol capability that is already `Done`/`Accepted` and shipping in the conformance suite. This is the App-track companion to [`openwop_roadmap_gap_analysis.md`](./openwop_roadmap_gap_analysis.md) and [`myndhyve-protocol-extension-rfcs.md`](./myndhyve-protocol-extension-rfcs.md) — where those identify protocol *gaps*, this lists protocol *surplus*: shipped wire surfaces the app doesn't yet expose.

**Reading the columns:** each feature cites the **protocol surface** it consumes (already shipped) and what the **app must add** on top. "Pure app" = no protocol dependency, a React Flow / UI task (listed because it's a fast win, but it doesn't depend on the protocol). Current app state is from the `apps/workflow-engine/frontend` inventory: ReactFlow canvas, node palette (search + categories), node validation, undo/redo, autosave, SSE event stream (`EventStreamView`, `streamsClient`, Last-Event-ID), `EnvelopeInspector`, and fork/replay (`RunDetailPage` `onForkFrom` → `POST /v1/runs/{id}:fork`).

---

## Why there's so much to build

The gap analysis found the protocol/runtime is ~65% `Done` while the app is an early prototype. That asymmetry **is the opportunity**: a large set of high-value app features need only a UI on top of an already-certified wire surface. The app's current consumption of the protocol is shallow (it streams events and forks runs) relative to what the protocol exposes (reasoning traces, multi-agent handoffs, cost metrics, the pack registry, the prompt library, interrupt profiles, audit verification, capability discovery).

---

# TIER 1 — Highest leverage (protocol is fully shipped; app exposes little or none of it)

## 🟡 1. Live execution overlay on the canvas
- **Protocol surface:** SSE event stream, 4 modes (`values`/`updates`/`messages`/`debug`), `node:started`/`node:completed`/`node:failed` events — RFC 0002 stream-modes (Done). Backend `routes/streams.ts`.
- **App adds:** color/animate canvas nodes by live status as events arrive; pulse the active node, mark completed/failed. The app already *receives* these events into `EventStreamView` as a text list — it just doesn't paint them onto the graph.
- **Why now:** turns the static builder into a live execution view with zero backend work.

## ✅ 2. Graphical execution timeline (replace the text event list)
- **Protocol surface:** ordered event log with `seq` + timestamps (Done); fork buttons already wired.
- **App adds:** a horizontal swimlane/Gantt timeline keyed by `nodeId`, with duration bars, retry markers, and click-to-inspect. `EventStreamView` currently renders `events.map(...)` as flat `<div>`s.

## ✅ 3. Agent reasoning & tool-call trace viewer
- **Protocol surface:** `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` events + reasoning streaming — RFC 0002 + RFC 0024 (Done). Causation IDs link the chain (RFC 0002 §causation).
- **App adds:** a per-agent reasoning panel that streams thinking tokens, then renders each tool call → return as an expandable step, threaded by causationId. The `EnvelopeInspector` already parses `agent.*` events — extend it from inspection to a narrative trace.

## ✅ 4. Multi-agent handoff visualization
- **Protocol surface:** `core.orchestrator.supervisor` + `core.dispatch` events, normalized handoff state machine — RFC 0006 / 0007 / 0037 §1 (Accepted). `OrchestratorDecision.nextWorkerIds[]`.
- **App adds:** a swimlane or graph showing supervisor → worker handoffs over time, with the 7 transition events labeled. Surface `agent.low_confidence.{ratified,rejected}` (RFC 0039/0044) as escalation markers.

## ✅ 5. Token & cost dashboard
- **Protocol surface:** provider-usage events (RFC 0026, Accepted) + OTel metrics `openwop.*` (RFC 0009/0034, Done). Cost attribution e2e (`conformance.cost.emit`).
- **App adds:** per-run and per-workspace token/cost aggregation, model-breakdown charts, budget indicators. The data is already emitted; nothing renders it.

## ✅ 6. Pack browser & installer in the node palette
- **Protocol surface:** `packs.openwop.dev` discovery + index + per-pack manifest + tarball endpoints; SRI + Ed25519 + trust tiers — RFC 0003 / 0013 / 0043 (Accepted/Draft-policy). 62 packs published.
- **App adds:** pull the live registry index into the palette so users can browse/search all published packs (not just locally-bundled ones), view manifest + signature + trust tier + SBOM, and add nodes from any pack. Currently `NodePalette.tsx` only shows locally-known nodes.
- **Why now:** instantly multiplies the available node set and showcases the registry that's already live.

## ✅ 7. Prompt library management UI
- **Protocol surface:** `/v1/prompts*` endpoints, `mutableLibrary`, template shapes, override hierarchy — RFC 0027 / 0028 / 0029 (Accepted/Active). INTEROP-MATRIX confirms `prompts.mutableLibrary: true` on the workflow-engine host.
- **App adds:** browse/create/edit/version prompts; show the override hierarchy resolution; bind a prompt to a `core.ai.callPrompt` node. The endpoint exists and the app host serves it; there's no UI.

## ✅ 8. HITL / approval inbox *(superseded by the full notification system — `notifications/{NotificationBell,NotificationPanel,NotificationsPage,NotificationPreferencesPanel}.tsx` + Web Push + OS notifications + quiet hours + flagged review queue)*
- **Protocol surface:** interrupt profiles — multi-approver quorum, external-event correlation, auth-required resume, parent/child cancel — RFC 0005 (Accepted). `/resume` with `resumeSchema` validation (`400 INVALID_RESUME_VALUE`).
- **App adds:** an inbox of pending interrupts across runs; render the correct form per interrupt kind (approve/reject, quorum vote, external-event payload, auth-required credential); call `/resume`. Step-replay UI exists but there's no interrupt-handling UI.

---

# TIER 2 — Strong value (shipped protocol, moderate app work)

## ✅ 9. Input/output inspector panel
- **Protocol surface:** event payloads carry node I/O (RFC 0002, Done).
- **App adds:** a dedicated per-node I/O panel (inputs, outputs, config) instead of raw-JSON `<details>` in the event list.

## ✅ 10. Capability inspector ("what does this host support?")
- **Protocol surface:** `/.well-known/openwop` capability advertisement + `Capabilities-Etag` + auth-scoped narrowing — RFC 0011 (Accepted).
- **App adds:** render the connected host's capabilities (envelopes, limits, profiles, host.* capabilities, models). Drives feature-gating in the UI (e.g. hide vector-node config if `host.vectorStore` absent). Show the narrowed view when authed with a scoped key.

## 🟡 11. Auto-generated node config forms from pack manifests
- **Protocol surface:** node-pack manifest input/output schemas are JSON Schema 2020-12 (Done); component schema provider.
- **App adds:** render a config form for any node from its manifest schema (JSON Schema → form), so newly-installed packs (item 6) get a working config UI for free.

## ✅ 12. Workflow validation against host capabilities (pre-flight)
- **Protocol surface:** cap-breach enforcement + `RunOptions.configurable` limits — RFC 0009 (`cap-breach.test.ts`, Done).
- **App adds:** before run, validate the graph against advertised limits (recursion, envelopes/turn, max node executions) and flag nodes that need an unadvertised capability. Catches failures at author time instead of run time.

## 🟡 13. Audit-log viewer with verification
- **Protocol surface:** audit-log-integrity profile — append-only, signed, tamper-detectable; SDK `verify()` on all 3 SDKs — RFC 0009/0010 (Done). `audit-checkpoint-export.test.ts`.
- **App adds:** a per-run/per-workspace audit timeline with a "Verify integrity" button that runs the SDK `verify()` and shows the Merkle/signature result; export checkpoint.

## ❓ 14. Debug-bundle download
- **Protocol surface:** production-profile debug bundle with truncation behavior — RFC 0009 (`debug-bundle-truncation.test.ts`, Done).
- **App adds:** a one-click "Download debug bundle" on any run for support/triage.

## ✅ 15. Conversation (multi-turn) UI
- **Protocol surface:** `core.conversationGate` lifecycle (`open`/`exchange`/`close`) — RFC 0005 (Accepted).
- **App adds:** a proper multi-turn conversation panel bound to `(runId, conversationId)`, distinct from one-shot chat. The sample-chat plans reference this; the gate primitive is shipped.

## 🟡 16. MCP tool & A2A peer browser *(MCP half shipped as `mcp/McpToolsPanel.tsx`; A2A peer browser not found)*
- **Protocol surface:** `core.mcp.toolCall` over HTTP/JSON-RPC (RFC 0020, Done; real-impl interop verified) + `a2a` task roundtrip (RFC 0007, Done; verified vs A2A SDK 0.3.13).
- **App adds:** list MCP server tools available to the host, let users drop a `mcp.toolCall` node and pick a tool; configure A2A peer dispatch. The packs + roundtrip are proven; there's no discovery UI.

## ✅ 17. RAG pipeline builder
- **Protocol surface:** `core.openwop.rag` (13 nodes: loaders/splitters/retrievers/vector ops) + `core.openwop.db.vector-*` + `core.openwop.ai.embeddings` — RFC 0018 (Done).
- **App adds:** a guided RAG template/wizard composing loader → splitter → embed → vector-upsert → retriever, with host vector-store capability detection.

## ✅ 18. API-key management UI
- **Protocol surface:** API-key rotation (two-key overlap + canary-redaction), auth profiles — RFC 0010 (Done).
- **App adds:** issue/rotate/revoke keys with the grace-window UX the protocol already supports; show scoped-discovery preview per key.

---

# TIER 3 — Polish & ecosystem (shipped protocol or pure app)

## ✅ 19. Workflow import/export (portable JSON)
- **Protocol surface:** open execution schemas — `run-event-payloads.schema.json`, `orchestrator-decision.schema.json`, workflow-definition schema (RFC 0037 §1, Done).
- **App adds:** export a built workflow as portable JSON and re-import; foundation for sharing.

## 🟡 20. Publish a workflow as a chain pack *(export shipped as manifest JSON; the PR-to-registry submission UX is not in-app yet)*
- **Protocol surface:** workflow-chain packs + registry publishing — RFC 0013 (Accepted); PUBLISHING.md flow.
- **App adds:** "Publish to registry" from a built workflow (PR-based publish flow exists); the app provides the authoring → manifest → submit UX.

## ❌ 21. Conformance / interop badge surfacing
- **Protocol surface:** INTEROP-MATRIX.md per-host pass/fail + suite version; site leaderboard started in `site/`.
- **App adds:** show the connected host's conformance badge + which profiles it passes, inline in the app (credibility + capability transparency).

## ❓ 22. Replace hand-rolled fetch with the published SDK
- **Protocol surface:** `@openwop/openwop` TS SDK, 32 wire-surface helpers, full parity (PARITY.md, Done).
- **App adds:** migrate `streamsClient.ts`/`runsClient.ts` to the SDK so the app stays wire-correct automatically as the SDK tracks the spec. Reduces drift risk.

## ❌ 23. Stream-mode switcher
- **Protocol surface:** 4 SSE modes (`values`/`updates`/`messages`/`debug`) — RFC 0002 (Done).
- **App adds:** a toggle to switch the event view between modes (e.g. `messages` for a chat view, `debug` for triage). The client already supports Last-Event-ID resume.

## ✅ 24. Two-run side-by-side compare (partial)
- **Protocol surface:** fork creates a new run from any `seq` — RFC 0011 (Done). *Full structured diff needs RFC 0054 (not yet filed).*
- **App adds:** a client-side side-by-side of two runs' event lists + terminal states (a run and its fork). Honest scope: this is the 80% achievable today; the deterministic `GET /v1/runs/{a}/diff/{b}` endpoint is the proper backend (see RFC 0054 in the extension doc).

## ✅ 25. Builder polish — pure app, no protocol dependency (fast wins) *(multi-select, alignment/distribution, batch undo, inline title edit, copy/paste, aria-labels all shipped across PRs #121/#124/#129/#133; minimap + grouping/subgraphs + sticky notes + grid-snapping not verified)*
These need only React Flow / store work; listed for completeness since they're the most visible gaps in Phase 2:
- **Minimap** — `<Minimap>` from `@xyflow/react` (not currently imported).
- **Multi-select** — currently `selectedNodeId` is single; add selection set + range select.
- **Grouping / subgraphs** — flat node array today.
- **Sticky notes / annotations.**
- **Alignment & distribution tools.**
- **Grid snapping** — free-form positioning today.
- **In-canvas copy/paste** — only palette→canvas drag exists.
- **Canvas keyboard shortcuts** — Delete/Ctrl+Z/Ctrl+D (card-level only today).
- **Inline node title editing** — fixed spans today.
- **Reusable node templates** — only whole-workflow duplication today.

---

## Suggested build order

1. **Tier 1 items 1–4** (live overlay, timeline, reasoning trace, multi-agent viz) — these make the app *visibly* a best-in-class AI orchestration debugger, all on the event stream the app already consumes. Highest demo value, lowest backend risk.
2. **Items 6–7** (pack browser, prompt library) — unlock the live registry + prompt endpoints that exist but are invisible; multiplies what users can build.
3. **Item 8 + 13–14** (HITL inbox, audit viewer, debug bundle) — enterprise/ops credibility on shipped profiles.
4. **Items 5, 10–12** (cost dashboard, capability inspector, generated forms, pre-flight validation) — depth + correctness.
5. **Tier 3** as polish, with item 25 (builder polish) parallelizable any time since it has no protocol dependency.

## What is deliberately NOT here

Features that **require a new RFC** (no shipped protocol surface) live in [`myndhyve-protocol-extension-rfcs.md`](./myndhyve-protocol-extension-rfcs.md), not this list: connector OAuth UIs (RFC 0046/0047), org/workspace/RBAC admin screens (RFC 0048/0049), marketplace social features — ratings/reviews (needs a rating schema RFC), scheduled-routine UI (RFC 0017 still Draft), embedded/white-label builder. Building their UI now would mean inventing the wire contract in the app — the exact host-private trap the RFC doc exists to avoid.

The one honest in-between is **item 24** (run compare): the fork primitive ships today so a client-side comparison is buildable now, but the *proper* deterministic diff endpoint is RFC 0054.
