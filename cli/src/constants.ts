/** Static CLI constants — version, default endpoints, provider + host catalogs. Leaf module. */

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'http://localhost:8080';
// Canonical signed node-pack registry. Distinct from the host --base-url
// (the workflow-engine demo): the demo only knows its in-process nodes and
// returns 404 for tarballs, whereas the file-backed registry at this URL
// serves the full catalog + signed .tgz + .sig + public keys. Overridable
// per `packs` command via --registry-url or OPENWOP_REGISTRY_URL.
export const DEFAULT_REGISTRY_URL = 'https://packs.openwop.dev';
export const DEFAULT_API_KEY = 'sample-token';
export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// Provider catalog — mirrors the four backend dispatchers in
// `apps/workflow-engine/backend/typescript/src/providers/dispatch.ts`.
// Adding a provider here requires backend support; this is not a free-form
// list. `envVar` is the conventional env var the wizard auto-detects.
export const PROVIDER_CATALOG = {
  anthropic: {
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-7', label: 'claude-opus-4-7 (most capable)' },
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 (balanced)', recommended: true },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5 (fastest)' },
    ],
  },
  openai: {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', label: 'gpt-4o (most capable)', recommended: true },
      { id: 'gpt-4-turbo', label: 'gpt-4-turbo' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (fastest)' },
    ],
  },
  google: {
    label: 'Google (Gemini)',
    envVar: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash (balanced)', recommended: true },
      { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    ],
  },
  minimax: {
    label: 'MiniMax',
    envVar: 'MINIMAX_API_KEY',
    models: [
      { id: 'minimax-text-01', label: 'minimax-text-01', recommended: true },
    ],
  },
};

// Host presets surfaced as the first onboarding choice. `url` is what gets
// written to the config; `label` is what the user sees. The "custom" option
// is appended at prompt time.
export const HOST_PRESETS = [
  { key: 'shared', label: 'Shared demo at https://app.openwop.dev/api (recommended for trying things out)', url: 'https://app.openwop.dev/api' },
  { key: 'local', label: 'Local demo at http://localhost:8080 (run `openwop demo start` to launch)', url: 'http://localhost:8080' },
];
