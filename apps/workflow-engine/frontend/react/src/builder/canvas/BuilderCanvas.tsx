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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// builder mounts (paste into a different workflow works). Holds each
// copied node's kind/name/config plus its offset (dx/dy) from the
// selection's top-left, so a multi-node paste preserves relative layout.
type ClipboardEntry = { kind: string; name: string; config: Record<string, unknown>; dx: number; dy: number };
let nodeClipboard: ClipboardEntry[] | null = null;

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
  const selectedNodeIds = useBuilderStore((s) => s.selectedNodeIds);
  const overlay = useBuilderStore((s) => s.overlay);
  const addNode = useBuilderStore((s) => s.addNode);
  const moveNodes = useBuilderStore((s) => s.moveNodes);
  const removeNodes = useBuilderStore((s) => s.removeNodes);
  const addEdge = useBuilderStore((s) => s.addEdge);
  const removeEdge = useBuilderStore((s) => s.removeEdge);
  const setSelection = useBuilderStore((s) => s.setSelection);
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

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
      const ids = st.selectedNodeIds;
      const primary = st.selectedNodeId ? st.nodes.find((n) => n.id === st.selectedNodeId) ?? null : null;
      const OFFSET = 32;
      if (key === 'd' && ids.length > 0) {
        e.preventDefault();
        st.cloneNodes(ids); // group-aware duplicate (1+ nodes)
      } else if (key === 'c' && ids.length > 0) {
        e.preventDefault();
        // Copy the whole selection, storing each node's offset from the
        // selection's top-left so paste can reconstruct the layout.
        const sel = st.nodes.filter((n) => ids.includes(n.id));
        const minX = Math.min(...sel.map((n) => n.position.x));
        const minY = Math.min(...sel.map((n) => n.position.y));
        nodeClipboard = sel.map((n) => ({
          kind: n.kind,
          name: n.name,
          config: { ...n.config },
          dx: n.position.x - minX,
          dy: n.position.y - minY,
        }));
      } else if (key === 'v' && nodeClipboard && nodeClipboard.length > 0) {
        e.preventDefault();
        // Anchor the paste near the primary node if one is selected, else a
        // fixed spot. The whole group shifts together by `OFFSET`.
        const anchor = primary
          ? { x: primary.position.x + OFFSET, y: primary.position.y + OFFSET }
          : { x: 160, y: 160 };
        st.pasteNodes(nodeClipboard, anchor);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Measured node dimensions, captured from xyflow's `dimensions` changes (see
  // onNodesChange). We feed these back onto the controlled nodes as width/height
  // so downstream consumers that read node size — notably the <MiniMap>, which
  // draws each blip from `measured?.width ?? width` — have dimensions to draw.
  // Without this, the controlled nodes carry no size and the minimap renders an
  // empty viewport box with no node blips.
  const [nodeDims, setNodeDims] = useState<Record<string, { width: number; height: number }>>({});

  const rfNodes: Node[] = useMemo(
    () =>
      builderNodes.map((n) => ({
        id: n.id,
        type: 'builder',
        position: n.position,
        data: { kind: n.kind, name: n.name, runStatus: overlay?.nodeStatus[n.id] },
        selected: selectedSet.has(n.id),
        ...((d) => (d ? { width: d.width, height: d.height } : {}))(nodeDims[n.id]),
      })),
    [builderNodes, selectedSet, overlay, nodeDims],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      builderEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourcePort,
        targetHandle: e.targetPort,
        // Liveness: an edge whose target node is currently running carries the
        // marching-dash "data in flight" treatment (CSS .edge-running, §6).
        ...(overlay?.nodeStatus[e.target] === 'running' ? { className: 'edge-running' } : {}),
      })),
    [builderEdges, overlay],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Drive position + selection from xyflow events. Batch position and
      // remove changes so one gesture (group drag, group delete) is one
      // undo entry rather than one-per-node.
      const applied = applyNodeChanges(changes, rfNodes);
      let selectionChanged = false;
      const moves: { id: string; position: { x: number; y: number } }[] = [];
      const removals: string[] = [];
      const dimUpdates: Record<string, { width: number; height: number }> = {};
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          moves.push({ id: change.id, position: change.position });
        }
        if (change.type === 'select') selectionChanged = true;
        if (change.type === 'remove') removals.push(change.id);
        // Capture xyflow's measured dimensions so the minimap (and any size-
        // dependent consumer) has a box to draw. Stored, not pushed to the
        // builder store — it's a render concern, not part of the saved workflow.
        if (change.type === 'dimensions' && change.dimensions) {
          dimUpdates[change.id] = { width: change.dimensions.width, height: change.dimensions.height };
        }
      }
      if (moves.length > 0) moveNodes(moves);
      if (removals.length > 0) removeNodes(removals);
      if (Object.keys(dimUpdates).length > 0) {
        // Guard against a re-render loop: only update when a value actually
        // changed (feeding width/height back recomputes rfNodes, which could
        // otherwise re-fire identical dimensions every render).
        setNodeDims((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, d] of Object.entries(dimUpdates)) {
            const p = prev[id];
            if (!p || p.width !== d.width || p.height !== d.height) {
              next[id] = d;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      // Derive the FULL multi-selection from xyflow's applied state — this
      // handles single click, shift-click (add/remove), and box-select
      // (multiple select changes in one batch) uniformly.
      if (selectionChanged) {
        setSelection(applied.filter((n) => n.selected).map((n) => n.id));
      }
    },
    [rfNodes, moveNodes, removeNodes, setSelection],
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
    setSelection([]);
    selectEdge(null);
  }, [setSelection, selectEdge]);

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

  // Color each minimap blip with its node-kind accent so the overview is a
  // legible mini-map of the workflow (default xyflow node color is invisible
  // against the themed panel). Reads `data.kind` → catalog accent (a token
  // var), falling back to a neutral ink for unknown kinds.
  const miniMapNodeColor = useCallback((node: Node): string => {
    const kind = node.data?.['kind'];
    const accent = typeof kind === 'string' ? catalogEntry(kind)?.accent : undefined;
    return accent ?? 'var(--ink-2)';
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
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={miniMapNodeColor}
          nodeStrokeColor={miniMapNodeColor}
          nodeStrokeWidth={2}
          nodeBorderRadius={2}
        />
      </ReactFlow>
    </div>
  );
}
