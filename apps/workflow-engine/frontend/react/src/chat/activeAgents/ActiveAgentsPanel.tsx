/**
 * Active-agents side panel (phase D1).
 *
 * Rendered inside `LeftRail` as one of the three tab panels. Lists the
 * agents currently active in this chat — the user @-mentions an agent
 * (`@code-reviewer …`) and that adds it here + switches the
 * conversation through it. Click any row to switch
 * the currently-routing agent without re-typing. Click × to remove
 * an agent from the lineup. The default OpenWOP Assistant is always
 * first and is not removable.
 *
 * The chat dispatcher (phase D2) reads
 * `session.activeAgents.currentAgentId` per turn and passes it into
 * the `sample.chat.turn` workflow's `inputs.agentId`. All active
 * agents see the whole shared history (group-chat model per the
 * 2026-05-28 product decision).
 *
 * Activation flow (phase D3 wires the `@` submit path):
 *   First `@code-reviewer` in a chat:
 *     → adds `code-reviewer` to `activeAgents.lineup`
 *     → sets `activeAgents.currentAgentId` to its id
 *     → the message goes through the agent
 *   Subsequent `@code-reviewer`:
 *     → finds it already in lineup → just switches
 *       `currentAgentId` to it (no duplicate row)
 *   Click another row in this panel:
 *     → switches `currentAgentId` to that agent (no chat message)
 *   Click × on a row:
 *     → removes from lineup
 *     → if it was the current agent, falls back to the assistant
 */

import type { ActiveAgentRow } from './types.js';

/** The sentinel id for the default OpenWOP Assistant — kept here so
 *  every consumer of the active-agents state agrees on the value
 *  rather than each hard-coding the string. */
export const DEFAULT_ASSISTANT_ID = '__default_assistant__';
export const DEFAULT_ASSISTANT_ROW: ActiveAgentRow = {
  agentId: DEFAULT_ASSISTANT_ID,
  persona: 'OpenWOP Assistant',
  slug: 'assistant',
  modelClass: 'chat',
  addedAt: '',
};

interface Props {
  /** Including the default assistant as the first row. The hook
   *  `useActiveAgents` synthesises this from
   *  `session.activeAgents.lineup`. */
  lineup: ReadonlyArray<ActiveAgentRow>;
  /** The currently-routing agentId (or `DEFAULT_ASSISTANT_ID` for
   *  the default assistant). */
  currentAgentId: string;
  /** Switch the currently-routing agent. Triggered by clicking a row. */
  onSwitch: (agentId: string) => void;
  /** Remove a non-default agent from the lineup. */
  onRemove: (agentId: string) => void;
  /** Close the panel chevron / Esc. */
  onClose: () => void;
}

export function ActiveAgentsPanel({
  lineup,
  currentAgentId,
  onSwitch,
  onRemove,
  onClose,
}: Props): JSX.Element {
  const headingId = 'active-agents-panel-heading';
  return (
    <aside
      className="active-agents-panel"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
      aria-labelledby={headingId}
    >
      <header
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong id={headingId} style={{ flex: 1, fontSize: 13 }}>
          Active agents
        </strong>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          aria-label="Close active agents"
          style={{ padding: '2px 8px', fontSize: 11, minHeight: 0, height: 22 }}
        >
          ×
        </button>
      </header>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto',
          flex: 1,
        }}
        aria-label="Agents in this chat"
      >
        {lineup.map((row) => (
          <ActiveAgentRowView
            key={row.agentId}
            row={row}
            isCurrent={row.agentId === currentAgentId}
            isRemovable={row.agentId !== DEFAULT_ASSISTANT_ID}
            onSwitch={() => onSwitch(row.agentId)}
            onRemove={() => onRemove(row.agentId)}
          />
        ))}
      </ul>

      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--color-border)',
          fontSize: 11,
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
        }}
      >
        Type <code>@agent-name</code> in chat to add an agent to this
        lineup and switch through it.{' '}
        <span style={{ opacity: 0.85 }}>
          Saved on this device only — opening this chat from another browser
          or device starts with the default assistant.
        </span>
      </div>
    </aside>
  );
}

function ActiveAgentRowView({
  row,
  isCurrent,
  isRemovable,
  onSwitch,
  onRemove,
}: {
  row: ActiveAgentRow;
  isCurrent: boolean;
  isRemovable: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <li>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onSwitch}
          aria-pressed={isCurrent}
          aria-label={`Switch to ${row.persona}`}
          style={{
            flex: 1,
            textAlign: 'left',
            padding: '6px 8px',
            background: isCurrent
              ? 'color-mix(in oklch, var(--color-clay, var(--clay)) 14%, transparent)'
              : 'transparent',
            border: 'none',
            borderLeft: isCurrent
              ? '2px solid var(--clay)'
              : '2px solid transparent',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12.5,
            fontWeight: isCurrent ? 600 : 400,
            color: 'var(--ink)',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ fontSize: 12 }}>{isCurrent ? '●' : '○'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.persona}
            </span>
          </span>
          <span className="muted" style={{ fontSize: 10.5, paddingLeft: 18, fontFamily: 'var(--mono)' }}>
            @{row.slug} · {row.modelClass}
          </span>
        </button>
        {isRemovable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${row.persona} from this chat`}
            title="Remove from this chat"
            style={{
              padding: '2px 6px',
              fontSize: 14,
              lineHeight: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              borderRadius: 4,
              minHeight: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}
