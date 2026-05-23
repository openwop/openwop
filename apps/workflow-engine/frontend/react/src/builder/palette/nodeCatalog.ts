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
   *  hand-author. 'checkbox' renders a boolean toggle.
   *  'prompt-picker' stores a stringy PromptRef (`prompt:templateId@version`)
   *  per RFC 0027 and renders a dropdown sourced from the prompt library.
   *  'credential-picker' stores a credentialRef (e.g., `anthropic:prod`)
   *  and renders a dropdown sourced from `listStoredRefs()` filtered by
   *  the optional `credentialProvider` constraint. */
  kind:
    | 'text'
    | 'number'
    | 'textarea'
    | 'checkbox'
    | 'prompt-picker'
    | 'credential-picker'
    | 'provider-picker'
    | 'model-picker';
  placeholder?: string;
  /** Default value used when a node of this kind is created. */
  defaultValue?: string | number | boolean;
  /** Help text shown beneath the input. */
  help?: string;
  /** When true, the inspector marks the field as required. */
  required?: boolean;
  /** For `kind: 'prompt-picker'`, constrains the picker to a single
   *  PromptTemplate kind (`system` / `user` / `few-shot` / `schema-hint`).
   *  Omitted = no filter. */
  promptKind?: 'system' | 'user' | 'few-shot' | 'schema-hint';
  /** For `kind: 'credential-picker'`, constrains the picker to refs
   *  whose `<provider>:` prefix matches. Omitted = show all refs. */
  credentialProvider?: string;
  /** For `kind: 'model-picker'` and `kind: 'credential-picker'`, names
   *  the SIBLING configField whose value drives the available options.
   *  Example: a `model-picker` with `dependsOn: 'provider'` reads
   *  `siblingConfig.provider` and only shows that provider's models.
   *  When the dependency-source field changes, the Inspector clears
   *  this field's value so a stale selection doesn't survive. */
  dependsOn?: string;
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
  /** Accent color used on the node's category stripe. Should be a CSS
   *  variable reference or an OKLCH literal so it themes with the
   *  warm-editorial palette per DESIGN.app.md §10. */
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
  /** RFC 0031 §B. MODEL capabilities this node needs the active model to
   *  advertise in `capabilities.modelCapabilities.advertised[]`. Empty /
   *  absent = no model-capability requirements. Used by the Inspector
   *  to surface a gap chip when the host's modelCapabilities advertisement
   *  doesn't cover the required set; the host's runtime dispatch will
   *  either substitute (RFC 0031 §B step 3) or refuse with
   *  `model.capability.insufficient` (step 4). */
  requiredModelCapabilities?: readonly string[];
}

// ─── Catalog defaults discipline ──────────────────────────────────────
//
// Several `prompt-picker` configFields below set `defaultValue` to a
// specific prompt-library template ID (e.g., 'writer-system',
// 'chat-assistant-system'). When a user drags a fresh node from the
// palette, `defaultConfigFor()` in catalogRegistry.ts materializes
// these defaults into the new node's config.
//
// IMPORTANT: every `defaultValue` string that points at a prompt
// template MUST match a real `templateId` in
// `apps/workflow-engine/frontend/react/src/prompts/samplePrompts.ts`
// (or whatever prompt library the host advertises). If the library
// drops or renames a template, every fresh node arrives pointing at
// a dead ref — the prompt-picker will show "unknown" silently.
//
// Current bindings:
//   mock-ai.systemPromptRef  → 'writer-system'
//   mock-ai.userPromptRef    → 'writer-user'
//   chat.systemPromptRef     → 'chat-assistant-system'
//
// A build-time check at `scripts/check-prompt-ref-defaults.mjs`
// asserts every defaultValue exists in the prompt library so a stale
// binding fails CI rather than silently breaking the palette.
export const NODE_CATALOG: readonly NodeCatalogEntry[] = [
  {
    kind: 'noop',
    typeId: 'core.noop',
    label: 'Pass-through',
    description: 'Forwards inputs unchanged to outputs. Useful as a placeholder.',
    category: 'flow',
    badge: 'P',
    accent: 'var(--ink-3)',
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
    accent: 'var(--clay)',
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
    accent: 'var(--color-success)',
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
    accent: 'var(--color-warning)',
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
    // mock-ai deliberately has no provider/model configFields — it's a
    // deterministic local node, not a real LLM dispatch. Adding those
    // fields would be misleading UX (the values would be ignored at
    // run time). Only prompt-picker fields appear, demonstrating the
    // RFC 0027 prompt-ref wire shape end-to-end without an LLM call.
    kind: 'mock-ai',
    typeId: 'local.sample.demo.mock-ai',
    label: 'Mock AI',
    description: 'Returns a deterministic mock completion for inputs.prompt. No external calls.',
    category: 'ai',
    badge: 'M',
    accent: 'var(--color-ai)',
    inputs: [{ name: 'prompt', type: 'string' }],
    outputs: [{ name: 'completion', type: 'string' }],
    configFields: [
      {
        key: 'systemPromptRef',
        label: 'System prompt',
        kind: 'prompt-picker',
        promptKind: 'system',
        // Demo-ready default — fresh mock-ai nodes drop onto the canvas
        // with a sensible writer system prompt instead of an empty slot.
        defaultValue: 'writer-system',
        help: 'PromptRef per RFC 0027. The mock node logs resolution at dispatch but doesn\'t call an LLM. Real AI nodes (chat) resolve and compose the same refs server-side.',
      },
      {
        key: 'userPromptRef',
        label: 'User prompt template',
        kind: 'prompt-picker',
        promptKind: 'user',
        defaultValue: 'writer-user',
        help: 'PromptRef per RFC 0027. Variables interpolate from inputs at dispatch time once the host advertises capabilities.prompts.supported.',
      },
    ],
  },
  {
    kind: 'chat',
    typeId: 'vendor.openwop-sample.chat-responder',
    label: 'Chat (real provider)',
    description: 'Calls a real LLM via BYOK. Expects inputs.messages and inputs.credentialRef.',
    category: 'ai',
    badge: 'C',
    accent: 'var(--color-ai)',
    inputs: [{ name: 'messages', type: 'object' }],
    outputs: [{ name: 'completion', type: 'string' }],
    // ConfigField order is UX-driven: provider first so the picker
    // reads top-to-bottom; model/credentialRef below since they
    // semantically depend on provider. The `dependsOn` lookup
    // resolves against the same node.config object regardless of
    // catalog order — render-order is not load-bearing.
    //
    // The backend chat-responder reads `provider`/`model`/`credentialRef`
    // from config FIRST and falls back to inputs (see
    // `sampleChatResponderNode` in nodes.ts).
    configFields: [
      {
        key: 'provider',
        label: 'Provider',
        kind: 'provider-picker',
        help: 'Which LLM provider this node calls. Determines the model + credential candidates below.',
      },
      {
        key: 'model',
        label: 'Model',
        kind: 'model-picker',
        dependsOn: 'provider',
        help: 'Specific model id from the chosen provider. Cleared when the provider changes.',
      },
      {
        key: 'credentialRef',
        label: 'API key',
        kind: 'credential-picker',
        dependsOn: 'provider',
        help: 'Which stored key this node uses to call the LLM. Manage keys at /keys. Filtered to keys matching the chosen provider.',
      },
      {
        key: 'systemPromptRef',
        label: 'System prompt',
        kind: 'prompt-picker',
        promptKind: 'system',
        defaultValue: 'chat-assistant-system',
        help: 'PromptRef per RFC 0027. Resolved + prepended to the messages array server-side before the LLM dispatch.',
      },
      {
        key: 'userPromptRef',
        label: 'User prompt template',
        kind: 'prompt-picker',
        promptKind: 'user',
        help: 'Optional. When set, the resolved template wraps the most-recent user message at dispatch time.',
      },
    ],
    requiredModelCapabilities: ['structured-output'],
  },
];

