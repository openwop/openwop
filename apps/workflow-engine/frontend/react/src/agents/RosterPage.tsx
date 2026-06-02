/**
 * `/roster` route — Standing Agent Roster + Org-Chart (RFCS/0086 + 0087).
 *
 * Manage named "digital-twin employee" agents (persona + the manifest they
 * run + their workflow portfolio), and view/build the org-chart — departments
 * of members with a responsibility roll-up (the union of a department's
 * members' portfolios). The org edge is descriptive only: it confers no
 * authority (RFC 0087 §B).
 *
 * Tenant scoping is server-side; the page never sends a tenantId.
 */

import { useCallback, useEffect, useState } from 'react';
import { Notice } from '../ui/Notice.js';
import { PageHeader } from '../ui/PageHeader.js';
import {
  createRosterEntry,
  deleteRosterEntry,
  getDepartmentRollup,
  getOrgChart,
  listRoster,
  putOrgChart,
  updateRosterEntry,
  type OrgChart,
  type ResponsibilityView,
  type RosterEntry,
} from './rosterClient.js';
import { toast } from '../ui/toast.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };
const card: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  borderRadius: 10,
  padding: '0.7rem 0.8rem',
  marginBottom: '0.5rem',
};

export function RosterPage(): JSX.Element {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [rollups, setRollups] = useState<Record<string, ResponsibilityView>>({});
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState('');
  const [agentId, setAgentId] = useState('core.openwop.agents.brief-writer');
  const [workflows, setWorkflows] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([listRoster(), getOrgChart()]);
      setRoster(r);
      setChart(c);
      const views: Record<string, ResponsibilityView> = {};
      for (const d of c.departments) {
        try { views[d.departmentId] = await getDepartmentRollup(d.departmentId); } catch { /* skip */ }
      }
      setRollups(views);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!persona.trim() || !agentId.trim()) return;
    try {
      await createRosterEntry({
        persona: persona.trim(),
        agentRef: { agentId: agentId.trim() },
        workflows: workflows.split(',').map((w) => w.trim()).filter(Boolean),
      });
      setPersona('');
      setWorkflows('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (rosterId: string) => {
    const name = roster.find((r) => r.rosterId === rosterId)?.persona ?? 'this agent';
    if (!window.confirm(`Delete the agent “${name}”? This removes it and its board/schedules and can't be undone.`)) return;
    try {
      await deleteRosterEntry(rosterId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Flip a member between autonomy levels: `auto` runs heartbeat picks
  // immediately; `review` routes them to the approval inbox for human sign-off.
  const onToggleAutonomy = async (r: RosterEntry) => {
    const next = r.autonomyLevel === 'review' ? 'auto' : 'review';
    try {
      await updateRosterEntry(r.rosterId, { autonomyLevel: next });
      await refresh();
      toast.success(
        next === 'review'
          ? `${r.persona} now proposes — its picks need your sign-off in the Inbox.`
          : `${r.persona} now runs its picks automatically.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Convenience: put every roster member into one flat "All Agents" department,
  // so the org-chart + responsibility roll-up are demonstrable without a full
  // tree editor. reportsTo is null for all (no hierarchy) — descriptive only.
  const buildFlatChart = async () => {
    try {
      await putOrgChart({
        departments: [{ departmentId: 'dept-all', name: 'All Agents', parentDepartmentId: null, roles: [{ roleId: 'role-member', name: 'Member' }] }],
        members: roster.map((r) => ({ rosterId: r.rosterId, departmentId: 'dept-all', roleId: 'role-member', reportsTo: null })),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const personaOf = (rosterId: string): string => roster.find((r) => r.rosterId === rosterId)?.persona ?? rosterId;

  return (
    <section style={{ padding: '1rem', maxWidth: 920 }}>
      <PageHeader
        eyebrow="Roster"
        title="Roster & Org-Chart"
        lede={<>Named "digital-twin employee" agents that own a workflow portfolio (RFC 0086), grouped into a descriptive org-chart (RFC 0087). Bind a roster member to a board on the <strong>Boards</strong> page to make its To&nbsp;Do column fire that agent's workflow.</>}
      />
      {error ? <Notice variant="error">{error}</Notice> : null}

      <h2 style={{ fontSize: '1rem' }}>Roster</h2>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Persona (e.g. Sally)" />
        <input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agentId" style={{ minWidth: 240 }} />
        <input value={workflows} onChange={(e) => setWorkflows(e.target.value)} placeholder="workflows (comma-separated)" style={{ minWidth: 240 }} />
        <button type="submit" className="primary">Add agent</button>
      </form>
      {roster.length === 0 ? (
        <p style={muted}>No named agents yet. Add one above.</p>
      ) : (
        roster.map((r) => (
          <div key={r.rosterId} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{r.persona}</strong>
              <button type="button" className="secondary" style={{ fontSize: '0.75rem' }} onClick={() => void onDelete(r.rosterId)}>Delete</button>
            </div>
            <div style={{ ...muted, fontSize: '0.8rem' }}>{r.rosterId} · runs <code>{r.agentRef.agentId}</code>{r.enabled ? '' : ' · disabled'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span className={`chip ${r.autonomyLevel === 'review' ? 'chip--accent' : 'chip--muted'}`}>
                {r.autonomyLevel === 'review' ? 'review — proposes' : 'auto — runs'}
              </span>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: '0.72rem' }}
                onClick={() => void onToggleAutonomy(r)}
                title={r.autonomyLevel === 'review'
                  ? 'Switch to auto: heartbeat picks run immediately'
                  : 'Switch to review: heartbeat picks need human sign-off (Inbox)'}
              >
                {r.autonomyLevel === 'review' ? 'Set auto' : 'Set review'}
              </button>
            </div>
            {r.workflows.length > 0 ? (
              <div style={{ fontSize: '0.8rem', marginTop: 4 }}>portfolio: {r.workflows.map((w) => <code key={w} style={{ marginRight: 6 }}>{w}</code>)}</div>
            ) : <div style={{ ...muted, fontSize: '0.8rem', marginTop: 4 }}>no workflows assigned</div>}
          </div>
        ))
      )}

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Org-chart</h2>
      <p style={{ ...muted, fontSize: '0.82rem', marginTop: '-0.4rem' }}>
        Departments + roles + reporting lines over roster members. An org edge is metadata only — it grants no authority
        (RFC 0087 §B). The responsibility roll-up is the union of a department's members' portfolios.
      </p>
      <button type="button" className="secondary" style={{ marginBottom: '0.6rem' }} onClick={() => void buildFlatChart()} disabled={roster.length === 0}>
        Generate flat chart from roster
      </button>
      {!chart || chart.departments.length === 0 ? (
        <p style={muted}>No org-chart yet. Use the button above to build a flat one from the roster (or PUT a structured chart via the API).</p>
      ) : (
        chart.departments.map((d) => {
          const view = rollups[d.departmentId];
          const members = chart.members.filter((m) => m.departmentId === d.departmentId);
          return (
            <div key={d.departmentId} style={card}>
              <strong>{d.name}</strong>
              {d.parentDepartmentId ? <span style={{ ...muted, fontSize: '0.78rem' }}> · under {chart.departments.find((x) => x.departmentId === d.parentDepartmentId)?.name ?? d.parentDepartmentId}</span> : null}
              <ul style={{ margin: '0.4rem 0', paddingLeft: '1.1rem' }}>
                {members.map((m) => (
                  <li key={m.rosterId} style={{ fontSize: '0.85rem' }}>
                    {personaOf(m.rosterId)} <span style={muted}>({d.roles.find((r) => r.roleId === m.roleId)?.name ?? m.roleId}{m.reportsTo ? ` → reports to ${personaOf(m.reportsTo)}` : ''})</span>
                  </li>
                ))}
              </ul>
              {view ? (
                <div style={{ fontSize: '0.8rem' }}>
                  <span style={muted}>responsible for: </span>
                  {view.responsibilities.length > 0 ? view.responsibilities.map((w) => <code key={w} style={{ marginRight: 6 }}>{w}</code>) : <span style={muted}>nothing yet</span>}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
