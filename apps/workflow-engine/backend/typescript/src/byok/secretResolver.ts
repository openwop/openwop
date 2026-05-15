/**
 * BYOK SecretResolver — sample impl using an in-memory map.
 *
 * The wire-side contract (per spec/v1/auth.md + run-options.md):
 *   - Run requests carry opaque `credentialRef` strings — never values.
 *   - The resolver maps refs to raw secrets at execute time.
 *   - Resolved secrets MUST NOT appear in events / errors / traces /
 *     persisted run docs. See `ephemeralRunSecrets.ts` for the
 *     strip-on-persist invariant.
 *
 * Real deployers swap this for a KMS-backed implementation (GCP KMS,
 * AWS KMS, Vault, etc.) and apply the same redaction guarantee.
 */

import { createLogger } from '../observability/logger.js';

const log = createLogger('byok.secretResolver');

const map: Map<string, string> = new Map();

/**
 * Bulk-load secrets at boot. Populates the in-memory map from
 * OPENWOP_SAMPLE_SECRETS env var (JSON object: credentialRef → value).
 *
 * Returns the count of secrets loaded.
 */
export function loadSecretsFromEnv(): number {
  const raw = process.env.OPENWOP_SAMPLE_SECRETS;
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      map.set(k, v);
    }
    log.info('loaded BYOK secrets from env', { count: map.size });
    return map.size;
  } catch (err) {
    log.warn('OPENWOP_SAMPLE_SECRETS parse failed; secrets disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export function resolveSecret(credentialRef: string): string | null {
  return map.get(credentialRef) ?? null;
}

/** Test/dev affordance — set a secret in-process. */
export function setSecret(credentialRef: string, value: string): void {
  map.set(credentialRef, value);
}

export function clearSecrets(): void {
  map.clear();
}
