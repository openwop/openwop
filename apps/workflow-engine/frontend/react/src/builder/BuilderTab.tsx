/**
 * Builder route entry. Loads the workflow named by `:workflowId` from
 * localStorage, or hydrates a blank workflow under that id if none
 * exists yet (lets the dashboard mint a fresh id and link straight in).
 * The dashboard at `/builder` owns the "pick most recent" decision.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BuilderShell } from './BuilderShell.js';
import { useBuilderStore } from './store/builderStore.js';
import { getSavedWorkflow, newWorkflowId } from './persistence/localStore.js';
import type { SavedWorkflow } from './schema/workflow.js';

export function BuilderTab() {
  const { workflowId } = useParams<{ workflowId?: string }>();
  const nav = useNavigate();

  useEffect(() => {
    if (!workflowId) {
      // Defensive: this route always has :workflowId; the index route is
      // the dashboard. If we land here without one, kick back to the list.
      nav('/builder', { replace: true });
      return;
    }
    const existing = getSavedWorkflow(workflowId);
    if (existing) {
      useBuilderStore.getState().loadFromSaved(existing);
      return;
    }
    const blank: SavedWorkflow = {
      id: workflowId,
      name: 'Untitled workflow',
      version: '1.0.0',
      nodes: [],
      edges: [],
      defaultInputs: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    useBuilderStore.getState().loadFromSaved(blank);
  }, [workflowId, nav]);

  function onNewWorkflow() {
    nav(`/builder/${newWorkflowId()}`);
  }

  return <BuilderShell onNewWorkflow={onNewWorkflow} />;
}
