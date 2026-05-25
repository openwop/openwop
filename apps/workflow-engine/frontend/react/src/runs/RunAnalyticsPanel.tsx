/**
 * RunAnalyticsPanel — per-run health/quality metrics derived entirely
 * from the existing event log (no new protocol surface). Surfaces:
 * duration, nodes completed/failed, interrupts raised vs resolved, and
 * resumes. Complements RunCostPanel (which owns token/cost).
 *
 * See plans/app-ux-enhancements.md §A2. The *quality* dimension
 * (correction-rate / mean-rating) needs RFC 0056's run.annotated event
 * and lands with Track C; this panel covers the intervention/reliability
 * metrics that are derivable today.
 *
 * Renders nothing until the run has emitted at least one event.
 */

import { useMemo } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { formatDuration } from './format.js';

interface Props {
  events: readonly RunEventDoc[];
}

const TERMINAL_TYPES = ['run.completed', 'run.failed', 'run.cancelled'];

function count(events: readonly RunEventDoc[], type: string): number {
  return events.reduce((n, e) => (e.type === type ? n + 1 : n), 0);
}

export function RunAnalyticsPanel({ events }: Props) {
  const stats = useMemo(() => {
    if (events.length === 0) return null;

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    const first = sorted[0];
    const terminal = sorted.find((e) => TERMINAL_TYPES.includes(e.type));
    const start = first ? Date.parse(first.timestamp) : NaN;
    const end = terminal ? Date.parse(terminal.timestamp) : Date.parse(sorted[sorted.length - 1]!.timestamp);
    const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;

    const outcome = terminal ? terminal.type.replace('run.', '') : 'running';
    const interruptsRaised = count(events, 'node.suspended');
    const interruptsResolved = count(events, 'node.interrupt.resolved');

    return {
      outcome,
      durationMs,
      live: !terminal,
      nodesCompleted: count(events, 'node.completed'),
      nodesFailed: count(events, 'node.failed'),
      interruptsRaised,
      interruptsResolved,
      interruptsPending: Math.max(0, interruptsRaised - interruptsResolved),
      resumes: count(events, 'run.resumed'),
    };
  }, [events]);

  if (!stats) return null;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Run analytics</h2>
      <dl className="run-stats">
        <Stat label="Outcome" value={stats.outcome} tone={stats.outcome === 'failed' ? 'danger' : stats.outcome === 'cancelled' ? 'warn' : undefined} />
        <Stat label={stats.live ? 'Elapsed' : 'Duration'} value={stats.durationMs == null ? '—' : formatDuration(stats.durationMs)} />
        <Stat label="Nodes done" value={String(stats.nodesCompleted)} />
        <Stat label="Node failures" value={String(stats.nodesFailed)} tone={stats.nodesFailed > 0 ? 'danger' : undefined} />
        <Stat label="Interrupts raised" value={String(stats.interruptsRaised)} />
        <Stat label="Interrupts pending" value={String(stats.interruptsPending)} tone={stats.interruptsPending > 0 ? 'warn' : undefined} />
        <Stat label="Resumes" value={String(stats.resumes)} />
      </dl>
      <p className="muted" style={{ marginBottom: 0, fontSize: 11 }}>
        Derived from this run's event log. Quality signals (ratings, corrections) arrive with RFC 0056.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className={`run-stat${tone ? ` run-stat--${tone}` : ''}`}>
      <dt className="run-stat-label">{label}</dt>
      <dd className="run-stat-value">{value}</dd>
    </div>
  );
}
