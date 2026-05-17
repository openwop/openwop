/**
 * Palette catalog. One row per BuilderNodeKind. The `typeId` field is
 * the backend NodeModule id — see backend/.../bootstrap/nodes.ts for
 * registered modules. Adding a node type to the palette = adding a
 * row here + (optionally) a config-field block in Inspector.
 */

import type { BuilderNodeKind, NodeCategory, PortDef } from '../schema/workflow.js';

export interface ConfigField {
  key: string;
  label: string;
  /** Renders as the matching HTML control. 'textarea' is used for
   *  free-form text + any object/array JSON the user has to
   *  hand-author. 'checkbox' renders a boolean toggle. */
  kind: 'text' | 'number' | 'textarea' | 'checkbox';
  placeholder?: string;
  /** Default value used when a node of this kind is created. */
  defaultValue?: string | number | boolean;
  /** Help text shown beneath the input. */
  help?: string;
  /** When true, the inspector marks the field as required. */
  required?: boolean;
}

export interface NodeCatalogEntry {
  kind: BuilderNodeKind;
  /** Backend NodeModule typeId. */
  typeId: string;
  label: string;
  description: string;
  category: NodeCategory;
  /** Single-letter badge shown in palette + node header. */
  badge: string;
  /** Accent color used on the node's category stripe. */
  accent: string;
  inputs: PortDef[];
  outputs: PortDef[];
  configFields: ConfigField[];
  /** Pack name (e.g., `core.openwop.flow`) when the node comes from a pack
   *  manifest. Absent for host-local nodes. Used by the palette to render
   *  collapsible pack sub-sections. */
  packName?: string;
  /** Host surfaces the node's runtime needs (e.g. `host.kvStorage`).
   *  Absent or empty for pure data/control/flow nodes. */
  requiresHostSurfaces?: readonly string[];
  /** Subset of `requiresHostSurfaces` THIS host doesn't advertise.
   *  Non-empty means dragging the node onto the canvas still works,
   *  but executing it will fail with HOST_CAPABILITY_MISSING. Server-
   *  computed so the client doesn't have to cross-reference advertising. */
  missingHostSurfaces?: readonly string[];
}

export const NODE_CATALOG: readonly NodeCatalogEntry[] = [
  {
    kind: 'noop',
    typeId: 'core.noop',
    label: 'Pass-through',
    description: 'Forwards inputs unchanged to outputs. Useful as a placeholder.',
    category: 'flow',
    badge: 'P',
    accent: '#8b93a7',
    inputs: [{ name: 'in', type: 'any' }],
    outputs: [{ name: 'out', type: 'any' }],
    configFields: [],
  },
  {
    kind: 'delay',
    typeId: 'core.delay',
    label: 'Delay',
    description: 'Sleeps for a fixed duration, then forwards inputs.',
    category: 'flow',
    badge: 'D',
    accent: '#5b8cff',
    inputs: [{ name: 'in', type: 'any' }],
    outputs: [{ name: 'out', type: 'any' }],
    configFields: [
      {
        key: 'durationMs',
        label: 'Duration (ms)',
        kind: 'number',
        defaultValue: 500,
        help: 'Clamped to 0–60000 by the backend.',
      },
    ],
  },
  {
    kind: 'uppercase',
    typeId: 'local.sample.demo.uppercase',
    label: 'Uppercase',
    description: 'Reads inputs.text and emits outputs.text uppercased.',
    category: 'data',
    badge: 'U',
    accent: '#4ade80',
    inputs: [{ name: 'text', type: 'string' }],
    outputs: [{ name: 'text', type: 'string' }],
    configFields: [],
  },
  {
    kind: 'approval',
    typeId: 'core.approvalGate',
    label: 'Approval Gate',
    description: 'Suspends the run for human approval. Resumes on resolve.',
    category: 'control',
    badge: 'A',
    accent: '#fbbf24',
    inputs: [{ name: 'in', type: 'any' }],
    outputs: [{ name: 'out', type: 'any' }],
    configFields: [
      {
        key: 'prompt',
        label: 'Prompt shown to approver',
        kind: 'textarea',
        defaultValue: 'Please approve to continue.',
      },
    ],
  },
  {
    kind: 'mock-ai',
    typeId: 'local.sample.demo.mock-ai',
    label: 'Mock AI',
    description: 'Returns a deterministic mock completion for inputs.prompt. No external calls.',
    category: 'ai',
    badge: 'M',
    accent: '#a78bfa',
    inputs: [{ name: 'prompt', type: 'string' }],
    outputs: [{ name: 'completion', type: 'string' }],
    configFields: [],
  },
  {
    kind: 'chat',
    typeId: 'local.sample.chat.responder',
    label: 'Chat (real provider)',
    description: 'Calls a real LLM via BYOK. Expects inputs.messages and inputs.credentialRef.',
    category: 'ai',
    badge: 'C',
    accent: '#f87171',
    inputs: [{ name: 'messages', type: 'object' }],
    outputs: [{ name: 'completion', type: 'string' }],
    configFields: [],
  },
];

