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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  checkAgent, getFleetActivity, getOrgChart, seedDemoAgents,
  type AgentActivityItem, type OrgChart,
} from './rosterClient.js';
import { listApprovals, type PendingApproval } from './approvalsClient.js';
import { loadAgentViews, relativeTime, type AgentView, type AgentStatus } from './agentViewModel.js';
import { roleKeyForAgent, roleThemeForKey, workflowName } from './roleTemplates.js';
import { RosterRow } from './RosterRow.js';
import { NeedsYouQueue } from './NeedsYouQueue.js';
import { AgentDrawer, type DrawerTab } from './AgentDrawer.js';
import { HireAgentModal } from './HireAgentModal.js';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { PageHeader } from '../ui/PageHeader.js';
import { BotIcon, ZapIcon, ClockIcon, ColumnsIcon, InboxIcon, PlayIcon, BuildingIcon, AlertIcon } from '../ui/icons/index.js';

type SortKey = 'attention' | 'name';

// ── Run-ledger helpers (folded in from the former /workforce page) ─────────
const SOURCE_GLYPH: Record<AgentActivityItem['source'], { Icon: typeof ZapIcon; label: string }> = {
  heartbeat: { Icon: ZapIcon, label: 'Heartbeat pick' },
  schedule: { Icon: ClockIcon, label: 'Scheduled run' },
  kanban: { Icon: ColumnsIcon, label: 'Board card' },
  approval: { Icon: InboxIcon, label: 'Approved proposal' },
};

interface LedgerGroup {
  first: AgentActivityItem;
  runs: number;
}

/** Collapse CONSECUTIVE feed items with the same agent + workflow + status
 *  into one row ("xN runs") — six identical "Lead routing · completed" rows
 *  carry one fact, not six rows of whitespace. Non-consecutive repeats stay
 *  separate so ordering remains honest. */
function groupLedger(items: AgentActivityItem[]): LedgerGroup[] {
  const out: LedgerGroup[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (
      last
      && last.first.persona === item.persona
      && last.first.workflowId === item.workflowId
      && last.first.status === item.status
      && last.first.source === item.source
    ) {
      last.runs += 1;
      continue;
    }
    out.push({ first: item, runs: 1 });
  }
  return out;
}

function runChip(status: string): string {
  if (status === 'completed') return 'chip chip--success';
  if (status === 'failed') return 'chip chip--danger';
  if (status === 'running' || status === 'pending') return 'chip chip--accent';
  return 'chip chip--muted';
}

// How much each agent wants the operator's eyes (highest first). "Waiting on a
// human" outranks everything; an idle agent with a full To Do queue outranks an
// empty one. Drives the default "Needs attention" sort so a 20-agent fleet
// surfaces what to look at first.
const STATUS_WEIGHT: Record<AgentStatus, number> = {
  error: 500,
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
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [hiring, setHiring] = useState(false);
  // Quick-look drawer state rides the URL (?agent=<rosterId>&tab=) so a
  // drawer view is shareable/refreshable (redesign PR 2, prototype contract).
  const [searchParams, setSearchParams] = useSearchParams();
  const drawerId = searchParams.get('agent');
  const drawerTabParam = searchParams.get('tab');
  const drawerTab: DrawerTab = drawerTabParam === 'board' || drawerTabParam === 'activity' ? drawerTabParam : 'overview';
  const openDrawer = useCallback((rosterId: string, tab?: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('agent', rosterId);
      if (tab === 'board' || tab === 'activity') p.set('tab', tab);
      else p.delete('tab');
      return p;
    });
  }, [setSearchParams]);
  const closeDrawer = useCallback(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('agent');
      p.delete('tab');
      return p;
    });
  }, [setSearchParams]);
  const [feed, setFeed] = useState<AgentActivityItem[] | null>(null);
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
      // Views + the editorial frame (org-chart filing, run ledger) in one
      // fan-in. Chart + ledger are progressive: their failure never blocks
      // the cards.
      const [v, c, f, ap] = await Promise.all([
        loadAgentViews(),
        getOrgChart().catch(() => null),
        getFleetActivity({ limit: 12 }).catch(() => ({ items: [], truncated: false })),
        listApprovals('pending').catch(() => []),
      ]);
      setViews(v);
      setChart(c);
      setFeed(f.items);
      setApprovals(ap);
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
        if (!cancelled) {
          setViews(loaded);
          const [c, f, ap] = await Promise.all([
            getOrgChart().catch(() => null),
            getFleetActivity({ limit: 12 }).catch(() => ({ items: [], truncated: false })),
            listApprovals('pending').catch(() => []),
          ]);
          if (!cancelled) { setChart(c); setFeed(f.items); setApprovals(ap); }
        }
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

  const figures = useMemo(() => ({
    staff: views.length,
    working: views.filter((v) => v.status === 'working').length,
    waiting: views.filter((v) => v.status === 'waiting').length,
    ready: views.filter((v) => v.status === 'active').length,
  }), [views]);

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
      await seedDemoAgents({ heal: true });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section>
      <PageHeader
        eyebrow="Agents"
        title="Digital workforce"
        lede="The named agents on staff — digital twins for company roles, each with workflows, a schedule, and a task board. What they own, how autonomous they are, and what they have been doing."
        actions={
          <button type="button" className="btn-accent-solid" onClick={() => setHiring(true)}>+ Hire an agent</button>
        }
      />

      {!loading && views.length > 0 ? (
        <NeedsYouQueue
          views={views}
          approvals={approvals}
          onOpen={(rosterId, tab) => openDrawer(rosterId, tab)}
          onResolved={() => void refresh()}
        />
      ) : null}

      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      {loading ? (
        <StateCard loading title="Loading your agents…" />
      ) : views.length === 0 ? (
        <>
        <ConceptStrip />
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
        </>
      ) : (
        <>
          {/* The two-column split opens at the TILES (layout parity with the
              prototype): tiles + toolbar + roster on the left, the ledger
              top-aligned with the tiles on the right. */}
          <div className="wf-body">
            <div>
            {/* Key figures double as the status FILTER: a tile both reports
                the count and narrows the roster to it. The old status select
                is gone — the tiles own status; long-tail states (failed /
                needs setup / paused) still bubble up via the attention sort. */}
            <div className="wf-figures" role="group" aria-label="Workforce key figures — click to filter">
              {([
                ['all', 'On staff', figures.staff, false],
                ['working', 'Working now', figures.working, false],
                ['waiting', 'Waiting on you', figures.waiting, true],
                ['active', 'Idle & ready', figures.ready, false],
              ] as const).map(([key, label, n, attn]) => (
                <button
                  type="button"
                  className={
                    'wf-figure wf-figure--tile'
                    + (statusFilter === key ? ' is-active' : '')
                    + (attn && n > 0 ? ' is-attn' : '')
                  }
                  key={key}
                  aria-pressed={statusFilter === key}
                  onClick={() => setStatusFilter(key as 'all' | AgentStatus)}
                >
                  <span className="wf-figure-n">{n}</span>
                  <span className="wf-figure-l">
                    {attn && n > 0 ? <AlertIcon size={11} aria-hidden /> : null}
                    {label}
                  </span>
                </button>
              ))}
            </div>

            {views.length > 3 ? (
              <div className="filterbar" role="group" aria-label="Filter and sort agents">
                <input
                  type="search"
                  className="ui-input filterbar-search"
                  placeholder="Search by name or role…"
                  aria-label="Search agents"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {roleOptions.length > 1 ? (
                  <select className="ui-input filterbar-select" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="all">All roles</option>
                    {roleOptions.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                ) : null}
                <select className="ui-input filterbar-select" aria-label="Sort agents" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
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
              <div className="surface-card roster-list">
                {visible.map((view) => (
                  <RosterRow
                    key={view.entry.rosterId}
                    view={view}
                    busy={busyAgent === view.entry.rosterId}
                    onOpen={(tab) => {
                      if (tab === 'workflows') {
                        // Editing flow — the full workspace, not the quick look.
                        navigate(`/agents/${encodeURIComponent(view.entry.rosterId)}?tab=workflows`);
                        return;
                      }
                      openDrawer(view.entry.rosterId, tab);
                    }}
                    onCheckNow={() => void onCheckNow(view.entry.rosterId, view.entry.persona)}
                    onChat={() => {
                      const agentId = view.entry.agentRef?.agentId;
                      navigate(agentId ? `/?agent=${encodeURIComponent(agentId)}` : '/');
                    }}
                  />
                ))}
              </div>
            )}

            </div>

            {/* The run ledger — fleet activity with run links, plus the
                department roll-up (folded in from the former /workforce). */}
            <aside className="wf-ledger surface-card" aria-label="Recent runs">
              <div className="wf-ledger-head">
                <span className="wf-ledger-title">The ledger</span>
                <Link to="/mission" className="wf-ledger-more">Mission control →</Link>
              </div>
              {feed === null ? (
                <div className="wf-ledger-rows">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width="100%" height={30} />)}</div>
              ) : feed.length === 0 ? (
                <p className="wf-ledger-empty">
                  No agent-attributed runs yet. Check an agent now, or drop a card on its board.
                </p>
              ) : (
                <ol className="wf-ledger-rows">
                  {groupLedger(feed).map((group) => {
                    const item = group.first;
                    const glyph = SOURCE_GLYPH[item.source] ?? { Icon: PlayIcon, label: item.source };
                    const Icon = glyph.Icon;
                    return (
                      <li className="wf-ledger-row" key={item.runId}>
                        <span className="wf-ledger-src" title={glyph.label} aria-hidden><Icon size={13} /></span>
                        <span className="wf-ledger-who">
                          <span>
                            <em>{item.persona ?? 'Agent'}</em>
                            <span className="wf-ledger-what"> · {workflowName(item.workflowId)}</span>
                          </span>
                          <Link to={`/runs/${encodeURIComponent(item.runId)}`} className="wf-ledger-when">
                            {group.runs > 1 ? `${group.runs} runs · ` : ''}{relativeTime(item.timestamp) ?? '—'}
                          </Link>
                        </span>
                        <span className={runChip(item.status)}>{item.status}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {chart && chart.departments.length > 0 ? (
                <div className="wf-ledger-foot">
                  <span className="wf-ledger-title">Departments</span>
                  <ul className="wf-depts">
                    {chart.departments.map((d) => (
                      <li key={d.departmentId}>
                        <BuildingIcon size={12} aria-hidden /> {d.name}
                        <span className="wf-dept-count">{chart.members.filter((m) => m.departmentId === d.departmentId).length}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/roster" className="wf-ledger-more">Org chart →</Link>
                </div>
              ) : null}
            </aside>
          </div>
        </>
      )}

      {hiring ? <HireAgentModal onClose={() => setHiring(false)} /> : null}

      {(() => {
        const drawerView = drawerId ? views.find((v) => v.entry.rosterId === drawerId) : undefined;
        if (!drawerView) return null;
        return (
          <AgentDrawer
            view={drawerView}
            approvals={approvals.filter((a) => a.rosterId === drawerView.entry.rosterId)}
            tab={drawerTab}
            onTab={(tab) => openDrawer(drawerView.entry.rosterId, tab)}
            onClose={closeDrawer}
            busy={busyAgent === drawerView.entry.rosterId}
            onCheckNow={() => void onCheckNow(drawerView.entry.rosterId, drawerView.entry.persona)}
            onResolved={() => void refresh()}
            onChat={() => {
              const agentId = drawerView.entry.agentRef?.agentId;
              navigate(agentId ? `/?agent=${encodeURIComponent(agentId)}` : '/');
            }}
          />
        );
      })()}
    </section>
  );
}
