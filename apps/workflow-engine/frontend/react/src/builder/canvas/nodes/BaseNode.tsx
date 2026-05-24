/**
 * Single xyflow custom node component used for every BuilderNodeKind.
 * Reads the catalog entry off `data.kind` to render the badge,
 * accent stripe, port labels, and handle positions.
 *
 * During a live-run overlay, `data.runStatus` paints a status badge +
 * glow so the canvas doubles as an execution view.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { catalogEntry } from '../../palette/catalogRegistry.js';
import type { NodeRunStatus } from '../../store/builderStore.js';

interface NodeData extends Record<string, unknown> {
  kind: string;
  name: string;
  /** Live run status painted by the execution overlay; undefined when idle. */
  runStatus?: NodeRunStatus;
}

// Status → accent color + glyph for the live-execution overlay badge.
const RUN_STATUS_META: Record<NodeRunStatus, { color: string; label: string; glyph: string }> = {
  running: { color: '#f59e0b', label: 'Running', glyph: '●' },
  completed: { color: '#10b981', label: 'Completed', glyph: '✓' },
  failed: { color: '#ef4444', label: 'Failed', glyph: '✕' },
  suspended: { color: '#8b5cf6', label: 'Suspended', glyph: '⏸' },
};

function BaseNodeImpl({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const entry = catalogEntry(d.kind);
  if (!entry) {
    return <div className="builder-node builder-node-unknown">Unknown: {d.kind}</div>;
  }
  const runMeta = d.runStatus ? RUN_STATUS_META[d.runStatus] : null;
  return (
    <div
      className={`builder-node${selected ? ' builder-node-selected' : ''}${
        d.runStatus ? ` builder-node-run-${d.runStatus}` : ''
      }`}
      style={{
        borderLeftColor: entry.accent,
        ...(runMeta
          ? { boxShadow: `0 0 0 2px ${runMeta.color}`, transition: 'box-shadow 150ms ease' }
          : {}),
      }}
    >
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
            color: '#fff',
            fontSize: 11,
            lineHeight: '18px',
            textAlign: 'center',
            fontWeight: 700,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            animation: d.runStatus === 'running' ? 'openwop-pulse 1.2s ease-in-out infinite' : 'none',
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
        <span className="builder-node-title">{d.name}</span>
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

// Single port → exactly on vertical center. Multi-port → evenly
// spaced around vertical center (20px between adjacent handles).
function handleTop(index: number, count: number): string {
  if (count <= 1) return '50%';
  const SPACING = 20;
  const offsetPx = (index - (count - 1) / 2) * SPACING;
  return `calc(50% + ${offsetPx}px)`;
}

export const BaseNode = memo(BaseNodeImpl);
