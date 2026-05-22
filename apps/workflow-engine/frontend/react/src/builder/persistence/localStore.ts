/**
 * localStorage CRUD for SavedWorkflow records. Keyed under
 * `openwop.sample.builder.workflows` as a single JSON object
 * `{ [workflowId]: SavedWorkflow }`. Quota failures swallow silently.
 */

import type { SavedWorkflow } from '../schema/workflow.js';

const LS_KEY = 'openwop.sample.builder.workflows';
const LS_SEEDED_KEY = 'openwop.sample.builder.workflows.seeded';

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

export function renameSavedWorkflow(id: string, name: string): void {
  const idx = readIndex();
  const wf = idx[id];
  if (!wf) return;
  idx[id] = { ...wf, name, updatedAt: new Date().toISOString() };
  writeIndex(idx);
}

export function duplicateSavedWorkflow(id: string): SavedWorkflow | undefined {
  const idx = readIndex();
  const src = idx[id];
  if (!src) return undefined;
  const now = new Date().toISOString();
  const copy: SavedWorkflow = {
    ...src,
    id: newWorkflowId(),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  idx[copy.id] = copy;
  writeIndex(idx);
  return copy;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'workflow';
}

export function exportSavedWorkflowAsJSON(
  id: string,
): { filename: string; blob: Blob } | undefined {
  const wf = getSavedWorkflow(id);
  if (!wf) return undefined;
  const filename = `${slugify(wf.name)}-${wf.id}.json`;
  const blob = new Blob([JSON.stringify(wf, null, 2)], { type: 'application/json' });
  return { filename, blob };
}

/**
 * One-shot seed for the workflows dashboard. On the very first visit
 * (no `seeded` flag set yet AND no existing saved workflows), persist
 * the supplied workflows so the user lands on a populated dashboard
 * instead of an empty state with only a "Templates" section below.
 *
 * After it runs once, the `seeded` flag is set so subsequent visits
 * never re-seed — even if the user deletes everything (their intent).
 *
 * Returns the number of workflows seeded (0 if it no-op'd).
 */
export function seedSavedWorkflowsIfFirstVisit(
  workflows: readonly SavedWorkflow[],
): number {
  try {
    if (localStorage.getItem(LS_SEEDED_KEY) === '1') return 0;
  } catch {
    return 0;
  }
  const existing = readIndex();
  if (Object.keys(existing).length > 0) {
    // User has workflows already (e.g., migrated from before seeding existed).
    // Don't seed; just mark seeded so we never run again.
    try { localStorage.setItem(LS_SEEDED_KEY, '1'); } catch { /* ignore */ }
    return 0;
  }
  const idx: Index = {};
  for (const wf of workflows) idx[wf.id] = wf;
  writeIndex(idx);
  try { localStorage.setItem(LS_SEEDED_KEY, '1'); } catch { /* ignore */ }
  return workflows.length;
}
