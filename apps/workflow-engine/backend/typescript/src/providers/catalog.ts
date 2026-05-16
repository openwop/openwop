/**
 * Provider catalog — server-side mirror of the FE's BYOK wizard data.
 *
 * Reads the single source of truth at `apps/workflow-engine/providers.json`
 * so adding a new provider model only requires editing one file. The
 * BE uses this for:
 *   - Default model fallback in `local.sample.chat.responder`
 *     (when the FE doesn't supply `inputs.model`).
 *   - Forward-compat validation surface (future: reject unknown
 *     provider IDs at run-create with a useful error envelope).
 *
 * esbuild + tsx both handle JSON imports natively. In dev the JSON
 * lives on disk; in the production bundle it's inlined.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  capabilities: readonly string[];
  cost?: { input: number; output: number };
  recommended?: boolean;
}

interface ProviderConfig {
  id: string;
  label: string;
  models: readonly ProviderModel[];
  [extra: string]: unknown;
}

interface ProvidersDocument {
  providers: readonly ProviderConfig[];
  [extra: string]: unknown;
}

function loadCatalog(): ProvidersDocument {
  // Find providers.json relative to this source file. Works in tsx dev
  // mode (file lives at apps/workflow-engine/providers.json) AND in the
  // esbuild bundle (we also vendor a copy alongside lib/index.js via
  // the Dockerfile — see Dockerfile §runtime stage).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../providers.json'),     // tsx dev: src/providers/catalog.ts → up 4 to apps/workflow-engine/
    resolve(here, '../providers.json'),              // esbuild prod: lib/ → up 1 to apps/workflow-engine/backend/typescript/, with providers.json vendored alongside
    resolve(here, './providers.json'),               // last resort: same dir
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as ProvidersDocument;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(
    `providers.json not found in any of: ${candidates.join(', ')}. ` +
      'Check Dockerfile if running in production bundle.',
  );
}

const CATALOG = loadCatalog();

export function listProviders(): readonly ProviderConfig[] {
  return CATALOG.providers;
}

export function getProviderConfig(id: string): ProviderConfig | null {
  return CATALOG.providers.find((p) => p.id === id) ?? null;
}

/**
 * Return the default model id for a provider — first `recommended: true`,
 * else first model. Used by the chat responder node when inputs.model
 * isn't supplied.
 */
export function getDefaultModel(providerId: string): string {
  const p = getProviderConfig(providerId);
  if (!p) {
    // Unknown provider — caller will fail at dispatch anyway; return
    // a safe-looking model id so the error message is descriptive.
    return `${providerId}-unknown`;
  }
  const recommended = p.models.find((m) => m.recommended);
  return (recommended ?? p.models[0])?.id ?? `${providerId}-unknown`;
}
