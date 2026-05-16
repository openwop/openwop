# Sample Chat — Improvements from MyndHyve (Round 2)

> **Status:** Pre-implementation analysis. Successor to `plans/openwop-sample-chat-ui-plan.md`. Phase-1 chat shipped (commits `7fa0108` + `d8a7031` + `abb555b`); this doc plans what to add next based on a focused gap analysis against MyndHyve's chat surface.
> **Created:** 2026-05-16
> **Authoritative sources:**
> - MyndHyve `src/components/chat/ChatPanel.tsx` (4665 LOC), `chat/hooks/`, `chat/renderers/`, `chat/cards/`
> - MyndHyve `services/chat/` — `StreamingEnvelopeHandler.ts`, `ErrorRecoveryService.ts`, `CostBudgetService.ts`, `crossTab.ts`
> - Current openwop sample: `apps/workflow-engine/frontend/react/src/chat/`

---

## 0. Single-sentence framing

The sample's chat works on the happy path with a clean architecture; MyndHyve teaches us how to make it **robust under failure**, **discoverable to power users**, and **honest about cost** — and where to draw the line so we don't accidentally rebuild a product.

---

## 1. What MyndHyve has that we don't, ranked by user impact

### Category A — Visible UX polish (users notice immediately)

| Gap | MyndHyve pattern | Effort | Impact |
|---|---|---|---|
| **No code blocks** | Regex-split `\`\`\`lang ... \`\`\`` → styled `<pre><code>` block with language label + copy-button + 2s "Copied!" feedback. Deliberately *no* syntax highlighting (regex fragility). (`ChatPanel.tsx:554-610`) | 1 day | HIGH — code is the #1 artifact in LLM chat |
| **No message actions** | Hover-revealed toolbar: Copy, Regenerate, Thumbs Up/Down. Per-message `feedback: 'positive' \| 'negative'` state. ARIA pressed states. (`ChatPanel.tsx:3796-3843`) | 1-2 days | HIGH — signals "real product" UX |
| **Bubble shows raw error string** | Smart error card: regex-detects "I encountered an error…" preamble, parses structured fields, renders red-bordered card with icon + bullet list + extracted URLs + retry CTA. Screen-reader `role="alert"`. (`ChatPanel.tsx:619-753`) | 2-3 days | MEDIUM-HIGH — turns "scary stack trace" into "actionable help" |
| **No stop button during stream** | Send button morphs to red Cancel during stream. Confirm modal → `engine.cancelRun(runId)` → system message announces cancellation. (`ChatPanel.tsx:1904-1986, 4355-4390`) | 3-6 hours | HIGH — users feel trapped without it |
| **No slash commands** | Popover above input on `/` keystroke. `useFilteredCommands` filters by name+description+aliases. `useCommandAutocompleteKeyboard` handles ↑↓ wrap, Tab single-match autocomplete, Esc dismiss. Generic — registry-driven. (`CommandAutocomplete.tsx:104-173`) | 2-3 hours (UX); 1 day to add a useful command set | HIGH — power users get 10× faster |
| **No file attach** | Hidden `<input type="file">` ref + Paperclip button. `Attachment` type `{id, name, type, size, url}` via `URL.createObjectURL`. Preview bar with per-item delete. Image vs file icon dispatch. (`ChatPanel.tsx:2775-2789, 4095-4121`) | 2 hours | MEDIUM — depends on whether we wire it to a vision-capable provider |

### Category B — Robustness (silent failures users hate)

| Gap | MyndHyve pattern | Effort | Impact |
|---|---|---|---|
| **No SSE timeouts** | Dual-layer: 30s idle (resets per chunk) + 120s absolute deadline (never resets). Fires `stream:timeout` event to UI. Prevents runaway streams from eating memory. (`StreamingEnvelopeHandler.ts:138-150`) | 2 hours | HIGH — single biggest robustness win |
| **No error classification** | `ErrorRecoveryService` classifies error string → `{category: 'network'\|'auth'\|'rate_limit'\|'quota'\|'timeout', action: 'retry'\|'resume'\|'regenerate'\|'reconfigure'\|'abort'\|'contact_support', userMessage}`. UI dispatches on category. (`ErrorRecoveryService.ts:14-73`) | 1 day | HIGH — replaces "internal_error: anthropic_429" with actionable next steps |
| **No mid-stream 401 handling** | Stream-error with `status: 401` → ErrorRecoveryService classifies as `auth` → dialog "Session expired" → on confirm, full re-auth flow. Without this, token expiry → silent SSE close → user thinks AI is still thinking. | 1 day | HIGH for real deploys, LOW for sample (no real auth yet) |
| **No partial-response preservation** | Stream-buffer is NOT cleared on error. Subsequent retries resume from last valid JSON boundary via `Last-Event-ID` header (already in SSE spec; we just need to use it on retry). | 1-2 days | MEDIUM — better than dropping a half-finished answer |
| **No 429 backoff** | `ErrorRecoveryService` returns `action: 'retry'` with exponential backoff (1s → 2s → 4s, max 3). Without this, retry spamming makes rate limits worse. | 4 hours | MEDIUM |

### Category C — Cost + budget transparency

| Gap | MyndHyve pattern | Effort | Impact |
|---|---|---|---|
| **No per-turn cost visibility** | `usage: {inputTokens, outputTokens, cost}` on every message. Cost computed client-side from model pricing in `providers.json`. (`CostBudgetService.ts`) | 4 hours — we already have `cost` in providers.json + the responder returns usage; just need to display it in the bubble footer | HIGH — users hate surprise bills |
| **No running session total** | Composer footer chip: "$0.42 / $10 monthly". Updates per turn. | 4 hours | MEDIUM |
| **No budget gating** | Hard-block at threshold (server returns 402 in their impl). Alerts at 50/80/95%. | 1-2 days — needs storage layer for per-user budget | LOW for sample (no per-user concept) |

### Category D — Multi-session + history

| Gap | MyndHyve pattern | Effort | Impact |
|---|---|---|---|
| **Single rolling session, no history** | `SessionHistorySidebar.tsx` (538 LOC): date grouping (Today/Yesterday/This Week/Older), search, rename (inline TextField), delete (modal + undo), sync-status icons, footer "Syncing…" chip. | 2-4 days — backend + frontend; biggest item on the list | HIGH — table-stakes once chat has any history |
| **No multi-tab sync** | `BroadcastChannel('myndhyve-cross-tab')` with JSON-RPC 2.0 envelope. Tab IDs stable across sessions. `WorkflowTabLock` prevents dual execution. (`crossTab.ts:44-57`) | 1-2 days — minimal viable in 2 hours | MEDIUM — annoyance, not data loss |

### Category E — Hook decomposition

| Gap | MyndHyve pattern | Effort | Impact |
|---|---|---|---|
| **`useChatSession` is becoming a mega-hook** (~250 LOC, will grow) | MyndHyve splits across `useChatOrchestration`, `useChatStreaming`, `useApplyAnimation`, `useClaimStaleness`, etc. — each one stateful surface gets its own hook with its own lifecycle. | 2-3 days when complexity warrants it | MEDIUM — preventative; defer until next big addition |

---

## 2. What we should explicitly NOT port

These are real MyndHyve features that don't belong in a teaching sample:

| MyndHyve has | Why we skip |
|---|---|
| **Citation rendering** (`[src_N]` chips with popovers) | No RAG in the sample. Add only when we ship a RAG demo |
| **@-mention autocomplete** for canvas/agent/workflow | Multi-type mentions need our own agent/canvas concept, which we don't have. The slash-command pattern covers the same UX |
| **Voice input** (Web Speech API) | Browser-permission complexity + variance. Defer indefinitely |
| **Markdown via `react-markdown`** | Heavy dep tree (remark + rehype + plugins). Plain text + code blocks covers 80% of LLM output. Adopters who want markdown can swap in their lib of choice |
| **Workflow envelope cards** (screen-generation, animation overlays) | MyndHyve product-scope (canvas types). The sample's CardRegistry handles this generically — adopters extend |
| **Brand voice injection in system prompt** | Product feature |
| **Token-enforcement context provider** | Billing tier |
| **Apply-animation overlay** for incoming responses | Cosmetic; defer indefinitely |
| **Harness budget indicator chip** (full version) | We'll do a stripped-down per-session cost chip instead |

---

## 3. Prioritized roadmap

### Phase 2A — Fastest wins (~1 week, all visible polish)

In order of effort-to-impact:

1. **Code blocks + copy button** (1 day) — `MessageRenderer.tsx` parser that splits on `\`\`\``, returns `[text, codeblock, text, ...]`. New `<CodeBlock>` component with language label + copy button.
2. **Stop / cancel button** (3-6 hours) — depends on whether `routes/runs.ts` exposes `POST /v1/runs/:id/cancel` (it does). FE: Send button morphs during stream, confirm modal, calls `cancelRun(runId)`.
3. **Per-turn cost display** (4 hours) — already have `usage.inputTokens`/`outputTokens` on the message + `cost` per 1K tokens in `providers.json`. Just need to multiply + render under the bubble.
4. **Slash commands** (2-3 hours UX + 1 day for a real command set like `/run <workflowId>` `/clear` `/help` `/cost`) — port the two hooks from MyndHyve.
5. **Message actions bar** (1-2 days) — hover-revealed Copy, Regenerate (we'd need to wire regenerate first), Thumbs Up/Down.
6. **Error card** (2-3 days) — parse our existing `error.code` + `error.message` into a structured card. Map well-known codes (`empty_completion`, `credential_unavailable`, `host_capability_missing`, etc.) to friendly headlines + suggested actions.

### Phase 2B — Robustness (~1 week)

1. **Dual-layer SSE timeouts** (2 hours) — idle (30s, resets per chunk) + absolute (120s). Both fire `stream:timeout` → bubble flips to error state with "Reconnect" button.
2. **ErrorRecoveryService pattern** (1 day) — classify errors by category, return `{category, action, userMessage}`. Wire the FE bubble to dispatch on action (retry, regenerate, reconfigure, abort).
3. **Exponential backoff for 429** (4 hours) — handle inside the responder node's dispatcher, retry once after 1-2s before surfacing as failure.
4. **Last-Event-ID resume on reconnect** (1-2 days) — the FE already sends Last-Event-ID via the EventSource standard; the BE's `streams.ts` already honors `fromSeq`. Just need to verify behavior under disconnect + add a test.

### Phase 2C — Sessions + multi-tab (~1 week)

1. **Session history sidebar** (2-4 days) — list/rename/delete via sqlite-backed `chat_sessions` table. Date grouping + search.
2. **BroadcastChannel sync** (1-2 days) — minimal viable: `BroadcastChannel('openwop-sample-chat')`, post on `message.added`, listen in `useChatSession` and merge.

### Phase 2D — Hook decomposition (preventative, ~2 days)

Trigger when `useChatSession.ts` crosses ~400 LOC OR the next feature needs a new lifecycle:
- `useStreamLifecycle` — EventSource setup/teardown, timeouts, reconnect
- `useChatPersistence` — localStorage + BroadcastChannel sync
- `useCostBudget` — per-turn + per-session totals, threshold alerts

---

## 4. Specific code changes per phase

### Phase 2A.1 — Code blocks

New file: `apps/workflow-engine/frontend/react/src/chat/MessageRenderer.tsx`

```ts
// Single function: split content on ``` fences, return array of jsx segments.
// Text segments render as plain whitespace-pre-wrap.
// Code segments render via <CodeBlock language="..." source={...} />.
// Total ~80 lines including the CodeBlock component.
```

Wire into `MessageBubble.tsx`:
```tsx
{message.content
  ? <MessageRenderer content={message.content} />
  : message.isStreaming ? <span>Thinking…</span> : ...}
```

### Phase 2A.2 — Stop button

`ChatInput.tsx` gains a new prop `onCancel?: () => void`. When `disabled && isStreaming`, render a red square-icon button instead of disabled-send. Click → optional `confirm()` → callback.

`useChatSession.ts` exposes `cancel()` that closes the SSE subscription + calls `POST /v1/runs/{id}/cancel`. The existing `cancelRun()` client wrapper is already there.

### Phase 2A.3 — Cost display

`MessageBubble.tsx` meta footer already shows `provider/model · in N · out M`. Just add the cost calculation:

```ts
import { getProvider } from '../byok/lib/providers.js';

function costForMessage(meta: ChatMessage['meta']): string | null {
  if (!meta?.provider || !meta?.model || meta.inputTokens == null || meta.outputTokens == null) return null;
  try {
    const provider = getProvider(meta.provider);
    const model = provider.models.find((m) => m.id === meta.model);
    if (!model?.cost) return null;
    const usd = (meta.inputTokens * model.cost.input + meta.outputTokens * model.cost.output) / 1000;
    return `$${usd.toFixed(4)}`;
  } catch { return null; }
}
```

### Phase 2A.4 — Slash commands

New extensibility surface mirroring `CardRegistry`:

```ts
// src/chat/registry/CommandRegistry.ts
export interface CommandRegistration {
  name: string;          // "/clear"
  description: string;   // "Start a new chat session"
  aliases?: readonly string[];
  /** Returns true to consume; false to insert command text into chat as a regular message. */
  handler: (args: string, ctx: { send: (text: string) => Promise<void>; reset: () => void }) => Promise<boolean>;
}
export function registerCommand(reg: CommandRegistration): void;
export function listCommands(): readonly CommandRegistration[];
```

Built-in commands at boot:
- `/clear` — wipes the session
- `/help` — lists registered commands
- `/cost` — prints session-total cost as a system message
- `/run <workflowId>` — fires off a non-chat openwop run (e.g., `/run sample.demo.uppercase`)

Adopters extend with `registerCommand({name: '/mydomain.foo', handler: ...})`.

### Phase 2A.5 — Message actions bar

`MessageBubble.tsx` gains an absolute-positioned toolbar visible on hover:
- Copy (writes content to clipboard, "Copied!" tooltip for 2s)
- Regenerate (re-runs the prior user message; replaces the current assistant bubble)
- 👍 / 👎 (records `feedback` in message state, persisted to localStorage; no BE wiring yet)

Regenerate needs new helper in `useChatSession`:
```ts
const regenerate = useCallback(async (assistantMessageId: string) => {
  const idx = session.messages.findIndex((m) => m.id === assistantMessageId);
  if (idx < 1) return;
  const userMsg = session.messages[idx - 1];
  if (userMsg?.role !== 'user') return;
  // Remove the assistant bubble + re-send the user message.
  setSession((s) => ({ ...s, messages: s.messages.slice(0, idx) }));
  await send(userMsg.content, config);
}, [session, send]);
```

### Phase 2A.6 — Error card

New `<ErrorCard error={...}>` component. Map well-known `error.code` strings:

| code | Title | Suggested action |
|---|---|---|
| `empty_completion` | "No response from the model" | "Try a different model or rephrase the prompt" |
| `credential_unavailable` | "API key missing" | "Add your key in the BYOK settings" + button → open BYOK wizard |
| `credential_required` | "BYOK required" | Same as above |
| `internal_error` (when message starts with `<provider>_<status>:`) | Provider-specific error from upstream | Show raw `provider/status` + suggested action based on status (429 → wait; 401 → reconfigure; 500 → retry) |
| anything else | "Something went wrong" | Raw code + message |

Rendered as a red-bordered card replacing the empty bubble content.

### Phase 2B.1 — SSE timeouts

`streamsClient.ts` (FE) gains:

```ts
interface SubscribeOptions {
  // existing fields...
  idleTimeoutMs?: number;       // default 30_000
  absoluteTimeoutMs?: number;   // default 120_000
  onTimeout?: (kind: 'idle' | 'absolute') => void;
}
```

Implementation: `setTimeout` for absolute (set once); `setTimeout` for idle (reset in `onEvent`). On fire, `es.close()` + invoke `onTimeout`.

### Phase 2B.2 — ErrorRecoveryService

New BE-side classifier: `src/observability/errorRecovery.ts`. Maps provider-error strings (`anthropic_429`, `openai_401`, `google_500`, etc.) to a small enum:

```ts
type ErrorCategory = 'network' | 'auth' | 'rate_limit' | 'quota' | 'timeout' | 'safety' | 'config' | 'unknown';
type RecoveryAction = 'retry' | 'regenerate' | 'reconfigure' | 'abort' | 'wait';

export function classifyDispatchError(err: Error): {
  category: ErrorCategory;
  action: RecoveryAction;
  retryAfterMs?: number;
  userMessage: string;
};
```

Used by `local.sample.chat.responder` to surface a structured error instead of raw provider strings. FE error-card consumes `category` + `action` to render appropriate UI.

### Phase 2B.3 — 429 backoff

Inside `dispatchAnthropic` / `dispatchOpenAI` / `dispatchGoogle`: on `res.status === 429`, parse `Retry-After` header (or default 2s), `await new Promise(r => setTimeout(r, ms))`, retry once. Cap at 3 attempts total.

### Phase 2C.1 — Session history

New sqlite table:
```sql
CREATE TABLE chat_sessions (
  session_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER DEFAULT 0
);
CREATE TABLE chat_messages (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
```

Vendor-prefixed routes:
- `GET /v1/host/sample/chat/sessions` → list
- `POST /v1/host/sample/chat/sessions` → create
- `PATCH /v1/host/sample/chat/sessions/:id` → rename
- `DELETE /v1/host/sample/chat/sessions/:id` → delete
- `GET /v1/host/sample/chat/sessions/:id/messages` → load thread

FE: `SessionHistoryDrawer.tsx` + `useChatSessions.ts` (new collection hook). Drop the localStorage-only persistence; sqlite becomes source of truth.

### Phase 2C.2 — BroadcastChannel

Minimal viable in `useChatSession`:
```ts
const channelRef = useRef<BroadcastChannel | null>(null);
useEffect(() => {
  if (typeof BroadcastChannel === 'undefined') return;
  channelRef.current = new BroadcastChannel('openwop-sample-chat');
  channelRef.current.onmessage = (e) => {
    if (e.data.type === 'session:updated' && e.data.sessionId === session.id) {
      // Reload the session
    }
  };
  return () => channelRef.current?.close();
}, [session.id]);
```

Post on message append + delete + rename.

---

## 5. Decisions needed from the user before Phase 2A starts

1. **Skip or include markdown rendering?** — MyndHyve uses plain text + code blocks (no markdown). I recommend matching MyndHyve for now. Markdown adds ~250KB of dep tree (remark + rehype + plugins) and most LLM outputs render fine as plain-text-with-code.

2. **Should slash commands be a Phase 2A scope-creep risk?** — The autocomplete UI is 2-3 hours; defining a useful command set (`/run`, `/clear`, `/help`, `/cost`) is another full day. I recommend: ship the autocomplete + 2 built-in commands (`/clear`, `/help`), and let users add their own via `registerCommand()`.

3. **Stop-button behavior:** — confirm modal on click, or instant-cancel? MyndHyve uses confirm modal. I recommend instant-cancel (with undo via a 5s "Cancelled — undo" snackbar) — fewer clicks for the common case.

4. **Session history backend:** — sqlite is consistent with rest of the sample. Alternative is server-side per-user but we have no user concept. I recommend sqlite + one anonymous tenant for the sample.

5. **Cost display unit:** — per-turn USD, per-session running total, or both? Per-turn alone is clutter (most turns are < $0.01). I recommend per-turn shown as `$0.0042` in muted text, plus a session-total chip in the header `Σ $0.31` that updates live.

6. **Phase ordering preference:** — Phase 2A (visible polish) first matches MyndHyve's "you can see it works" feel; Phase 2B (robustness) prevents the embarrassing bugs. I recommend interleaving: 2A.1-3 → 2B.1 → 2A.4-6 → 2B.2-3 → 2C. Total ~3 weeks at moderate pace.

---

## 6. Out-of-scope (deliberate cuts)

These DO NOT belong in any phase:

- **Citation rendering / RAG sources** — no RAG demo in the sample
- **@-mention autocomplete** — no agent/canvas concept; slash commands cover the same UX
- **Voice input** — permissions + browser variance; defer indefinitely
- **Apply-animation overlay** — cosmetic
- **Full budget enforcement** (alerts at 50/80/95%, hard 402 blocks) — no per-user concept
- **Branch from message** — fork is already disabled in discovery (`replay: false`)
- **Markdown via react-markdown** — heavy deps for marginal value
- **Inline configure-from-model-selector** — defer to Phase 3 (the MyndHyve 2-click swap pattern)
- **Streaming reasoning traces** — `agent.reasoned` events not yet emitted by any provider dispatcher

---

## 7. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 2A polish makes the sample feel "done" and Phase 2B robustness gets skipped | Medium | Interleave phases (recommendation #6 above). 2B.1 (timeouts) is a 2-hour win that prevents the embarrassing "Thinking forever" bug. |
| Session history's sqlite schema migration breaks existing dev databases | Low | Schema migration v3 with explicit version bump; existing v2 dbs auto-upgrade |
| BroadcastChannel sync introduces race conditions with localStorage | Medium | Make sqlite the source of truth in Phase 2C; localStorage becomes a cache only |
| ErrorRecoveryService accidentally exposes upstream provider errors to non-authed callers | Low | `userMessage` field is the only string ever returned to FE; raw `Error.message` stays in BE logs |
| Slash-command registry becomes a `/run <arbitrary command>` shell-injection vector | Low | Each command's handler validates args; no eval-style commands ship by default |
| Hook decomposition (Phase 2D) breaks active feature work | Medium | Defer until forced by complexity (>400 LOC in useChatSession); use TypeScript interfaces to draw boundaries first, then refactor |

---

## 8. What this analysis assumes

- Phase 1 chat is feature-complete enough that improvements happen in additive layers, not rewrites.
- The sample stays sample-grade — no production-readiness claims, no SLA work, no per-user auth.
- `providers.json` stays the source of truth for provider taxonomy + pricing (cost computation reads from it).
- Adopters extend via `registerCard()` and (new in 2A.4) `registerCommand()` — those are the two extensibility seams we commit to maintaining.

---

**End of analysis.** Next step: pick which phases to ship + answer §5 decisions.
