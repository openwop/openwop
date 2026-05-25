/**
 * Right sidebar. Three modes:
 *   1. Node selected → name + per-kind config fields from the catalog
 *   2. Edge selected → trigger rule + condition predicate (DAG fan-in)
 *   3. Nothing selected → workflow-level fields (name + default inputs JSON)
 */

import { useEffect, useState } from 'react';
import { useBuilderStore } from '../store/builderStore.js';
import { catalogEntry } from '../palette/catalogRegistry.js';
import { type ConfigField } from '../palette/nodeCatalog.js';
import { PromptPickerInput } from '../../prompts/PromptPickerInput.js';
import { CredentialPickerInput } from './CredentialPickerInput.js';
import { ProviderPickerInput } from './ProviderPickerInput.js';
import { ModelPickerInput } from './ModelPickerInput.js';
import { getCapabilities } from '../../client/runsClient.js';
import type { BuilderEdge, EdgeCondition, EdgeTriggerRule } from '../schema/workflow.js';

/** Capabilities the host advertises across its installed models. Computed
 *  union for the gap check; `null` while discovery is in flight or absent. */
function useHostAdvertisedModelCapabilities(): Set<string> | null {
  const [caps, setCaps] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((c) => {
        if (cancelled) return;
        // Per schemas/capabilities.schema.json §modelCapabilities.advertised:
        // a flat list of capability identifiers.
        const advertised = (c as { capabilities?: { modelCapabilities?: { advertised?: string[] } } })
          .capabilities?.modelCapabilities?.advertised;
        if (Array.isArray(advertised)) {
          setCaps(new Set(advertised));
        }
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);
  return caps;
}

export function Inspector() {
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const selectedNodeIds = useBuilderStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useBuilderStore((s) => s.selectedEdgeId);
  const node = useBuilderStore((s) => s.nodes.find((n) => n.id === selectedNodeId) ?? null);
  const edge = useBuilderStore((s) => s.edges.find((e) => e.id === selectedEdgeId) ?? null);
  const advertised = useHostAdvertisedModelCapabilities();

  if (edge) return <EdgeInspector edge={edge} />;
  // More than one node selected → group actions (single-node config is
  // ambiguous across heterogeneous kinds, so we expose batch ops instead).
  if (selectedNodeIds.length > 1) return <MultiSelectInspector ids={selectedNodeIds} />;
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
  // RFC 0031 gap: what does this node need that the host's modelCapabilities
  // advertisement doesn't (yet) cover?
  const requiredCaps = entry.requiredModelCapabilities ?? [];
  const missingModelCaps = advertised
    ? requiredCaps.filter((c) => !advertised.has(c))
    : [];
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

      {requiredCaps.length > 0 ? (
        <div
          className={missingModelCaps.length > 0 ? 'alert warning' : 'alert info'}
          role="status"
          aria-label="Model capability requirements"
          style={{ marginTop: missing.length > 0 ? 8 : 0 }}
        >
          <strong>Requires model capabilities:</strong>{' '}
          {requiredCaps.map((c, i) => (
            <span key={c}>
              <code style={{
                background: missingModelCaps.includes(c)
                  ? 'color-mix(in oklch, var(--color-warning) 14%, transparent)'
                  : undefined,
              }}>{c}</code>
              {i < requiredCaps.length - 1 ? ' · ' : ''}
            </span>
          ))}
          .
          <div className="muted builder-inspector-help" style={{ marginTop: 4 }}>
            {advertised === null ? (
              <>Discovering host's <code>modelCapabilities</code> advertisement…</>
            ) : missingModelCaps.length === 0 ? (
              <>The host advertises every required capability; this node will dispatch directly.</>
            ) : (
              <>
                The host's <code>modelCapabilities.advertised[]</code> doesn't cover{' '}
                <code>{missingModelCaps.join(', ')}</code>. At dispatch time the host will
                either substitute a fallback model
                (<code>model.capability.substituted</code>) or refuse with
                <code> capability_not_provided</code> per RFC 0031 §B.
              </>
            )}
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
            <ConfigInput
              key={f.key}
              nodeId={node.id}
              config={node.config}
              field={f}
              allFields={entry.configFields}
            />
          ))}
        </>
      )}

      <div className="builder-inspector-divider" />
      <div className="builder-inspector-section-label">Output role</div>
      <div className="form-row">
        <label htmlFor="builder-inspector-output-role">Artifact</label>
        <select
          id="builder-inspector-output-role"
          value={node.outputRole ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            useBuilderStore.getState().updateNode(node.id, {
              outputRole: v === 'primary' || v === 'secondary' ? v : undefined,
            });
          }}
          title="RFC 0065 — author hint for which terminal node's output is the workflow's canonical deliverable. Advisory; engine ignores the value."
        >
          <option value="">(none)</option>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
        </select>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: -4 }}>
        Tag the canonical-deliverable terminal node so the chat's
        completion card surfaces this output as the workflow's primary
        artifact. RFC 0065 — advisory; the engine ignores the value.
      </p>

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
  allFields,
}: {
  nodeId: string;
  config: Record<string, unknown>;
  field: ConfigField;
  allFields: readonly ConfigField[];
}) {
  const value = config[field.key];
  const onChange = (next: unknown) => {
    // Cascade: when this field's value changes, clear every sibling
    // field whose `dependsOn` points back at it (e.g., changing the
    // provider clears the model + credentialRef since both are
    // resolved against the provider). Avoids stale config like
    // "provider: anthropic, model: gpt-5" surviving a swap.
    const nextConfig: Record<string, unknown> = { ...config, [field.key]: next };
    for (const sibling of allFields) {
      if (sibling.dependsOn === field.key && sibling.key !== field.key) {
        nextConfig[sibling.key] = undefined;
      }
    }
    useBuilderStore.getState().updateNode(nodeId, { config: nextConfig });
  };
  // Resolve the dependency-source value for this field (e.g., a
  // model-picker with dependsOn: 'provider' looks up
  // `config.provider`). Undefined when this field has no dependency.
  const dependsOnValue = field.dependsOn ? (config[field.dependsOn] as string | undefined) : undefined;
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
      ) : field.kind === 'credential-picker' ? (
        <CredentialPickerInput
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => onChange(next)}
          {...(field.credentialProvider
            ? { providerFilter: field.credentialProvider }
            : dependsOnValue
              ? { providerFilter: dependsOnValue }
              : {})}
          required={field.required}
        />
      ) : field.kind === 'provider-picker' ? (
        <ProviderPickerInput
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => onChange(next)}
          required={field.required}
        />
      ) : field.kind === 'model-picker' ? (
        <ModelPickerInput
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => onChange(next)}
          providerId={dependsOnValue}
          required={field.required}
        />
      ) : field.kind === 'textarea' ? (
        <textarea
          rows={3}
          value={textareaValue(value)}
          placeholder={field.placeholder}
          required={field.required}
          {...(field.minLength !== undefined ? { minLength: field.minLength } : {})}
          {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'number' ? (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          {...(field.min !== undefined ? { min: field.min } : {})}
          {...(field.max !== undefined ? { max: field.max } : {})}
          {...(field.step !== undefined ? { step: field.step } : {})}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      ) : field.kind === 'select' ? (
        <select
          value={typeof value === 'string' ? value : ''}
          required={field.required}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.kind === 'string-list' ? (
        <StringListInput
          value={Array.isArray(value) ? (value as unknown[]).filter((v) => typeof v === 'string') as string[] : []}
          onChange={(next) => onChange(next.length === 0 ? undefined : next)}
          placeholder={field.placeholder}
          maxItems={field.maxItems}
        />
      ) : (
        <input
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          {...(field.minLength !== undefined ? { minLength: field.minLength } : {})}
          {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
          {...(field.pattern !== undefined ? { pattern: field.pattern } : {})}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && <div className="muted builder-inspector-help">{field.help}</div>}
    </div>
  );
}

/** Stringify a textarea value. Pack `configSchema`s with `default` set to
 *  an object/array (collapsed to `kind: 'textarea'` by the JSON-Schema
 *  converter) come through as the raw default rather than a pre-stringified
 *  blob — pretty-print it so the user sees readable JSON instead of
 *  `[object Object]`. */
function textareaValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** One-per-line textarea that round-trips to `string[]`. Used for
 *  JSON-Schema `{ type: 'array', items: { type: 'string' } }` configs
 *  like `stopSequences` — far less hostile than a raw-JSON textarea
 *  for the (common) case of a small list of plain strings.
 *
 *  Blank lines are stripped (a trailing newline while typing doesn't
 *  add an empty entry); when the parsed list would exceed `maxItems`,
 *  the input clamps to the first `maxItems` entries and surfaces a
 *  warning via the help row above. */
function StringListInput({
  value,
  onChange,
  placeholder,
  maxItems,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string | undefined;
  maxItems?: number | undefined;
}): JSX.Element {
  const [draft, setDraft] = useState<string>(value.join('\n'));
  // Reset the draft when the store-side value changes from somewhere
  // other than this input (e.g., reset, import, multi-select edit).
  // The check avoids clobbering the user's in-progress edits.
  useEffect(() => {
    const parsedDraft = draft.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    if (parsedDraft.join('') !== [...value].join('')) {
      setDraft(value.join('\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const overLimit = maxItems !== undefined && countNonBlankLines(draft) > maxItems;
  return (
    <>
      <textarea
        rows={Math.min(6, Math.max(2, value.length + 1))}
        value={draft}
        placeholder={placeholder ?? 'One per line'}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const parsed = next.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
          const clamped = maxItems !== undefined ? parsed.slice(0, maxItems) : parsed;
          onChange(clamped);
        }}
      />
      {overLimit ? (
        <div className="muted builder-inspector-help" role="status">
          ⚠ Only the first {maxItems} entries are kept (host limit).
        </div>
      ) : null}
    </>
  );
}

function countNonBlankLines(s: string): number {
  return s.split('\n').filter((line) => line.trim().length > 0).length;
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

function MultiSelectInspector({ ids }: { ids: string[] }) {
  const cloneNodes = useBuilderStore.getState().cloneNodes;
  const alignNodes = useBuilderStore.getState().alignNodes;
  const removeNodes = useBuilderStore.getState().removeNodes;
  const deleteAll = () => removeNodes(ids); // one undo entry; clears selection
  return (
    <aside className="builder-inspector">
      <h3 className="builder-inspector-title">{ids.length} nodes selected</h3>
      <p className="muted builder-inspector-desc">
        Batch actions apply to every selected node. Select a single node to edit
        its configuration.
      </p>

      <div className="builder-inspector-divider" />
      <div className="builder-inspector-section-label">Arrange</div>
      <div className="form-row builder-inspector-btn-row">
        <button className="secondary" onClick={() => alignNodes(ids, 'left')}>
          Align left
        </button>
        <button className="secondary" onClick={() => alignNodes(ids, 'top')}>
          Align top
        </button>
      </div>
      <div className="form-row builder-inspector-btn-row">
        <button
          className="secondary"
          disabled={ids.length < 3}
          aria-label="Distribute horizontally"
          onClick={() => alignNodes(ids, 'distribute-h')}
        >
          Distribute ↔
        </button>
        <button
          className="secondary"
          disabled={ids.length < 3}
          aria-label="Distribute vertically"
          onClick={() => alignNodes(ids, 'distribute-v')}
        >
          Distribute ↕
        </button>
      </div>
      <div className="muted builder-inspector-help">
        Distribute evens out the gaps between three or more nodes.
      </div>

      <div className="builder-inspector-divider" />
      <button className="secondary" onClick={() => cloneNodes(ids)}>
        Duplicate all ({ids.length})
      </button>
      <button className="secondary" onClick={deleteAll} style={{ marginTop: 8 }}>
        Delete all ({ids.length})
      </button>
    </aside>
  );
}

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
