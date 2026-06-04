import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listRoster, getOrgChart, getFleetActivity, checkAgent,
  type RosterEntry, type OrgChart, type AgentActivityItem,
} from './rosterClient.js';
import { AgentAvatar } from './AgentAvatar.js';
import { roleThemeForKey, roleKeyForAgent, workflowName } from './roleTemplates.js';
import { relativeTime } from './agentViewModel.js';
import { PageHeader } from '../ui/PageHeader.js';
import { StateCard } from '../ui/StateCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { toast } from '../ui/toast.js';
import {
  BotIcon, ZapIcon, InboxIcon, ColumnsIcon, ClockIcon, PlayIcon, BuildingIcon,
} from '../ui/icons/index.js';

/**
 * The Digital Workforce — a tier-1 reading view of the named agents as a
 * staff roster (white-label PRD §13, user-requested 2026-06-04).
 *
 * Editorial "annual report" treatment, composed entirely from the governed
 * token system: a key-figures band (oversized serif numerals over hairline
 * rules), personnel-dossier cards filed under their org-chart department, and
 * a ruled run ledger. Day-to-day management stays on /agents (dashboards) and
 * /agents/:id (workspaces); this page is the workforce AT A GLANCE — who they
 * are, what they own, how autonomous they are, what they have been doing.
 */

const SOURCE_GLYPH: Record<AgentActivityItem['source'], { Icon: typeof ZapIcon; label: string }> = {
  heartbeat: { Icon: ZapIcon, label: 'Heartbeat pick' },
  schedule: { Icon: ClockIcon, label: 'Scheduled run' },
  kanban: { Icon: ColumnsIcon, label: 'Board card' },
  approval: { Icon: InboxIcon, label: 'Approved proposal' },
};

function runChip(status: string): string {
  if (status === 'completed') return 'chip chip--success';
  if (status === 'failed') return 'chip chip--danger';
  if (status === 'running' || status === 'pending') return 'chip chip--accent';
  return 'chip chip--muted';
}

function cadenceLabel(ms: number | undefined): string {
  if (!ms || ms <= 0) return 'manual';
  if (ms % 3_600_000 === 0) { const h = ms / 3_600_000; return `every ${h}h`; }
  if (ms % 60_000 === 0) { const m = ms / 60_000; return `every ${m}m`; }
  return `every ${Math.round(ms / 1000)}s`;
}

interface MemberPlacement { department: string; role: string }

function placements(chart: OrgChart | null): Map<string, MemberPlacement> {
  const out = new Map<string, MemberPlacement>();
  if (!chart) return out;
  for (const m of chart.members) {
    const dept = chart.departments.find((d) => d.departmentId === m.departmentId);
    if (!dept) continue;
    const role = dept.roles.find((r) => r.roleId === m.roleId);
    out.set(m.rosterId, { department: dept.name, role: role?.name ?? '' });
  }
  return out;
}

function WorkforceCard({ entry, placement, index, onChecked }: {
  entry: RosterEntry;
  placement: MemberPlacement | undefined;
  index: number;
  onChecked: () => void;
}): JSX.Element {
  const [checking, setChecking] = useState(false);
  const theme = roleThemeForKey(roleKeyForAgent(entry.agentRef.agentId, entry.workflows));
  const onHeartbeat = (entry.heartbeatIntervalMs ?? 0) > 0;
  const review = entry.autonomyLevel === 'review';
  const lastChecked = relativeTime(entry.lastHeartbeatAt);

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await checkAgent(entry.rosterId);
      toast.success(
        result.picked
          ? `${entry.persona} picked up “${result.cardTitle ?? 'a card'}” and started a run.`
          : `${entry.persona} checked the board — nothing to pick up.`,
      );
      onChecked();
    } catch (err) {
      toast.error(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <article
      className="surface-card wf-card"
      style={{ animationDelay: `${Math.min(index, 10) * 55}ms` }}
    >
      <div className="wf-card-file" aria-hidden>
        <span className="wf-card-dept">{placement?.department ?? 'Unassigned'}</span>
        <span
          className={onHeartbeat ? 'wf-live is-on' : 'wf-live'}
          title={onHeartbeat ? `Autonomous heartbeat ${cadenceLabel(entry.heartbeatIntervalMs)}` : 'Manual heartbeat only'}
        />
      </div>
      <div className="wf-card-id">
        <AgentAvatar persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} size={52} showBadge={false} />
        <div className="wf-card-name">
          <h3>{entry.persona}</h3>
          <p className="wf-card-role">{entry.label ?? placement?.role ?? theme.label}</p>
        </div>
      </div>
      {entry.description ? <p className="wf-card-bio">{entry.description}</p> : null}
      <dl className="wf-card-facts">
        <div><dt>Portfolio</dt><dd>{entry.workflows.length} workflow{entry.workflows.length === 1 ? '' : 's'}</dd></div>
        <div><dt>Cadence</dt><dd>{cadenceLabel(entry.heartbeatIntervalMs)}</dd></div>
        <div><dt>Last check</dt><dd>{lastChecked ?? 'never'}</dd></div>
      </dl>
      <div className="wf-card-standing">
        {review
          ? <span className="chip chip--warning" title="Heartbeat picks queue as proposals for human sign-off">Proposes for review</span>
          : <span className="chip chip--accent" title="Heartbeat picks start runs immediately">Autonomous</span>}
        {!entry.enabled ? <span className="chip chip--muted">Paused</span> : null}
      </div>
      <div className="wf-card-actions action-bar">
        <Link className="secondary btn-sm" to={`/agents/${encodeURIComponent(entry.rosterId)}`}>
          Open workspace
        </Link>
        <button type="button" className="secondary btn-sm" disabled={checking || !entry.enabled} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </article>
  );
}

export function WorkforcePage(): JSX.Element {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [feed, setFeed] = useState<AgentActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      // One fan-in: roster + chart + a bounded ledger window (3 reads total,
      // friendly to the per-IP read budget).
      const [r, c, f] = await Promise.all([
        listRoster(),
        getOrgChart().catch(() => null),
        getFleetActivity({ limit: 12 }).catch(() => ({ items: [], truncated: false })),
      ]);
      setRoster(r);
      setChart(c);
      setFeed(f.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byMember = useMemo(() => placements(chart), [chart]);
  const figures = useMemo(() => {
    const r = roster ?? [];
    return {
      headcount: r.length,
      onHeartbeat: r.filter((e) => (e.heartbeatIntervalMs ?? 0) > 0 && e.enabled).length,
      inReview: r.filter((e) => e.autonomyLevel === 'review').length,
      departments: chart?.departments.length ?? 0,
    };
  }, [roster, chart]);

  if (error) {
    return (
      <section className="workforce">
        <PageHeader eyebrow="Operate" title="Digital workforce" />
        <StateCard
          icon={<BotIcon size={20} />}
          title="The roster could not be loaded"
          body={error}
          action={<button type="button" className="secondary btn-sm" onClick={() => void load()}>Retry</button>}
        />
      </section>
    );
  }

  return (
    <section className="workforce">
      <PageHeader
        eyebrow="Operate"
        title="Digital workforce"
        lede="The named agents on staff — what they own, how autonomous they are, and what they have been doing."
        actions={<Link className="primary btn-sm" to="/agents/new">Hire an agent</Link>}
      />

      <dl className="wf-figures" aria-label="Workforce key figures">
        {([
          ['On staff', figures.headcount],
          ['On a heartbeat', figures.onHeartbeat],
          ['Propose for review', figures.inReview],
          ['Departments', figures.departments],
        ] as const).map(([label, n]) => (
          <div className="wf-figure" key={label}>
            <dd>{roster === null ? <Skeleton width={44} height={34} /> : n}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>

      <div className="wf-body">
        <div className="wf-grid">
          {roster === null ? (
            [0, 1, 2].map((i) => (
              <div className="surface-card wf-card" key={i}>
                <Skeleton width="40%" height={11} />
                <div className="wf-card-id"><Skeleton width={52} height={52} radius={26} /><Skeleton width="55%" height={20} /></div>
                <Skeleton width="90%" height={12} />
                <Skeleton width="70%" height={12} />
              </div>
            ))
          ) : roster.length === 0 ? (
            <StateCard
              icon={<BotIcon size={20} />}
              title="No agents on staff yet"
              body="Hire your first named agent, or load the demo roster from Admin → Demo data."
              action={<Link className="primary btn-sm" to="/agents/new">Hire an agent</Link>}
            />
          ) : (
            roster.map((entry, i) => (
              <WorkforceCard
                key={entry.rosterId}
                entry={entry}
                placement={byMember.get(entry.rosterId)}
                index={i}
                onChecked={() => void load()}
              />
            ))
          )}
        </div>

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
              {feed.map((item) => {
                const glyph = SOURCE_GLYPH[item.source] ?? { Icon: PlayIcon, label: item.source };
                const Icon = glyph.Icon;
                return (
                  <li className="wf-ledger-row" key={item.runId}>
                    <span className="wf-ledger-src" title={glyph.label} aria-hidden><Icon size={13} /></span>
                    <span className="wf-ledger-who">
                      <em>{item.persona ?? 'Agent'}</em>
                      <span className="wf-ledger-what">{workflowName(item.workflowId)}</span>
                    </span>
                    <span className={runChip(item.status)}>{item.status}</span>
                    <Link to={`/runs/${encodeURIComponent(item.runId)}`} className="wf-ledger-when">
                      {relativeTime(item.timestamp) ?? '—'}
                    </Link>
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
    </section>
  );
}
