/**
 * openwop.codemod.subworkflow-parent-link-drop — RFC 0171 row C4.18: a v1
 * `core.subWorkflow` child run carried `parentRunId` and `parentNodeId` on its
 * RunSnapshot (node-packs.md §Parent linkage). In v2 `parentRunId` is fork
 * lineage and `parentNodeId` does not exist; the child's parent is read from
 * `getRunAncestry` (spec/v2/core/execution.md §subWorkflow). Drops both from a
 * snapshot carrying `parentNodeId`, so a v2 reader does not take the child for a
 * fork. A snapshot without `parentNodeId` (a root run, or a fork) is unchanged.
 * Refuses a `parentNodeId` that is not a string or has no `parentRunId` beside
 * it, since that is not a v1 child link. Idempotent. Pure.
 */
export const id = 'openwop.codemod.subworkflow-parent-link-drop';
export const inputSchema = 'schemas/run-snapshot.schema.json';
export function transform(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a RunSnapshot object`);
  if (!('parentNodeId' in doc)) return doc;
  if (typeof doc.parentNodeId !== 'string' || typeof doc.parentRunId !== 'string') throw new Error(`${id}: parentNodeId ${JSON.stringify(doc.parentNodeId)} beside parentRunId ${JSON.stringify(doc.parentRunId)} is not a v1 child link; refusing to guess`);
  const { parentRunId, parentNodeId, ...rest } = doc;
  return rest;
}
