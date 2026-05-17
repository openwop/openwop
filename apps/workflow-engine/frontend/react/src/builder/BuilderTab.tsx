/**
 * Builder route entry. Resolves `:workflowId` (or picks the most recent
 * saved workflow, or creates a blank one) and hydrates the zustand
 * store. Re-syncs on workflowId param change.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BuilderShell } from './BuilderShell.js';
import { useBuilderStore } from './store/builderStore.js';
import {
  deleteSavedWorkflow,
  getSavedWorkflow,
  listSavedWorkflows,
  newWorkflowId,
} from './persistence/localStore.js';
import type { SavedWorkflow } from './schema/workflow.js';

export function BuilderTab() {
  const { workflowId } = useParams<{ workflowId?: string }>();
  const nav = useNavigate();

  useEffect(() => {
    // Resolve target workflow: explicit param > most recent > new blank.
    if (workflowId) {
      const existing = getSavedWorkflow(workflowId);
      if (existing) {
        useBuilderStore.getState().loadFromSaved(existing);
        return;
      }
      // Param points to a workflow we don't have — fall through to blank.
    }
    const all = listSavedWorkflows();
    const mostRecent = all[0];
    if (!workflowId && mostRecent) {
      nav(`/builder/${mostRecent.id}`, { replace: true });
      return;
    }
    // Start a blank workflow.
    const blank: SavedWorkflow = {
      id: workflowId ?? newWorkflowId(),
      name: 'Untitled workflow',
      version: '1.0.0',
      nodes: [],
      edges: [],
      defaultInputs: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    useBuilderStore.getState().loadFromSaved(blank);
    if (!workflowId) {
      nav(`/builder/${blank.id}`, { replace: true });
    }
  }, [workflowId, nav]);

  function onNewWorkflow() {
    nav(`/builder/${newWorkflowId()}`);
  }
  function onOpenWorkflow(id: string) {
    nav(`/builder/${id}`);
  }
  function onDeleteWorkflow(id: string) {
    deleteSavedWorkflow(id);
    if (workflowId === id) {
      const [nextWf] = listSavedWorkflows();
      if (nextWf) nav(`/builder/${nextWf.id}`, { replace: true });
      else nav(`/builder/${newWorkflowId()}`, { replace: true });
    }
  }

  return (
    <BuilderShell
      onNewWorkflow={onNewWorkflow}
      onOpenWorkflow={onOpenWorkflow}
      onDeleteWorkflow={onDeleteWorkflow}
    />
  );
}
