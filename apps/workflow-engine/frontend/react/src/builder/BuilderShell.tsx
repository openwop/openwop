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

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NodePalette } from './palette/NodePalette.js';
import { BuilderCanvas } from './canvas/BuilderCanvas.js';
import { Inspector } from './inspector/Inspector.js';
import { DemoHostBanner } from './DemoHostBanner.js';
import { useBuilderStore } from './store/builderStore.js';
import { newWorkflowId } from './persistence/localStore.js';
import { registerWorkflow } from './persistence/registerClient.js';
import { serializeWorkflow, SerializeError } from './schema/serialize.js';
import { createRun } from '../client/runsClient.js';

interface Props {
  onNewWorkflow(): void;
}

export function BuilderShell({ onNewWorkflow }: Props) {
  const nav = useNavigate();
  const workflowId = useBuilderStore((s) => s.workflowId);
  const name = useBuilderStore((s) => s.name);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const canUndo = useBuilderStore((s) => s.past.length > 0);
  const canRedo = useBuilderStore((s) => s.future.length > 0);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    setRunning(true);
    setError(null);
    try {
      const snap = useBuilderStore.getState().snapshot();
      const def = serializeWorkflow(snap);
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
      const res = await createRun({ workflowId: def.workflowId, tenantId: 'demo', inputs });
      nav(`/runs/${res.runId}`);
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

  return (
    <div className="builder-shell">
      <DemoHostBanner />
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
        <button className="secondary" onClick={onNewWorkflow}>New</button>
        <button onClick={onRun} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
      {error && <div className="alert error builder-toolbar-error">{error}</div>}
      <div className="builder-body">
        <NodePalette />
        <BuilderCanvas />
        <Inspector />
      </div>
    </div>
  );
}
