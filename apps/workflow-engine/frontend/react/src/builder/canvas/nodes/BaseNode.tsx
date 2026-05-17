/**
 * Single xyflow custom node component used for every BuilderNodeKind.
 * Reads the catalog entry off `data.kind` to render the badge,
 * accent stripe, port labels, and handle positions.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { catalogEntry } from '../../palette/catalogRegistry.js';

interface NodeData extends Record<string, unknown> {
  kind: string;
  name: string;
}

function BaseNodeImpl({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const entry = catalogEntry(d.kind);
  if (!entry) {
    return <div className="builder-node builder-node-unknown">Unknown: {d.kind}</div>;
  }
  return (
    <div
      className={`builder-node${selected ? ' builder-node-selected' : ''}`}
      style={{ borderLeftColor: entry.accent }}
    >
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
