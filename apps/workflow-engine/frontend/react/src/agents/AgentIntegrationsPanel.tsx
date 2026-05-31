/**
 * Agent integrations panel (PRD §9 Integrations + §15) — task sources, real and
 * simulated. The Discord demo shows the example command and creates a simulated
 * Discord task on the agent's board so the source taxonomy is demonstrable
 * without a real integration. Future sources are clearly labeled.
 */

import { useState } from 'react';
import { createCard } from '../kanban/kanbanClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

interface SourceRow {
  name: string;
  glyph: string;
  status: 'demo' | 'planned';
  blurb: string;
}

const SOURCES: ReadonlyArray<SourceRow> = [
  { name: 'Discord', glyph: '💬', status: 'demo', blurb: 'Teammates assign work from chat with a slash command.' },
  { name: 'Slack', glyph: '💼', status: 'planned', blurb: 'Assign tasks from a Slack channel or DM.' },
  { name: 'Email', glyph: '✉️', status: 'planned', blurb: 'Forward an email to create a task.' },
  { name: 'Webhook / API', glyph: '🔌', status: 'planned', blurb: 'Create tasks programmatically from your systems.' },
  { name: 'Other agents', glyph: '🤖', status: 'demo', blurb: 'One agent assigns a task to another.' },
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
      {error ? <div style={{ color: 'var(--color-danger)', marginBottom: '0.5rem' }}>⚠ {error}</div> : null}
      {notice ? <div style={{ background: '#e6f7ee', color: '#1f7a4d', padding: '0.4rem 0.6rem', borderRadius: 8, marginBottom: '0.5rem', fontSize: '0.82rem' }}>{notice}</div> : null}

      <p style={{ ...muted, marginTop: 0 }}>
        Work can arrive on {persona}'s board from humans, workflows, other agents, chat tools, schedules, or APIs.
      </p>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.8rem', marginBottom: '1rem', background: 'var(--color-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>💬 Discord</strong>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: '#fff1e0', color: '#9a5b12' }}>Demo simulation</span>
        </div>
        <p style={{ fontSize: '0.85rem' }}>
          In Discord, <code>/assign @{handle} "Follow up with ACME on renewal"</code> creates a To Do card on {persona}'s board.
          {persona}'s heartbeat then picks it up and runs the matching workflow.
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
            <span aria-hidden="true">{s.glyph}</span>
            <span style={{ fontWeight: 600, minWidth: 110 }}>{s.name}</span>
            <span style={{ ...muted, fontSize: '0.82rem', flex: 1 }}>{s.blurb}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: s.status === 'demo' ? '#e6f7ee' : 'var(--color-surface-alt, #eef1f5)', color: s.status === 'demo' ? '#1f7a4d' : 'var(--color-text-muted)' }}>
              {s.status === 'demo' ? 'Demo' : 'Planned'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
