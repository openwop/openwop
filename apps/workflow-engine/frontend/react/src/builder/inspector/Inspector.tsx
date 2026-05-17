/**
 * Right sidebar. When a node is selected, renders a name field plus
 * the per-kind config fields from the catalog. When nothing is
 * selected, shows workflow-level fields (name + default inputs JSON).
 */

import { useBuilderStore } from '../store/builderStore.js';
import { catalogEntry } from '../palette/catalogRegistry.js';
import { type ConfigField } from '../palette/nodeCatalog.js';

export function Inspector() {
  const selectedId = useBuilderStore((s) => s.selectedNodeId);
  const node = useBuilderStore((s) => s.nodes.find((n) => n.id === selectedId) ?? null);

  if (!node) return <WorkflowInspector />;
  const entry = catalogEntry(node.kind);
  if (!entry) {
    return (
      <aside className="builder-inspector">
        <div className="alert error">Unknown node kind: {node.kind}</div>
      </aside>
    );
  }
  const missing = entry.missingHostSurfaces ?? [];
  return (
    <aside className="builder-inspector">
      <h3 className="builder-inspector-title">{entry.label}</h3>
      <p className="muted builder-inspector-desc">{entry.description}</p>

      {missing.length > 0 ? (
        <div
          className="alert warning builder-inspector-host-warn"
          role="status"
          aria-label="Host capability missing"
        >
          <strong>Needs host capability:</strong> {missing.join(', ')}.
          <div className="muted builder-inspector-help" style={{ marginTop: 4 }}>
            This engine doesn't advertise the required surface. The node will
            still serialize and ship in the workflow, but running it here returns
            <code> HOST_CAPABILITY_MISSING</code>. Wire the surface in your host,
            or run <code>examples/hosts/postgres</code> for a host that advertises
            every surface.
          </div>
        </div>
      ) : null}

      <div className="form-row">
        <label>Name</label>
        <input
          value={node.name}
          onChange={(e) => useBuilderStore.getState().updateNode(node.id, { name: e.target.value })}
        />
      </div>

      <div className="form-row">
        <label>Type</label>
        <code className="builder-inspector-typeid">{entry.typeId}</code>
      </div>

      {entry.configFields.length > 0 && (
        <>
          <div className="builder-inspector-divider" />
          <div className="builder-inspector-section-label">Configuration</div>
          {entry.configFields.map((f) => (
            <ConfigInput key={f.key} nodeId={node.id} config={node.config} field={f} />
          ))}
        </>
      )}

      <div className="builder-inspector-divider" />
      <button
        className="secondary"
        onClick={() => useBuilderStore.getState().removeNode(node.id)}
      >
        Delete node
      </button>
    </aside>
  );
}

function ConfigInput({
  nodeId,
  config,
  field,
}: {
  nodeId: string;
  config: Record<string, unknown>;
  field: ConfigField;
}) {
  const value = config[field.key];
  const onChange = (next: unknown) => {
    useBuilderStore
      .getState()
      .updateNode(nodeId, { config: { ...config, [field.key]: next } });
  };
  return (
    <div className="form-row">
      <label>
        {field.label}
        {field.required && <span className="builder-inspector-required" aria-hidden> *</span>}
      </label>
      {field.kind === 'checkbox' ? (
        <input
          type="checkbox"
          checked={value === true}
          required={field.required}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 'auto' }}
        />
      ) : field.kind === 'textarea' ? (
        <textarea
          rows={3}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'number' ? (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      ) : (
        <input
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && <div className="muted builder-inspector-help">{field.help}</div>}
    </div>
  );
}

function WorkflowInspector() {
  const name = useBuilderStore((s) => s.name);
  const defaultInputs = useBuilderStore((s) => s.defaultInputs);
  const workflowId = useBuilderStore((s) => s.workflowId);

  return (
    <aside className="builder-inspector">
      <h3 className="builder-inspector-title">Workflow</h3>
      <p className="muted builder-inspector-desc">
        Click a node to edit it. These fields apply when no node is selected.
      </p>
      <div className="form-row">
        <label>Workflow name</label>
        <input
          value={name}
          onChange={(e) => useBuilderStore.getState().setName(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Workflow ID</label>
        <code className="builder-inspector-typeid">{workflowId || '—'}</code>
      </div>
      <div className="form-row">
        <label>Default inputs (JSON)</label>
        <textarea
          rows={6}
          spellCheck={false}
          value={defaultInputs}
          onChange={(e) => useBuilderStore.getState().setDefaultInputs(e.target.value)}
        />
        <div className="muted builder-inspector-help">
          Passed to the first node as <code>ctx.inputs</code> when this workflow runs.
        </div>
      </div>
    </aside>
  );
}
