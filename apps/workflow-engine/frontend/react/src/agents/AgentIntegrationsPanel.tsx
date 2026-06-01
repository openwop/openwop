/**
 * Agent integrations panel (PRD §9 Integrations + §15) — task sources, real and
 * simulated. The Discord demo shows the example command and creates a simulated
 * Discord task on the agent's board so the source taxonomy is demonstrable
 * without a real integration. Future sources are clearly labeled.
 */

import { useState, type ComponentType, type CSSProperties } from 'react';
import { createCard } from '../kanban/kanbanClient.js';
import { Notice } from '../ui/Notice.js';
import { BotIcon, MessageCircleIcon, PlugIcon, SendIcon } from '../ui/icons/index.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

type IconCmp = ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>;

interface SourceRow {
  name: string;
  Icon: IconCmp;
  status: 'demo' | 'planned';
  blurb: string;
}

const SOURCES: ReadonlyArray<SourceRow> = [
  { name: 'Discord', Icon: MessageCircleIcon, status: 'demo', blurb: 'Teammates assign work from chat with a slash command.' },
  { name: 'Slack', Icon: MessageCircleIcon, status: 'planned', blurb: 'Assign tasks from a Slack channel or DM.' },
  { name: 'Email', Icon: SendIcon, status: 'planned', blurb: 'Forward an email to create a task.' },
  { name: 'Webhook / API', Icon: PlugIcon, status: 'planned', blurb: 'Create tasks programmatically from your systems.' },
  { name: 'Other agents', Icon: BotIcon, status: 'demo', blurb: 'One agent assigns a task to another.' },
];

export function AgentIntegrationsPanel({ boardId, persona, onChanged }: { boardId: string | null; persona: string; onChanged?: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discordTask, setDiscordTask] = useState('');

  const handle = persona.toLowerCase();

  const onCreateDiscord = async () => {
    if (!boardId || !discordTask.trim()) return;
    setError(null);
    try {
      await createCard(boardId, {
        title: discordTask.trim(),
        columnId: 'todo',
        source: 'discord',
        sourceLabel: `/assign @${handle}`,
      });
      setNotice(`Created a To Do task on ${persona}'s board from a simulated Discord command.`);
      setDiscordTask('');
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      <p style={{ ...muted, marginTop: 0 }}>
        Work can arrive on {persona}'s board from humans, workflows, other agents, chat tools, schedules, or APIs.
      </p>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.8rem', marginBottom: '1rem', background: 'var(--color-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><MessageCircleIcon size={16} /> Discord</strong>
          <span className="chip chip--warning">Demo simulation</span>
        </div>
        <p style={{ fontSize: '0.85rem' }}>
          In Discord, <code>/assign @{handle} "Follow up with ACME on renewal"</code> creates a To Do card on {persona}'s board.
          {' '}{persona}'s heartbeat then picks it up and runs the matching workflow.
        </p>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <input
            value={discordTask}
            onChange={(e) => setDiscordTask(e.target.value)}
            placeholder={`Follow up with ACME on renewal`}
            style={{ minWidth: 280, flex: 1 }}
            disabled={!boardId}
          />
          <button type="button" className="primary" onClick={() => void onCreateDiscord()} disabled={!boardId || !discordTask.trim()}>
            Create simulated Discord task
          </button>
        </div>
        {!boardId ? <p style={{ ...muted, fontSize: '0.78rem' }}>Create this agent's board first.</p> : null}
      </div>

      <strong style={{ fontSize: '0.9rem' }}>All task sources</strong>
      <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {SOURCES.map((s) => (
          <li key={s.name} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem 0.7rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--color-text-muted)', display: 'inline-flex' }}><s.Icon size={16} /></span>
            <span style={{ fontWeight: 600, minWidth: 110 }}>{s.name}</span>
            <span style={{ ...muted, fontSize: '0.82rem', flex: 1 }}>{s.blurb}</span>
            <span className={`chip ${s.status === 'demo' ? 'chip--success' : 'chip--muted'}`}>
              {s.status === 'demo' ? 'Demo' : 'Planned'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
