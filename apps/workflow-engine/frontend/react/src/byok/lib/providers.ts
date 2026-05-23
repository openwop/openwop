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
  /** Provider exposes native web-search tool the dispatcher can flip on. */
  webSearch?: boolean;
  /** Model accepts raw audio input as a content part (no separate STT). */
  audioInput?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** Brand color for the provider badge (40×40px circle, first-letter avatar). */
  badgeColor: string;
  /** One-line description shown under the name on the wizard card. */
  description: string;
  /** Managed providers run on a server-held key. The BYOK wizard skips
   *  the model picker + key entry steps; clicking the tile triggers
   *  sign-in (if anon) or directly activates the provider (if authed).
   *  apiKey* / customModel* fields below are not required when managed. */
  managed?: boolean;
  /** Hidden providers are NOT rendered in the BYOK wizard tile list and
   *  are NOT pickable directly by the user. They still live in
   *  providers.json so the backend can read their capability surface
   *  (model list, structured-output / tools / vision flags, costs) —
   *  e.g., MiniMax sits behind the "Try it free" managed entry: it's
   *  the real underlying provider, but we don't want users to pick it
   *  by name because the steward is paying for it. */
  hidden?: boolean;
  /** Hint shown beneath a managed-provider tile to signed-out users
   *  (e.g., "Sign in to use"). Ignored for non-managed providers. */
  signedInHint?: string;
  /** Placeholder for the API key input (e.g., "sk-ant-…"). Required for non-managed providers. */
  apiKeyPlaceholder?: string;
  /** Helper text shown beneath the key input. Required for non-managed providers. */
  apiKeyHelpText?: string;
  /** Where the user gets a key. Rendered as a "Get key" link. Required for non-managed providers. */
  apiKeyConsoleUrl?: string;
  /** Soft validation prefix — used for the "Anthropic keys usually start with…" warning. */
  apiKeyPrefix?: string;
  /** Placeholder for the "Other…" custom-model input. */
  customModelPlaceholder?: string;
  /** Helper text shown under the "Other…" custom-model input. */
  customModelHelp?: string;
  models: readonly ProviderModel[];
}

interface ProvidersDocument {
  providers: ProviderConfig[];
}

/**
 * Runtime validator for providers.json. Fails loud at module load if
 * anyone edits the JSON and breaks the shape — better than silent
 * `undefined`/`NaN` rendering in the wizard.
 *
 * Narrow on purpose: checks fields the wizard renders + dispatches on.
 * JSON-only meta fields (`_comment`, `_schemaVersion`, `_docsUrl`,
 * `_notes`) are ignored.
 */
function validateProvidersDocument(raw: unknown): ProvidersDocument {
  if (!raw || typeof raw !== 'object' || !('providers' in raw)) {
    throw new Error('providers.json: missing top-level `providers` array');
  }
  const providers = (raw as { providers: unknown }).providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('providers.json: `providers` MUST be a non-empty array');
  }
  for (const p of providers) assertProviderShape(p);
  return { providers: providers as ProviderConfig[] };
}

function assertProviderShape(p: unknown): asserts p is ProviderConfig {
  if (!p || typeof p !== 'object') throw new Error('providers.json: each provider MUST be an object');
  const rec = p as Record<string, unknown>;
  const managed = rec.managed === true;
  const alwaysRequired = ['id', 'label', 'badgeColor', 'description'] as const;
  const byokOnlyRequired = ['apiKeyPlaceholder', 'apiKeyHelpText', 'apiKeyConsoleUrl'] as const;
  const required = managed ? alwaysRequired : [...alwaysRequired, ...byokOnlyRequired];
  for (const field of required) {
    if (typeof rec[field] !== 'string' || (rec[field] as string).length === 0) {
      throw new Error(`providers.json: provider missing string field \`${field}\` (got ${typeof rec[field]})`);
    }
  }
  if (!Array.isArray(rec.models) || rec.models.length === 0) {
    throw new Error(`providers.json: provider \`${String(rec.id)}\` MUST have a non-empty models array`);
  }
  for (const m of rec.models as unknown[]) {
    if (!m || typeof m !== 'object') throw new Error('providers.json: each model MUST be an object');
    const mrec = m as Record<string, unknown>;
    if (typeof mrec.id !== 'string' || typeof mrec.label !== 'string') {
      throw new Error(`providers.json: model in \`${String(rec.id)}\` missing id/label strings`);
    }
    if (typeof mrec.contextWindow !== 'number' || mrec.contextWindow < 0) {
      throw new Error(`providers.json: model \`${String(mrec.id)}\` MUST have a non-negative contextWindow number`);
    }
    if (!Array.isArray(mrec.capabilities)) {
      throw new Error(`providers.json: model \`${String(mrec.id)}\` MUST have a capabilities array`);
    }
  }
}

const validated = validateProvidersDocument(providersData);
export const PROVIDERS: readonly ProviderConfig[] = validated.providers;

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
