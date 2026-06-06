/**
 * Single xyflow custom node component used for every BuilderNodeKind.
 * Reads the catalog entry off `data.kind` to render the badge,
 * accent stripe, port labels, and handle positions.
 *
 * During a live-run overlay, `data.runStatus` paints a status badge +
 * glow so the canvas doubles as an execution view.
 */

import { memo, useState, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { catalogEntry } from '../../palette/catalogRegistry.js';
import { useBuilderStore, type NodeRunStatus } from '../../store/builderStore.js';
import { CircleIcon, CheckIcon, XIcon, PauseIcon, AlertIcon } from '../../../ui/icons/index.js';

interface NodeData extends Record<string, unknown> {
  kind: string;
  name: string;
  /** Live run status painted by the execution overlay; undefined when idle. */
  runStatus?: NodeRunStatus;
}

// Status → accent color + glyph for the live-execution overlay badge.
const RUN_STATUS_META: Record<NodeRunStatus, { color: string; label: string; glyph: ReactNode }> = {
  running: { color: 'var(--color-warning-text)', label: 'Running', glyph: <CircleIcon size={12} filled /> },
  completed: { color: 'var(--color-success-text)', label: 'Completed', glyph: <CheckIcon size={12} /> },
  failed: { color: 'var(--color-danger-text)', label: 'Failed', glyph: <XIcon size={12} /> },
  suspended: { color: 'var(--color-ai-text)', label: 'Suspended', glyph: <PauseIcon size={12} /> },
};

function BaseNodeImpl({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const entry = catalogEntry(d.kind);
  if (!entry) {
    return <div className="builder-node builder-node-unknown">Unknown: {d.kind}</div>;
  }
  // Client-only nodes (sticky notes, future annotations) get a distinct
  // render: no ports, no run status (they never execute), no missing-
  // capability warnings (preflight skips them), and the prominent
  // content is the config string set on the node itself. The Inspector
  // still drives the configField so authors edit content via the same
  // textarea pattern as any other node.
  if (entry.clientOnly) {
    return <ClientOnlyNode nodeId={id} selected={Boolean(selected)} accent={entry.accent} badge={entry.badge} />;
  }
  const runMeta = d.runStatus ? RUN_STATUS_META[d.runStatus] : null;
  // Author-time capability gap: the connected host doesn't advertise a
  // surface this node kind needs (catalog `missingHostSurfaces`, server-
  // computed). Surface it on the canvas — not just the inspector — so the
  // unrunnable node is visible at a glance. A live run takes visual
  // priority, so suppress the warning while a run status is painted.
  const missingSurfaces = entry.missingHostSurfaces ?? [];
  const showCapWarning = missingSurfaces.length > 0 && !d.runStatus;
  return (
    <div
      className={`builder-node${selected ? ' builder-node-selected' : ''}${
        d.runStatus ? ` builder-node-run-${d.runStatus}` : ''
      }${showCapWarning ? ' builder-node-warn' : ''}`}
      style={{
        borderLeftColor: entry.accent,
        ...(runMeta
          ? { boxShadow: `0 0 0 2px ${runMeta.color}`, transition: 'box-shadow 150ms ease' }
          : {}),
      }}
    >
      {showCapWarning && (
        <span
          className="builder-node-warn-badge"
          title={`This host can't run this node — needs: ${missingSurfaces.join(', ')}`}
          aria-label={`Host capability missing: needs ${missingSurfaces.join(', ')}`}
        >
          <AlertIcon size={14} />
        </span>
      )}
      {runMeta && (
        <span
          className="builder-node-run-badge"
          title={runMeta.label}
          aria-label={`Run status: ${runMeta.label}`}
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: runMeta.color,
            color: 'var(--color-on-scrim)',
            fontSize: 11,
            lineHeight: '18px',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            boxShadow: '0 1px 3px var(--ink-shadow)',
            // running → live breathe; landed (completed/failed) → one-shot
            // "stamp" press so the run visibly settles down the graph (§6).
            animation: d.runStatus === 'running'
              ? 'openwop-pulse 1.2s ease-in-out infinite'
              : (d.runStatus === 'completed' || d.runStatus === 'failed')
                ? 'openwop-stamp-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) 1'
                : 'none',
          }}
        >
          {runMeta.glyph}
        </span>
      )}
      {entry.inputs.map((p, i, arr) => (
        <Handle
          key={`in-${p.name}`}
          id={p.name}
          type="target"
          position={Position.Left}
          style={{ top: handleTop(i, arr.length), background: entry.accent }}
        />
      ))}
      {entry.outputs.map((p, i, arr) => (
        <Handle
          key={`out-${p.name}`}
          id={p.name}
          type="source"
          position={Position.Right}
          style={{ top: handleTop(i, arr.length), background: entry.accent }}
        />
      ))}
      <div className="builder-node-header">
        <span className="builder-node-badge" style={{ background: entry.accent }}>
          {entry.badge}
        </span>
        <EditableTitle nodeId={id} name={d.name} />
      </div>
      <div className="builder-node-ports">
        <div className="builder-node-ports-col">
          {entry.inputs.map((p) => (
            <div key={p.name} className="builder-node-port">
              <span className="builder-node-port-label">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="builder-node-ports-col builder-node-ports-col-right">
          {entry.outputs.map((p) => (
            <div key={p.name} className="builder-node-port builder-node-port-right">
              <span className="builder-node-port-label">{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Canvas annotation (sticky note, etc). The content lives on the node's
// `config.content` field and is edited in the Inspector; here we just
// surface it on the canvas so the annotation is readable in context.
// Pale-yellow paper, italic body, no port handles. Click on the body to
// select the node so the Inspector opens (matches BaseNode click target).
function ClientOnlyNode({ nodeId, selected, accent, badge }: {
  nodeId: string;
  selected: boolean;
  accent: string;
  badge: string;
}) {
  const node = useBuilderStore((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  if (!node) return null;
  const content = (node.config['content'] as string | undefined) ?? '';
  return (
    <div
      className={`builder-node builder-node-client-only${selected ? ' builder-node-selected' : ''}`}
      style={{ borderLeftColor: accent }}
    >
      <div className="builder-node-client-only__head">
        <span className="builder-node-client-only__badge">{badge}</span>
        <span className="muted builder-node-client-only__name">{node.name}</span>
      </div>
      <div className={`builder-node-client-only__body${content ? '' : ' builder-node-client-only__body--empty'}`}>
        {content || 'Empty note — edit in the Inspector →'}
      </div>
    </div>
  );
}

// Inline node-title editing: double-click the title to rename. The
// `nodrag` class stops xyflow from dragging the node while editing, and
// stopPropagation keeps the canvas keyboard shortcuts (Delete / ⌘D)
// from firing keystrokes meant for the input.
function EditableTitle({ nodeId, name }: { nodeId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing) {
    return (
      <span
        className="builder-node-title"
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </span>
    );
  }
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) useBuilderStore.getState().updateNode(nodeId, { name: trimmed });
    setEditing(false);
  };
  return (
    <input
      className="builder-node-title-input nodrag"
      value={draft}
      autoFocus
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

// Single port → exactly on vertical center. Multi-port → evenly
// spaced around vertical center (20px between adjacent handles).
function handleTop(index: number, count: number): string {
  if (count <= 1) return '50%';
  const SPACING = 20;
  const offsetPx = (index - (count - 1) / 2) * SPACING;
  return `calc(50% + ${offsetPx}px)`;
}

export const BaseNode = memo(BaseNodeImpl);
