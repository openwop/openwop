/**
 * Sample-extension workflow-registration routes used by the in-app
 * builder UI. Vendor-prefixed under `/v1/host/sample/*` per
 * `spec/v1/host-extensions.md` §"Canonical prefixes" — these are NOT
 * part of the v1 wire contract.
 *
 *   POST   /v1/host/sample/workflows           — register / overwrite
 *   GET    /v1/host/sample/workflows           — list registered
 *   DELETE /v1/host/sample/workflows/:workflowId
 *
 * The workflowCatalog (`src/host/index.ts`) consults the in-memory
 * registry after its hardcoded samples, so a registered workflow is
 * immediately resolvable by `POST /v1/runs`.
 */

import type { Express } from 'express';
import { OpenwopError } from '../types.js';
import type { EdgeDef, WorkflowDefinition } from '../executor/types.js';
import {
  deleteRegisteredWorkflow,
  listRegisteredWorkflows,
  registerWorkflow,
} from '../host/workflowsRegistry.js';
import { resolveCapabilityFlag } from '../host/capabilityOverlay.js';
import type { HostAdapterSuite } from '../host/index.js';

const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9_.\-:]{1,128}$/;
const NODE_ID_PATTERN = /^[a-zA-Z0-9_\-]{1,64}$/;
const TYPE_ID_PATTERN = /^[a-zA-Z0-9_.\-]{1,128}$/;
const EDGE_ID_PATTERN = /^[a-zA-Z0-9_\-]{1,64}$/;
const TRIGGER_RULES = new Set(['all_success', 'any_success', 'all_complete', 'none_failed', 'any_failed']);

/** RFC 0022 §C — workflow-register MUST refuse with `validation_error` +
 *  `details.requiredCapability` when a node's mapping field is non-empty
 *  AND the matching capability flag is not advertised (or has been
 *  toggled off via the test-seam overlay). */
function checkMappingCapability(
  nodes: ReadonlyArray<{ nodeId: string; typeId: string; config?: Record<string, unknown> }>,
): void {
  for (const node of nodes) {
    const cfg = node.config ?? {};
    if (node.typeId === 'core.dispatch') {
      const hasMapping = hasNonEmptyMapping(cfg, ['inputMapping', 'outputMapping', 'perWorkerInputMappings', 'perWorkerOutputMappings']);
      if (hasMapping && resolveCapabilityFlag('agents.dispatchMapping') !== true) {
        throw new OpenwopError(
          'validation_error',
          `Node '${node.nodeId}' (core.dispatch) declares non-empty mapping fields but the host does not advertise capabilities.agents.dispatchMapping: true.`,
          400,
          { nodeId: node.nodeId, requiredCapability: 'agents.dispatchMapping' },
        );
      }
      // RFC 0007 §B / `dispatch-config.schema.json` — `fanOutPolicy`,
      // `workerDispatchModel`, `askUserRouting` are part of the
      // canonical config surface. The sample only implements the
      // sequential / child-run / auto path today; refuse other values
      // at register time rather than silently treating them as the
      // implemented defaults. Production hosts that DO support these
      // surfaces SHOULD remove this refusal.
      const fanOutPolicy = (cfg.fanOutPolicy ?? 'sequential') as unknown;
      if (typeof fanOutPolicy === 'string' && fanOutPolicy !== 'sequential') {
        throw new OpenwopError(
          'capability_not_provided',
          `Node '${node.nodeId}' (core.dispatch) requests fanOutPolicy='${fanOutPolicy}' but this host only implements 'sequential'.`,
          400,
          { nodeId: node.nodeId, requiredCapability: 'dispatch.fanOut' },
        );
      }
      const workerDispatchModel = (cfg.workerDispatchModel ?? 'child-run') as unknown;
      if (typeof workerDispatchModel === 'string' && workerDispatchModel !== 'child-run') {
        throw new OpenwopError(
          'capability_not_provided',
          `Node '${node.nodeId}' (core.dispatch) requests workerDispatchModel='${workerDispatchModel}' but this host only implements 'child-run'.`,
          400,
          { nodeId: node.nodeId, requiredCapability: 'dispatch.workerDispatchModel' },
        );
      }
      const askUserRouting = (cfg.askUserRouting ?? 'auto') as unknown;
      if (typeof askUserRouting === 'string' && askUserRouting !== 'auto') {
        throw new OpenwopError(
          'capability_not_provided',
          `Node '${node.nodeId}' (core.dispatch) requests askUserRouting='${askUserRouting}' but this host only implements 'auto'.`,
          400,
          { nodeId: node.nodeId, requiredCapability: 'dispatch.askUserRouting' },
        );
      }
    }
    if (node.typeId === 'core.subWorkflow') {
      const hasMapping = hasNonEmptyMapping(cfg, ['inputMapping']);
      if (hasMapping && resolveCapabilityFlag('subWorkflow.inputMapping') !== true) {
        throw new OpenwopError(
          'validation_error',
          `Node '${node.nodeId}' (core.subWorkflow) declares non-empty inputMapping but the host does not advertise capabilities.subWorkflow.inputMapping: true.`,
          400,
          { nodeId: node.nodeId, requiredCapability: 'subWorkflow.inputMapping' },
        );
      }
    }
  }
}

function hasNonEmptyMapping(cfg: Record<string, unknown>, fields: readonly string[]): boolean {
  for (const f of fields) {
    const v = cfg[f];
    if (!v) continue;
    if (typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) return true;
      continue;
    }
    if (Object.keys(v as Record<string, unknown>).length > 0) return true;
  }
  return false;
}

export function registerWorkflowRoutes(app: Express, deps: { hostSuite: HostAdapterSuite }): void {
  app.get('/v1/host/sample/workflows', (_req, res) => {
    res.json({ workflows: listRegisteredWorkflows() });
  });

  // Spec endpoint: GET /v1/workflows/{workflowId} per
  // `api/openapi.yaml operationId=getWorkflow`. Returns the workflow
  // definition (including `id` and `nodes`) for any advertised
  // workflowId — both runtime-registered workflows (via POST
  // /v1/host/sample/workflows) and conformance fixtures auto-loaded
  // from `conformance/fixtures/`. 404 on unknown ids per `rest-
  // endpoints.md §"Error envelope"`.
  app.get('/v1/workflows/:workflowId', async (req, res, next) => {
    try {
      const wf = await deps.hostSuite.workflowCatalog.getWorkflow(req.params.workflowId);
      if (!wf) {
        throw new OpenwopError(
          'workflow_not_found',
          'workflow not found',
          404,
          { workflowId: req.params.workflowId },
        );
      }
      res.json(wf.definition);
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/workflows', (req, res, next) => {
    try {
      const def = validateDefinition(req.body);
      registerWorkflow(def);
      res.status(201).json({ workflowId: def.workflowId, nodeCount: def.nodes.length });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/workflows/:workflowId', (req, res, next) => {
    try {
      const id = req.params.workflowId;
      if (!WORKFLOW_ID_PATTERN.test(id)) {
        throw new OpenwopError('validation_error', 'Invalid workflowId.', 400, { workflowId: id });
      }
      const removed = deleteRegisteredWorkflow(id);
      res.json({ workflowId: id, removed });
    } catch (err) {
      next(err);
    }
  });
}

function validateDefinition(raw: unknown): WorkflowDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new OpenwopError('validation_error', 'Request body MUST be a JSON object.', 400);
  }
  const obj = raw as Record<string, unknown>;
  const workflowId = obj.workflowId;
  if (typeof workflowId !== 'string' || !WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new OpenwopError(
      'validation_error',
      'Field `workflowId` MUST match [a-zA-Z0-9_.-:]{1,128}.',
      400,
      { field: 'workflowId' },
    );
  }
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
    throw new OpenwopError(
      'validation_error',
      'Field `nodes` MUST be a non-empty array.',
      400,
      { field: 'nodes' },
    );
  }
  const seen = new Set<string>();
  const nodes = obj.nodes.map((n, i) => {
    if (!n || typeof n !== 'object') {
      throw new OpenwopError('validation_error', `nodes[${i}] MUST be an object.`, 400);
    }
    const node = n as Record<string, unknown>;
    if (typeof node.nodeId !== 'string' || !NODE_ID_PATTERN.test(node.nodeId)) {
      throw new OpenwopError(
        'validation_error',
        `nodes[${i}].nodeId MUST match [a-zA-Z0-9_-]{1,64}.`,
        400,
      );
    }
    if (seen.has(node.nodeId)) {
      throw new OpenwopError('validation_error', `Duplicate nodeId: ${node.nodeId}`, 400);
    }
    seen.add(node.nodeId);
    if (typeof node.typeId !== 'string' || !TYPE_ID_PATTERN.test(node.typeId)) {
      throw new OpenwopError(
        'validation_error',
        `nodes[${i}].typeId MUST match [a-zA-Z0-9_.-]{1,128}.`,
        400,
      );
    }
    if (node.config != null && (typeof node.config !== 'object' || Array.isArray(node.config))) {
      throw new OpenwopError(
        'validation_error',
        `nodes[${i}].config MUST be an object when present.`,
        400,
      );
    }
    // RFC 0065 — optional advisory `outputRole` annotation; enum
    // validation matches the wire-level schema. Reject unknown values
    // at the route boundary so the registered definition is round-
    // trippable through `workflow-definition.schema.json`.
    if (
      node.outputRole !== undefined
      && node.outputRole !== 'primary'
      && node.outputRole !== 'secondary'
    ) {
      throw new OpenwopError(
        'validation_error',
        `nodes[${i}].outputRole MUST be 'primary' or 'secondary' when present.`,
        400,
      );
    }
    return {
      nodeId: node.nodeId,
      typeId: node.typeId,
      ...(node.config ? { config: node.config as Record<string, unknown> } : {}),
      ...(node.outputRole !== undefined
        ? { outputRole: node.outputRole as 'primary' | 'secondary' }
        : {}),
    };
  });
  // RFC 0022 §C capability-gate refusal check.
  checkMappingCapability(nodes);

  // Optional `edges` array — wire-shape matches `WorkflowEdge` in
  // `spec/v1/workflow-definition.schema.json`. Without this validation
  // step the executor falls back to an implicit linear chain over
  // `nodes`, which silently mis-wires every fan-out template (every
  // chat critic in the Triple-AI board reads its predecessor's output
  // instead of the prepared prompt). See bug from 2026-05-23.
  let edges: WorkflowDefinition['edges'];
  if (obj.edges !== undefined) {
    if (!Array.isArray(obj.edges)) {
      throw new OpenwopError('validation_error', 'Field `edges` MUST be an array when present.', 400, { field: 'edges' });
    }
    const nodeIds = new Set(nodes.map((n) => n.nodeId));
    const seenEdgeIds = new Set<string>();
    edges = obj.edges.map((raw, i) => {
      if (!raw || typeof raw !== 'object') {
        throw new OpenwopError('validation_error', `edges[${i}] MUST be an object.`, 400);
      }
      const e = raw as Record<string, unknown>;
      if (typeof e.edgeId !== 'string' || !EDGE_ID_PATTERN.test(e.edgeId)) {
        throw new OpenwopError('validation_error', `edges[${i}].edgeId MUST match [a-zA-Z0-9_-]{1,64}.`, 400);
      }
      if (seenEdgeIds.has(e.edgeId)) {
        throw new OpenwopError('validation_error', `Duplicate edgeId: ${e.edgeId}`, 400);
      }
      seenEdgeIds.add(e.edgeId);
      if (typeof e.sourceNodeId !== 'string' || !nodeIds.has(e.sourceNodeId)) {
        throw new OpenwopError('validation_error', `edges[${i}].sourceNodeId MUST reference a declared node.`, 400);
      }
      if (typeof e.targetNodeId !== 'string' || !nodeIds.has(e.targetNodeId)) {
        throw new OpenwopError('validation_error', `edges[${i}].targetNodeId MUST reference a declared node.`, 400);
      }
      if (e.triggerRule !== undefined && (typeof e.triggerRule !== 'string' || !TRIGGER_RULES.has(e.triggerRule))) {
        throw new OpenwopError('validation_error', `edges[${i}].triggerRule MUST be one of ${[...TRIGGER_RULES].join(', ')}.`, 400);
      }
      const out: Mutable<EdgeDef> = {
        edgeId: e.edgeId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
      };
      if (typeof e.sourceOutput === 'string') out.sourceOutput = e.sourceOutput;
      if (typeof e.targetInput === 'string') out.targetInput = e.targetInput;
      if (typeof e.triggerRule === 'string') out.triggerRule = e.triggerRule as EdgeDef['triggerRule'];
      if (e.condition && typeof e.condition === 'object') out.condition = e.condition as EdgeDef['condition'];
      if (typeof e.label === 'string') out.label = e.label;
      return out;
    });
  }

  return edges ? { workflowId, nodes, edges } : { workflowId, nodes };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
