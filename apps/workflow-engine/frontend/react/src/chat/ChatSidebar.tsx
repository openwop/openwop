/**
 * Chat sidebar — the full chat surface. Three zones (header / feed /
 * input) inside a vertical flex container.
 */

import { useCallback, useState } from 'react';
import { ChatHeader } from './ChatHeader.js';
import { ChatInput } from './ChatInput.js';
import { MessageFeed } from './MessageFeed.js';
import { WelcomeCard } from './WelcomeCard.js';
import { useChatSession } from './hooks/useChatSession.js';
import { findCommand } from './registry/CommandRegistry.js';
import { registerDefaultCommands } from './registry/defaultCommands.js';
import { getProvider } from '../byok/lib/providers.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';
import type { ContentPart } from './hooks/useChatSession.js';
import { buildAvailableTools } from './lib/availableTools.js';
import { detectBareMention } from './lib/workflowMentions.js';

// Ensure built-in commands are registered before first render.
registerDefaultCommands();

interface Props {
  config: BYOKActiveConfig;
  onOpenSettings: () => void;
  onRemoveKey: () => void | Promise<void>;
  tenantId?: string;
}

export function ChatSidebar({ config, onOpenSettings, onRemoveKey, tenantId = 'demo' }: Props): JSX.Element {
  const { session, isSending, error, send, cancel, emitSystem, reset, resolveInterrupt, runWorkflowMention } = useChatSession();
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(false);

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
  const supportsTools = config.provider === 'anthropic';

  const disabledReason = isSending ? 'A turn is in flight — wait for the response.' : undefined;

  /** Submit path: intercepts /commands and bare `@mention` workflow
   *  dispatches via their respective handlers; falls through to send()
   *  for regular chat (which may still trigger workflow tool-use through
   *  the Anthropic-only `availableTools` path). */
  const onUserSubmit = useCallback(async (text: string, attachments?: readonly ContentPart[]) => {
    // Bare `@<slug>` (no other text, no attachments) → direct workflow
    // dispatch. Avoids the LLM round-trip and works on every provider.
    if (!attachments) {
      const mention = detectBareMention(text);
      if (mention) {
        await runWorkflowMention(mention);
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
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 100px)',
      maxHeight: 900,
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      background: 'var(--color-surface)',
      overflow: 'hidden',
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
          placeholder={isSending ? 'Generating… (Esc to stop)' : 'Ask anything… (/ for commands)'}
          supportsAudioInput={supportsAudioInput}
        />
      </div>
    </div>
  );
}
