/**
 * Agent template detail — `/agents/templates/:agentId`.
 *
 * Read-only projection of `GET /v1/agents/:agentId` (RFC 0072 §A): the resolved
 * manifest metadata (persona/label, description, model class, tool allowlist,
 * memory shape, handoff schemas, confidence threshold, source pack pin). A
 * "Fork" button → `/agents/fork?fork=<agentId>` prefilled; a user-authored
 * template additionally shows "Delete" (pack-installed templates are immutable).
 *
 * The systemPrompt body itself is NOT projected over the inventory surface
 * (RFC 0072 §A SR-1 — system prompts are credential-adjacent and never cross the
 * read-only API). The detail view shows the `systemPromptRef` only; the body
 * lives in the pack manifest.
 */

import { useEffect, useState } from 'react'; // useState used by both AgentDetailPage (state) and AgentDetail (delete-in-flight + error)
import { EmptyBlock, slugify } from './agentUi.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteUserAgent, getAgent, type AgentEntry } from '../client/agentsClient.js';
import { ArrowLeftIcon, CheckIcon, CircleIcon } from '../ui/icons/index.js';

interface State {
  agent: AgentEntry | null;
  isLoading: boolean;
  error: string | null;
}

export function AgentDetailPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const [state, setState] = useState<State>({ agent: null, isLoading: true, error: null });

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const agent = await getAgent(agentId);
        if (cancelled) return;
        setState({ agent, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          agent: null,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  return (
    <section aria-labelledby="agent-detail-heading">
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Link to="/agents/templates" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          <ArrowLeftIcon size={12} /> Agent templates
        </Link>
      </div>

      {state.isLoading && (
        <EmptyBlock>Loading agent…</EmptyBlock>
      )}
      {state.error && (
        <EmptyBlock tone="error">Couldn't load agent: {state.error}</EmptyBlock>
      )}
      {!state.isLoading && !state.error && !state.agent && (
        <EmptyBlock>
          Agent <code>{agentId}</code> is not installed on this host.{' '}
          <Link to="/agents/templates">Back to the list.</Link>
        </EmptyBlock>
      )}

      {state.agent && <AgentDetail agent={state.agent} />}
    </section>
  );
}

function AgentDetail({ agent }: { agent: AgentEntry }): JSX.Element {
  const navigate = useNavigate();
  // User-authored agents carry `packName: 'user:<tenantId>'` (phase E1
  // synthesises that on register); pack-installed agents always carry
  // a real pack name (e.g. `core.openwop.agents.code-reviewer`). The
  // prefix is the cleanest discriminator without round-tripping a
  // separate `source` flag through the SDK.
  const isUserAuthored = agent.packName.startsWith('user:');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete(): Promise<void> {
    if (!isUserAuthored) return;
    if (!window.confirm(`Delete the "${agent.persona}" agent? This can't be undone.`)) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteUserAgent(agent.agentId);
      navigate('/agents/templates');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setIsDeleting(false);
    }
  }

  return (
    <article>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h2
          id="agent-detail-heading"
          style={{ marginBottom: 'var(--space-1)', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}
        >
          {agent.label || agent.persona}
          <code className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
            @{slugify(agent.persona)}
          </code>
        </h2>
        {agent.description && (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {agent.description}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)', alignItems: 'center' }}>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/agents/fork?fork=${encodeURIComponent(agent.agentId)}`)}
            title="Duplicate this agent's config into a new one you can customize"
          >
            Fork
          </button>
          {isUserAuthored ? (
            <button
              type="button"
              className="secondary"
              onClick={() => void onDelete()}
              disabled={isDeleting}
              title="Permanently delete this user-authored agent"
              style={{ color: 'var(--color-danger)' }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Pack-installed agents are not deletable. Fork to customize.
            </span>
          )}
        </div>
        {deleteError && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius)',
              color: 'var(--color-danger)',
              fontSize: 12,
              background: 'color-mix(in oklch, var(--color-danger) 6%, transparent)',
            }}
          >
            Delete failed: {deleteError}
          </div>
        )}
      </header>

      <DetailSection title="Source">
        <Row label="Pack" value={<code>{agent.packName}@{agent.packVersion}</code>} />
        <Row label="Agent ID" value={<code style={{ fontSize: 11 }}>{agent.agentId}</code>} />
      </DetailSection>

      <DetailSection title="Model + behaviour">
        <Row label="Model class" value={<code>{agent.modelClass}</code>} />
        {agent.confidenceThreshold !== undefined && (
          <Row
            label="Confidence threshold"
            value={<code>≥ {agent.confidenceThreshold.toFixed(2)}</code>}
            hint="The agent declares decisions below this score as low-confidence."
          />
        )}
        <Row
          label="Handoff schemas"
          value={agent.hasHandoffSchemas ? 'Declared' : 'Not declared'}
          hint={
            agent.hasHandoffSchemas
              ? 'The pack declares typed input + output schemas for inter-agent handoff (RFC 0037 §B).'
              : 'Inter-agent handoff falls back to free-form text.'
          }
        />
      </DetailSection>

      <DetailSection title="Memory shape">
        {agent.memoryShape ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <MemoryBadge label="Scratchpad" enabled={agent.memoryShape.scratchpad ?? false} />
            <MemoryBadge label="Conversation" enabled={agent.memoryShape.conversation ?? false} />
            <MemoryBadge label="Long-term" enabled={agent.memoryShape.longTerm ?? false} />
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            The pack does not declare a memory shape; the runtime treats this
            agent as stateless across turns.
          </p>
        )}
      </DetailSection>

      <DetailSection title={`Tool allowlist (${agent.toolAllowlist.length})`}>
        {agent.toolAllowlist.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            No tools allowlisted — the agent runs as a pure-completion
            persona without function-call surface.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {agent.toolAllowlist.map((tool) => (
              <li
                key={tool}
                style={{
                  padding: '3px 10px',
                  borderRadius: 14,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  fontSize: 11.5,
                  fontFamily: 'var(--mono)',
                  color: 'var(--ink-2)',
                }}
              >
                {tool}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {agent.degraded && agent.degraded.length > 0 && (
        <DetailSection title="Degraded capability tiers" tone="warning">
          <p className="muted" style={{ fontSize: 12.5, margin: 0, marginBottom: 8 }}>
            This pack declares capability tiers that this host does not
            satisfy (RFC 0072 §C). The agent still dispatches; these
            features are inert until the host advertises them.
          </p>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {agent.degraded.map((tier) => (
              <li
                key={tier}
                style={{
                  padding: '3px 10px',
                  borderRadius: 14,
                  background: 'color-mix(in oklch, var(--color-warning) 14%, transparent)',
                  color: 'var(--color-warning)',
                  fontSize: 11.5,
                  fontFamily: 'var(--mono)',
                }}
              >
                {tier}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
    </article>
  );
}

function DetailSection({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'warning';
}): JSX.Element {
  return (
    <section
      style={{
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        border: `1px solid ${tone === 'warning' ? 'var(--color-warning)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
        background: 'var(--color-surface)',
      }}
    >
      <h3
        style={{
          fontSize: 11,
          fontFamily: 'var(--mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: tone === 'warning' ? 'var(--color-warning)' : 'var(--ink-3)',
          margin: 0,
          marginBottom: 'var(--space-2)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid color-mix(in oklch, var(--rule) 40%, transparent)' }}>
      <span style={{ minWidth: 160, fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <div style={{ flex: 1, fontSize: 13 }}>
        <div>{value}</div>
        {hint && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function MemoryBadge({ label, enabled }: { label: string; enabled: boolean }): JSX.Element {
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 14,
        fontSize: 11.5,
        fontFamily: 'var(--mono)',
        background: enabled ? 'var(--clay-wash)' : 'var(--color-surface-2)',
        color: enabled ? 'var(--clay)' : 'var(--ink-3)',
        border: `1px solid ${enabled ? 'var(--clay-rule)' : 'var(--color-border)'}`,
      }}
    >
      {enabled ? <CheckIcon size={12} /> : <CircleIcon size={12} />} {label}
    </span>
  );
}

