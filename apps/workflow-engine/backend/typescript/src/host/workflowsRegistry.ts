/**
 * In-memory workflow registry consulted by the workflowCatalog after
 * the hardcoded sample workflows. Populated by clients via
 * `POST /v1/host/sample/workflows` — the builder UI calls this just
 * before dispatching a run so the catalog can resolve the workflowId.
 *
 * Sample-grade: process-local, evicted on restart. Real hosts persist
 * to the `workflows` table referenced in storage.ts plans.
 */

import type { WorkflowDefinition } from '../executor/types.js';

const registry = new Map<string, WorkflowDefinition>();

export function registerWorkflow(def: WorkflowDefinition): void {
  registry.set(def.workflowId, def);
}

export function getRegisteredWorkflow(workflowId: string): WorkflowDefinition | undefined {
  return registry.get(workflowId);
}

export function listRegisteredWorkflows(): readonly WorkflowDefinition[] {
  return Array.from(registry.values());
}

export function deleteRegisteredWorkflow(workflowId: string): boolean {
  return registry.delete(workflowId);
}
