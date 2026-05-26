# app.openwop.dev — Features Buildable Now on Existing Protocol

> **Status: closed (audit 2026-05-25, closure round 2026-05-25)** — ~54 frontend commits landed against this backlog in the ~28 hours after authoring, then a closure pass shipped the last open items. Per-item markers added inline below: **✅ done · 🟡 partial · ❌ not shipped · ❓ not verified**. Final tally: **23 ✅ · 2 🟡 · 0 ❌ · 0 ❓** across the 25 items, with both `🟡`s structurally unblockable from the openwop side (see "Remaining open work" below).
>
> **Closure round (2026-05-25):** PR #213 (item 12 — engine-limit pre-flight extension), PR #217 (item 15 — multi-turn conversation panel), PR #221 (item 13 — dedicated audit-log viewer page), PR #222 (item 25 — sticky-note canvas annotations via the new `clientOnly: true` catalog flag), PR #224 (items 16 + 20 — A2A peer placeholder + Publish-to-registry helper). Item 1 (live execution overlay) was re-audited and confirmed shipped in PR #210-era work (`BaseNode.tsx` `RUN_STATUS_META` + glow + pulse + className route through `applyRunEvent`).
>
> **Pivot to follow-up plan.** The work expanded substantially beyond this backlog into a parallel track tracked at [`plans/app-ux-enhancements.md`](./app-ux-enhancements.md) (§A1–A7) — Mission Control / Command Center page (§A1), per-run health analytics (§A2), memory ledger (§A3, paired with RFC 0057), debugging-studio playhead (§A4), canonical workflow import + validate-button (§A5), the in-builder pack-drop ("A6 use in builder"), and the accessibility / mobile / i18n pass (§A7). The notification-system rewrite (Web Push + OS notifications + preferences + quiet hours + flagged review queue) replaced the originally-planned item 8 "HITL inbox" with something materially bigger. Multimodal rendering (RFC 0055 §C consumer) + feedback annotations (RFC 0056 consumer) shipped despite neither RFC existing when this plan was authored.
>
> **Remaining open work (`🟡`, structurally unblockable from the openwop side).** Both items below depend on non-steward host adoption that this repo can't unilaterally drive — request issued at [`docs/myndhyve-round-2-handoff.md`](../docs/myndhyve-round-2-handoff.md):
>
>   - **#11b** — `x-openwop-form` consumer is shipped (`builder/inspector/Inspector.tsx` + `builder/palette/configFieldsFromSchema.ts`, PRs #204/#205). RFC 0066 is `Draft`; path-to-`Accepted` requires a non-steward host advertising a pack with `x-openwop-form` annotations. Tracked at `docs/KNOWN-LIMITS.md` "RFCs not yet `Accepted`" → row 0066.
>   - **#16 (A2A half) + #25 (grouping)** — both deferred for the right reason. A2A: `spec/v1/a2a-integration.md` is FINAL but the `capabilities.a2a` advertisement shape is still a candidate; the reference host doesn't expose itself as an A2A agent; nothing to enumerate. Grouping: xyflow parent-node + drag-into-group is a multi-PR surface that's not required for current use cases. Both are captured as placeholders in the shipped UIs (#16 via `A2APeerPanel` rendered alongside `McpToolsPanel`; #25 noted in the PR #222 commit body).
>
> Plus two narrow follow-ups under the now-finished **#22**: `feedbackClient` annotations migrate once the next SDK ships (per the in-file TODO + `sdk/PARITY.md` 2026-05-25 entry), and `registryClient` needs a second SDK instance pointed at the registry origin.
>
> **Body preserved.** Item descriptions, protocol-surface citations, and the "why now" framing are kept as-authored for traceability; markers were added to each section heading. Where the body's "App adds" text predicts work that has since shipped, the description still reads as future tense — read the marker first.

**Purpose:** A comprehensive, prioritized backlog for the reference app (`apps/workflow-engine/`) that requires **no new RFC**. Every item builds on an OpenWOP protocol capability that is already `Done`/`Accepted` and shipping in the conformance suite. This is the App-track companion to [`openwop_roadmap_gap_analysis.md`](./openwop_roadmap_gap_analysis.md) and [`myndhyve-protocol-extension-rfcs.md`](./myndhyve-protocol-extension-rfcs.md) — where those identify protocol *gaps*, this lists protocol *surplus*: shipped wire surfaces the app doesn't yet expose.

**Reading the columns:** each feature cites the **protocol surface** it consumes (already shipped) and what the **app must add** on top. "Pure app" = no protocol dependency, a React Flow / UI task (listed because it's a fast win, but it doesn't depend on the protocol). Current app state is from the `apps/workflow-engine/frontend` inventory: ReactFlow canvas, node palette (search + categories), node validation, undo/redo, autosave, SSE event stream (`EventStreamView`, `streamsClient`, Last-Event-ID), `EnvelopeInspector`, and fork/replay (`RunDetailPage` `onForkFrom` → `POST /v1/runs/{id}:fork`).

---

## Why there's so much to build

The gap analysis found the protocol/runtime is ~65% `Done` while the app is an early prototype. That asymmetry **is the opportunity**: a large set of high-value app features need only a UI on top of an already-certified wire surface. The app's current consumption of the protocol is shallow (it streams events and forks runs) relative to what the protocol exposes (reasoning traces, multi-agent handoffs, cost metrics, the pack registry, the prompt library, interrupt profiles, audit verification, capability discovery).

---

# TIER 1 — Highest leverage (protocol is fully shipped; app exposes little or none of it)

## ✅ 1. Live execution overlay on the canvas *(audit 2026-05-25: shipped — `BaseNode.tsx` renders `RUN_STATUS_META` color glow + `openwop-pulse` animation + `builder-node-run-<status>` className; `applyRunEvent` in `builderStore.ts` routes `node.{started,completed,failed,suspended}` events into `RunOverlay.nodeStatus`; subscribed in `BuilderShell.tsx` via `subscribeToRun`)*
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

## 🟡 11. Auto-generated node config forms from pack manifests *(materially shipped; split into 11a [✅ this branch] + 11b [RFC pending])*

The architect audit (2026-05-25) found the JSON-Schema → form pipeline already lives in `apps/workflow-engine/frontend/react/src/builder/palette/configFieldsFromSchema.ts` (extracted from `catalogRegistry.ts` for testability) + the existing `Inspector.tsx` renderer. Boot-time `loadDynamicCatalog()` merges pack-served nodes into the catalog and they get a config form today. The remaining work split into two trackable sub-items:

### ✅ 11a. JSON-Schema validation-hint surfacing + `array<string>` rendering (no RFC needed)

Pure renderer/converter extension. Surfaces JSON-Schema 2020-12 keywords that the original converter ignored:

- `minimum` / `maximum` / `multipleOf` → HTML5 `min` / `max` / `step` on number inputs (integer step defaults to 1).
- `minLength` / `maxLength` / `pattern` → HTML5 `minlength` / `maxlength` / `pattern` on text inputs.
- `array` of `items: { type: 'string' }` → new `string-list` ConfigField kind, rendered as a one-per-line textarea instead of raw JSON. Honors `maxItems` (clamps + warns) and surfaces `items.pattern` in help text.
- `default` for `array<string>` and `object` shapes are now carried through and pretty-printed (previously silently dropped).
- New `configFieldsFromSchema.ts` extracted for unit testability + vitest-style test file (`__tests__/configFieldsFromSchema.test.ts`) covering 25+ cases including the production `core.ai.chatCompletion` configSchema as a regression fixture.

### 🚧 11b. Picker UX for pack-installed nodes via `x-openwop-form` vendor extension (RFC pending)

Static-catalog AI nodes get model/provider/credential pickers + cross-field dependency cascades (e.g., changing provider clears the model). Pack-served nodes can't reach picker-grade UX today because JSON Schema alone can't express "this string is a model id whose options depend on the sibling `provider` field." Pursuing as a new RFC that reserves the `x-openwop-form` namespace on pack `configSchema`s, mirroring the existing `ConfigField.kind` / `dependsOn` / `credentialProvider` vocabulary. Additive per `COMPATIBILITY.md §2.1`; pack authors opt in; existing manifests work unchanged via the pure-schema fallback shipped in 11a.

## ✅ 12. Workflow validation against host capabilities (pre-flight) *(closure PR #213 added engine-limit pre-flight against advertised `capabilities.limits.maxNodeExecutions` + `maxRunDurationMs` + `maxLoopIterations` on top of the existing per-node `missingHostSurfaces` check; Validate-OK message now reports advertised limits the run will execute under)*
- **Protocol surface:** cap-breach enforcement + `RunOptions.configurable` limits — RFC 0009 (`cap-breach.test.ts`, Done).
- **App adds:** before run, validate the graph against advertised limits (recursion, envelopes/turn, max node executions) and flag nodes that need an unadvertised capability. Catches failures at author time instead of run time.

## ✅ 13. Audit-log viewer with verification *(closure PR #221 added `runs/RunAuditPage.tsx` at route `/runs/:runId/audit` — auto-runs `client.audit.verify(0, lastSeq)` on mount, prominent chain-valid banner, per-checkpoint timeline with full merkleRoot/signature/checkpoint strings, per-anomaly table with full hashes, re-verify button, "Download checkpoints (JSON)" for offline re-verification via `scripts/verify-audit-checkpoints.mjs`, "View full audit log →" link added to `RunOpsPanel`. Capability-gated on `openwop-audit-log-integrity` profile.)*
- **Protocol surface:** audit-log-integrity profile — append-only, signed, tamper-detectable; SDK `verify()` on all 3 SDKs — RFC 0009/0010 (Done). `audit-checkpoint-export.test.ts`.
- **App adds:** a per-run/per-workspace audit timeline with a "Verify integrity" button that runs the SDK `verify()` and shows the Merkle/signature result; export checkpoint.

## ✅ 14. Debug-bundle download *(shipped in this branch — "Download bundle" button on `RunDetailPage.tsx` → `getDebugBundle()` in `runsClient.ts` → `GET /v1/runs/{runId}/debug-bundle` → file saved as `openwop-run-{runId}.json`)*
- **Protocol surface:** production-profile debug bundle with truncation behavior — RFC 0009 (`debug-bundle-truncation.test.ts`, Done).
- **App adds:** a one-click "Download debug bundle" on any run for support/triage.

## ✅ 15. Conversation (multi-turn) UI *(closure PR #217 added `runs/RunConversationPanel.tsx` consuming `conversation.opened` / `conversation.exchanged` / `conversation.closed` events per `schemas/conversation-event.schema.json`, with an inline resume form for `conversation.exchange` / `conversation.close` interrupts via the token-scoped resolve endpoint. Forward-compat: the panel returns `null` until a host advertises `capabilities.conversationPrimitive: true` — request issued at `docs/myndhyve-round-2-handoff.md` §1.)*
- **Protocol surface:** `core.conversationGate` lifecycle (`open`/`exchange`/`close`) — RFC 0005 (Accepted).
- **App adds:** a proper multi-turn conversation panel bound to `(runId, conversationId)`, distinct from one-shot chat. The sample-chat plans reference this; the gate primitive is shipped.

## 🟡 16. MCP tool & A2A peer browser *(MCP half shipped as `mcp/McpToolsPanel.tsx`; A2A half — closure PR #224 added `peers/A2APeerPanel.tsx` rendered right below McpToolsPanel on `/capabilities` as a forward-compat placeholder. Cannot enumerate today because `capabilities.a2a` shape is still a candidate in `spec/v1/a2a-integration.md` §"Capability advertisement", the reference host doesn't expose an Agent Card, and no `core.a2a.*` NodeModule is registered. Request issued at `docs/myndhyve-round-2-handoff.md` §3 for a non-steward host to publish an A2A AgentCard — converts the placeholder into a real peer browser.)*
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

## ✅ 20. Publish a workflow as a chain pack *(closure PR #224 added "Publish to registry…" button next to "Export chain pack". Opens an inline checklist banner with proposed pack slug, manifest size, one-click manifest.json download, link to fork `openwop/openwop` and add the manifest at `registry/packs/<slug>/manifest.json`, local `npm run openwop:check` validation step, PR-open step + resulting `packs.openwop.dev` URL. In-browser pushing intentionally NOT added — Ed25519 signing happens at PR-merge time by the registry maintainers per `PUBLISHING.md` + `spec/v1/registry-operations.md`.)*
- **Protocol surface:** workflow-chain packs + registry publishing — RFC 0013 (Accepted); PUBLISHING.md flow.
- **App adds:** "Publish to registry" from a built workflow (PR-based publish flow exists); the app provides the authoring → manifest → submit UX.

## ✅ 21. Conformance / interop badge surfacing *(shipped in this branch — new "Conformance & profiles" card on `CapabilitiesPanel.tsx` shows the connected host's `implementation.{name, version, vendor}` + the union of `capabilities.profiles[]` and `capabilities.auth.profiles[]` + an inline `openwop.dev/badge/<host>.svg` when the implementation matches a reference host, else a leaderboard link)*
- **Protocol surface:** INTEROP-MATRIX.md per-host pass/fail + suite version; site leaderboard started in `site/`.
- **App adds:** show the connected host's conformance badge + which profiles it passes, inline in the app (credibility + capability transparency).

## ✅ 22. Replace hand-rolled fetch with the published SDK *(finished via PR #188 commit `dfb98a8` (debug-bundle revert to SDK) + PR #193 (interruptsClient + promptsClient + DemoHostBanner + streamsClient bearer-mode → SDK `streamEvents`). Dropped the `?apiKey=` URL query-param leak in bearer-mode SSE. Cookie-mode SSE stays on native EventSource pending an SDK `credentials: 'include'` hook. `feedbackClient` annotation create/list deferred to next SDK publish (per the in-file TODO + PARITY.md); `registryClient` deferred — needs a separate SDK instance pointed at the registry origin)*
- **Protocol surface:** `@openwop/openwop` TS SDK, 32 wire-surface helpers, full parity (PARITY.md, Done).
- **App adds:** migrate `streamsClient.ts`/`runsClient.ts` to the SDK so the app stays wire-correct automatically as the SDK tracks the spec. Reduces drift risk.

## ✅ 23. Stream-mode switcher *(shipped — `<select>` for `updates`/`values`/`messages`/`debug` at `runs/RunDetailPage.tsx:270`; re-subscribes the SSE on change)*
- **Protocol surface:** 4 SSE modes (`values`/`updates`/`messages`/`debug`) — RFC 0002 (Done).
- **App adds:** a toggle to switch the event view between modes (e.g. `messages` for a chat view, `debug` for triage). The client already supports Last-Event-ID resume.

## ✅ 24. Two-run side-by-side compare (partial)
- **Protocol surface:** fork creates a new run from any `seq` — RFC 0011 (Done). *Full structured diff needs RFC 0054 (not yet filed).*
- **App adds:** a client-side side-by-side of two runs' event lists + terminal states (a run and its fork). Honest scope: this is the 80% achievable today; the deterministic `GET /v1/runs/{a}/diff/{b}` endpoint is the proper backend (see RFC 0054 in the extension doc).

## ✅ 25. Builder polish — pure app, no protocol dependency (fast wins) *(multi-select, alignment/distribution, batch undo, inline title edit, copy/paste, aria-labels all shipped across PRs #121/#124/#129/#133. Re-audit 2026-05-25: minimap is already shipped (`<MiniMap pannable zoomable>` in `BuilderCanvas.tsx`), grid-snap is already shipped (`snapToGrid snapGrid={[20, 20]}`). Closure PR #222 added sticky-note canvas annotations via a new `clientOnly: true` `NodeCatalogEntry` flag — annotation nodes are stripped from the serialized `BackendWorkflowDefinition` by `serializeWithIdMap`, skipped by `collectLimitIssues` against `maxNodeExecutions`, and render via a dedicated `ClientOnlyNode` branch in `BaseNode.tsx`. Grouping/subgraphs deferred — xyflow parent-node + drag-into-group is a multi-PR surface not required by current users.)*
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
