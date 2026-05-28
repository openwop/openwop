/**
 * Agents tab — list view (phase C1).
 *
 * Sources from `GET /v1/agents` (RFC 0072 §A normative read-only
 * inventory). Surfaces every installed manifest agent the host knows
 * about; the source pack + version is shown per row so users can tell
 * two same-persona agents apart.
 *
 * Future phases attaching to this surface:
 *   - C2: row click → `/agents/:agentId` detail view
 *   - E1-E2: "+ Author new" button → `/agents/new` form, backed by
 *     `POST /v1/host/sample/agents`
 *   - E3: "Install from registry" → modal listing published
 *     `core.openwop.agents.*` packs
 *   - E4: per-row "Fork" → `/agents/new?fork=<agentId>` prefilled
 *
 * Today the row affordances are just "View" (text link to detail);
 * Fork / Delete light up after E1 introduces the user-authored
 * vs pack-installed split.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listAgents, type AgentEntry } from '../client/agentsClient.js';

interface State {
  agents: readonly AgentEntry[];
  isLoading: boolean;
  error: string | null;
}

export function AgentsPage(): JSX.Element {
  const [state, setState] = useState<State>({ agents: [], isLoading: true, error: null });
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const agents = await listAgents();
        if (cancelled) return;
        setState({ agents, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          agents: [],
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = state.agents.filter((a) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      a.persona.toLowerCase().includes(q) ||
      a.label.toLowerCase().includes(q) ||
      (a.description?.toLowerCase().includes(q) ?? false) ||
      a.packName.toLowerCase().includes(q)
    );
  });

  return (
    <section aria-labelledby="agents-page-heading" style={{ maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)' }}>
        <div style={{ flex: 1 }}>
          <h2 id="agents-page-heading" style={{ marginBottom: 'var(--space-1)' }}>Agents</h2>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Persona-driven LLM workers. Mention one in chat with{' '}
            <code>@</code> to add it to your active-agents lineup.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate('/agents/install')}
          >
            Install from registry
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => navigate('/agents/new')}
          >
            + Author new
          </button>
        </div>
      </header>

      <div style={{ marginBottom: 'var(--space-3)' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, description, or pack…"
          aria-label="Filter agents"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 13,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        />
      </div>

      {state.isLoading && (
        <EmptyBlock>Loading agents…</EmptyBlock>
      )}
      {state.error && (
        <EmptyBlock tone="error">Couldn't load agents: {state.error}</EmptyBlock>
      )}
      {!state.isLoading && !state.error && state.agents.length === 0 && (
        <EmptyBlock>
          No agents installed yet. Install one from the registry or author
          your own — both are coming in phase E (the buttons above light
          up then).
        </EmptyBlock>
      )}
      {!state.isLoading && !state.error && state.agents.length > 0 && filtered.length === 0 && (
        <EmptyBlock>No agents match <code>{query}</code>.</EmptyBlock>
      )}

      {filtered.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((agent) => (
            <AgentRow key={agent.agentId} agent={agent} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentRow({ agent }: { agent: AgentEntry }): JSX.Element {
  return (
    <li>
      <Link
        to={`/agents/${encodeURIComponent(agent.agentId)}`}
        style={{
          display: 'block',
          padding: 'var(--space-3) var(--space-4)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          background: 'var(--color-surface)',
          color: 'inherit',
          textDecoration: 'none',
          transition: 'border-color .12s ease, background .12s ease',
        }}
        // Keep the marketing-site rhythm: subtle clay-tinted border
        // on hover, no full background flip. Matches the
        // .nav-dropdown-menu hover state.
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--clay-rule)';
          e.currentTarget.style.background = 'var(--clay-wash)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)';
          e.currentTarget.style.background = 'var(--color-surface)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{agent.label || agent.persona}</strong>
          <code className="muted" style={{ fontSize: 11 }}>@{slugify(agent.persona)}</code>
          <ModelClassChip modelClass={agent.modelClass} />
          {agent.degraded && agent.degraded.length > 0 && (
            <DegradedChip count={agent.degraded.length} />
          )}
        </div>
        {agent.description && (
          <p className="muted" style={{ margin: 0, marginBottom: 6, fontSize: 12.5, lineHeight: 1.45 }}>
            {agent.description}
          </p>
        )}
        <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>
            Pack: <code>{agent.packName}@{agent.packVersion}</code>
          </span>
          {agent.toolAllowlist.length > 0 && (
            <span>{agent.toolAllowlist.length} tool{agent.toolAllowlist.length === 1 ? '' : 's'}</span>
          )}
          {agent.hasHandoffSchemas && <span>Handoff schemas declared</span>}
          {agent.confidenceThreshold !== undefined && (
            <span>Confidence ≥ {agent.confidenceThreshold.toFixed(2)}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function ModelClassChip({ modelClass }: { modelClass: string }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 8px',
        borderRadius: 10,
        background: 'var(--color-surface-2)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--mono)',
        textTransform: 'lowercase',
      }}
    >
      {modelClass}
    </span>
  );
}

function DegradedChip({ count }: { count: number }): JSX.Element {
  return (
    <span
      title={`${count} declared capability tier${count === 1 ? '' : 's'} this host does not satisfy — see agent detail.`}
      style={{
        fontSize: 10,
        padding: '1px 8px',
        borderRadius: 10,
        background: 'color-mix(in oklch, var(--color-warning) 14%, transparent)',
        color: 'var(--color-warning)',
        fontFamily: 'var(--mono)',
      }}
    >
      degraded ×{count}
    </span>
  );
}

function EmptyBlock({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}): JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        border: `1px ${tone === 'error' ? 'solid' : 'dashed'} ${
          tone === 'error' ? 'var(--color-danger)' : 'var(--rule)'
        }`,
        borderRadius: 8,
        textAlign: 'center',
        color: tone === 'error' ? 'var(--color-danger)' : 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

/** Local slug helper — keeps the list view's row chip aligned with
 *  the chat picker's `@persona-slug` rendering. Duplicated rather
 *  than re-exported from `chat/lib/agentMentions.ts` to avoid pulling
 *  the chat module into the agents tab graph. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}
