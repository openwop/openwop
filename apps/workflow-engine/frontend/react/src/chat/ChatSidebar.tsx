/**
 * Chat sidebar — the full chat surface. Three zones (header / feed /
 * input) inside a vertical flex container.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatHeader } from './ChatHeader.js';
import { ChatInput } from './ChatInput.js';
import { MessageFeed } from './MessageFeed.js';
import { WelcomeCard } from './WelcomeCard.js';
import { SessionHistoryDrawer } from './SessionHistoryDrawer.js';
import { WorkflowProgressPanel } from './workflowProgress/WorkflowProgressPanel.js';
import { useChatSession } from './hooks/useChatSession.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { findCommand } from './registry/CommandRegistry.js';
import { registerDefaultCommands } from './registry/defaultCommands.js';
import { getProvider } from '../byok/lib/providers.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';
import type { ContentPart } from './hooks/useChatSession.js';
import { buildAvailableTools } from './lib/availableTools.js';
import { detectMention } from './lib/workflowMentions.js';

// localStorage keys for panel persistence — keeps the user's "open" /
// "which run is focused" choice across page reloads. Tenant-suffixed
// so two tenants signed in on the same browser (anon → signed-in
// transition, or a shared-machine demo) don't see each other's panel
// state leak into their UI.
const LS_PROGRESS_OPEN_PREFIX = 'openwop.sample.chat.progressPanel.open';
const LS_PROGRESS_FOCUSED_PREFIX = 'openwop.sample.chat.progressPanel.focusedRunMsgId';
const MOBILE_BREAKPOINT_PX = 720;

function progressOpenKey(tenantId: string): string {
  return `${LS_PROGRESS_OPEN_PREFIX}:${tenantId}`;
}
function progressFocusedKey(tenantId: string): string {
  return `${LS_PROGRESS_FOCUSED_PREFIX}:${tenantId}`;
}

function readBoolFromStorage(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  } catch { return fallback; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
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
  const { session, isSending, error, send, cancel, emitSystem, reset, resolveInterrupt, runWorkflowMention, cancelWorkflowRun, regenerate, setFeedback, loadSessionFromBackend } = useChatSession();
  const sessionsCollection = useChatSessions();
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(() => readBoolFromStorage(progressOpenKey(tenantId), false));
  const [focusedWorkflowMessageId, setFocusedWorkflowMessageId] = useState<string | null>(() => {
    try { return localStorage.getItem(progressFocusedKey(tenantId)); } catch { return null; }
  });
  // Track viewport width so the panel switches between right-side
  // drawer and full-screen overlay below the mobile breakpoint.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  // Persist panel state on every change so reload restores the user's
  // last view.
  useEffect(() => { writeStorage(progressOpenKey(tenantId), progressOpen ? '1' : '0'); }, [tenantId, progressOpen]);
  useEffect(() => { writeStorage(progressFocusedKey(tenantId), focusedWorkflowMessageId); }, [tenantId, focusedWorkflowMessageId]);

  const openProgressForRun = useCallback((messageId: string) => {
    setFocusedWorkflowMessageId(messageId);
    setProgressOpen(true);
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

  /** Submit path: intercepts /commands and bare `@mention` workflow
   *  dispatches via their respective handlers; falls through to send()
   *  for regular chat (which may still trigger workflow tool-use through
   *  the Anthropic-only `availableTools` path). */
  const onUserSubmit = useCallback(async (text: string, attachments?: readonly ContentPart[]) => {
    // `@<slug>` (with or without trailing text, no attachments) →
    // direct workflow dispatch. Avoids the LLM round-trip and works
    // on every provider. Trailing text after the slug is mapped to
    // the first input field of the workflow's defaultInputs.
    if (!attachments) {
      const match = detectMention(text);
      if (match) {
        await runWorkflowMention(match.entry, match.trailing ?? undefined);
        return;
      }
    }
    const cmd = findCommand(text);
    if (cmd && !attachments) {
      // Slash commands don't accept attachments — preserve the command's
      // text-only contract. If you typed a command with audio attached,
      // we fall through to a regular message (the command name will be
      // visible in chat for clarity).
      const consumed = await cmd.reg.handler(cmd.args, {
        send: (msg) => send(msg, config),
        reset,
        cancel,
        config,
        emitSystem,
      });
      if (consumed) return;
    }
    await send(text, config, {
      attachments,
      webSearch: webSearchEnabled && supportsWebSearch,
      tools: toolsEnabled && supportsTools ? buildAvailableTools() : undefined,
    });
  }, [send, cancel, reset, emitSystem, config, webSearchEnabled, supportsWebSearch, toolsEnabled, supportsTools, runWorkflowMention]);

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
      {historyOpen && (
        <SessionHistoryDrawer
          sessions={sessionsCollection.sessions}
          isLoading={sessionsCollection.isLoading}
          error={sessionsCollection.error}
          activeSessionId={session.id}
          onRefresh={sessionsCollection.refresh}
          onSelect={(id) => { void loadSessionFromBackend(id); setHistoryOpen(false); }}
          onRename={sessionsCollection.rename}
          onDelete={async (id) => {
            await sessionsCollection.remove(id);
            // If the deleted session is the active one, fall back to a
            // fresh local chat so the message feed isn't orphaned.
            if (id === session.id) reset();
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
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
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
          progressOpen={progressOpen}
          onToggleProgress={() => setProgressOpen((v) => !v)}
          progressBadgeCount={workflowRunMessages.length}
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
            focusedWorkflowMessageId={progressOpen ? focusedWorkflowMessageId : null}
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
            placeholder={isSending ? 'Generating… (Esc to stop)' : 'Type @ to run a workflow, / for commands or just chat…'}
            supportsAudioInput={supportsAudioInput}
          />
        </div>
      </div>
      {progressOpen && (
        <WorkflowProgressPanel
          workflowRunMessages={workflowRunMessages}
          focusedMessageId={focusedWorkflowMessageId}
          tenantId={tenantId}
          onFocus={(id) => setFocusedWorkflowMessageId(id)}
          onClose={() => setProgressOpen(false)}
          onResolveInterrupt={resolveInterrupt}
          onCancel={cancelWorkflowRun}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
