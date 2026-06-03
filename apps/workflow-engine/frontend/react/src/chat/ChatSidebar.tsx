/**
 * Chat sidebar — the full chat surface. Three zones (header / feed /
 * input) inside a vertical flex container.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatHeader } from './ChatHeader.js';
import { ChatInput } from './ChatInput.js';
import { MessageFeed } from './MessageFeed.js';
import { WelcomeCard } from './WelcomeCard.js';
import { LeftRail, type LeftRailTab } from './leftRail/LeftRail.js';
import { DEFAULT_ASSISTANT_ID } from './activeAgents/ActiveAgentsPanel.js';
import { useChatSession } from './hooks/useChatSession.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { findCommand } from './registry/CommandRegistry.js';
import { registerDefaultCommands } from './registry/defaultCommands.js';
import { getProvider } from '../byok/lib/providers.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';
import type { ContentPart } from './hooks/useChatSession.js';
import { buildAvailableTools } from './lib/availableTools.js';
import { detectWorkflowSlashMention } from './lib/workflowMentions.js';
import { detectAgentMention, useAgentMentions } from './lib/agentMentions.js';

// localStorage keys for rail persistence — keeps the user's "which
// tab" / "which run is focused" choice across page reloads.
// Tenant-suffixed so two tenants signed in on the same browser
// (anon → signed-in transition, or a shared-machine demo) don't see
// each other's state leak into their UI.
const LS_RAIL_TAB_PREFIX = 'openwop.sample.chat.leftRail.activeTab';
const LS_PROGRESS_FOCUSED_PREFIX = 'openwop.sample.chat.progressPanel.focusedRunMsgId';
// Legacy keys — pre-consolidation, History/Progress/Agents each had
// their own open boolean. Read once on first mount per tenant to
// migrate, then removed. Predates the LeftRail consolidation.
const LS_LEGACY_PROGRESS_OPEN_PREFIX = 'openwop.sample.chat.progressPanel.open';
const LS_LEGACY_AGENTS_OPEN_PREFIX = 'openwop.sample.chat.activeAgentsPanel.open';
const MOBILE_BREAKPOINT_PX = 720;

function railTabKey(tenantId: string): string {
  return `${LS_RAIL_TAB_PREFIX}:${tenantId}`;
}
function progressFocusedKey(tenantId: string): string {
  return `${LS_PROGRESS_FOCUSED_PREFIX}:${tenantId}`;
}

function readRailTabFromStorage(tenantId: string): LeftRailTab | null {
  try {
    const v = localStorage.getItem(railTabKey(tenantId));
    if (v === 'history' || v === 'progress' || v === 'agents') return v;
    // First mount after upgrade — migrate from the legacy two-boolean
    // shape. Progress wins over Agents because the auto-open-on-new-
    // workflow_run behavior makes Progress the more likely "last-open"
    // panel for active users.
    const legacyProgress = localStorage.getItem(`${LS_LEGACY_PROGRESS_OPEN_PREFIX}:${tenantId}`);
    const legacyAgents = localStorage.getItem(`${LS_LEGACY_AGENTS_OPEN_PREFIX}:${tenantId}`);
    let migrated: LeftRailTab | null = null;
    if (legacyProgress === '1') migrated = 'progress';
    else if (legacyAgents === '1') migrated = 'agents';
    if (legacyProgress !== null) localStorage.removeItem(`${LS_LEGACY_PROGRESS_OPEN_PREFIX}:${tenantId}`);
    if (legacyAgents !== null) localStorage.removeItem(`${LS_LEGACY_AGENTS_OPEN_PREFIX}:${tenantId}`);
    if (migrated !== null) localStorage.setItem(railTabKey(tenantId), migrated);
    return migrated;
  } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* quota / disabled — ignore */ }
}

/** Drop tenant-suffixed rail keys that don't match the current
 *  tenant. Switching identity in the same browser would otherwise
 *  leave the old tenant's entries behind forever. Called once on
 *  mount per ChatSidebar instance. Also sweeps legacy panel-open
 *  keys for tenants other than the current one (current-tenant
 *  legacy keys are migrated, not pruned, by `readRailTabFromStorage`). */
function pruneStalePanelKeys(currentTenantId: string): void {
  try {
    const keep = new Set([
      railTabKey(currentTenantId),
      progressFocusedKey(currentTenantId),
    ]);
    const prefixes = [
      `${LS_RAIL_TAB_PREFIX}:`,
      `${LS_PROGRESS_FOCUSED_PREFIX}:`,
      `${LS_LEGACY_PROGRESS_OPEN_PREFIX}:`,
      `${LS_LEGACY_AGENTS_OPEN_PREFIX}:`,
    ];
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p)) && !keep.has(key)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch { /* quota / disabled — ignore */ }
}

// Ensure built-in commands are registered before first render.
registerDefaultCommands();

interface Props {
  config: BYOKActiveConfig;
  onOpenSettings: () => void;
  onRemoveKey: () => void | Promise<void>;
  tenantId?: string;
}

export function ChatSidebar({ config, onOpenSettings, onRemoveKey, tenantId = 'demo' }: Props): JSX.Element {
  const { session, isSending, error, send, cancel, emitSystem, reset, resolveInterrupt, runWorkflowMention, cancelWorkflowRun, regenerate, setFeedback, loadSessionFromBackend, activeAgents } = useChatSession();
  // Agent catalog — read once at mount, used by the submit-path's
  // `@`-mention detection (phase D3). The `AgentMentionAutocomplete`
  // popover refetches independently; both consumers pay the same
  // /v1/agents round-trip but cached results bake themselves out in
  // the SDK fetch layer.
  const { entries: agentEntries } = useAgentMentions();
  // Deep-link: a "Chat with <persona>" affordance elsewhere (e.g. the agent
  // dashboard / roster cards) navigates to `/?agent=<agentId|slug>`. When that
  // param is present AND the agent catalog has loaded, pre-activate the matching
  // agent so the chat opens already routed to it, then strip the param so a
  // refresh doesn't re-activate and the URL stays clean. Entry-gated: an
  // unknown/legacy id simply no-ops (the catalog re-runs this effect as it
  // loads, so an early mount before `agentEntries` arrives still resolves).
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkAgentHandled = useRef<string | null>(null);
  useEffect(() => {
    const wanted = searchParams.get('agent');
    if (!wanted || deepLinkAgentHandled.current === wanted) return;
    const entry = agentEntries.find((e) => e.agentId === wanted || e.slug === wanted.toLowerCase());
    if (!entry) return; // catalog may still be loading; this effect re-runs when it arrives
    deepLinkAgentHandled.current = wanted;
    activeAgents.activateAgent(entry);
    const next = new URLSearchParams(searchParams);
    next.delete('agent');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, agentEntries, activeAgents]);
  const sessionsCollection = useChatSessions();
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [activeRailTab, setActiveRailTab] = useState<LeftRailTab | null>(
    () => readRailTabFromStorage(tenantId),
  );
  // Track the last non-null tab so the chat-header toggle can reopen
  // the rail to whichever panel the user was last looking at, rather
  // than forcing them through a default tab every time.
  const [lastRailTab, setLastRailTab] = useState<LeftRailTab>(
    () => readRailTabFromStorage(tenantId) ?? 'history',
  );
  const [focusedWorkflowMessageId, setFocusedWorkflowMessageId] = useState<string | null>(() => {
    try { return localStorage.getItem(progressFocusedKey(tenantId)); } catch { return null; }
  });
  // Track viewport width so the panel switches between right-side
  // drawer and full-screen overlay below the mobile breakpoint.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX,
  );
  useEffect(() => {
    // Resize listener — skip the state-set when the boolean wouldn't
    // change so a window drag doesn't cause a top-level re-render per
    // resize event (~60Hz). Cheap guard, frees up the render pipeline
    // for the chat thread while the panel is open.
    const onResize = () => {
      const next = window.innerWidth < MOBILE_BREAKPOINT_PX;
      setIsMobile((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // One-time prune of panel-state keys belonging to other tenants on
  // this browser. Keeps localStorage bounded across identity switches
  // (anon → signed-in transition, shared-machine demos).
  useEffect(() => {
    pruneStalePanelKeys(tenantId);
  }, [tenantId]);

  // Workflow_run messages in this session — feed into the panel +
  // run-switcher. Most-recent first so the run-switcher row order
  // mirrors how the user thinks about their dispatch history.
  const workflowRunMessages = useMemo(
    () => session.messages
      .filter((m) => m.role === 'workflow_run')
      .slice()
      .reverse(),
    [session.messages],
  );

  // Reconcile the focused id against the active session's
  // workflow_run set. Two cases:
  //   - Nothing focused → auto-focus the most recently dispatched run.
  //   - Focused id doesn't exist in this session (loaded a different
  //     session via the history drawer, persisted id is stale) → drop
  //     it and re-focus on the visible most-recent run.
  // The panel's RunSwitcher highlights `focusedMessageId` directly, so
  // a stale id would leave the highlight pointing at no row.
  useEffect(() => {
    const stillExists = focusedWorkflowMessageId !== null
      && workflowRunMessages.some((m) => m.id === focusedWorkflowMessageId);
    if (!stillExists) {
      setFocusedWorkflowMessageId(workflowRunMessages[0]?.id ?? null);
    }
  }, [workflowRunMessages, focusedWorkflowMessageId]);

  // Auto-open the progress panel when a brand-new workflow_run is
  // dispatched in this session. Watch a ref of "ids we've already
  // seen" — when an id appears that wasn't there before, it's a
  // fresh dispatch (via `@-mention` or workflow-tool-use) and the
  // user benefits from the panel popping open to track it. Loading
  // a different session via the history drawer also changes the id
  // set but those ids exist in the saved messages; the ref seeds
  // from `workflowRunMessages` on mount so pre-existing runs don't
  // trigger the open. Session switches reset the ref to the new
  // session's id set, so switching back to a session with old runs
  // doesn't re-pop the panel.
  const seenWorkflowRunIdsRef = useRef<Set<string>>(new Set(workflowRunMessages.map((m) => m.id)));
  const prevSessionIdRef = useRef<string>(session.id);
  useEffect(() => {
    // Session switch — reseed the seen-set with whatever's in the new
    // session and skip the auto-open this tick.
    if (prevSessionIdRef.current !== session.id) {
      prevSessionIdRef.current = session.id;
      seenWorkflowRunIdsRef.current = new Set(workflowRunMessages.map((m) => m.id));
      return;
    }
    const seen = seenWorkflowRunIdsRef.current;
    const newRun = workflowRunMessages.find((m) => !seen.has(m.id));
    if (newRun) {
      // Mark all current ids as seen (covers the case where multiple
      // arrived in a single tick, e.g., hydration race).
      for (const m of workflowRunMessages) seen.add(m.id);
      setFocusedWorkflowMessageId(newRun.id);
      setActiveRailTab('progress');
      setLastRailTab('progress');
    }
  }, [workflowRunMessages, session.id]);

  // Persist rail state on every change so reload restores the user's
  // last view.
  useEffect(() => { writeStorage(railTabKey(tenantId), activeRailTab); }, [tenantId, activeRailTab]);
  useEffect(() => { writeStorage(progressFocusedKey(tenantId), focusedWorkflowMessageId); }, [tenantId, focusedWorkflowMessageId]);

  const selectRailTab = useCallback((tab: LeftRailTab | null) => {
    setActiveRailTab(tab);
    if (tab !== null) setLastRailTab(tab);
  }, []);

  const openProgressForRun = useCallback((messageId: string) => {
    setFocusedWorkflowMessageId(messageId);
    setActiveRailTab('progress');
    setLastRailTab('progress');
  }, []);

  // Per-turn capability hints sourced from providers.json for the active model.
  const activeModel = (() => {
    try {
      return getProvider(config.provider).models.find((m) => m.id === config.model) ?? null;
    } catch {
      return null;
    }
  })();
  const supportsAudioInput = activeModel?.audioInput === true;
  // Image (vision) input is the model's `vision` capability. PDFs ride the
  // same native document channel only on Anthropic + Gemini in our dispatcher
  // (OpenAI Chat Completions + MiniMax don't accept PDF parts) — gate on both
  // vision + provider so the chip warns honestly. Text files (.txt/.md/.json/
  // .csv) inline as text on every provider, so they're never gated.
  const supportsImageInput = activeModel?.capabilities?.includes('vision') === true;
  const supportsPdfInput = supportsImageInput && (config.provider === 'anthropic' || config.provider === 'google');
  const supportsWebSearch = activeModel?.webSearch === true;
  // Tool calling is gated to Anthropic in the backend dispatcher
  // (OpenAI / Google have their own wire shapes — see
  // backend/.../bootstrap/nodes.ts useTools).
  // Tools support is per-model. Anthropic Claude 4 models, MiniMax-M2,
  // and any future provider whose adapter we wire all declare `tools`
  // in providers.json. The provider-level check we had before was a
  // proxy for "Anthropic-only" — replaced with a real capability lookup
  // so MiniMax (the managed Try-it-free path) unlocks tool-use too.
  const supportsTools = activeModel?.capabilities?.includes('tools') === true;

  const disabledReason = isSending ? 'A turn is in flight — wait for the response.' : undefined;

  /** Submit path. Dispatch precedence (highest first):
   *    1. Built-in `/command` (registered in CommandRegistry).
   *       Always takes precedence over a same-name workflow so a
   *       workflow can't shadow `/clear` / `/help` / `/stop`.
   *    2. `/<slug>` workflow mention (canonical workflow syntax).
   *    3. `@<slug>` agent mention — phase D3 will activate the agent
   *       in the active-agents side panel; until then the `@` text
   *       falls through to (4) so the message still sends, just as
   *       a regular chat turn that happens to mention the agent's
   *       persona name.
   *    4. Otherwise fall through to `send()` (regular LLM chat;
   *       Anthropic tool-use can still dispatch workflows via the
   *       `availableTools` path on its own).
   *
   *  Attachments short-circuit 1-3 (workflow + command + agent
   *  surfaces are text-only) and route to `send` directly. */
  const onUserSubmit = useCallback(async (text: string, attachments?: readonly ContentPart[]) => {
    // 1. Built-in slash command — registered commands win over
    //    workflows of the same slug so `/clear` is never overridable.
    const cmd = findCommand(text);
    if (cmd && !attachments) {
      const consumed = await cmd.reg.handler(cmd.args, {
        send: (msg) => send(msg, config),
        reset,
        cancel,
        config,
        emitSystem,
      });
      if (consumed) return;
    }
    if (!attachments) {
      // 2. `/<slug>` → workflow dispatch. Only fires when (1) didn't
      //    match — `findCommand` returned null, so the slash text
      //    isn't a registered command.
      const slashMatch = detectWorkflowSlashMention(text);
      if (slashMatch) {
        await runWorkflowMention(slashMatch.entry, slashMatch.trailing ?? undefined);
        return;
      }
    }
    // 3. `@<slug>` agent activation (phase D3). First-time mention
    //    adds the agent to the lineup AND switches to it; subsequent
    //    mentions of the same agent just switch. The activation
    //    mutates session state; we then fall through to (4) so the
    //    send goes through with the newly-routed agent id.
    let activeAgentIdForThisTurn: string | undefined;
    if (!attachments) {
      const agentMatch = detectAgentMention(text, agentEntries);
      if (agentMatch) {
        activeAgentIdForThisTurn = activeAgents.activateAgent(agentMatch.entry);
        // The mention text stays in the chat as-is — users see
        // `@code-reviewer ...` in their own message, matching the
        // group-chat mental model. Trailing text is the actual
        // turn content; bare `@code-reviewer` (no trailing) sends
        // an empty turn which is fine — most chat models treat
        // that as a re-greet from the new persona.
      }
    }
    // 4. Regular chat. Anthropic-side tool-use can still dispatch
    //    workflows the model decides to invoke based on availableTools.
    //    Phase D2: thread the currently-routing agent through to the
    //    chat-responder so the LLM takes on the agent's persona.
    //
    //    Precedence on `activeAgentId`:
    //    - The just-activated agent from step (3) wins, because the
    //      activation's `setSession` may not have committed before
    //      this turn dispatches (React state is async). Reading
    //      `activeAgents.currentAgentId` post-activation can return
    //      the old value for one render. The explicit return value
    //      from `activateAgent` dodges that race.
    //    - Otherwise fall back to the current routing agent.
    //    - Default to undefined when the assistant is current; the
    //      chat-responder's default system-prompt path then runs.
    const activeAgentId =
      activeAgentIdForThisTurn ??
      (activeAgents.currentAgentId !== DEFAULT_ASSISTANT_ID
        ? activeAgents.currentAgentId
        : undefined);
    await send(text, config, {
      attachments,
      webSearch: webSearchEnabled && supportsWebSearch,
      tools: toolsEnabled && supportsTools ? buildAvailableTools() : undefined,
      ...(activeAgentId ? { activeAgentId } : {}),
    });
  }, [send, cancel, reset, emitSystem, config, webSearchEnabled, supportsWebSearch, toolsEnabled, supportsTools, runWorkflowMention, activeAgents.currentAgentId, activeAgents.activateAgent, agentEntries]);

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      minHeight: 0,
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      background: 'var(--color-surface)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <LeftRail
        activeTab={activeRailTab}
        onSelectTab={selectRailTab}
        isMobile={isMobile}
        historyProps={{
          sessions: sessionsCollection.sessions,
          isLoading: sessionsCollection.isLoading,
          error: sessionsCollection.error,
          activeSessionId: session.id,
          onRefresh: sessionsCollection.refresh,
          onSelect: (id) => { void loadSessionFromBackend(id); selectRailTab(null); },
          onRename: sessionsCollection.rename,
          onDelete: async (id) => {
            await sessionsCollection.remove(id);
            // If the deleted session is the active one, fall back to
            // a fresh local chat so the message feed isn't orphaned.
            if (id === session.id) reset();
          },
        }}
        progressProps={{
          workflowRunMessages,
          focusedMessageId: focusedWorkflowMessageId,
          onFocus: (id) => setFocusedWorkflowMessageId(id),
          onCancel: cancelWorkflowRun,
        }}
        agentsProps={{
          lineup: activeAgents.lineup,
          currentAgentId: activeAgents.currentAgentId ?? DEFAULT_ASSISTANT_ID,
          onSwitch: activeAgents.switchTo,
          onRemove: activeAgents.remove,
        }}
        progressBadgeCount={workflowRunMessages.length}
        agentsBadgeCount={Math.max(0, activeAgents.lineup.length - 1)}
      />
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}>
        <ChatHeader
          config={config}
          onOpenSettings={onOpenSettings}
          onRemoveKey={onRemoveKey}
          onNewChat={reset}
          session={session}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={supportsWebSearch ? () => setWebSearchEnabled((v) => !v) : null}
          toolsEnabled={toolsEnabled}
          onToggleTools={supportsTools ? () => setToolsEnabled((v) => !v) : null}
          railOpen={activeRailTab !== null}
          onToggleRail={() => selectRailTab(activeRailTab === null ? lastRailTab : null)}
          railBadgeCount={workflowRunMessages.length + Math.max(0, activeAgents.lineup.length - 1)}
        />

        {session.messages.length === 0 ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <WelcomeCard onPickSuggestion={(text) => onUserSubmit(text)} />
          </div>
        ) : (
          <MessageFeed
            messages={session.messages}
            tenantId={tenantId}
            onResolveInterrupt={resolveInterrupt}
            onOpenWorkflowProgress={openProgressForRun}
            focusedWorkflowMessageId={activeRailTab === 'progress' ? focusedWorkflowMessageId : null}
            onRegenerate={(id) => { void regenerate(id, config); }}
            onFeedback={setFeedback}
            onReconfigureBYOK={onOpenSettings}
          />
        )}

        {error && (
          <div className="alert error" style={{ margin: 8, fontSize: 12 }}>{error}</div>
        )}

        <div style={{ padding: 12, borderTop: '1px solid var(--color-border)' }}>
          <ChatInput
            onSend={onUserSubmit}
            onCancel={cancel}
            disabled={isSending}
            disabledReason={disabledReason}
            placeholder={isSending ? 'Generating… (Esc to stop)' : 'Type / for commands + workflows, @ for agents, or just chat…'}
            supportsAudioInput={supportsAudioInput}
            supportsImageInput={supportsImageInput}
            supportsPdfInput={supportsPdfInput}
          />
        </div>
      </div>
    </div>
  );
}
