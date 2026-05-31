/**
 * Task source chip — where a Kanban card came from (PRD §8 source taxonomy).
 *
 * Accessibility: each source has a distinct glyph AND text label, so the
 * source is never conveyed by color alone (PRD §20).
 */

import type { KanbanCardSource } from '../kanban/kanbanClient.js';

// Each source maps to a glyph + label + a token-driven `.chip--*` variant (no
// hardcoded hex; chips theme correctly across surfaces). Color is never the
// sole signal — the glyph + label carry the meaning (PRD §20).
const SOURCE_META: Record<KanbanCardSource, { label: string; glyph: string; chip: string }> = {
  human: { label: 'Human', glyph: '🧑', chip: 'chip--muted' },
  workflow: { label: 'Workflow', glyph: '⚙', chip: 'chip--accent' },
  agent: { label: 'Agent', glyph: '🤖', chip: 'chip--ai' },
  discord: { label: 'Discord', glyph: '💬', chip: 'chip--ai' },
  schedule: { label: 'Schedule', glyph: '⏰', chip: 'chip--warning' },
  api: { label: 'API', glyph: '🔌', chip: 'chip--success' },
};

export function TaskSourceChip({ source, sourceLabel }: { source?: KanbanCardSource; sourceLabel?: string }): JSX.Element {
  const meta = SOURCE_META[source ?? 'human'];
  const title = sourceLabel ? `${meta.label}: ${sourceLabel}` : `Created by ${meta.label}`;
  return (
    <span className={`chip ${meta.chip}`} title={title}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{sourceLabel ?? meta.label}</span>
    </span>
  );
}
