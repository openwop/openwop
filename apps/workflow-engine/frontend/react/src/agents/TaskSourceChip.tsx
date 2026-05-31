/**
 * Task source chip — where a Kanban card came from (PRD §8 source taxonomy).
 *
 * Accessibility: each source has a distinct glyph AND text label, so the
 * source is never conveyed by color alone (PRD §20).
 */

import type { ComponentType, CSSProperties } from 'react';
import { BotIcon, ClockIcon, MessageCircleIcon, PlugIcon, UserIcon, WorkflowIcon } from '../chat/icons/index.js';
import type { KanbanCardSource } from '../kanban/kanbanClient.js';

type IconCmp = ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>;

// Each source maps to a Lucide icon + label + a token-driven `.chip--*` variant
// (no hardcoded hex; chips theme across surfaces). Color is never the sole
// signal — the icon + label carry the meaning (PRD §20).
const SOURCE_META: Record<KanbanCardSource, { label: string; Icon: IconCmp; chip: string }> = {
  human: { label: 'Human', Icon: UserIcon, chip: 'chip--muted' },
  workflow: { label: 'Workflow', Icon: WorkflowIcon, chip: 'chip--accent' },
  agent: { label: 'Agent', Icon: BotIcon, chip: 'chip--ai' },
  discord: { label: 'Discord', Icon: MessageCircleIcon, chip: 'chip--ai' },
  schedule: { label: 'Schedule', Icon: ClockIcon, chip: 'chip--warning' },
  api: { label: 'API', Icon: PlugIcon, chip: 'chip--success' },
};

export function TaskSourceChip({ source, sourceLabel }: { source?: KanbanCardSource; sourceLabel?: string }): JSX.Element {
  const meta = SOURCE_META[source ?? 'human'];
  const { Icon } = meta;
  const title = sourceLabel ? `${meta.label}: ${sourceLabel}` : `Created by ${meta.label}`;
  return (
    <span className={`chip ${meta.chip}`} title={title}>
      <Icon size={12} />
      <span>{sourceLabel ?? meta.label}</span>
    </span>
  );
}
