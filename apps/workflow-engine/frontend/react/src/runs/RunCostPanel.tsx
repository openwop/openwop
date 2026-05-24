/**
 * RunCostPanel — per-run token & cost aggregation.
 *
 * Reads `provider.usage` events (RFC 0026) off the run's event log and
 * rolls them up per (provider, model): call count, input/output tokens,
 * and USD. Cost prefers the host's advisory `costEstimateUsd` on the
 * event; when absent it falls back to the static per-1K rates in
 * providers.json (same table the chat cost helper uses). The advisory
 * caveat is surfaced — these are estimates, not billing.
 *
 * Renders nothing when a run emitted no usage events.
 */

import { useMemo } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { getProvider } from '../byok/lib/providers.js';
import { formatUsd } from '../chat/lib/cost.js';

interface Props {
  events: readonly RunEventDoc[];
}

interface Row {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** True when at least one call's cost came from the local rate table
   *  rather than the host's advisory estimate. */
  estimatedLocally: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function localRate(provider: string, model: string, inT: number, outT: number): number | null {
  try {
    const p = getProvider(provider);
    const m = p.models.find((mm) => mm.id === model);
    if (!m?.cost) return null;
    return (inT * m.cost.input + outT * m.cost.output) / 1000;
  } catch {
    return null;
  }
}

function aggregate(events: readonly RunEventDoc[]): { rows: Row[]; total: Row } {
  const byKey = new Map<string, Row>();
  for (const ev of events) {
    if (ev.type !== 'provider.usage') continue;
    const p = asRecord(ev.payload);
    const provider = String(p.provider ?? 'unknown');
    const model = String(p.model ?? 'unknown');
    const inT = Number(p.inputTokens ?? 0) || 0;
    const outT = Number(p.outputTokens ?? 0) || 0;
    const key = `${provider}::${model}`;
    const row = byKey.get(key) ?? {
      provider, model, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, estimatedLocally: false,
    };
    row.calls += 1;
    row.inputTokens += inT;
    row.outputTokens += outT;
    if (typeof p.costEstimateUsd === 'number') {
      row.costUsd += p.costEstimateUsd as number;
    } else {
      const local = localRate(provider, model, inT, outT);
      if (local != null) { row.costUsd += local; row.estimatedLocally = true; }
    }
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => b.costUsd - a.costUsd);
  const total: Row = {
    provider: '', model: 'Total', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
    estimatedLocally: rows.some((r) => r.estimatedLocally),
  };
  for (const r of rows) {
    total.calls += r.calls;
    total.inputTokens += r.inputTokens;
    total.outputTokens += r.outputTokens;
    total.costUsd += r.costUsd;
  }
  return { rows, total };
}

export function RunCostPanel({ events }: Props) {
  const { rows, total } = useMemo(() => aggregate(events), [events]);
  if (rows.length === 0) return null;
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 1e-9);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ flex: 1 }}>Tokens &amp; cost</h2>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(total.costUsd)}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {(total.inputTokens + total.outputTokens).toLocaleString()} tokens · {total.calls} calls
        </span>
      </div>
      <table className="cost-table">
        <thead>
          <tr>
            <th>Model</th>
            <th className="num">Calls</th>
            <th className="num">In</th>
            <th className="num">Out</th>
            <th className="num">Cost</th>
            <th className="cost-bar-col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.provider}::${r.model}`}>
              <td>
                <span className="muted">{r.provider}/</span>{r.model}
                {r.estimatedLocally && <span className="muted" title="Cost from local rate table, not host advisory"> *</span>}
              </td>
              <td className="num">{r.calls}</td>
              <td className="num">{r.inputTokens.toLocaleString()}</td>
              <td className="num">{r.outputTokens.toLocaleString()}</td>
              <td className="num">{formatUsd(r.costUsd)}</td>
              <td className="cost-bar-col">
                <span className="cost-bar" style={{ width: `${(r.costUsd / maxCost) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Advisory estimates (RFC 0026) — not billing. <span title="Local rate table">*</span> = computed
        from providers.json rates where the host omitted an estimate.
      </p>
    </div>
  );
}
