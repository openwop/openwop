/**
 * localStorage CRUD for SavedWorkflow records. Keyed under
 * `openwop.sample.builder.workflows` as a single JSON object
 * `{ [workflowId]: SavedWorkflow }`. Quota failures swallow silently.
 */

import type { SavedWorkflow } from '../schema/workflow.js';

const LS_KEY = 'openwop.sample.builder.workflows';

type Index = Record<string, SavedWorkflow>;

function readIndex(): Index {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Index;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(idx: Index): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(idx));
  } catch (err) {
    // Quota exceeded (or storage disabled). The current session keeps
    // working from zustand state, but the workflow won't survive a
    // page reload. Warn so dev iterations notice instead of silently
    // losing work.
    console.warn('[openwop-builder] workflow persist failed:', err);
  }
}

export function listSavedWorkflows(): SavedWorkflow[] {
  return Object.values(readIndex()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSavedWorkflow(id: string): SavedWorkflow | undefined {
  return readIndex()[id];
}

export function upsertSavedWorkflow(wf: SavedWorkflow): void {
  const idx = readIndex();
  idx[wf.id] = wf;
  writeIndex(idx);
}

export function deleteSavedWorkflow(id: string): void {
  const idx = readIndex();
  delete idx[id];
  writeIndex(idx);
}

export function newWorkflowId(): string {
  return `wf_${crypto.randomUUID().slice(0, 8)}`;
}
