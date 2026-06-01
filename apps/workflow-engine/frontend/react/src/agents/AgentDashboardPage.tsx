/**
 * `/agents` — the AI coworkers dashboard (PRD §8). The product-facing home for
 * named agents: who works here and what they're doing. Replaces the old
 * manifest-inventory list (now at `/agents/templates`) and folds in what used
 * to live under `/roster` and `/boards`.
 *
 * First visit seeds the built-in demo agents automatically (idempotent); the
 * roster/board/schedule data all come from the host-extension surfaces.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkAgent, seedDemoAgents } from './rosterClient.js';
import { loadAgentViews, type AgentView, type AgentStatus } from './agentViewModel.js';
import { roleKeyForAgent, roleThemeForKey } from './roleTemplates.js';
import { AgentCard } from './AgentCard.js';
import { AgentActivityFeed } from './AgentActivityFeed.js';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { PageHeader } from '../ui/PageHeader.js';
import { BotIcon } from '../ui/icons/index.js';

type SortKey = 'attention' | 'name';

// How much each agent wants the operator's eyes (highest first). "Waiting on a
// human" outranks everything; an idle agent with a full To Do queue outranks an
// empty one. Drives the default "Needs attention" sort so a 20-agent fleet
// surfaces what to look at first.
const STATUS_WEIGHT: Record<AgentStatus, number> = {
  waiting: 400,
  'needs-setup': 300,
  working: 200,
  active: 100,
  paused: 0,
};
function attentionScore(v: AgentView): number {
  return STATUS_WEIGHT[v.status] + Math.min(v.laneCounts.todo, 99);
}

function ConceptStrip(): JSX.Element {
  const steps = [
    { n: '1', label: 'Create an agent' },
    { n: '2', label: 'Assign workflows' },
    { n: '3', label: 'Tasks arrive on their board' },
    { n: '4', label: 'Heartbeat picks up work' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '0.8rem 0 1.2rem' }}>
      {steps.map((s) => (
        <div
          key={s.n}
          style={{
            flex: '1 1 160px',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: '0.6rem 0.8rem',
            background: 'var(--color-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--color-accent)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>{s.n}</span>
          <span style={{ fontSize: '0.85rem' }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function AgentDashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const [views, setViews] = useState<AgentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AgentStatus>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('attention');

  // Role families present in the current roster (for the role filter dropdown).
  const roleOptions = useMemo(() => {
    const keys = new Set(views.map((v) => roleKeyForAgent(v.entry.agentRef?.agentId, v.entry.workflows)));
    return [...keys].map((k) => ({ key: k, label: roleThemeForKey(k).label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [views]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = views.filter((v) => {
      if (statusFilter !== 'all' && v.status !== statusFilter) return false;
      if (roleFilter !== 'all' && roleKeyForAgent(v.entry.agentRef?.agentId, v.entry.workflows) !== roleFilter) return false;
      if (q) {
        const hay = `${v.entry.persona} ${v.entry.label ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) =>
      sortKey === 'name'
        ? a.entry.persona.localeCompare(b.entry.persona)
        : attentionScore(b) - attentionScore(a) || a.entry.persona.localeCompare(b.entry.persona),
    );
  }, [views, query, statusFilter, roleFilter, sortKey]);

  const refresh = useCallback(async () => {
    try {
      setViews(await loadAgentViews());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // First load: hydrate; if the tenant has no agents yet, seed the demo set
  // automatically (idempotent) so the first visit is never an empty screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let loaded = await loadAgentViews();
        if (loaded.length === 0) {
          await seedDemoAgents();
          loaded = await loadAgentViews();
        }
        if (!cancelled) setViews(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCheckNow = async (rosterId: string, persona: string) => {
    setBusyAgent(rosterId);
    setNotice(null);
    setError(null);
    try {
      const result = await checkAgent(rosterId);
      if (result.picked) {
        setNotice(`${persona} picked up “${result.cardTitle}” and started a run.`);
      } else {
        setNotice(`${persona} found no eligible To Do tasks (${result.reason ?? 'idle'}).`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent(null);
    }
  };

  const onLoadDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      await seedDemoAgents();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        eyebrow="Agents"
        title="AI coworkers"
        lede="Create AI coworkers that act as digital twins for company roles, then give them workflows, schedules, and task boards."
        actions={
          <button type="button" className="primary" onClick={() => navigate('/agents/new')}>Create agent</button>
        }
      />

      <ConceptStrip />

      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      {loading ? (
        <StateCard loading title="Loading your agents…" />
      ) : views.length === 0 ? (
        <StateCard
          icon={<BotIcon size={26} />}
          title="Agents are named digital coworkers"
          body="Like Sally in Sales Ops or Marcus in Support. Give each one a role, workflows, and a task board, then watch work arrive and get picked up."
          action={
            <>
              <button type="button" className="primary" onClick={() => navigate('/agents/new')}>Create from template</button>
              <button type="button" className="secondary" onClick={() => void onLoadDemo()} disabled={seeding}>
                {seeding ? 'Loading…' : 'Load demo agents'}
              </button>
            </>
          }
        />
      ) : (
        <>
          {views.length > 3 ? (
            <div className="action-bar" role="group" aria-label="Filter and sort agents" style={{ marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              <input
                type="search"
                className="ui-input"
                placeholder="Search by name or role…"
                aria-label="Search agents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: '1 1 200px', minWidth: 160 }}
              />
              <select className="ui-input" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | AgentStatus)}>
                <option value="all">All statuses</option>
                <option value="working">Working</option>
                <option value="waiting">Waiting on human</option>
                <option value="active">Ready</option>
                <option value="paused">Paused</option>
                <option value="needs-setup">Needs setup</option>
              </select>
              {roleOptions.length > 1 ? (
                <select className="ui-input" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="all">All roles</option>
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              ) : null}
              <select className="ui-input" aria-label="Sort agents" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="attention">Sort: Needs attention</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <StateCard
              icon={<BotIcon size={26} />}
              title="No agents match"
              body="Try clearing the search or filters."
              action={<button type="button" className="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setRoleFilter('all'); }}>Clear filters</button>}
            />
          ) : (
            <div className="card-grid">
              {visible.map((view) => (
                <AgentCard
                  key={view.entry.rosterId}
                  view={view}
                  busy={busyAgent === view.entry.rosterId}
                  onOpen={(tab) => navigate(`/agents/${encodeURIComponent(view.entry.rosterId)}${tab ? `?tab=${tab}` : ''}`)}
                  onCheckNow={() => void onCheckNow(view.entry.rosterId, view.entry.persona)}
                />
              ))}
            </div>
          )}

          <h2 style={{ fontSize: '15px', marginTop: 'var(--space-5)' }}>Fleet activity</h2>
          <AgentActivityFeed views={views} />
        </>
      )}
    </section>
  );
}
