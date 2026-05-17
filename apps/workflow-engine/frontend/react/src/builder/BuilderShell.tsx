/**
 * Three-region builder layout + top toolbar.
 *
 * Toolbar: workflow name input, [New], [Open ▾], [Run], undo/redo.
 * Layout: palette (260px) | canvas (flex 1) | inspector (320px).
 *
 * Auto-saves to localStorage on every store mutation; no explicit Save
 * button — matches the chat session pattern (useChatSession.ts:87-113).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NodePalette } from './palette/NodePalette.js';
import { BuilderCanvas } from './canvas/BuilderCanvas.js';
import { Inspector } from './inspector/Inspector.js';
import { useBuilderStore } from './store/builderStore.js';
import { listSavedWorkflows, newWorkflowId } from './persistence/localStore.js';
import { registerWorkflow } from './persistence/registerClient.js';
import { serializeWorkflow, SerializeError } from './schema/serialize.js';
import { createRun } from '../client/runsClient.js';

interface Props {
  onNewWorkflow(): void;
  onOpenWorkflow(id: string): void;
  onDeleteWorkflow(id: string): void;
}

export function BuilderShell({ onNewWorkflow, onOpenWorkflow, onDeleteWorkflow }: Props) {
  const nav = useNavigate();
  const workflowId = useBuilderStore((s) => s.workflowId);
  const name = useBuilderStore((s) => s.name);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const canUndo = useBuilderStore((s) => s.past.length > 0);
  const canRedo = useBuilderStore((s) => s.future.length > 0);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);

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

  const saved = listSavedWorkflows();

  return (
    <div className="builder-shell">
      <div className="builder-toolbar">
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
        <div className="builder-open-menu">
          <button
            className="secondary"
            onClick={() => setOpenMenuOpen((v) => !v)}
            disabled={saved.length === 0}
          >
            Open ▾ ({saved.length})
          </button>
          {openMenuOpen && (
            <div className="builder-open-menu-popover">
              {saved.map((wf) => (
                <div key={wf.id} className="builder-open-menu-item">
                  <button
                    className="builder-open-menu-open"
                    onClick={() => {
                      setOpenMenuOpen(false);
                      onOpenWorkflow(wf.id);
                    }}
                  >
                    {wf.name}
                    <span className="muted"> · {wf.nodes.length} nodes</span>
                  </button>
                  <button
                    className="builder-open-menu-delete"
                    title="Delete"
                    onClick={() => {
                      if (!confirm(`Delete "${wf.name}"?`)) return;
                      onDeleteWorkflow(wf.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
