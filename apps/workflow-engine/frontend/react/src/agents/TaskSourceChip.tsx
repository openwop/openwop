/**
 * Task source chip — where a Kanban card came from (PRD §8 source taxonomy).
 *
 * Accessibility: each source has a distinct glyph AND text label, so the
 * source is never conveyed by color alone (PRD §20).
 */

import type { KanbanCardSource } from '../kanban/kanbanClient.js';

const SOURCE_META: Record<KanbanCardSource, { label: string; glyph: string; bg: string; fg: string }> = {
  human: { label: 'Human', glyph: '🧑', bg: 'var(--color-surface-alt, #eef1f5)', fg: 'var(--color-text)' },
  workflow: { label: 'Workflow', glyph: '⚙', bg: '#e7f0ff', fg: '#1c4f9c' },
  agent: { label: 'Agent', glyph: '🤖', bg: '#efe9ff', fg: '#5a36b0' },
  discord: { label: 'Discord', glyph: '💬', bg: '#e8eaff', fg: '#4451c7' },
  schedule: { label: 'Schedule', glyph: '⏰', bg: '#fff1e0', fg: '#9a5b12' },
  api: { label: 'API', glyph: '🔌', bg: '#e6f7ee', fg: '#1f7a4d' },
};

export function TaskSourceChip({ source, sourceLabel }: { source?: KanbanCardSource; sourceLabel?: string }): JSX.Element {
  const meta = SOURCE_META[source ?? 'human'];
  const title = sourceLabel ? `${meta.label}: ${sourceLabel}` : `Created by ${meta.label}`;
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: '0.7rem',
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 999,
        background: meta.bg,
        color: meta.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{sourceLabel ?? meta.label}</span>
    </span>
  );
}
