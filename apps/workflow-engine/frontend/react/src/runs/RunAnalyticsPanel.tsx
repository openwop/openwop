/**
 * RunAnalyticsPanel — per-run health/quality metrics. The reliability half
 * (duration, nodes completed/failed, interrupts raised vs resolved, resumes)
 * derives entirely from the event log (§A2). The *quality* half (mean rating,
 * corrections, flags, most-corrected nodes) derives from RFC 0056 annotations
 * passed in via `annotations` (§C2); it renders only when the host advertises
 * `capabilities.feedback` and at least one annotation exists. Complements
 * RunCostPanel (which owns token/cost).
 *
 * Renders nothing until the run has emitted at least one event OR carries
 * at least one annotation.
 */

import { useMemo } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import type { Annotation } from '../client/feedbackClient.js';
import { formatDuration } from './format.js';

interface Props {
  events: readonly RunEventDoc[];
  annotations?: readonly Annotation[];
}

const TERMINAL_TYPES = ['run.completed', 'run.failed', 'run.cancelled'];

function count(events: readonly RunEventDoc[], type: string): number {
  return events.reduce((n, e) => (e.type === type ? n + 1 : n), 0);
}

export function RunAnalyticsPanel({ events, annotations }: Props) {
  const stats = useMemo(() => {
    if (events.length === 0) return null;

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    const first = sorted[0];
    const terminal = sorted.find((e) => TERMINAL_TYPES.includes(e.type));
    const last = sorted[sorted.length - 1];
    const start = first ? Date.parse(first.timestamp) : NaN;
    const end = terminal ? Date.parse(terminal.timestamp) : last ? Date.parse(last.timestamp) : NaN;
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

  // §C2 — quality dimension from RFC 0056 annotations.
  const quality = useMemo(() => {
    if (!annotations || annotations.length === 0) return null;
    const ratings: number[] = [];
    let corrections = 0;
    let flags = 0;
    let labels = 0;
    const correctedNodes = new Map<string, number>();
    for (const a of annotations) {
      switch (a.signal.kind) {
        case 'rating':
          if (typeof a.signal.rating === 'number') ratings.push(a.signal.rating);
          break;
        case 'correction': {
          corrections += 1;
          const node = a.target.nodeId;
          if (node) correctedNodes.set(node, (correctedNodes.get(node) ?? 0) + 1);
          break;
        }
        case 'flag':
          flags += 1;
          break;
        case 'label':
          labels += 1;
          break;
      }
    }
    const meanRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null;
    const topCorrected = [...correctedNodes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return {
      total: annotations.length,
      meanRating,
      ratingCount: ratings.length,
      corrections,
      flags,
      labels,
      topCorrected,
    };
  }, [annotations]);

  if (!stats && !quality) return null;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Run analytics</h2>
      {stats && (
        <dl className="run-stats">
          <Stat label="Outcome" value={stats.outcome} tone={stats.outcome === 'failed' ? 'danger' : stats.outcome === 'cancelled' ? 'warn' : undefined} />
          <Stat label={stats.live ? 'Elapsed' : 'Duration'} value={stats.durationMs == null ? '—' : formatDuration(stats.durationMs)} />
          <Stat label="Nodes done" value={String(stats.nodesCompleted)} />
          <Stat label="Node failures" value={String(stats.nodesFailed)} tone={stats.nodesFailed > 0 ? 'danger' : undefined} />
          <Stat label="Interrupts raised" value={String(stats.interruptsRaised)} />
          <Stat label="Interrupts pending" value={String(stats.interruptsPending)} tone={stats.interruptsPending > 0 ? 'warn' : undefined} />
          <Stat label="Resumes" value={String(stats.resumes)} />
        </dl>
      )}
      {quality && (
        <>
          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>Quality signals</h3>
          <dl className="run-stats">
            <Stat label="Annotations" value={String(quality.total)} />
            <Stat
              label="Mean rating"
              value={quality.meanRating == null ? '—' : `${quality.meanRating.toFixed(1)} / 5`}
              tone={quality.meanRating != null && quality.meanRating < 3 ? 'warn' : undefined}
            />
            <Stat label="Corrections" value={String(quality.corrections)} tone={quality.corrections > 0 ? 'warn' : undefined} />
            <Stat label="Flags" value={String(quality.flags)} tone={quality.flags > 0 ? 'danger' : undefined} />
          </dl>
          {quality.topCorrected.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Most-corrected nodes</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {quality.topCorrected.map(([nodeId, n]) => (
                  <li key={nodeId}>
                    <code>{nodeId}</code> — {n} correction{n === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="muted" style={{ marginBottom: 0, fontSize: 11 }}>
        Reliability metrics derive from this run's event log. Quality signals derive from RFC 0056 annotations and appear once the host advertises <code>capabilities.feedback</code>.
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
