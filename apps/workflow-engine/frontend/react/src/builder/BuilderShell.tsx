/**
 * Three-region builder layout + top toolbar.
 *
 * Toolbar: ‹ Workflows back-link, name input, [New], [Run], undo/redo.
 * Layout: palette (260px) | canvas (flex 1) | inspector (320px).
 *
 * Auto-saves to localStorage on every store mutation; no explicit Save
 * button — matches the chat session pattern (useChatSession.ts:87-113).
 * The workflow list lives at /builder (WorkflowsDashboard).
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NodePalette } from './palette/NodePalette.js';
import { BuilderCanvas } from './canvas/BuilderCanvas.js';
import { Inspector } from './inspector/Inspector.js';
import { useBuilderStore } from './store/builderStore.js';
import { newWorkflowId } from './persistence/localStore.js';
import { registerWorkflow } from './persistence/registerClient.js';
import { serializeWithIdMap, SerializeError } from './schema/serialize.js';
import { fromCanonicalDefinition, looksCanonical } from './schema/deserialize.js';
import { buildChainPackManifest } from './schema/chainPackManifest.js';
import { createRun, getCapabilities } from '../client/runsClient.js';
import { subscribeToRun } from '../client/streamsClient.js';
import type { SavedWorkflow } from './schema/workflow.js';
import { catalogEntry } from './palette/catalogRegistry.js';

/** Host-advertised engine limits from `capabilities.limits` (RFC 0009 +
 *  RFC 0058). Optional fields are absent when the host doesn't advertise. */
interface HostLimits {
  envelopesPerTurn?: number;
  clarificationRounds?: number;
  schemaRounds?: number;
  maxNodeExecutions?: number;
  maxRunDurationMs?: number;
  maxLoopIterations?: number;
}

/** Fetch `capabilities.limits` once on mount. `null` while in flight or
 *  if the host omits the block entirely. */
function useHostLimits(): HostLimits | null {
  const [limits, setLimits] = useState<HostLimits | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((c) => {
        if (cancelled) return;
        // capabilities.limits is REQUIRED in v1, but the optional fields
        // (maxNodeExecutions, maxRunDurationMs, maxLoopIterations) MAY be
        // omitted. We carry the whole block through unchanged.
        const block = (c as { capabilities?: { limits?: HostLimits } }).capabilities?.limits;
        if (block && typeof block === 'object') setLimits(block);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);
  return limits;
}

interface Props {
  onNewWorkflow(): void;
}

interface PreflightIssue {
  nodeId: string;
  name: string;
  missing: readonly string[];
}

/** Hard ceilings the workflow shape will breach when the host advertises
 *  them. Stays empty when the host omits the optional limit. RFC 0009 +
 *  RFC 0058: any breach surfaces at run time as `cap.breached` + an
 *  error code (`HOST_CAPABILITY_MISSING` / `run_timeout` / `loop_limit_exceeded`),
 *  so we lift the same check to author time. */
interface LimitIssue {
  kind: 'maxNodeExecutions';
  advertised: number;
  actual: number;
  message: string;
}

/** Pre-flight: which graph nodes need a host surface the connected host
 *  doesn't advertise? The catalog already cross-references advertised
 *  host surfaces (CapabilitiesPanel / NodePalette), so we read the
 *  per-node `missingHostSurfaces` and flag them before run — catching
 *  HOST_CAPABILITY_MISSING failures at author time (RFC 0009/0011). */
function collectPreflightIssues(nodes: ReadonlyArray<{ id: string; kind: string; name: string }>): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const n of nodes) {
    const entry = catalogEntry(n.kind);
    const missing = entry?.missingHostSurfaces ?? [];
    if (missing.length > 0) issues.push({ nodeId: n.id, name: n.name, missing });
  }
  return issues;
}

/** Pre-flight: does the workflow's static shape exceed an advertised
 *  engine limit? Today we check `maxNodeExecutions` — a workflow whose
 *  node count already exceeds the per-run ceiling cannot complete even
 *  a single linear pass. Loop / fork dynamics aren't statically
 *  knowable, so this is intentionally conservative — false negatives
 *  on those are acceptable; false positives would be worse. */
function collectLimitIssues(
  nodes: ReadonlyArray<{ id: string }>,
  limits: HostLimits | null,
): LimitIssue[] {
  if (!limits) return [];
  const issues: LimitIssue[] = [];
  const cap = limits.maxNodeExecutions;
  if (typeof cap === 'number' && nodes.length > cap) {
    issues.push({
      kind: 'maxNodeExecutions',
      advertised: cap,
      actual: nodes.length,
      message: `Workflow has ${nodes.length} nodes; the host caps a run at ${cap} node executions. The run will breach the engine ceiling and fail (cap.breached → HOST_CAPABILITY_MISSING).`,
    });
  }
  return issues;
}

/** Render the optional advertised limits (RFC 0009 + RFC 0058) as a
 *  short, human-readable line so the user knows the ceilings their run
 *  will execute under. Omits any field the host doesn't advertise. */
function formatAdvertisedLimits(limits: HostLimits | null): string {
  if (!limits) return '';
  const parts: string[] = [];
  if (typeof limits.maxNodeExecutions === 'number') parts.push(`up to ${limits.maxNodeExecutions} node executions`);
  if (typeof limits.maxRunDurationMs === 'number') {
    const sec = Math.round(limits.maxRunDurationMs / 1000);
    parts.push(`up to ${sec}s wall-clock`);
  }
  if (typeof limits.maxLoopIterations === 'number') parts.push(`up to ${limits.maxLoopIterations} loop iterations`);
  if (parts.length === 0) return '';
  return ` Host limits in effect: ${parts.join(', ')}.`;
}

export function BuilderShell({ onNewWorkflow }: Props) {
  const nav = useNavigate();
  const workflowId = useBuilderStore((s) => s.workflowId);
  const name = useBuilderStore((s) => s.name);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const canUndo = useBuilderStore((s) => s.past.length > 0);
  const canRedo = useBuilderStore((s) => s.future.length > 0);
  const overlay = useBuilderStore((s) => s.overlay);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-flight issues found on the last Run click. When non-null the
  // user must confirm ("Run anyway") or cancel before the run fires.
  // `caps` are per-node missing host surfaces; `limits` are graph-shape
  // breaches of advertised engine ceilings. A "Run anyway" applies to
  // both — limit breaches will still fail at runtime, but the user may
  // want to capture the error trace.
  const [preflight, setPreflight] = useState<
    | { caps: PreflightIssue[]; limits: LimitIssue[] }
    | null
  >(null);
  // Success summary from the last Validate click; null when none/cleared.
  const [validateOk, setValidateOk] = useState<string | null>(null);
  const hostLimits = useHostLimits();

  // Subscribe to the overlaid run's SSE stream and fold each event into
  // the store so the canvas paints node status live. Re-subscribes when
  // a new run starts (overlay.runId changes); tears down on unmount.
  const overlayRunId = overlay?.runId ?? null;
  useEffect(() => {
    if (!overlayRunId) return;
    const sub = subscribeToRun(overlayRunId, {
      modes: ['updates'],
      // Relax the default 30s/120s timeouts — a watched run can be long
      // and idle between nodes; the idle timer still resets per event.
      idleTimeoutMs: 5 * 60_000,
      absoluteTimeoutMs: 30 * 60_000,
      onEvent: (ev) => useBuilderStore.getState().applyRunEvent(ev),
    });
    return () => sub.close();
  }, [overlayRunId]);

  // Dry-run validation: the same gates Run applies — graph serialization
  // (empty graph / cycles / orphan edges via SerializeError), default-inputs
  // JSON parse, and the host-capability pre-flight — but with no network
  // work. Surfaces "build → run → cryptic failure" problems at author time.
  function onValidate() {
    setError(null);
    setPreflight(null);
    setValidateOk(null);
    const snap = useBuilderStore.getState().snapshot();
    try {
      serializeWithIdMap(snap);
    } catch (err) {
      if (err instanceof SerializeError) {
        setError(err.message);
        if (err.nodeId) useBuilderStore.getState().selectNode(err.nodeId);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const raw = snap.defaultInputs?.trim();
    if (raw) {
      try {
        JSON.parse(raw);
      } catch {
        setError('Default inputs is not valid JSON.');
        return;
      }
    }
    const caps = collectPreflightIssues(snap.nodes);
    const limits = collectLimitIssues(snap.nodes, hostLimits);
    if (caps.length > 0 || limits.length > 0) {
      setPreflight({ caps, limits });
      return;
    }
    const nN = snap.nodes.length;
    const eN = snap.edges.length;
    setValidateOk(
      `Valid — ${nN} node${nN === 1 ? '' : 's'}, ${eN} edge${eN === 1 ? '' : 's'}. ` +
        `No cycles, default inputs parse, and the host can run every node.` +
        formatAdvertisedLimits(hostLimits),
    );
  }

  async function onRun(force = false) {
    setError(null);
    setValidateOk(null);
    const snap0 = useBuilderStore.getState().snapshot();
    // Pre-flight host-capability + engine-limit check before doing any
    // network work. The two are surfaced together so the user sees the
    // full set of author-time problems in one banner.
    if (!force) {
      const caps = collectPreflightIssues(snap0.nodes);
      const limits = collectLimitIssues(snap0.nodes, hostLimits);
      if (caps.length > 0 || limits.length > 0) {
        setPreflight({ caps, limits });
        return;
      }
    }
    setPreflight(null);
    setRunning(true);
    try {
      const snap = useBuilderStore.getState().snapshot();
      const { definition: def, backendIdToBuilder } = serializeWithIdMap(snap);
      let inputs: Record<string, unknown> = {};
      const raw = snap.defaultInputs?.trim();
      if (raw) {
        try {
          inputs = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new Error('Default inputs is not valid JSON.');
        }
      }
      await registerWorkflow(def);
      // Omit body.tenantId so the BE infers from the authenticated
      // session/bearer (req.tenantId): `anon:<sid>` for cookie-anon
      // callers, `user:<hash>` for Firebase-signed-in callers. A
      // hardcoded 'demo' here is rejected by principalAuthorizer
      // for any non-bearer-with-demo-allowlist principal — that's
      // the "principal cannot operate under tenant demo" error.
      const res = await createRun({ workflowId: def.workflowId, inputs });
      // Stay on the canvas and paint the run live, rather than navigating
      // straight to the text event log. The banner offers a jump to the
      // full run detail for the timeline / reasoning / inspector views.
      useBuilderStore.getState().startOverlay(res.runId, backendIdToBuilder);
    } catch (err) {
      if (err instanceof SerializeError) {
        setError(err.message);
        if (err.nodeId) useBuilderStore.getState().selectNode(err.nodeId);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
  }

  // Export the built graph as portable JSON (the SavedWorkflow shape —
  // open execution schema, RFC 0037 §1). Re-importable here or shareable.
  function onExport() {
    const snap = useBuilderStore.getState().snapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = (snap.name || 'workflow').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    a.download = `${safe}.openwop-workflow.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Export the built graph as an RFC 0013 workflow-chain-pack manifest
  // (the authoring half of "publish as a chain pack" — the user submits
  // it via the PR-based registry flow; the app never signs/pushes). Runs
  // the same graph validation as Run, so cycles/orphans surface here too.
  function onExportChainPack() {
    setError(null);
    try {
      const snap = useBuilderStore.getState().snapshot();
      const manifest = buildChainPackManifest(snap);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = (snap.name || 'workflow').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
      a.download = `${safe}.workflow-chain-pack.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof SerializeError) {
        setError(err.message);
        if (err.nodeId) useBuilderStore.getState().selectNode(err.nodeId);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  // Import portable JSON. Mints a fresh workflow id so importing never
  // clobbers the workflow currently open, then navigates into it.
  async function onImportFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      const id = newWorkflowId();
      const now = new Date().toISOString();
      let imported: SavedWorkflow;
      if (looksCanonical(raw)) {
        // Canonical WorkflowDefinition (an `examples/*` pipeline, a
        // chain-pack composition, or this builder's own chain-pack
        // export) — convert typeIds back to builder kinds.
        const { name, nodes, edges, defaultInputs } = fromCanonicalDefinition(raw);
        imported = {
          id,
          name: `${name} (imported)`,
          version: '1.0.0',
          nodes,
          edges,
          defaultInputs,
          createdAt: now,
          updatedAt: now,
        };
      } else {
        // Builder SavedWorkflow shape (this builder's "Export" output).
        const parsed = raw as Partial<SavedWorkflow>;
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error('Not an OpenWOP workflow export (missing nodes/edges).');
        }
        imported = {
          id,
          name: parsed.name ? `${parsed.name} (imported)` : 'Imported workflow',
          version: parsed.version ?? '1.0.0',
          nodes: parsed.nodes,
          edges: parsed.edges,
          defaultInputs: parsed.defaultInputs ?? '{}',
          createdAt: now,
          updatedAt: now,
        };
      }
      useBuilderStore.getState().loadFromSaved(imported);
      useBuilderStore.getState().persist();
      nav(`/builder/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="builder-shell">
      <div className="builder-toolbar">
        <Link to="/builder" className="builder-toolbar-back" title="Back to workflows">
          ‹ Workflows
        </Link>
        <input
          className="builder-toolbar-name"
          value={name}
          onChange={(e) => useBuilderStore.getState().setName(e.target.value)}
          placeholder="Workflow name"
        />
        <span className="builder-toolbar-id muted">{workflowId || newWorkflowId()}</span>
        <div className="builder-toolbar-spacer" />
        <button className="secondary" onClick={undo} disabled={!canUndo} title="Undo">↶</button>
        <button className="secondary" onClick={redo} disabled={!canRedo} title="Redo">↷</button>
        <button className="secondary" onClick={onExport} title="Export this workflow as portable JSON">Export</button>
        <button
          className="secondary"
          onClick={onExportChainPack}
          title="Export as an RFC 0013 workflow-chain-pack manifest (submit via the registry PR flow)"
        >
          Export chain pack
        </button>
        <button
          className="secondary"
          onClick={() => importInputRef.current?.click()}
          title="Import a workflow from JSON (opens as a new workflow)"
        >
          Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = '';
          }}
        />
        <button className="secondary" onClick={onNewWorkflow}>New</button>
        <button
          className="secondary"
          onClick={onValidate}
          disabled={running}
          title="Check the workflow for cycles, invalid inputs, and missing host capabilities — without running it"
        >
          Validate
        </button>
        <button onClick={() => onRun()} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
      {error && <div className="alert error builder-toolbar-error">{error}</div>}
      {validateOk && (
        <div className="alert success builder-toolbar-error" role="status">
          ✓ {validateOk}
        </div>
      )}
      {preflight && (
        <div className="alert warning builder-toolbar-error">
          {preflight.caps.length > 0 && (
            <>
              <strong>
                Host can&apos;t run {preflight.caps.length} node{preflight.caps.length === 1 ? '' : 's'}.
              </strong>{' '}
              The connected host doesn&apos;t advertise the surface
              {preflight.caps.length === 1 ? '' : 's'} these nodes need — running now will fail with{' '}
              <code>HOST_CAPABILITY_MISSING</code>:
              <ul style={{ margin: '6px 0', fontSize: 12 }}>
                {preflight.caps.map((i) => (
                  <li key={i.nodeId}>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => useBuilderStore.getState().selectNode(i.nodeId)}
                    >
                      {i.name}
                    </button>{' '}
                    needs <code>{i.missing.join(', ')}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {preflight.limits.length > 0 && (
            <>
              <strong>
                Workflow exceeds {preflight.limits.length} advertised host limit
                {preflight.limits.length === 1 ? '' : 's'}.
              </strong>
              <ul style={{ margin: '6px 0', fontSize: 12 }}>
                {preflight.limits.map((i) => (
                  <li key={i.kind}>{i.message}</li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setPreflight(null)}>Cancel</button>
            <button type="button" onClick={() => onRun(true)}>Run anyway</button>
          </div>
        </div>
      )}
      {overlay && <RunOverlayBanner />}
      <div className="builder-body">
        <NodePalette />
        <BuilderCanvas />
        <Inspector />
      </div>
    </div>
  );
}

const OVERLAY_STATUS_META: Record<string, { label: string; color: string }> = {
  running: { label: 'Running', color: 'var(--clay)' },
  completed: { label: 'Completed', color: '#10b981' },
  failed: { label: 'Failed', color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: 'var(--ink-3)' },
};

// Live-run banner shown above the canvas while an overlay is active.
// Counts painted nodes, links to the full run detail, and dismisses
// the overlay (which also tears down the SSE subscription).
function RunOverlayBanner() {
  const overlay = useBuilderStore((s) => s.overlay);
  const clearOverlay = useBuilderStore((s) => s.clearOverlay);
  if (!overlay) return null;
  const meta = OVERLAY_STATUS_META[overlay.runStatus] ?? OVERLAY_STATUS_META.running!;
  const statuses = Object.values(overlay.nodeStatus);
  const done = statuses.filter((s) => s === 'completed').length;
  const failed = statuses.filter((s) => s === 'failed').length;
  return (
    <div className="builder-overlay-banner" role="status">
      <span
        className="builder-overlay-dot"
        style={{
          background: meta.color,
          animation: overlay.runStatus === 'running' ? 'openwop-pulse 1.2s ease-in-out infinite' : 'none',
        }}
        aria-hidden
      />
      <strong style={{ color: meta.color }}>{meta.label}</strong>
      <span className="muted">
        {done} done{failed > 0 ? `, ${failed} failed` : ''}
      </span>
      <span className="builder-toolbar-spacer" />
      <Link to={`/runs/${overlay.runId}`} title="Open the full run detail — timeline, reasoning, I/O">
        Run detail →
      </Link>
      <button
        type="button"
        className="secondary"
        style={{ padding: '2px 10px', minHeight: 0 }}
        onClick={clearOverlay}
        title="Dismiss the live overlay"
      >
        Dismiss
      </button>
    </div>
  );
}
