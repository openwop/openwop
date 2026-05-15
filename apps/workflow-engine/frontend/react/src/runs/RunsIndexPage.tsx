import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRun } from '../client/runsClient.js';

const SAMPLE_WORKFLOWS = [
  { id: 'sample.demo.uppercase', label: 'sample.demo.uppercase — single-node uppercase' },
  { id: 'sample.demo.approval-gate', label: 'sample.demo.approval-gate — uppercase gated by an approval interrupt' },
];

export function RunsIndexPage() {
  const nav = useNavigate();
  const [workflowId, setWorkflowId] = useState(SAMPLE_WORKFLOWS[0]!.id);
  const [tenantId, setTenantId] = useState('demo');
  const [inputsRaw, setInputsRaw] = useState(JSON.stringify({ text: 'hello world' }, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const inputs = JSON.parse(inputsRaw);
      const res = await createRun({ workflowId, tenantId, inputs });
      nav(`/runs/${res.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="card">
        <h2>Create a run</h2>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Workflow</label>
            <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
              {SAMPLE_WORKFLOWS.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Tenant</label>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Inputs (JSON)</label>
            <textarea
              rows={6}
              value={inputsRaw}
              onChange={(e) => setInputsRaw(e.target.value)}
              spellCheck={false}
            />
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="button-row">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>About this sample</h2>
        <p className="muted">
          The two seeded workflows are defined in the backend's <code>workflowCatalog</code>
          (<code>src/host/index.ts</code>). The first runs end-to-end without HITL; the
          second pauses at an approval gate so you can exercise the interrupt-resolution UI.
        </p>
      </div>
    </section>
  );
}
