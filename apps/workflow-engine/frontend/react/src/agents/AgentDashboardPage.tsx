/**
 * `/agents` — the AI coworkers dashboard (PRD §8). The product-facing home for
 * named agents: who works here and what they're doing. Replaces the old
 * manifest-inventory list (now at `/agents/templates`) and folds in what used
 * to live under `/roster` and `/boards`.
 *
 * First visit seeds the built-in demo agents automatically (idempotent); the
 * roster/board/schedule data all come from the host-extension surfaces.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkAgent, seedDemoAgents } from './rosterClient.js';
import { loadAgentViews, type AgentView } from './agentViewModel.js';
import { AgentCard } from './AgentCard.js';
import { AgentActivityFeed } from './AgentActivityFeed.js';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { BotIcon } from '../chat/icons/index.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginTop: 0, marginBottom: '0.3rem' }}>AI coworkers</h1>
          <p style={{ ...muted, marginTop: 0, maxWidth: 560 }}>
            Create named agents, assign company workflows, and manage their work from task boards.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="primary" onClick={() => navigate('/agents/new')}>Create agent</button>
        </div>
      </div>

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
          <div className="card-grid">
            {views.map((view) => (
              <AgentCard
                key={view.entry.rosterId}
                view={view}
                busy={busyAgent === view.entry.rosterId}
                onOpen={() => navigate(`/agents/${encodeURIComponent(view.entry.rosterId)}`)}
                onCheckNow={() => void onCheckNow(view.entry.rosterId, view.entry.persona)}
              />
            ))}
          </div>

          <h2 style={{ fontSize: '15px', marginTop: 'var(--space-5)' }}>Fleet activity</h2>
          <AgentActivityFeed views={views} />
        </>
      )}
    </section>
  );
}
