/**
 * Right sidebar. Three modes:
 *   1. Node selected → name + per-kind config fields from the catalog
 *   2. Edge selected → trigger rule + condition predicate (DAG fan-in)
 *   3. Nothing selected → workflow-level fields (name + default inputs JSON)
 */

import { useBuilderStore } from '../store/builderStore.js';
import { catalogEntry } from '../palette/catalogRegistry.js';
import { type ConfigField } from '../palette/nodeCatalog.js';
import { PromptPickerInput } from '../../prompts/PromptPickerInput.js';
import type { BuilderEdge, EdgeCondition, EdgeTriggerRule } from '../schema/workflow.js';

export function Inspector() {
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const selectedEdgeId = useBuilderStore((s) => s.selectedEdgeId);
  const node = useBuilderStore((s) => s.nodes.find((n) => n.id === selectedNodeId) ?? null);
  const edge = useBuilderStore((s) => s.edges.find((e) => e.id === selectedEdgeId) ?? null);

  if (edge) return <EdgeInspector edge={edge} />;
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
      ) : field.kind === 'prompt-picker' ? (
        <PromptPickerInput
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => onChange(next)}
          promptKind={field.promptKind}
          required={field.required}
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

const TRIGGER_RULE_OPTIONS: { value: EdgeTriggerRule; label: string; help: string }[] = [
  { value: 'all_success', label: 'all_success', help: 'Default. Target fires after every upstream completes successfully.' },
  { value: 'any_success', label: 'any_success', help: 'Target fires on the first upstream success (race).' },
  { value: 'all_complete', label: 'all_complete', help: 'Target fires after every upstream reaches a terminal state regardless of outcome.' },
  { value: 'none_failed', label: 'none_failed', help: 'Target fires when every upstream completed AND none failed.' },
  { value: 'any_failed', label: 'any_failed', help: 'Target fires only when an upstream fails — error-routing path.' },
];

const CONDITION_OPS: { value: EdgeCondition['op']; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: '= (equals)', needsValue: true },
  { value: 'neq', label: '≠ (not equal)', needsValue: true },
  { value: 'truthy', label: 'is truthy', needsValue: false },
  { value: 'falsy', label: 'is falsy', needsValue: false },
  { value: 'exists', label: 'exists', needsValue: false },
  { value: 'contains', label: 'contains', needsValue: true },
];

function EdgeInspector({ edge }: { edge: BuilderEdge }) {
  const rule = edge.triggerRule ?? 'all_success';
  const cond = edge.condition;
  const updateEdge = useBuilderStore.getState().updateEdge;
  const removeEdge = useBuilderStore.getState().removeEdge;
  const conditionOp = cond?.op ?? 'eq';
  const conditionMeta = CONDITION_OPS.find((o) => o.value === conditionOp)!;
  return (
    <aside className="builder-inspector">
      <h3 className="builder-inspector-title">Edge</h3>
      <p className="muted builder-inspector-desc">
        Edges connect node outputs to downstream inputs. The trigger rule
        controls fan-in behavior when a target has multiple incoming edges.
      </p>

      <div className="form-row">
        <label>From → To</label>
        <code className="builder-inspector-typeid">
          {edge.source} → {edge.target}
        </code>
      </div>

      <div className="form-row">
        <label>Label (optional)</label>
        <input
          value={edge.label ?? ''}
          placeholder="e.g. 'on success', 'high confidence'"
          onChange={(e) => updateEdge(edge.id, { label: e.target.value || undefined })}
        />
      </div>

      <div className="builder-inspector-divider" />
      <div className="builder-inspector-section-label">Trigger rule</div>

      <div className="form-row">
        <select
          value={rule}
          onChange={(e) => updateEdge(edge.id, { triggerRule: e.target.value as EdgeTriggerRule })}
        >
          {TRIGGER_RULE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="muted builder-inspector-help">
          {TRIGGER_RULE_OPTIONS.find((o) => o.value === rule)?.help}
        </div>
        <div className="muted builder-inspector-help" style={{ marginTop: 4 }}>
          Applies to target <code>{edge.target}</code>. When multiple edges target
          the same node, all should declare the same rule (the scheduler picks
          the rule from the lexicographically-first edge id if they diverge).
        </div>
      </div>

      <div className="builder-inspector-divider" />
      <div className="builder-inspector-section-label">Condition predicate (optional)</div>

      <div className="form-row">
        <label>Path (into source output)</label>
        <input
          value={cond?.path ?? ''}
          placeholder="e.g. 'completion' or 'data.score'"
          onChange={(e) => {
            const path = e.target.value;
            if (!path) {
              updateEdge(edge.id, { condition: undefined });
              return;
            }
            const next: EdgeCondition = { path, op: conditionOp, ...(cond?.value !== undefined ? { value: cond.value } : {}) };
            updateEdge(edge.id, { condition: next });
          }}
        />
        <div className="muted builder-inspector-help">
          When set, this edge fires only when the predicate matches the source's output.
        </div>
      </div>

      {cond?.path ? (
        <>
          <div className="form-row">
            <label>Operator</label>
            <select
              value={conditionOp}
              onChange={(e) =>
                updateEdge(edge.id, {
                  condition: { ...cond, op: e.target.value as EdgeCondition['op'] },
                })
              }
            >
              {CONDITION_OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {conditionMeta.needsValue ? (
            <div className="form-row">
              <label>Value</label>
              <input
                value={typeof cond.value === 'string' ? cond.value : cond.value === undefined ? '' : JSON.stringify(cond.value)}
                placeholder="literal or JSON"
                onChange={(e) => {
                  // Try parsing as JSON for numbers/booleans/objects; fall back to plain string.
                  const raw = e.target.value;
                  let parsed: unknown = raw;
                  try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
                  updateEdge(edge.id, { condition: { ...cond, value: parsed } });
                }}
              />
              <div className="muted builder-inspector-help">
                Plain text stays a string. Values that parse as JSON
                (<code>5</code>, <code>true</code>, <code>null</code>,
                <code>{`["a","b"]`}</code>) are stored as the parsed value.
                Partial JSON (<code>{`{"x": 1`}</code>) silently stays a string.
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="builder-inspector-divider" />
      <button className="secondary" onClick={() => removeEdge(edge.id)}>
        Delete edge
      </button>
    </aside>
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
