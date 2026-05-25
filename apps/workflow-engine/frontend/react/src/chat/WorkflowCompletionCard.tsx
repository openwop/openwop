/**
 * Workflow Completion Card — persistent record appended below a
 * workflow_run bubble after the run reaches a terminal state.
 *
 * Renders one of three variants based on `workflowRun.status`:
 *   - completed → "Workflow completed" + N View links for the
 *                 terminal nodes (per the architect review's "N
 *                 View links for N terminals" v1 convention).
 *   - failed    → muted-danger row with the error summary + an
 *                 "Open run" link to /runs/:runId for full diagnostics.
 *   - cancelled → muted row noting the cancellation + "Open run" link.
 *
 * Architecture decision: derive, don't persist (Option B). All data
 * comes from the existing `WorkflowRunState` snapshot — no new BE
 * endpoints, no new chat_messages rows, no new event types. Survives
 * reload because the workflow_run message hydrates from the BE event
 * log on session restore.
 *
 * Terminal-node convention (architect review §3): the FE walks the
 * saved workflow graph to find every node with no outgoing edges and
 * surfaces one View link per terminal. Falls back to "Open run" when
 * the graph isn't locally cached (e.g., a workflow saved on a
 * different device).
 */

import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { getSavedWorkflow } from '../builder/persistence/localStore.js';
import { formatElapsed } from './workflowProgress/formatters.js';
import { AlertIcon, BanIcon, CheckIcon } from './icons/index.js';
import type { WorkflowRunState } from './types.js';

interface Props {
  run: WorkflowRunState;
  /** When set, clicking the View link opens this preview modal handler
   *  instead of relying on default in-page navigation. The handler
   *  receives the terminal node id + its output blob. */
  onPreviewArtifact?: (nodeId: string, output: unknown, label: string) => void;
}

export function WorkflowCompletionCard({ run, onPreviewArtifact }: Props): JSX.Element | null {
  // Hooks MUST come before any conditional return — Rules of Hooks.
  // The previous shape early-returned on non-terminal states and then
  // called hooks below, which throws "Rendered more hooks than during
  // the previous render" the first time a workflow_run flips terminal.
  // Both hooks are cheap during the running phase (no work done, just
  // initial-state reads), so the render-time cost of always calling
  // them is negligible.
  const terminals = useTerminalNodes(run);
  const elapsed = useElapsedSince(run.startedAt);

  const isTerminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  if (!isTerminal) return null;

  const stepCount = run.totalNodes > 0
    ? `${run.completedNodeIds.length}/${run.totalNodes} steps`
    : `${run.completedNodeIds.length} step${run.completedNodeIds.length === 1 ? '' : 's'}`;

  const unavailable = run.runUnavailable === true;

  if (run.status === 'failed') {
    return (
      <CompletionShell tone="danger" iconKind="alert" title="Workflow failed">
        <Meta items={[stepCount, elapsed]} />
        {run.error && (
          <div
            className="muted"
            style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-word' }}
          >
            {run.error.code}: {run.error.message}
          </div>
        )}
        {run.runId && (
          <Actions>
            <OpenRunLink runId={run.runId} unavailable={unavailable} />
          </Actions>
        )}
      </CompletionShell>
    );
  }

  if (run.status === 'cancelled') {
    return (
      <CompletionShell tone="muted" iconKind="ban" title="Workflow cancelled">
        <Meta items={[stepCount, elapsed]} />
        {run.runId && (
          <Actions>
            <OpenRunLink runId={run.runId} unavailable={unavailable} />
          </Actions>
        )}
      </CompletionShell>
    );
  }

  // status === 'completed'
  return (
    <CompletionShell tone="success" iconKind="check" title="Workflow completed">
      <Meta items={[stepCount, elapsed]} />
      <Actions>
        {terminals.length > 0
          ? terminals.map((t) => (
              <span key={t.nodeId} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onPreviewArtifact?.(t.nodeId, t.output, t.label)}
                  disabled={!onPreviewArtifact}
                  style={{ fontSize: 12 }}
                  // Button label:
                  //   - primary-tagged terminal → "View {label}" (author named
                  //     it; lean on that)
                  //   - one terminal, untagged → "View output" (generic;
                  //     legacy v1 behavior)
                  //   - N>1 untagged terminals → "View {label}" (disambiguates)
                  title={t.isPrimary ? `Primary output — declared by workflow author` : undefined}
                >
                  {(t.isPrimary || terminals.length > 1) ? `View ${t.label}` : 'View output'} →
                </button>
                {run.runId && !unavailable && (
                  // Deep-link companion to the modal-opening View button —
                  // opens /runs/:runId#node-:nodeId in a new tab so the user
                  // can inspect the artifact in the full run-detail surface
                  // (event log, agent trace, etc.) alongside the chat thread.
                  <a
                    href={`/runs/${run.runId}#node-${encodeURIComponent(t.nodeId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in run detail (new tab)"
                    style={{
                      fontSize: 12,
                      display: 'inline-flex',
                      alignItems: 'center',
                      textDecoration: 'none',
                      color: 'var(--color-accent)',
                      padding: '0 4px',
                    }}
                    aria-label={`Open ${t.label} in run detail (new tab)`}
                  >
                    ↗
                  </a>
                )}
              </span>
            ))
          : null}
        {run.runId && (
          <span style={{ alignSelf: 'center' }}>
            <OpenRunLink runId={run.runId} unavailable={unavailable} />
          </span>
        )}
      </Actions>
    </CompletionShell>
  );
}

/**
 * Shared "Open run" affordance — renders the link normally when the
 * run is still on the server, or a muted "(unavailable)" placeholder
 * when the orphan-detection probe set `runUnavailable: true`.
 */
function OpenRunLink({ runId, unavailable }: { runId: string; unavailable: boolean }): JSX.Element {
  if (unavailable) {
    return (
      <span
        className="muted"
        style={{ fontSize: 12, fontStyle: 'italic' }}
        title="Run record no longer available on the server"
      >
        Open run (unavailable)
      </span>
    );
  }
  return (
    <Link to={`/runs/${runId}`} style={{ fontSize: 12 }}>
      Open run →
    </Link>
  );
}

interface Terminal {
  nodeId: string;
  label: string;
  output: unknown;
  /** RFC 0065 — true when the workflow author tagged this node as the
   *  canonical-deliverable artifact. When ≥1 terminal is primary, the
   *  card surfaces only the primary as a "View output" button and the
   *  rest as a single "Open run" link; otherwise it falls back to the
   *  v1 "N View links for N terminals" convention. */
  isPrimary: boolean;
}

/**
 * Find terminal nodes of the run. Terminal == no outgoing edge in the
 * saved workflow graph. Two failure modes:
 *   - Workflow not in local cache (saved on another device): return [],
 *     caller falls back to the "Open run" link.
 *   - Run hasn't completed a terminal node yet: return [], same fallback.
 *
 * Hooked rather than computed inline because `getSavedWorkflow` reads
 * localStorage and we want to memoize the result.
 */
function useTerminalNodes(run: WorkflowRunState): Terminal[] {
  // Memo key is a stable string hash of the inputs that actually
  // matter — using the raw `run.nodeNames` / `run.nodeOutputs` object
  // references would invalidate on every SSE event (the session
  // reducer spreads a fresh object each time), defeating the cache.
  const memoKey = useMemo(
    () => `${run.workflowId}::${run.status}::${run.completedNodeIds.join(',')}`,
    [run.workflowId, run.status, run.completedNodeIds],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- memoKey
  // captures every input that the memo body reads; depending on the
  // raw refs would cause spurious invalidations per the comment above.
  return useMemo(() => {
    const saved = getSavedWorkflow(run.workflowId);
    if (!saved) return [];
    // A node is terminal if no edge has it as `source`.
    const hasOutgoing = new Set<string>();
    for (const e of saved.edges) hasOutgoing.add(e.source);
    const terminals: Terminal[] = [];
    for (const n of saved.nodes) {
      if (hasOutgoing.has(n.id)) continue;
      // Only surface terminals the run actually reached — a half-run
      // with one branch failed shouldn't claim un-run terminals.
      // Match the builder node id against the backend nodeId via the
      // run's `nodeNames` map (which carries the BE→builder mapping).
      const backendNodeId = lookupBackendNodeId(n.id, run);
      if (!backendNodeId) continue;
      if (!run.completedNodeIds.includes(backendNodeId)) continue;
      const output = run.nodeOutputs[backendNodeId];
      if (output == null) continue;
      // `n.config?.name` is `unknown` until proven otherwise — narrow
      // via typeof, don't cast. Operator precedence with `??` matters
      // here: `(x as string) ?? y` would coerce `undefined` to `string`
      // and never reach the fallback.
      const namedLabel = typeof n.config?.name === 'string' ? n.config.name : null;
      const label = namedLabel ?? n.kind ?? backendNodeId.slice(0, 8);
      terminals.push({
        nodeId: backendNodeId,
        label,
        output,
        isPrimary: n.outputRole === 'primary',
      });
    }
    // RFC 0065 — if at least one terminal is tagged `primary`, narrow
    // the surfaced list to JUST the primary one. Per the RFC, the
    // tiebreaker for multiple primaries is lexicographic node id —
    // deterministic + reproducible across implementations.
    const primaries = terminals.filter((t) => t.isPrimary);
    if (primaries.length > 0) {
      primaries.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      return [primaries[0]!];
    }
    // Fallback (v1 convention): show every terminal as a separate
    // "View output" link.
    return terminals;
  }, [memoKey]);
}

/**
 * The run snapshot's `nodeNames` is `{backendNodeId → builderNodeId}`
 * in some adapters and `{backendNodeId → friendlyName}` in others.
 * To map builder→backend we walk the entries and reverse-match. When
 * the run was an ephemeral / sample workflow with no builder id at
 * all, `nodeNames` is empty and we fall back to a direct lookup.
 */
function lookupBackendNodeId(builderNodeId: string, run: WorkflowRunState): string | null {
  if (run.completedNodeIds.includes(builderNodeId)) return builderNodeId;
  for (const [backendId, name] of Object.entries(run.nodeNames)) {
    if (name === builderNodeId || backendId === builderNodeId) return backendId;
  }
  return null;
}

function useElapsedSince(startedAt: string): string {
  // Snapshot at mount — terminal runs don't keep ticking, so a single
  // read is sufficient. The render cost is paid even while the run is
  // still mid-flight (the parent calls this unconditionally now to
  // satisfy Rules of Hooks), but `formatElapsed` is a constant-time
  // string format so the overhead is negligible.
  const [text] = useState(() => formatElapsed(startedAt));
  return text;
}

interface ShellProps {
  tone: 'success' | 'danger' | 'muted';
  iconKind: 'check' | 'alert' | 'ban';
  title: string;
  children: React.ReactNode;
}

function CompletionShell({ tone, iconKind, title, children }: ShellProps): JSX.Element {
  const color = tone === 'success'
    ? 'var(--color-success)'
    : tone === 'danger'
      ? 'var(--color-danger)'
      : 'var(--color-text-muted)';
  // Danger uses a 2px border for non-color differentiation so users
  // with limited color discrimination still see the failure call-out.
  const borderWidth = tone === 'danger' ? 2 : 1;
  // ARIA landmark label so SR users can navigate the row as a unit.
  const ariaLabel = `Workflow run: ${title}`;
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      style={{
        marginTop: 8,
        padding: '10px 14px',
        borderRadius: 10,
        background: `color-mix(in oklch, ${color} 8%, transparent)`,
        border: `${borderWidth}px solid color-mix(in oklch, ${color} 40%, var(--color-border))`,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color, display: 'inline-flex' }}>
          {iconKind === 'check' && <CheckIcon size={14} />}
          {iconKind === 'alert' && <AlertIcon size={14} />}
          {iconKind === 'ban' && <BanIcon size={14} />}
        </span>
        <strong style={{ color }}>{title}</strong>
      </div>
      {children}
    </div>
  );
}

function Meta({ items }: { items: readonly string[] }): JSX.Element {
  return (
    <div
      className="muted"
      style={{ marginTop: 4, paddingLeft: 22, fontSize: 11, display: 'flex', gap: 8 }}
    >
      {items.filter(Boolean).map((t, i) => (
        <span key={i}>{t}</span>
      ))}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        marginTop: 8,
        paddingLeft: 22,
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  );
}
