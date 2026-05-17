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
import type { WorkflowDefinition } from '../executor/types.js';
import {
  deleteRegisteredWorkflow,
  listRegisteredWorkflows,
  registerWorkflow,
} from '../host/workflowsRegistry.js';

const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9_.\-:]{1,128}$/;
const NODE_ID_PATTERN = /^[a-zA-Z0-9_\-]{1,64}$/;
const TYPE_ID_PATTERN = /^[a-zA-Z0-9_.\-]{1,128}$/;

export function registerWorkflowRoutes(app: Express): void {
  app.get('/v1/host/sample/workflows', (_req, res) => {
    res.json({ workflows: listRegisteredWorkflows() });
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
    return {
      nodeId: node.nodeId,
      typeId: node.typeId,
      ...(node.config ? { config: node.config as Record<string, unknown> } : {}),
    };
  });
  return { workflowId, nodes };
}
