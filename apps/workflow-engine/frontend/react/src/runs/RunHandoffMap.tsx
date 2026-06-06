/**
 * RunHandoffMap — multi-agent handoff & dispatch visualization.
 *
 * Surfaces the orchestration event families as a sequence-ordered strip
 * of transition chips so a supervisor → worker → child run flow reads
 * left-to-right:
 *
 *   - `runOrchestrator.decided`               supervisor decision
 *   - `agent.handoff` (RFC 0007)              fromAgent → toAgent
 *   - `node.dispatched`                       child run spawned
 *   - `core.workflowChain.event` (RFC 0037)   dispatch lifecycle phases
 *     (dispatch.began → succeeded/failed → child.* → output.harvested)
 *   - `core.workflowChain.confidence-escalated` (RFC 0039/0044)
 *                                             low-confidence escalation marker
 *
 * Renders nothing when a run has no orchestration events (single-agent
 * / no-handoff runs).
 */

import { useMemo } from 'react';
import type { RunEventDoc } from '@openwop/openwop';

interface Props {
  events: readonly RunEventDoc[];
}

interface Chip {
  seq: number;
  kind: 'supervisor' | 'handoff' | 'dispatch' | 'phase' | 'escalation';
  label: string;
  sublabel?: string;
  color: string;
  emphasize?: boolean;
}

const PHASE_COLOR: Record<string, string> = {
  'dispatch.began': 'var(--clay)',
  'dispatch.succeeded': 'var(--color-success)',
  'dispatch.failed': 'var(--color-danger)',
  'child.completed': 'var(--color-success)',
  'child.failed': 'var(--color-danger)',
  'child.cancelled': 'var(--ink-3)',
  'output.harvested': 'var(--color-info)',
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function buildChips(events: readonly RunEventDoc[]): Chip[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const chips: Chip[] = [];
  for (const ev of sorted) {
    const p = asRecord(ev.payload);
    switch (ev.type) {
      case 'runOrchestrator.decided': {
        const d = p.decision;
        const label = typeof d === 'string' ? d : (asRecord(d).kind as string) ?? 'decided';
        chips.push({ seq: ev.sequence, kind: 'supervisor', label: `supervisor: ${label}`, sublabel: p.agentId as string, color: 'var(--color-ai-text)' });
        break;
      }
      case 'agent.handoff': {
        // Tolerate canonical (fromAgentId/toAgentId) and variant (from/to).
        const from = (p.fromAgentId ?? p.from) as string | undefined;
        const to = (p.toAgentId ?? p.to) as string | undefined;
        chips.push({
          seq: ev.sequence, kind: 'handoff',
          label: `${from ?? '?'} → ${to ?? '?'}`,
          ...(typeof p.reason === 'string' ? { sublabel: p.reason as string } : {}),
          color: 'var(--color-info-text)',
        });
        break;
      }
      case 'node.dispatched':
        chips.push({
          seq: ev.sequence, kind: 'dispatch',
          label: `dispatch ${String(p.childWorkflowId ?? '')}`.trim(),
          ...(typeof p.childStatus === 'string' ? { sublabel: p.childStatus as string } : {}),
          color: 'var(--clay-text)',
        });
        break;
      case 'core.workflowChain.event': {
        const phase = String(p.phase ?? '');
        chips.push({
          seq: ev.sequence, kind: 'phase',
          label: phase,
          ...(typeof p.workerId === 'string' ? { sublabel: p.workerId as string } : {}),
          color: PHASE_COLOR[phase] ?? 'var(--ink-3)',
        });
        break;
      }
      case 'core.workflowChain.confidence-escalated':
        chips.push({
          seq: ev.sequence, kind: 'escalation',
          label: `escalation: ${String(p.escalationKind ?? '')}`,
          sublabel: typeof p.confidence === 'number'
            ? `conf ${Math.round((p.confidence as number) * 100)}% < floor ${Math.round(((p.floor as number) ?? 0) * 100)}%`
            : (p.workerId as string),
          color: 'var(--color-warning-text)',
          emphasize: true,
        });
        break;
      default:
        break;
    }
  }
  return chips;
}

export function RunHandoffMap({ events }: Props) {
  const chips = useMemo(() => buildChips(events), [events]);
  if (chips.length === 0) return null;
  return (
    <div className="card">
      <h2>Multi-agent handoffs</h2>
      <div className="handoff-map">
        {chips.map((chip, i) => (
          <div className="handoff-chip-wrap" key={`${chip.seq}-${i}`}>
            {i > 0 && <span className="handoff-arrow" aria-hidden>→</span>}
            <div
              className={`handoff-chip${chip.emphasize ? ' handoff-chip-emphasize' : ''}`}
              style={{ borderColor: chip.color }}
              title={`#${chip.seq} ${chip.kind}`}
            >
              <span className="handoff-chip-dot" style={{ background: chip.color }} aria-hidden />
              <span className="handoff-chip-label">{chip.label}</span>
              {chip.sublabel && <span className="muted handoff-chip-sub">{chip.sublabel}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
