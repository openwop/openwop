/**
 * Builder state. One zustand store per BuilderTab mount.
 *
 * Holds the graph (nodes/edges), the currently selected node, and a
 * fixed-depth snapshot stack for undo/redo. Persists the active
 * workflow's nodes/edges to localStorage on every change (debounced
 * implicitly by react batching).
 *
 * v1 undo strategy: deep-copy snapshots of {nodes, edges} on every
 * mutation, capped at HISTORY_MAX. Cheap at <100 nodes; revisit if
 * users hit the cap.
 */

import { create } from 'zustand';
import type { RunEventDoc } from '@openwop/openwop';
import type { BuilderEdge, BuilderNode, SavedWorkflow } from '../schema/workflow.js';
import { catalogEntry, defaultConfigFor } from '../palette/catalogRegistry.js';
import { upsertSavedWorkflow } from '../persistence/localStore.js';

const HISTORY_MAX = 30;

interface Snapshot {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

/** Per-node live status painted onto the canvas during a run overlay. */
export type NodeRunStatus = 'running' | 'completed' | 'failed' | 'suspended';

/** Terminal status of the overlaid run itself, for the canvas banner. */
export type OverlayRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunOverlay {
  runId: string;
  /** Backend node.nodeId → builder BuilderNode.id, from serializeWithIdMap. */
  backendIdToBuilder: Record<string, string>;
  /** builder BuilderNode.id → live status. */
  nodeStatus: Record<string, NodeRunStatus>;
  runStatus: OverlayRunStatus;
}

export interface BuilderState {
  workflowId: string;
  name: string;
  defaultInputs: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  past: Snapshot[];
  future: Snapshot[];

  /** Live run overlay. Null when no run is being watched. Ephemeral —
   *  never snapshotted (undo/redo) or persisted to localStorage. */
  overlay: RunOverlay | null;

  loadFromSaved(wf: SavedWorkflow): void;
  setName(name: string): void;
  setDefaultInputs(value: string): void;
  selectNode(id: string | null): void;
  selectEdge(id: string | null): void;
  addNode(kind: string, position: { x: number; y: number }): string;
  updateNode(id: string, patch: Partial<Pick<BuilderNode, 'name' | 'position' | 'config'>>): void;
  removeNode(id: string): void;
  addEdge(edge: Omit<BuilderEdge, 'id'>): void;
  updateEdge(id: string, patch: Partial<Omit<BuilderEdge, 'id' | 'source' | 'target' | 'sourcePort' | 'targetPort'>>): void;
  removeEdge(id: string): void;
  undo(): void;
  redo(): void;
  snapshot(): SavedWorkflow;
  persist(): void;

  /** Begin painting a run onto the canvas. Resets any prior overlay. */
  startOverlay(runId: string, backendIdToBuilder: Record<string, string>): void;
  /** Fold a single run event into the overlay's per-node status. */
  applyRunEvent(ev: RunEventDoc): void;
  /** Clear the overlay (run finished + user dismissed, or new edit). */
  clearOverlay(): void;
}

function clone(s: { nodes: BuilderNode[]; edges: BuilderEdge[] }): Snapshot {
  return {
    nodes: s.nodes.map((n) => ({ ...n, position: { ...n.position }, config: { ...n.config } })),
    edges: s.edges.map((e) => ({ ...e })),
  };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workflowId: '',
  name: 'Untitled workflow',
  defaultInputs: '{}',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  past: [],
  future: [],
  overlay: null,

  loadFromSaved(wf) {
    set({
      workflowId: wf.id,
      name: wf.name,
      defaultInputs: wf.defaultInputs ?? '{}',
      nodes: wf.nodes.map((n) => ({ ...n, position: { ...n.position }, config: { ...n.config } })),
      edges: wf.edges.map((e) => ({ ...e })),
      selectedNodeId: null,
      past: [],
      future: [],
      overlay: null,
    });
  },

  setName(name) {
    set({ name });
    get().persist();
  },

  setDefaultInputs(value) {
    set({ defaultInputs: value });
    get().persist();
  },

  selectNode(id) {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },

  selectEdge(id) {
    set({ selectedEdgeId: id, selectedNodeId: null });
  },

  addNode(kind, position) {
    const entry = catalogEntry(kind);
    if (!entry) return '';
    const id = `n_${crypto.randomUUID().slice(0, 8)}`;
    const node: BuilderNode = {
      id,
      kind: entry.kind,
      name: entry.label,
      position,
      config: defaultConfigFor(kind),
    };
    pushHistory(set, get);
    set({ nodes: [...get().nodes, node], selectedNodeId: id });
    get().persist();
    return id;
  },

  updateNode(id, patch) {
    pushHistory(set, get);
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.position !== undefined ? { position: patch.position } : {}),
              ...(patch.config !== undefined ? { config: patch.config } : {}),
            }
          : n,
      ),
    });
    get().persist();
  },

  removeNode(id) {
    pushHistory(set, get);
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
    get().persist();
  },

  addEdge(edge) {
    // Reject duplicates and self-loops.
    if (edge.source === edge.target) return;
    const exists = get().edges.some(
      (e) =>
        e.source === edge.source &&
        e.target === edge.target &&
        e.sourcePort === edge.sourcePort &&
        e.targetPort === edge.targetPort,
    );
    if (exists) return;
    pushHistory(set, get);
    set({
      edges: [
        ...get().edges,
        { id: `e_${crypto.randomUUID().slice(0, 8)}`, ...edge },
      ],
    });
    get().persist();
  },

  updateEdge(id, patch) {
    pushHistory(set, get);
    set({
      edges: get().edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
    get().persist();
  },

  removeEdge(id) {
    pushHistory(set, get);
    set({
      edges: get().edges.filter((e) => e.id !== id),
      selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId,
    });
    get().persist();
  },

  undo() {
    const past = get().past;
    if (past.length === 0) return;
    const prev = past[past.length - 1]!;
    const current = clone({ nodes: get().nodes, edges: get().edges });
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      past: past.slice(0, -1),
      future: [current, ...get().future].slice(0, HISTORY_MAX),
    });
    get().persist();
  },

  redo() {
    const future = get().future;
    if (future.length === 0) return;
    const next = future[0]!;
    const current = clone({ nodes: get().nodes, edges: get().edges });
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: [...get().past, current].slice(-HISTORY_MAX),
      future: future.slice(1),
    });
    get().persist();
  },

  snapshot() {
    const s = get();
    return {
      id: s.workflowId,
      name: s.name,
      version: '1.0.0',
      nodes: s.nodes,
      edges: s.edges,
      defaultInputs: s.defaultInputs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  persist() {
    const s = get();
    if (!s.workflowId) return;
    upsertSavedWorkflow({
      id: s.workflowId,
      name: s.name,
      version: '1.0.0',
      nodes: s.nodes,
      edges: s.edges,
      defaultInputs: s.defaultInputs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },

  startOverlay(runId, backendIdToBuilder) {
    set({
      overlay: { runId, backendIdToBuilder, nodeStatus: {}, runStatus: 'running' },
    });
  },

  applyRunEvent(ev) {
    const overlay = get().overlay;
    if (!overlay || ev.runId !== overlay.runId) return;
    // Run-level terminal transitions update the banner status.
    if (ev.type === 'run.completed') { set({ overlay: { ...overlay, runStatus: 'completed' } }); return; }
    if (ev.type === 'run.failed') { set({ overlay: { ...overlay, runStatus: 'failed' } }); return; }
    if (ev.type === 'run.cancelled') { set({ overlay: { ...overlay, runStatus: 'cancelled' } }); return; }
    // Node-level transitions paint individual nodes.
    if (!ev.nodeId) return;
    const builderId = overlay.backendIdToBuilder[ev.nodeId];
    if (!builderId) return;
    const next: NodeRunStatus | null =
      ev.type === 'node.started' ? 'running'
      : ev.type === 'node.completed' ? 'completed'
      : ev.type === 'node.failed' ? 'failed'
      : ev.type === 'node.suspended' ? 'suspended'
      : ev.type === 'node.interrupt.resolved' ? 'running'
      : null;
    if (!next) return;
    set({ overlay: { ...overlay, nodeStatus: { ...overlay.nodeStatus, [builderId]: next } } });
  },

  clearOverlay() {
    set({ overlay: null });
  },
}));

function pushHistory(
  set: (partial: Partial<BuilderState>) => void,
  get: () => BuilderState,
): void {
  const current = clone({ nodes: get().nodes, edges: get().edges });
  set({ past: [...get().past, current].slice(-HISTORY_MAX), future: [] });
}
