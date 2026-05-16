/**
 * BYOK provider taxonomy. The data lives in the sibling JSON file at
 * `apps/workflow-engine/providers.json` — both the BE
 * (`src/bootstrap/nodes.ts` default-fallback) and this FE read from
 * the same source. Edit the JSON to add/remove providers or models;
 * the types in this file are pure structure for type-safety.
 *
 * Vite inlines JSON at build time so the import is free at runtime.
 */

import providersData from '../../../../../providers.json';

export type ProviderId = string;

export interface ProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  capabilities: readonly ('text' | 'vision' | 'tools' | 'structured')[];
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
  /** Soft validation prefix — used for the "Anthropic keys usually start with…" warning. */
  apiKeyPrefix?: string;
  /** Placeholder for the "Other…" custom-model input. */
  customModelPlaceholder?: string;
  /** Helper text shown under the "Other…" custom-model input. */
  customModelHelp?: string;
  models: readonly ProviderModel[];
}

// Strip the JSON-only meta fields (_comment / _schemaVersion / _docsUrl
// / _notes) — they're hints for whoever edits providers.json, not
// runtime data. The JSON's shape past those keys matches ProviderConfig.
const raw = providersData as unknown as { providers: ProviderConfig[] };
export const PROVIDERS: readonly ProviderConfig[] = raw.providers;

export function getProvider(id: ProviderId): ProviderConfig {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** Return the recommended default model for a provider (first `recommended: true`, else first model). */
export function getDefaultModel(providerId: ProviderId): ProviderModel | null {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return p.models.find((m) => m.recommended) ?? p.models[0] ?? null;
}
