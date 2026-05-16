# Sample Chat UI + BYOK Integration — Analysis

> **Status:** Pre-implementation analysis. Not normative. Plans a chat surface for `apps/workflow-engine/frontend/react/` informed by MyndHyve's chat + BYOK patterns.
> **Created:** 2026-05-16
> **Authoritative sources:**
> - `/Users/david/dev/myndhyve/src/components/chat/` (chat sidebar, 4665-line `ChatPanel.tsx`, supporting components)
> - `/Users/david/dev/myndhyve/src/components/settings/BYOKPanel.tsx` (985 lines)
> - `/Users/david/dev/myndhyve/src/components/chat/ModelSelector.tsx` (537 lines)
> - `/Users/david/dev/myndhyve/src/core/workflow/services/CardComponentRegistry.ts` (extensibility pattern)
> - `/Users/david/dev/myndhyve/DESIGN.md` + `/Users/david/dev/myndhyve/src/core/design-system/tokens/`
> - openwop spec: `spec/v1/{stream-modes,interrupt,agent-memory,channels-and-reducers,run-options}.md`
> - openwop sample: `apps/workflow-engine/frontend/react/src/byok/` (existing static BYOK explainer)

---

## 0. Single-sentence framing

Replace the existing static BYOK tab with an **AI surface** that demonstrates the end-to-end openwop chat experience: BYOK as the prerequisite, model selection, an AI chat sidebar that starts a real OpenWOP run per turn and renders streamed events back into chat bubbles, plus a `CardComponentRegistry`-style extensibility hook so adopters can plug in custom card renderers for their artifact types.

---

## 1. Why this matters

The current `apps/workflow-engine/frontend/react/src/byok/` is a doc page — it explains the BYOK contract but doesn't exercise it. Three problems with that:

1. **It teaches the API, not the pattern.** A new adopter sees the spec but no working reference for "how do I wire chat → openwop run → SSE event → rendered card?"
2. **BYOK has no consumer.** The seeded workflows (`uppercase`, `approval-gate`) don't declare `requires.secrets[]`, so even if a key were stored there's nowhere it would flow.
3. **The sample has a credibility gap vs. MyndHyve.** MyndHyve's chat sidebar is the most polished part of the product. Without something analogous, openwop's reference application looks bureaucratic — all wire surface, no human surface.

The new tab fixes all three: BYOK becomes the gate to chat (so users have a reason to configure it), chat becomes the consumer of BYOK-protected workflow runs, and the extensibility hook makes the sample a credible starting template instead of a toy.

---

## 2. What MyndHyve does well (and what to copy)

### 2.1 Chat sidebar layout (from `ChatPanel.tsx`, `PromptChatSidebar.tsx`)

Three-zone vertical flex:

```
┌─────────────────────────────────────────┐
│  Header  ◇ Provider/Model chip │ Cost ◇ │  ← collapsible
├─────────────────────────────────────────┤
│                                         │
│  Message feed (flex-1, scrollable)      │
│   • user bubbles right-aligned          │
│   • assistant bubbles left-aligned      │
│   • envelope cards (approval, artifact, │
│     screen) render inline               │
│   • streaming bubble appends tokens     │
│                                         │
│  ↓ messagesEndRef sentinel for autoscroll│
├─────────────────────────────────────────┤
│  Input pill                             │
│   [textarea] [send] [+] [voice?]        │
│   ▸ slash autocomplete pops above       │
│   ▸ @-mention autocomplete pops above   │
└─────────────────────────────────────────┘
```

**Things to lift verbatim:**

- **Auto-resizing textarea** with `Math.min(scrollHeight, 120px)` capping at ~3 rows (`ChatPanel.tsx:1162-1167`).
- **Cmd+Enter sends, Shift+Enter newlines** — the universal AI-chat keyboard contract (`ChatPanel.tsx:4274-4277`).
- **Send-button state machine** — disabled when (empty AND no attachments) OR (AI generating) OR (no key configured), with a tooltip explaining *why* (`ChatPanel.tsx:4339-4371`).
- **Welcome card with 2×2 suggestion grid** (`ChatWelcomeCard.tsx:67-169`) — empty state isn't a void, it's a curated set of starter prompts.
- **Streaming bubble** uses `isStreaming: boolean` on the Message type. New tokens append to the in-flight bubble's content; on completion the flag flips and the bubble looks identical to a finalized one.
- **Date-grouped session history** ("Today / Yesterday / This Week / Older") with live search, rename, delete (`SessionHistorySidebar.tsx:328-359`).

### 2.2 BYOK panel state machine (from `BYOKPanel.tsx`)

Two-mode layout that's critical to copy:

- **Unconfigured mode (wizard):** 3-step linear flow — provider → model → API key. Each step is a card grid with hover lift + checkmark on selection. Provider cards have colored badge (40×40px, first letter, semantic color per provider), name, description, "Recommended" chip.
- **Configured mode (collapsed):** Compact card "[Provider] • [Model] ✓" with refresh + delete icons. Clicking re-expands the wizard. *This is what keeps the UI clean after onboarding.*

**Specific patterns to lift:**

- **`maskApiKey()`** displays `xxxx…yyyy` (first 4 + ellipsis + last 4) per `BYOKCloudSyncService.ts:201-204`. Same masking everywhere a key is shown.
- **Password input with eye toggle** for entry; clear input field immediately on submission so plaintext doesn't sit in React state (`BYOKPanel.tsx:305-306`).
- **Inline configure-from-model-selector** — clicking an unconfigured model's provider pops an inline config form right in the dropdown (`ModelSelector.tsx:76-181`). Means "I need GPT-4 but don't have an OpenAI key" is a 2-click fix, not a tab switch.
- **Trust-building security alert** with shield icon: *"Your key is encrypted and never sent to our servers in plaintext."* One sentence, high ROI (`BYOKPanel.tsx:374-378`).
- **Status indicators** consistently colored: green = active/ready, amber = setup required, red = delete/error.

### 2.3 Card-registry extensibility (from `CardComponentRegistry.ts`)

This is **the most important pattern to copy** for the "extendable framework" the user asked for. MyndHyve registers a card-type → component map at module load:

```ts
getCardComponentRegistry().register('prd', {
  label: 'Product Requirements Document',
  icon: 'FileText',
  checkpointCard: MyCustomCheckpointCard,        // full HITL card
  artifactSummaryCard: MyCustomSummaryCard,      // post-approval summary
  previewRenderer: (cp, art) => <CompactPreview .../>,
  actionHandlers: { 'view': handler, 'edit': handler },
});
```

The chat renderer queries the registry with the artifact's type and falls back to a default card if no custom one is registered. Adopters extend by calling `register()` from their own module — zero modification to the chat panel itself.

**Critical contract** (`WorkflowCardRenderer.tsx:80-200`):
- Cards wrapped in `CardErrorBoundary` so a broken third-party card doesn't crash the chat.
- Standard props every card accepts: `{artifact, artifactType, actions, onAction, context, isLoading, askService}`.
- Actions returned from cards bubble up via `onAction(actionId, payload)` to a dispatcher that calls the engine.

For the openwop sample this maps **perfectly** to:
- **Interrupt cards** — each interrupt kind (`approval`, `clarification`, `refinement`, `cancellation`) is a registered card type. The 4 existing components in `apps/workflow-engine/frontend/react/src/interrupts/` move into the registry. Adopters register their own custom card by `kind` or by a `metadata.cardType` field.
- **Future artifact renderers** — when openwop adds artifact types (per `host-extensions.md`), the registry is the seam.

---

## 3. What to drop (MyndHyve-specific)

Hard line. None of these come over:

| MyndHyve concern | Why dropped |
|---|---|
| Firestore + Firebase Auth + Cloud KMS | Cloud-coupled; sample stays storage-pluggable |
| Canvas types / `canvasTypeId` routing | Product concept, not protocol |
| Kanban / app-builder / workspace stores | Product surface |
| `httpsCallable(functions, 'aiProxy')` | Firebase-specific transport; sample uses Bearer + REST |
| `useTokenEnforcementContext` + budget gating | Billing tier |
| Brand voice injection in system prompt | Product feature |
| Voice input via Web Speech API | Optional; defer |
| `WorkflowSelectorDialog`, screen preview, applied animations | Canvas-renderer concerns |
| MUI dependency | Sample uses hand-rolled CSS modules; keep zero UI-framework deps |

**Two clarifications worth calling out:**

- **MUI removal.** MyndHyve uses MUI heavily. The openwop sample uses hand-rolled CSS (`global.css`) per the original analysis — adding MUI would bloat the sample's `node_modules` ~30MB. The patterns I'm lifting are *visual* (token systems, layouts), not implementation — they re-skin trivially.
- **No KMS in the sample.** MyndHyve wraps every key with Cloud KMS server-side. The sample's BE has an in-memory map (`src/byok/secretResolver.ts`). The UI's *trust-building copy* still applies, but the truth is "this is sample-grade; production replaces with KMS" — say so plainly.

---

## 4. Proposed architecture for the openwop sample

### 4.1 Tab rename + new IA

The current `/byok` route becomes the new **AI** tab. Inside, two states:

**State A — No key configured (BYOK onboarding):**
- Wizard: provider → model → API key (mirrors MyndHyve)
- Once a key is stored, transitions to State B
- Cancel/skip option for users who just want to read the docs

**State B — Configured (chat surface):**
- Chat sidebar fills the main area
- Top-right: small "[Provider] • [Model]" pill with gear icon → opens BYOK panel as a side-drawer or modal for swapping keys/models without leaving chat
- Chat consumes BYOK via a real openwop run

### 4.2 Component tree

```
src/chat/                              ← NEW directory
├── ChatTab.tsx                        ← top-level tab; routes between BYOK wizard + chat
├── ChatSidebar.tsx                    ← the chat surface itself (header + feed + input)
├── ChatHeader.tsx                     ← model chip, settings gear, cost indicator
├── MessageFeed.tsx                    ← scrollable list w/ auto-scroll
├── MessageBubble.tsx                  ← user / assistant differentiation
├── ChatInput.tsx                      ← auto-resize textarea + send button
├── WelcomeCard.tsx                    ← empty state with suggestion grid
├── SessionHistoryDrawer.tsx           ← (Phase 2) date-grouped past chats
├── hooks/
│   ├── useChatSession.ts              ← message state + send dispatcher
│   ├── useRunStream.ts                ← consumes EventSource, appends to bubble
│   └── useBYOKConfig.ts               ← reads/writes BYOK config (localStorage + BE)
└── registry/
    ├── CardRegistry.ts                ← the extensibility surface
    ├── defaultCards.ts                ← register the 4 interrupt-kind cards
    └── types.ts                       ← CheckpointCardProps + register API

src/byok/                              ← REVISED
├── BYOKWizard.tsx                     ← 3-step provider/model/key flow
├── ProviderCard.tsx                   ← colored-badge selectable card
├── ModelCard.tsx                      ← model picker with ctx/capability/cost chips
├── APIKeyInput.tsx                    ← masked input + eye toggle + trust alert
├── ConfiguredProviderCard.tsx         ← compact stored-key display
├── BYOKSettingsDrawer.tsx             ← side-drawer wrapper for in-chat access
├── PolicyExplainer.tsx                ← KEEP — still useful as a help panel
└── lib/
    ├── maskApiKey.ts                  ← `xxxx…yyyy` formatter
    └── providers.ts                   ← provider taxonomy + colors + placeholders

src/interrupts/                         ← MOVE these into the card registry
   (existing 4 components register themselves via `defaultCards.ts`)
```

### 4.3 The chat → openwop run mapping

Each user message in the chat creates **one OpenWOP run** that the BE executes and streams back. The mapping:

| Chat action | OpenWOP wire call |
|---|---|
| User submits message | `POST /v1/runs` with `workflowId: 'sample.chat.turn'`, `inputs: {prompt, history}`, `metadata: {chatSessionId}`, `configurable: {credentialRef: <byok-ref>}` |
| Subscribe to events | `GET /v1/runs/{id}/events?mode=messages,values` |
| Token chunks (when wired) | `node.message` events → append to in-flight bubble |
| Final answer | `node.completed` → flip `isStreaming: false`, finalize bubble |
| Interrupt mid-run (e.g., approval) | `node.suspended` → fetch `GET /v1/runs/{id}/interrupts` → render the registered card → user click → `POST /v1/interrupts/{token}` |
| Reasoning trail (when wired) | `agent.reasoned` events → collapsible "Show reasoning" below the bubble |

The chat surface knows nothing about LLM providers — it knows only `messages` mode. The BE's `sample.chat.turn` workflow does the actual provider dispatch via the BYOK-resolved key.

### 4.4 Required BE additions

The chat needs three things the BE doesn't yet have:

1. **`sample.chat.turn` workflow** in `host/index.ts:workflowCatalog`. Single-node initially: `local.sample.chat.responder` that calls a configured AI provider (when BYOK key is present) or echoes back with `{ completion: 'BYOK required — configure a key in the AI tab' }` otherwise. Declares `requires.secrets[]` so the BYOK invariant fires.

2. **`local.sample.chat.responder` node** in `bootstrap/nodes.ts`. Wires to a minimal provider dispatcher (initially: Anthropic OR OpenAI via stdlib `fetch` — single function per provider, no new deps). Emits `node.message` events for streaming tokens via `ctx.emit('node.message', {delta: '...'})`. The existing strip-on-persist + cost-emitter already wired.

3. **`POST /v1/byok/secrets` endpoint** (or similar) so the FE can store a BYOK key without restarting the BE. Updates `secretResolver` map in-place. Auth-gated. Returns `{credentialRef}` only — never echoes back the value. *Honest comment in the code: "Real deploys swap for KMS-wrapped storage."*

### 4.5 The card registry contract

```ts
// src/chat/registry/types.ts
export interface CardProps {
  /** The persisted interrupt or artifact record. */
  payload: unknown;
  /** Discriminator — 'interrupt.approval' / 'interrupt.clarification' / 'artifact.<type>' / etc. */
  cardType: string;
  /** Convenience: the openwop run id + node id. */
  context: { runId: string; nodeId?: string; tenantId: string };
  /** Action dispatcher — calls registered actionHandlers or the openwop wire. */
  onAction: (actionId: string, payload?: unknown) => Promise<void>;
  /** Loading state for the parent. */
  isLoading?: boolean;
}

export interface CardRegistration {
  cardType: string;
  /** Human label shown in tooltips / debug. */
  label: string;
  /** Main React component for this card. */
  Component: React.ComponentType<CardProps>;
  /** Optional compact preview shown when card is collapsed. */
  PreviewComponent?: React.ComponentType<CardProps>;
  /** Optional action handlers — return true to consume, false to bubble. */
  actionHandlers?: Record<string, (payload: unknown, ctx: CardProps['context']) => Promise<boolean>>;
}

// src/chat/registry/CardRegistry.ts
export function registerCard(reg: CardRegistration): void;
export function getCard(cardType: string): CardRegistration | null;
export function listCards(): readonly CardRegistration[];
```

Built-in registrations in `defaultCards.ts`:

```ts
registerCard({ cardType: 'interrupt.approval',     Component: ApprovalCard });
registerCard({ cardType: 'interrupt.clarification',Component: ClarificationDialog });
registerCard({ cardType: 'interrupt.refinement',   Component: RefinementForm });
registerCard({ cardType: 'interrupt.cancellation', Component: CancellationBanner });
```

Adopters extend by calling `registerCard()` from their own module — zero changes to `MessageFeed.tsx`.

### 4.6 Provider taxonomy (initial)

Three providers in the wizard, mirroring MyndHyve's bundle but smaller:

| Provider | Badge color | Key prefix | Default model |
|---|---|---|---|
| Anthropic | `#cc785c` (rust orange) | `sk-ant-…` | `claude-sonnet-4-6` |
| OpenAI | `#10a37f` (green) | `sk-…` | `gpt-4o-mini` |
| Google | `#4285f4` (blue) | `AIza…` | `gemini-2.0-flash` |

Defined once in `byok/lib/providers.ts`. Adding a 4th provider = adding a row to that array. No string-matching across the codebase.

---

## 5. Design tokens

Lift the structure from MyndHyve's CSS-variable system (`/Users/david/dev/myndhyve/src/index.css:29-150`) and add to the sample's existing `global.css`. Already there: `--color-bg`, `--color-surface`, `--color-text`, `--color-accent` etc. Adding:

```css
/* Chat-specific tokens — new in this work */
:root {
  --color-msg-user-bg: #5b8cff;        /* maps to --color-accent */
  --color-msg-user-text: #ffffff;
  --color-msg-assistant-bg: #1c2230;   /* maps to --color-surface-2 */
  --color-msg-system-bg: rgba(251, 191, 36, 0.1); /* warn-tinted */
  --radius-bubble: 16px;
  --radius-pill: 24px;
  --max-bubble-width: 75ch;            /* readable line length */
  --chat-input-height-max: 120px;      /* matches MyndHyve */
  --chat-feed-pad: var(--space-4);
}
```

Light-mode variants flip under the existing `@media (prefers-color-scheme: light)` block. No theme toggle needed initially; auto-follow OS.

---

## 6. Phased implementation

### Phase 1 — minimum viable chat (1 commit, ~1.5K LOC)

- Rename `/byok` route to `/ai`; navigation chip updates
- `BYOKWizard` (3 steps, copies MyndHyve's pattern)
- `BYOKSettingsDrawer` for in-chat access
- New BE: `POST /v1/byok/secrets` endpoint; `sample.chat.turn` workflow; `local.sample.chat.responder` node with **mock** provider dispatch (echoes user prompt as `Mock response to: <prompt>` — same pattern as the existing `local.sample.demo.mock-ai` node, but emits `node.message` deltas for streaming UX demo)
- New FE: `ChatTab`, `ChatSidebar`, `ChatHeader`, `MessageFeed`, `MessageBubble`, `ChatInput`, `WelcomeCard`
- `useChatSession` + `useRunStream` hooks
- `CardRegistry` infrastructure + the 4 existing interrupt components move in as default cards
- Welcome state with 4 suggested prompts: "Run the uppercase workflow on this text", "Walk me through the approval-gate workflow", "What capabilities does this host advertise?", "Explain BYOK in three sentences"

**What's NOT in Phase 1:** real provider dispatch (mock only), session history, slash commands, @-mentions, voice input, file attach, multi-turn memory.

### Phase 2 — real providers (1 commit, ~600 LOC)

- Anthropic + OpenAI dispatchers in the BE responder node (stdlib `fetch`, no SDK deps). Streams real tokens via `node.message` events. Existing strip-on-persist + cost-emitter already wired.
- Session history drawer (`SessionHistoryDrawer`) using sqlite-backed `chat_sessions` table. Date grouping + search.
- `RegisterAgentCard` example in the registry — shows adopters how to plug a custom card type via `registerCard({...})` in 10 lines.

### Phase 3 — polish (optional, ~400 LOC)

- Slash commands (`/run <workflowId>`, `/cancel`, `/clear`, `/help`)
- Cost indicator chip in header
- Inline configure-from-model-selector (the MyndHyve 2-click pattern)
- Rate limit + retry handling

---

## 7. Extensibility — what's the "framework" the user asked for?

Three explicit extension seams, each documented in the new `apps/workflow-engine/frontend/react/src/chat/README.md`:

1. **Register a custom card** — `registerCard({cardType: 'mydomain.foo', Component: MyFooCard})` from any module. The chat panel dispatches by `cardType` and falls back to a generic envelope card if unregistered.
2. **Register a new BYOK provider** — append a row to `byok/lib/providers.ts`. Wire dispatch in the BE responder node. No FE component changes.
3. **Register a chat command** (Phase 3) — `registerCommand({name: '/foo', handler})` for slash-command extension.

All three seams use the same module-load registration pattern. Adopters don't fork the chat panel — they import + register.

---

## 8. Open decisions for the user before implementation

1. **Mock-only Phase 1, or real providers immediately?** Phase 1 with a mock means the demo works without any real API key (you can showcase the chat UX cold). Real providers immediately means BYOK actually buys something on day one but the demo requires a key. **My recommendation: mock-only Phase 1**, real in Phase 2.
2. **MUI or stay hand-rolled CSS?** MyndHyve's patterns assume MUI. Hand-rolled CSS keeps the sample lean but means more component code (no `<Stack>`, `<Card>`, `<TextField>` shorthand). **My recommendation: stay hand-rolled.** Adds ~300 LOC vs MUI but keeps `node_modules` small and the patterns more transferable.
3. **Replace the BYOK tab entirely vs add a separate Chat tab?** The user said "build it into the BYOK tab interface" — I'm reading this as *replace*. The BYOK form becomes the gating wizard for the new AI tab. Alternative: keep both `/byok` (settings-style) and add `/ai` (chat). **My recommendation: replace** — fewer tabs to explain, BYOK has a real consumer.
4. **Session history backed by sqlite (BE) or localStorage (FE-only)?** sqlite means sessions persist across browsers / devices (when the BE has real auth); localStorage is simpler but lost on cache-clear. **My recommendation: localStorage in Phase 1, sqlite-backed in Phase 2.**
5. **How extendable does Phase 1's card registry need to be?** Minimal (just the 4 interrupt kinds with cardType discriminators) or already-pluggable (full `registerCard` API + README + example)? **My recommendation: already-pluggable** — the registry IS the framework the user asked for; cutting it would defeat the purpose.

Answers to these gate Phase 1.

---

## 9. Out-of-scope (don't build this)

- Multi-modal input (images, PDFs)
- Voice input / TTS playback
- Inline editing of past messages
- Branching conversations / forking from a message
- Streaming reasoning traces (defer to when agent.reasoned events ship in `core.openwop.ai` pack)
- Token budget enforcement / billing gates
- Multi-tenant workspace switcher

Each is a real feature in MyndHyve; each is product-scope, not protocol-demo-scope.

---

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mock responder feels lifeless | High | Medium | Phase 2 with real providers ships within a week of Phase 1; mock has visible `[mock]` label |
| Card-registry API drifts when new card types arrive | Medium | Medium | Keep CardProps narrow (5 fields max); version via `cardSchemaVersion` field if needed |
| BYOK key reaches localStorage when user navigates away mid-wizard | Medium | High | Clear input field on submission; never `setState(key)`; in-memory only |
| FE becomes too coupled to the sample's specific node types | Low | Medium | Card registry takes a string discriminator, not a hardcoded enum |
| Adding providers in Phase 2 requires SDK deps (Anthropic SDK, OpenAI SDK) | Low | Low | Use raw `fetch` to provider REST endpoints; ~60 LOC per provider |
| The user wants the chat to actually orchestrate openwop workflows (not just be an LLM chat) | Medium | High | Phase 3 slash commands (`/run sample.demo.approval-gate`) give this surface; flag it explicitly so we don't over-build Phase 1 |

---

## 11. What this analysis assumes

- The user wants a *teaching-quality* chat surface, not a production-grade one. (Stated: "extendable framework for us to continue to build upon.")
- The sample is for demonstrating openwop, not for shipping as a MyndHyve alternative.
- BYOK key management staying in-memory for the sample is acceptable with explicit "swap for KMS" comments.
- React + hand-rolled CSS + zero MUI is the right baseline (matches existing sample posture).

If any assumption is wrong, several answers in §8 flip.

---

**End of analysis.** Next step: confirm the 5 open decisions in §8, then ship Phase 1 in a single commit.
