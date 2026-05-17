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
import type { BuilderEdge, BuilderNode, SavedWorkflow } from '../schema/workflow.js';
import { catalogEntry, defaultConfigFor } from '../palette/catalogRegistry.js';
import { upsertSavedWorkflow } from '../persistence/localStore.js';

const HISTORY_MAX = 30;

interface Snapshot {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

export interface BuilderState {
  workflowId: string;
  name: string;
  defaultInputs: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;
  past: Snapshot[];
  future: Snapshot[];

  loadFromSaved(wf: SavedWorkflow): void;
  setName(name: string): void;
  setDefaultInputs(value: string): void;
  selectNode(id: string | null): void;
  addNode(kind: string, position: { x: number; y: number }): string;
  updateNode(id: string, patch: Partial<Pick<BuilderNode, 'name' | 'position' | 'config'>>): void;
  removeNode(id: string): void;
  addEdge(edge: Omit<BuilderEdge, 'id'>): void;
  removeEdge(id: string): void;
  undo(): void;
  redo(): void;
  snapshot(): SavedWorkflow;
  persist(): void;
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
  past: [],
  future: [],

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
    set({ selectedNodeId: id });
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

  removeEdge(id) {
    pushHistory(set, get);
    set({ edges: get().edges.filter((e) => e.id !== id) });
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
}));

function pushHistory(
  set: (partial: Partial<BuilderState>) => void,
  get: () => BuilderState,
): void {
  const current = clone({ nodes: get().nodes, edges: get().edges });
  set({ past: [...get().past, current].slice(-HISTORY_MAX), future: [] });
}
