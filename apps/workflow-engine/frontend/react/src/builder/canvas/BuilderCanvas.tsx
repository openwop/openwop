/**
 * xyflow canvas wired to the zustand builder store.
 *
 * - Converts BuilderNode/BuilderEdge → xyflow Node/Edge on render.
 * - Translates xyflow events (move, select, connect, delete) → store
 *   mutations.
 * - Handles HTML5 DnD from the palette: dataTransfer key
 *   "application/openwop-node-kind" carries the kind string.
 * - `isValidConnection` runs port-type compatibility before accepting
 *   an edge.
 * - During a live-run overlay, per-node status is fed into node data so
 *   BaseNode paints execution state.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useBuilderStore } from '../store/builderStore.js';
import { catalogEntry } from '../palette/catalogRegistry.js';
import { isPortCompatible } from './portCompatibility.js';
import { BaseNode } from './nodes/BaseNode.js';

const NODE_TYPES = { builder: BaseNode };
export const PALETTE_MIME = 'application/openwop-node-kind';

// In-canvas copy/paste clipboard — module-level so it survives across
// builder mounts (paste into a different workflow works). Holds the
// node's kind/name/config, not its id/position.
let nodeClipboard: { kind: string; name: string; config: Record<string, unknown> } | null = null;

export function BuilderCanvas() {
  return (
    <ReactFlowProvider>
      <BuilderCanvasInner />
    </ReactFlowProvider>
  );
}

function BuilderCanvasInner() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const builderNodes = useBuilderStore((s) => s.nodes);
  const builderEdges = useBuilderStore((s) => s.edges);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const overlay = useBuilderStore((s) => s.overlay);
  const addNode = useBuilderStore((s) => s.addNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const removeNode = useBuilderStore((s) => s.removeNode);
  const addEdge = useBuilderStore((s) => s.addEdge);
  const removeEdge = useBuilderStore((s) => s.removeEdge);
  const selectNode = useBuilderStore((s) => s.selectNode);

  // Canvas keyboard shortcuts: ⌘/Ctrl+D duplicate, ⌘/Ctrl+C copy,
  // ⌘/Ctrl+V paste the selected node. (Delete/Backspace is handled by
  // xyflow's built-in node-removal → onNodesChange 'remove'.) Reads the
  // store via getState() to avoid stale-closure deps; runs once.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      // Don't hijack copy/paste while the user is typing in a field
      // (inline node title, inspector inputs, etc.).
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v' && key !== 'd') return;
      const st = useBuilderStore.getState();
      const sel = st.selectedNodeId ? st.nodes.find((n) => n.id === st.selectedNodeId) ?? null : null;
      const OFFSET = 32;
      if (key === 'd' && sel) {
        e.preventDefault();
        st.cloneNode(sel, { x: sel.position.x + OFFSET, y: sel.position.y + OFFSET });
      } else if (key === 'c' && sel) {
        e.preventDefault();
        nodeClipboard = { kind: sel.kind, name: sel.name, config: { ...sel.config } };
      } else if (key === 'v' && nodeClipboard) {
        e.preventDefault();
        const pos = sel
          ? { x: sel.position.x + OFFSET, y: sel.position.y + OFFSET }
          : { x: 160, y: 160 };
        st.cloneNode(nodeClipboard, pos);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rfNodes: Node[] = useMemo(
    () =>
      builderNodes.map((n) => ({
        id: n.id,
        type: 'builder',
        position: n.position,
        data: { kind: n.kind, name: n.name, runStatus: overlay?.nodeStatus[n.id] },
        selected: n.id === selectedNodeId,
      })),
    [builderNodes, selectedNodeId, overlay],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      builderEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourcePort,
        targetHandle: e.targetPort,
      })),
    [builderEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Drive position + selection from xyflow events.
      const applied = applyNodeChanges(changes, rfNodes);
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          updateNode(change.id, { position: change.position });
        }
        if (change.type === 'select') {
          if (change.selected) selectNode(change.id);
          else if (selectedNodeId === change.id) selectNode(null);
        }
        if (change.type === 'remove') {
          removeNode(change.id);
        }
      }
      // applied is only used to satisfy xyflow's internal state expectations
      // when we drive selection — actual state lives in the zustand store.
      void applied;
    },
    [rfNodes, updateNode, removeNode, selectNode, selectedNodeId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          removeEdge(change.id);
        }
      }
    },
    [removeEdge],
  );

  const selectEdge = useBuilderStore((s) => s.selectEdge);
  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: Edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );
  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      addEdge({
        source: conn.source,
        target: conn.target,
        sourcePort: conn.sourceHandle,
        targetPort: conn.targetHandle,
      });
    },
    [addEdge],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const sourceNode = builderNodes.find((n) => n.id === conn.source);
      const targetNode = builderNodes.find((n) => n.id === conn.target);
      if (!sourceNode || !targetNode) return false;
      if (sourceNode.id === targetNode.id) return false;
      const sourceEntry = catalogEntry(sourceNode.kind);
      const targetEntry = catalogEntry(targetNode.kind);
      if (!sourceEntry || !targetEntry) return false;
      const sourcePort = sourceEntry.outputs.find((p) => p.name === conn.sourceHandle);
      const targetPort = targetEntry.inputs.find((p) => p.name === conn.targetHandle);
      if (!sourcePort || !targetPort) return false;
      return isPortCompatible(sourcePort.type, targetPort.type);
    },
    [builderNodes],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(PALETTE_MIME);
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="builder-canvas"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls position="bottom-right" />
        <MiniMap pannable zoomable position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
