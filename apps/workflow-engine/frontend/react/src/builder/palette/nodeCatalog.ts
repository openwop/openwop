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
    | 'select'
    | 'prompt-picker'
    | 'credential-picker'
    | 'provider-picker'
    | 'model-picker';
  placeholder?: string;
  /** For `kind: 'select'` (e.g. a JSON-Schema `enum`), the allowed
   *  values rendered as a dropdown. */
  options?: readonly { value: string; label: string }[];
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
    kind: 'chat',
    typeId: 'vendor.openwop-sample.chat-responder',
    label: 'AI (LLM)',
    description: 'Calls a real LLM. Defaults to the managed openwop-free tile; pick a stored key in the Inspector to use your own provider.',
    category: 'ai',
    badge: 'AI',
    accent: 'var(--color-ai)',
    inputs: [
      { name: 'prompt', type: 'string' },
      { name: 'messages', type: 'object' },
    ],
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
        key: 'systemPrompt',
        label: 'System prompt',
        kind: 'textarea',
        help: 'Plain text shown to the LLM as the system role. Takes precedence over the PromptRef below.',
      },
      {
        key: 'systemPromptRef',
        label: 'System prompt (template)',
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

