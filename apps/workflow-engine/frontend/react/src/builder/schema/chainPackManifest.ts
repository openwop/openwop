/**
 * Builder graph → RFC 0013 workflow-chain-pack manifest.
 *
 * Produces a `WorkflowChainPackManifest` (kind: "workflow-chain") with a
 * single chain whose `dag` is the built graph, conforming to
 * `schemas/workflow-chain-pack-manifest.schema.json`. This is the
 * *authoring* half of "publish as a chain pack" — the user downloads the
 * manifest and submits it via the PR-based registry flow (PUBLISHING.md);
 * the app never signs or pushes to the registry.
 *
 * The export is a degenerate (fully-bound, no `{{params.*}}`) chain — a
 * runnable starting point. The user parameterizes + renames the
 * `community.local.*` placeholder name before submitting.
 */

import { serializeWithIdMap } from './serialize.js';
import type { SavedWorkflow } from './workflow.js';

interface FragmentNode {
  id: string;
  typeId: string;
  name?: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}
interface FragmentEdge { from: string; to: string }
interface WorkflowChain {
  chainId: string;
  version: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  dag: { nodes: FragmentNode[]; edges?: FragmentEdge[] };
}
export interface ChainPackManifest {
  name: string;
  version: string;
  kind: 'workflow-chain';
  description: string;
  engines: { openwop: string };
  chains: WorkflowChain[];
}

/** Reverse-DNS-safe slug for the `community.local.<slug>` segment, which
 *  MUST match `[a-z][a-z0-9_-]*` (start with a lowercase letter). */
function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(s) ? s : `wf-${s || 'workflow'}`;
}

/**
 * Build the manifest. Reuses `serializeWithIdMap` for the canonical
 * node/edge shape + topological validation — so a graph with cycles,
 * orphans, or no nodes throws `SerializeError` (same as Run), and the
 * caller surfaces it.
 */
export function buildChainPackManifest(snap: SavedWorkflow): ChainPackManifest {
  const { definition, backendIdToBuilder } = serializeWithIdMap(snap);
  const builderById = new Map(snap.nodes.map((n) => [n.id, n]));

  const nodes: FragmentNode[] = definition.nodes.map((n) => {
    const builder = builderById.get(backendIdToBuilder[n.nodeId] ?? '');
    return {
      id: n.nodeId,
      typeId: n.typeId,
      ...(builder?.name ? { name: builder.name } : {}),
      ...(builder?.position ? { position: { ...builder.position } } : {}),
      ...(n.config && Object.keys(n.config).length > 0 ? { config: n.config } : {}),
    };
  });
  const edges: FragmentEdge[] = definition.edges.map((e) => ({ from: e.sourceNodeId, to: e.targetNodeId }));

  const slug = slugify(snap.name || 'workflow');
  const packName = `community.local.${slug}`;
  const label = snap.name || 'Workflow';

  return {
    name: packName,
    version: '1.0.0',
    kind: 'workflow-chain',
    description: `Workflow-chain pack exported from the OpenWOP builder: "${label}". Rename the community.local.* placeholder and add parameters before publishing.`,
    engines: { openwop: '^1.0.0' },
    chains: [
      {
        chainId: packName,
        version: '1.0.0',
        label,
        description: `Builder export of "${label}". Fully bound (no {{params.*}}) — parameterize as needed.`,
        parameters: {},
        dag: { nodes, ...(edges.length > 0 ? { edges } : {}) },
      },
    ],
  };
}
