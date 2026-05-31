/**
 * `/agents/new` — guided create-agent wizard (PRD §10). Replaces the raw form
 * with five steps: Role → Persona & Instructions → Workflows → Board & sources
 * → Schedule & heartbeat. No raw ids in the primary surface.
 *
 * On finish it composes the existing host-extension surfaces:
 *   1. POST /v1/host/sample/agents       — a user-authored agent (editable
 *      instructions; agentRef `user.*` so the Instructions tab can edit it)
 *   2. POST /v1/host/sample/roster       — the named agent bound to that agent
 *   3. POST /v1/host/sample/kanban/boards — its task board (4 demo lanes)
 *   4. POST /v1/host/sample/scheduler/jobs — any chosen starter schedules
 * then routes to the new agent's workspace.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_TEMPLATES, type RoleTemplate, type WorkflowOption } from './roleTemplates.js';
import { createUserAgent } from '../client/agentsClient.js';
import { createRosterEntry } from './rosterClient.js';
import { createBoard, type KanbanColumn } from '../kanban/kanbanClient.js';
import { CADENCE_PRESETS, createJob } from './scheduleClient.js';
import { Notice } from '../ui/Notice.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

const DEMO_LANES: KanbanColumn[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'working', name: 'Working' },
  { id: 'waiting', name: 'Waiting on Human' },
  { id: 'done', name: 'Done' },
];

const HEARTBEAT_OPTIONS = [
  { key: 'manual', label: 'Manual only (Check now)' },
  { key: '2m', label: 'Every 2 minutes' },
  { key: '15m', label: 'Every 15 minutes' },
  { key: 'hourly', label: 'Hourly' },
];

function StepHeader({ step, title }: { step: number; title: string }): JSX.Element {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ ...muted, fontSize: '0.78rem' }}>Step {step} of 5</div>
      <h2 style={{ margin: '0.1rem 0 0', fontSize: '1.15rem' }}>{title}</h2>
    </div>
  );
}

export function AgentCreateWizard(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Step 1 — role + identity
  const [role, setRole] = useState<RoleTemplate | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');

  // Step 2 — persona + instructions
  const [tone, setTone] = useState('friendly and precise');
  const [decisionStyle, setDecisionStyle] = useState('decisive but careful');
  const [escalation, setEscalation] = useState('asks a human before risky actions');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Step 3 — workflows
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());

  // Step 4 — board + sources
  const [createBoardEnabled, setCreateBoardEnabled] = useState(true);
  const [enableDiscord, setEnableDiscord] = useState(true);

  // Step 5 — schedule + heartbeat
  const [heartbeat, setHeartbeat] = useState('manual');
  const [scheduleWorkflowId, setScheduleWorkflowId] = useState('');
  const [scheduleCadence, setScheduleCadence] = useState(CADENCE_PRESETS[2]!.key); // weekdays

  const recommendedWorkflows: WorkflowOption[] = role?.workflows ?? [];

  const pickRole = (r: RoleTemplate) => {
    setRole(r);
    setIsCustom(false);
    setRoleTitle(r.title);
    setSelectedWorkflows(new Set(r.workflows.map((w) => w.workflowId)));
    setSystemPrompt(r.personaPrompt);
    setScheduleWorkflowId(r.workflows[0]?.workflowId ?? '');
  };

  const pickCustom = () => {
    setRole(null);
    setIsCustom(true);
    setRoleTitle('');
    setSelectedWorkflows(new Set());
    setSystemPrompt('');
  };

  const composedPrompt = (): string => {
    if (systemPrompt.trim()) return systemPrompt.trim();
    return `You are ${name || 'an assistant'}, a ${roleTitle || 'helpful coworker'}. You are ${tone}; you are ${decisionStyle}; you ${escalation}.`;
  };

  const toggleWorkflow = (id: string) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canNext = (): boolean => {
    if (step === 1) return name.trim().length > 0 && roleTitle.trim().length > 0 && (role !== null || isCustom);
    return true;
  };

  const onFinish = async () => {
    setCreating(true);
    setError(null);
    try {
      const workflows = [...selectedWorkflows];
      // 1. user-authored agent (editable instructions).
      const agent = await createUserAgent({
        persona: name.trim(),
        label: roleTitle.trim(),
        modelClass: 'chat',
        systemPrompt: composedPrompt(),
      });
      // 2. roster entry bound to that agent.
      const entry = await createRosterEntry({
        persona: name.trim(),
        agentRef: { agentId: agent.agentId },
        workflows,
        label: roleTitle.trim(),
      });
      // 3. board with the 4 demo lanes; To Do triggers the first workflow.
      if (createBoardEnabled) {
        const columns = DEMO_LANES.map((c) =>
          c.id === 'todo' && workflows[0] ? { ...c, triggerWorkflowId: workflows[0] } : { ...c },
        );
        await createBoard({ name: `${name.trim()}'s board`, rosterId: entry.rosterId, columns });
      }
      // 4. optional starter schedule.
      if (heartbeat !== 'manual' && scheduleWorkflowId) {
        const preset = CADENCE_PRESETS.find((p) => p.key === scheduleCadence) ?? CADENCE_PRESETS[0]!;
        await createJob({
          cronExpr: preset.cronExpr,
          workflowId: scheduleWorkflowId,
          rosterId: entry.rosterId,
          agentId: agent.agentId,
          metadata: { label: preset.label },
        });
      }
      navigate(`/agents/${encodeURIComponent(entry.rosterId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  return (
    <section style={{ padding: '1rem', maxWidth: 720, margin: '0 auto' }}>
      <Link to="/agents" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>← All agents</Link>
      <h1 style={{ marginTop: '0.4rem' }}>Create an agent</h1>

      {error ? <Notice variant="error">{error}</Notice> : null}

      {step === 1 ? (
        <div>
          <StepHeader step={1} title="Pick a role" />
          <p style={{ ...muted, marginTop: 0, fontSize: '0.85rem' }}>The name is how teammates assign work — pick a human-like name.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '0.8rem' }}>
            {ROLE_TEMPLATES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => pickRole(r)}
                style={{ textAlign: 'left', border: role?.key === r.key ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 10, padding: '0.6rem', background: 'var(--color-surface)', cursor: 'pointer' }}
              >
                <strong style={{ fontSize: '0.9rem' }}>{r.title}</strong>
                <div style={{ ...muted, fontSize: '0.78rem' }}>{r.blurb}</div>
              </button>
            ))}
            <button
              type="button"
              onClick={pickCustom}
              style={{ textAlign: 'left', border: isCustom ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 10, padding: '0.6rem', background: 'var(--color-surface)', cursor: 'pointer' }}
            >
              <strong style={{ fontSize: '0.9rem' }}>Custom role</strong>
              <div style={{ ...muted, fontSize: '0.78rem' }}>Define your own role and workflows.</div>
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sally" style={{ width: '100%' }} />
            </label>
            <label style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Role title</div>
              <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Sales Ops Assistant" style={{ width: '100%' }} />
            </label>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div>
          <StepHeader step={2} title="Persona & instructions" />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <label style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: '0.82rem' }}>Tone</div>
              <input value={tone} onChange={(e) => setTone(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: '0.82rem' }}>Decision style</div>
              <input value={decisionStyle} onChange={(e) => setDecisionStyle(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: '0.82rem' }}>Escalation behavior</div>
              <input value={escalation} onChange={(e) => setEscalation(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Instructions (editable)</div>
          <p style={{ ...muted, fontSize: '0.78rem', marginTop: 0 }}>Auto-generated from the role — edit freely.</p>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}
            placeholder={composedPrompt()}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div>
          <StepHeader step={3} title="Assign workflows" />
          <p style={{ ...muted, marginTop: 0, fontSize: '0.85rem' }}>
            {role ? `Recommended for a ${role.title}:` : 'Choose workflows from the library:'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {(isCustom ? ROLE_TEMPLATES.flatMap((r) => r.workflows) : recommendedWorkflows).map((w) => (
              <label key={w.workflowId} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem' }}>
                <input type="checkbox" checked={selectedWorkflows.has(w.workflowId)} onChange={() => toggleWorkflow(w.workflowId)} />
                <span>
                  <strong style={{ fontSize: '0.88rem' }}>{w.name}</strong>
                  <div style={{ ...muted, fontSize: '0.78rem' }}>{w.purpose}</div>
                </span>
              </label>
            ))}
          </div>
          <Link to="/builder" style={{ fontSize: '0.8rem' }}>Create from template →</Link>
        </div>
      ) : null}

      {step === 4 ? (
        <div>
          <StepHeader step={4} title="Board & work sources" />
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <input type="checkbox" checked={createBoardEnabled} onChange={(e) => setCreateBoardEnabled(e.target.checked)} />
            <span>Create a task board (lanes: To Do · Working · Waiting on Human · Done)</span>
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <input type="checkbox" checked disabled />
            <span style={muted}>Human tasks (always on)</span>
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <input type="checkbox" checked disabled />
            <span style={muted}>Workflow-created tasks (always on)</span>
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="checkbox" checked={enableDiscord} onChange={(e) => setEnableDiscord(e.target.checked)} />
            <span>Simulated Discord tasks (demo)</span>
          </label>
        </div>
      ) : null}

      {step === 5 ? (
        <div>
          <StepHeader step={5} title="Schedule & heartbeat" />
          <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Heartbeat</div>
          <p style={{ ...muted, fontSize: '0.78rem', marginTop: 0 }}>How often {name || 'the agent'} checks its board for new work.</p>
          <select value={heartbeat} onChange={(e) => setHeartbeat(e.target.value)} style={{ marginBottom: '0.8rem' }}>
            {HEARTBEAT_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
          </select>
          {heartbeat !== 'manual' && selectedWorkflows.size > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Starter schedule (optional)</div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: 4 }}>
                <select value={scheduleWorkflowId} onChange={(e) => setScheduleWorkflowId(e.target.value)}>
                  <option value="">No starter schedule</option>
                  {[...selectedWorkflows].map((id) => {
                    const wf = (isCustom ? ROLE_TEMPLATES.flatMap((r) => r.workflows) : recommendedWorkflows).find((w) => w.workflowId === id);
                    return <option key={id} value={id}>{wf?.name ?? id}</option>;
                  })}
                </select>
                <select value={scheduleCadence} onChange={(e) => setScheduleCadence(e.target.value)}>
                  {CADENCE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: '1rem', padding: '0.7rem', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface-alt, #f4f6f9)' }}>
            <strong>Review</strong>
            <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.84rem' }}>
              <li>{name} — {roleTitle}</li>
              <li>{selectedWorkflows.size} workflow{selectedWorkflows.size === 1 ? '' : 's'}</li>
              <li>{createBoardEnabled ? 'Task board with 4 lanes' : 'No board'}</li>
              <li>Heartbeat: {HEARTBEAT_OPTIONS.find((h) => h.key === heartbeat)?.label}</li>
            </ul>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.2rem' }}>
        <button type="button" className="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || creating}>Back</button>
        {step < 5 ? (
          <button type="button" className="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>Next</button>
        ) : (
          <button type="button" className="primary" onClick={() => void onFinish()} disabled={creating}>{creating ? 'Creating…' : 'Create agent'}</button>
        )}
      </div>
    </section>
  );
}
