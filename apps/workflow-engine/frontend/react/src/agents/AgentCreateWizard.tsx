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
import { ROLE_TEMPLATES, roleThemeForKey, type RoleTemplate, type WorkflowOption } from './roleTemplates.js';
import { createUserAgent } from '../client/agentsClient.js';
import { createRosterEntry } from './rosterClient.js';
import { createBoard, type KanbanColumn } from '../kanban/kanbanClient.js';
import { CADENCE_PRESETS, createJob } from './scheduleClient.js';
import { Notice } from '../ui/Notice.js';
import { StructuredPromptEditor } from './StructuredPromptEditor.js';
import { AgentAvatar } from './AgentAvatar.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

const DEMO_LANES: KanbanColumn[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'working', name: 'Working' },
  { id: 'waiting', name: 'Waiting on Human' },
  { id: 'done', name: 'Done' },
];

// Suggested human names per role — same personas the demo seed uses, so the
// name field reads as a coworker rather than a config value.
const EXAMPLE_NAMES: Record<string, string> = {
  'sales-ops': 'Sally',
  'support-triage': 'Marcus',
  'finance-ops': 'Priya',
  'engineering-ops': 'Devon',
  'marketing-ops': 'Nora',
};

const HEARTBEAT_OPTIONS = [
  { key: 'manual', label: 'Manual only (Check now)' },
  { key: '2m', label: 'Every 2 minutes' },
  { key: '15m', label: 'Every 15 minutes' },
  { key: 'hourly', label: 'Hourly' },
];

/** Heartbeat key → autonomous cadence in ms (0 = manual only). Persisted on the
 *  roster entry; the background heartbeat daemon honors it. */
const HEARTBEAT_INTERVAL_MS: Record<string, number> = {
  manual: 0,
  '2m': 120_000,
  '15m': 900_000,
  hourly: 3_600_000,
};

const MODEL_CLASS_OPTIONS = [
  { key: 'chat', label: 'Chat — general conversation' },
  { key: 'reasoning', label: 'Reasoning — complex multi-step work' },
  { key: 'coding', label: 'Coding — code generation & review' },
  { key: 'extraction', label: 'Extraction — structured data pulls' },
] as const;
type WizardModelClass = (typeof MODEL_CLASS_OPTIONS)[number]['key'];

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
  const [modelClass, setModelClass] = useState<WizardModelClass>('chat');
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

  // Explain why "Next" is disabled instead of leaving a dead button.
  const nextHint = (): string | null => {
    if (step !== 1 || canNext()) return null;
    if (role === null && !isCustom) return 'Pick a role to continue.';
    if (!name.trim()) return 'Add a name so teammates can assign work.';
    if (!roleTitle.trim()) return 'Add a role title to continue.';
    return null;
  };

  const exampleName = role ? EXAMPLE_NAMES[role.key] ?? 'Sally' : 'Sally';
  const CustomRoleIcon = roleThemeForKey('custom').Icon;

  const onFinish = async () => {
    setCreating(true);
    setError(null);
    try {
      const workflows = [...selectedWorkflows];
      // 1. user-authored agent (editable instructions).
      const agent = await createUserAgent({
        persona: name.trim(),
        label: roleTitle.trim(),
        modelClass,
        systemPrompt: composedPrompt(),
      });
      // 2. roster entry bound to that agent. The heartbeat cadence is persisted
      //    so the background daemon auto-runs "Check now" on that interval.
      const heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS[heartbeat] ?? 0;
      const entry = await createRosterEntry({
        persona: name.trim(),
        agentRef: { agentId: agent.agentId },
        workflows,
        label: roleTitle.trim(),
        ...(heartbeatIntervalMs > 0 ? { heartbeatIntervalMs } : {}),
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
            {ROLE_TEMPLATES.map((r) => {
              const RoleIcon = roleThemeForKey(r.key).Icon;
              const selected = role?.key === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickRole(r)}
                  style={{ textAlign: 'left', border: selected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 10, padding: '0.6rem', background: selected ? 'var(--clay-wash)' : 'var(--color-surface)', cursor: 'pointer' }}
                >
                  <strong style={{ fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <RoleIcon size={15} style={{ color: 'var(--color-accent)' }} /> {r.title}
                  </strong>
                  <div style={{ ...muted, fontSize: '0.78rem' }}>{r.blurb}</div>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={isCustom}
              onClick={pickCustom}
              style={{ textAlign: 'left', border: isCustom ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 10, padding: '0.6rem', background: isCustom ? 'var(--clay-wash)' : 'var(--color-surface)', cursor: 'pointer' }}
            >
              <strong style={{ fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <CustomRoleIcon size={15} style={{ color: 'var(--color-accent)' }} /> Custom role
              </strong>
              <div style={{ ...muted, fontSize: '0.78rem' }}>Define your own role and workflows.</div>
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${exampleName}`} style={{ width: '100%' }} />
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
          <label style={{ display: 'block', marginBottom: '0.6rem', maxWidth: 360 }}>
            <div style={{ fontSize: '0.82rem' }}>Model class</div>
            <select value={modelClass} onChange={(e) => setModelClass(e.target.value as WizardModelClass)} style={{ width: '100%' }}>
              {MODEL_CLASS_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Instructions (editable)</div>
          <p style={{ ...muted, fontSize: '0.78rem', marginTop: 0 }}>
            Auto-generated from the role — edit freely. Use the sections, or switch to raw Markdown.
          </p>
          <StructuredPromptEditor
            key={role?.key ?? (isCustom ? 'custom' : 'none')}
            value={systemPrompt}
            onChange={setSystemPrompt}
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
          {(() => {
            const wfOptions = isCustom ? ROLE_TEMPLATES.flatMap((r) => r.workflows) : recommendedWorkflows;
            const wfNames = [...selectedWorkflows].map((id) => wfOptions.find((w) => w.workflowId === id)?.name ?? id);
            const prompt = composedPrompt();
            const promptPreview = prompt.length > 160 ? `${prompt.slice(0, 160)}…` : prompt;
            const sources = ['Human tasks', 'Workflow-created tasks', ...(enableDiscord ? ['Simulated Discord'] : [])];
            return (
              <div style={{ marginTop: '1rem', padding: '0.8rem', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface-2)' }}>
                <strong>Review &amp; create</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.5rem 0' }}>
                  <AgentAvatar persona={name || 'New agent'} roleTheme={roleThemeForKey(role?.key ?? 'custom')} size={40} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{name || 'Unnamed'}</div>
                    <div style={{ ...muted, fontSize: '0.8rem' }}>{roleTitle || 'No role title'}</div>
                  </div>
                </div>
                <dl style={{ margin: 0, fontSize: '0.84rem', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.2rem 0.6rem' }}>
                  <dt style={muted}>Workflows</dt>
                  <dd style={{ margin: 0 }}>{wfNames.length ? wfNames.join(', ') : 'None selected'}</dd>
                  <dt style={muted}>Board</dt>
                  <dd style={{ margin: 0 }}>{createBoardEnabled ? 'Task board · To Do / Working / Waiting / Done' : 'No board'}</dd>
                  <dt style={muted}>Sources</dt>
                  <dd style={{ margin: 0 }}>{sources.join(', ')}</dd>
                  <dt style={muted}>Heartbeat</dt>
                  <dd style={{ margin: 0 }}>{HEARTBEAT_OPTIONS.find((h) => h.key === heartbeat)?.label}</dd>
                </dl>
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ ...muted, fontSize: '0.78rem' }}>Instructions preview</div>
                  <div style={{ fontSize: '0.8rem', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{promptPreview}</div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.2rem', gap: '0.6rem' }}>
        <button type="button" className="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || creating}>Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {nextHint() ? <span style={{ ...muted, fontSize: '0.8rem' }}>{nextHint()}</span> : null}
          {step < 5 ? (
            <button type="button" className="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>Next</button>
          ) : (
            <button type="button" className="primary" onClick={() => void onFinish()} disabled={creating}>{creating ? 'Creating…' : 'Create agent'}</button>
          )}
        </div>
      </div>
    </section>
  );
}
