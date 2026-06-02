/**
 * Resolve an agent's `modelClass` to a concrete `(provider, model)` for a live
 * dispatch turn.
 *
 * A manifest agent declares a `modelClass` (`chat | reasoning | coding |
 * extraction`) but NOT a concrete provider/model — nothing in the host mapped
 * the two, so a real turn had no model to call. This module is that mapping.
 *
 * Resolution order:
 *   1. An explicit `(provider, model)` the caller supplies (validated against
 *      the catalog; an unknown model on a known provider falls back to that
 *      provider's default rather than failing).
 *   2. `preferManaged` ⇒ the server-key-held managed tier (`openwop-free`), so an
 *      agent can take a real turn with zero BYOK setup.
 *   3. The per-class default, validated against providers.json; a stale mapping
 *      degrades to the provider default, then to the managed tier.
 *
 * The per-class defaults are intentionally simple and reference real catalog
 * ids; they degrade gracefully when providers.json changes (the catalog is the
 * source of truth, this is only a preference).
 *
 * @see src/providers/catalog.ts — the providers.json mirror
 * @see src/host/agentDispatch.ts — the live turn that consumes this
 */

import { getProviderConfig, getDefaultModel, listManagedProviderIds } from '../providers/catalog.js';

export type ModelClass = 'chat' | 'reasoning' | 'coding' | 'extraction';

export interface ResolvedModel {
  provider: string;
  model: string;
  /** Whether this resolved to the server-held managed tier (no BYOK needed). */
  managed: boolean;
}

/** Per-class preference. References real providers.json ids; validated at
 *  resolve time so a catalog change can't produce a dangling model. */
const MODEL_CLASS_DEFAULTS: Record<ModelClass, { provider: string; model: string }> = {
  chat: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  reasoning: { provider: 'anthropic', model: 'claude-opus-4-7' },
  coding: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  extraction: { provider: 'anthropic', model: 'claude-haiku-4-5' },
};

const KNOWN_CLASSES = new Set<ModelClass>(['chat', 'reasoning', 'coding', 'extraction']);

/** The managed tier, or null when none is advertised in providers.json. */
function managedTier(): ResolvedModel | null {
  const id = listManagedProviderIds()[0];
  if (!id) return null;
  return { provider: id, model: getDefaultModel(id), managed: true };
}

/** True when `provider` advertises `model` in the catalog. */
function modelExists(provider: string, model: string): boolean {
  const cfg = getProviderConfig(provider);
  return !!cfg && cfg.models.some((m) => m.id === model);
}

export interface ResolveModelOptions {
  /** Caller-pinned provider (e.g. from the agent's BYOK config or the request). */
  provider?: string;
  /** Caller-pinned model id. */
  model?: string;
  /** Prefer the server-held managed tier (zero-BYOK turns). */
  preferManaged?: boolean;
}

/**
 * Resolve a `modelClass` to a concrete `(provider, model)`. Returns null only
 * when nothing resolves (no managed tier AND the default provider is absent from
 * the catalog) — the caller treats null as "no model available".
 */
export function resolveModelForClass(modelClass: string, opts: ResolveModelOptions = {}): ResolvedModel | null {
  // 1. Explicit pin — the caller's deliberate choice wins over default
  //    resolution. The catalog drives only DEFAULT model selection, so an
  //    off-catalog pin (e.g. the conformance-only `mock` provider used to
  //    verify the live-dispatch pipeline without credentials) is still honored.
  //    callAI's assertProviderSupported remains the real safety gate: a bogus
  //    provider reaches it and fails as `provider_not_supported`.
  if (opts.provider) {
    const cfg = getProviderConfig(opts.provider);
    if (cfg) {
      const model = opts.model && modelExists(opts.provider, opts.model) ? opts.model : getDefaultModel(opts.provider);
      return { provider: opts.provider, model, managed: cfg.managed === true };
    }
    // Off-catalog but explicitly pinned — honor it (model defaults to the
    // provider id when unspecified; e.g. `mock`/`mock`).
    return { provider: opts.provider, model: opts.model ?? opts.provider, managed: false };
  }

  // 2. Managed preference.
  if (opts.preferManaged) {
    const managed = managedTier();
    if (managed) return managed;
  }

  // 3. Per-class default, validated against the catalog.
  const cls = KNOWN_CLASSES.has(modelClass as ModelClass) ? (modelClass as ModelClass) : 'chat';
  const pref = MODEL_CLASS_DEFAULTS[cls];
  if (getProviderConfig(pref.provider)) {
    const model = modelExists(pref.provider, pref.model) ? pref.model : getDefaultModel(pref.provider);
    return { provider: pref.provider, model, managed: false };
  }

  // 4. Last resort — the managed tier if the preferred provider vanished.
  return managedTier();
}
