/**
 * BYOK provider taxonomy. Adding a 4th provider = adding a row here +
 * wiring the dispatcher in `apps/workflow-engine/backend/typescript/src/providers/dispatch.ts`.
 *
 * Trust signals (badge colors) borrowed from MyndHyve's BYOKPanel.tsx
 * provider taxonomy.
 */

export type ProviderId = 'anthropic' | 'openai';

export interface ProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  capabilities: readonly ('text' | 'vision' | 'tools' | 'structured')[];
  /** Approximate USD per 1K tokens — input / output. For informational display only. */
  cost?: { input: number; output: number };
  recommended?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** Brand color for the provider badge (40×40px circle, first-letter avatar). */
  badgeColor: string;
  /** One-line description shown under the name on the wizard card. */
  description: string;
  /** Placeholder for the API key input (e.g., "sk-ant-…"). */
  apiKeyPlaceholder: string;
  /** Helper text shown beneath the key input. */
  apiKeyHelpText: string;
  /** Where the user gets a key. Rendered as a "Get key" link. */
  apiKeyConsoleUrl: string;
  /** Models offered. First item with `recommended: true` is the default. */
  models: readonly ProviderModel[];
  /** Inferred convention: `sk-ant-` for Anthropic, `sk-` for OpenAI. Used for soft validation. */
  apiKeyPrefix?: string;
}

export const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    badgeColor: '#cc785c',
    description: 'Claude 4 family. Strong reasoning, tool use, long context.',
    apiKeyPlaceholder: 'sk-ant-…',
    apiKeyHelpText: 'Your key stays in the sample BE\'s in-memory map. Real deploys swap for KMS.',
    apiKeyConsoleUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyPrefix: 'sk-ant-',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', contextWindow: 200_000, capabilities: ['text', 'tools', 'vision'], cost: { input: 0.003, output: 0.015 }, recommended: true },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', contextWindow: 200_000, capabilities: ['text', 'tools', 'vision'], cost: { input: 0.015, output: 0.075 } },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextWindow: 200_000, capabilities: ['text', 'tools'], cost: { input: 0.0008, output: 0.004 } },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    badgeColor: '#10a37f',
    description: 'GPT-4 family. Broad ecosystem support.',
    apiKeyPlaceholder: 'sk-…',
    apiKeyHelpText: 'Your key stays in the sample BE\'s in-memory map. Real deploys swap for KMS.',
    apiKeyConsoleUrl: 'https://platform.openai.com/api-keys',
    apiKeyPrefix: 'sk-',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128_000, capabilities: ['text', 'tools', 'vision'], cost: { input: 0.00015, output: 0.0006 }, recommended: true },
      { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000, capabilities: ['text', 'tools', 'vision'], cost: { input: 0.0025, output: 0.01 } },
    ],
  },
];

export function getProvider(id: ProviderId): ProviderConfig {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
