/**
 * BYOK SecretResolver — sqlite-backed with AES-256-GCM encryption at
 * rest. Persists across restarts.
 *
 * The wire-side contract (per spec/v1/auth.md + run-options.md):
 *   - Run requests carry opaque `credentialRef` strings — never values.
 *   - The resolver maps refs to raw secrets at execute time.
 *   - Resolved secrets MUST NOT appear in events / errors / traces /
 *     persisted run docs. Enforced by `ephemeralRunSecrets.ts` strip
 *     on the event-log + interrupt boundaries.
 *
 * Storage layer: encrypted records live in the `byok_secrets` sqlite
 * table (one row per credentialRef). Plaintext is decrypted on-demand
 * into an in-process cache to avoid hitting sqlite + crypto on every
 * node dispatch.
 *
 * Production deployers swap:
 *   - The master key (env var → KMS-wrapped DEK + KMS API call)
 *   - The storage (sqlite → Postgres / Firestore / Vault)
 * The resolver interface stays the same.
 */

import { resolve } from 'node:path';
import { createLogger } from '../observability/logger.js';
import { decrypt, encrypt, loadMasterKey, type EncryptedRecord } from './encryption.js';
import type { Storage } from '../storage/storage.js';

const log = createLogger('byok.secretResolver');

let backend: Storage | null = null;
let masterKeyPath: string | null = null;

/** Lazy-decryption cache for the SQLite-backed path. Keyed by ref. */
const plaintextCache = new Map<string, string>();

/**
 * Per-tenant in-memory store for ephemeral-mode BYOK (P0.3 in the
 * deploy plan). Populated when `OPENWOP_BYOK_EPHEMERAL=true` is set on
 * the host. Secrets never touch disk; they live in this Map until the
 * daily cleanup endpoint (P0.5) wipes the tenant's entry, OR until the
 * process restarts. Cloud Run cold starts wipe all session secrets,
 * which is the intended public-demo posture documented in the demo
 * banner.
 *
 * Shape: `Map<tenantId, Map<credentialRef, plaintextValue>>`.
 */
const ephemeralSecrets = new Map<string, Map<string, string>>();

function ephemeralEnabled(): boolean {
  return process.env.OPENWOP_BYOK_EPHEMERAL === 'true';
}

function ephemeralBucket(tenantId: string): Map<string, string> {
  let b = ephemeralSecrets.get(tenantId);
  if (!b) { b = new Map(); ephemeralSecrets.set(tenantId, b); }
  return b;
}

/** Scope context for secret operations. Required in ephemeral mode;
 *  optional in SQLite mode (where the resolver is process-global). */
export interface SecretScope {
  tenantId: string;
}

/**
 * Wire the resolver to the storage backend + master-key location.
 * Called once at boot from index.ts.
 */
export function configureSecretResolver(input: { storage: Storage; dataDir: string }): void {
  backend = input.storage;
  masterKeyPath = resolve(input.dataDir, '.byok-master-key');
  // Touch the master key at boot so we crash fast on a misconfigured
  // env var, rather than at first-secret-write.
  loadMasterKey(masterKeyPath);
}

function requireConfigured(): { storage: Storage; masterKey: Buffer } {
  if (!backend || !masterKeyPath) {
    throw new Error('secretResolver not configured — call configureSecretResolver() at boot.');
  }
  return { storage: backend, masterKey: loadMasterKey(masterKeyPath) };
}

/**
 * Bulk-load secrets from OPENWOP_SAMPLE_SECRETS at boot. Reads a JSON
 * object `{credentialRef: value}` and upserts each into storage. Useful
 * for conformance / scripted test environments that want a known set
 * of refs without going through the wizard.
 *
 * Returns the count of secrets loaded.
 */
export function loadSecretsFromEnv(): number {
  const raw = process.env.OPENWOP_SAMPLE_SECRETS;
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    let count = 0;
    for (const [ref, value] of Object.entries(parsed)) {
      setSecret(ref, value);
      count++;
    }
    log.info('loaded BYOK secrets from env', { count });
    return count;
  } catch (err) {
    log.warn('OPENWOP_SAMPLE_SECRETS parse failed; secrets disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export function resolveSecret(credentialRef: string, scope?: SecretScope): string | null {
  if (ephemeralEnabled()) {
    if (!scope?.tenantId) {
      // In ephemeral mode the caller MUST provide a scope. Without
      // tenantId we'd have to fall back to a global map, which would
      // share secrets across tenants — exactly the leak we're closing.
      log.warn('resolveSecret called without scope in ephemeral mode', { credentialRef });
      return null;
    }
    return ephemeralBucket(scope.tenantId).get(credentialRef) ?? null;
  }

  const cached = plaintextCache.get(credentialRef);
  if (cached !== undefined) return cached;

  const { storage, masterKey } = requireConfigured();
  const encryptedJson = storage.getEncryptedSecret(credentialRef);
  if (!encryptedJson) return null;

  try {
    const record = JSON.parse(encryptedJson) as EncryptedRecord;
    const plaintext = decrypt(record, masterKey);
    plaintextCache.set(credentialRef, plaintext);
    return plaintext;
  } catch (err) {
    log.error('failed to decrypt BYOK secret', {
      credentialRef,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Persist a new (or updated) secret. Called by POST /v1/host/sample/byok/secrets. */
export function setSecret(credentialRef: string, value: string, scope?: SecretScope): void {
  if (ephemeralEnabled()) {
    if (!scope?.tenantId) {
      throw new Error('setSecret in ephemeral mode requires scope.tenantId');
    }
    ephemeralBucket(scope.tenantId).set(credentialRef, value);
    return;
  }
  const { storage, masterKey } = requireConfigured();
  const record = encrypt(value, masterKey);
  storage.upsertEncryptedSecret(credentialRef, JSON.stringify(record), new Date().toISOString());
  plaintextCache.set(credentialRef, value);
}

/** Remove a secret. Called by DELETE /v1/host/sample/byok/secrets/:ref. */
export function removeSecret(credentialRef: string, scope?: SecretScope): void {
  if (ephemeralEnabled()) {
    if (!scope?.tenantId) throw new Error('removeSecret in ephemeral mode requires scope.tenantId');
    ephemeralBucket(scope.tenantId).delete(credentialRef);
    return;
  }
  const { storage } = requireConfigured();
  storage.deleteSecret(credentialRef);
  plaintextCache.delete(credentialRef);
}

/** Return all stored credentialRefs for the given scope. NEVER returns values. */
export function listSecretRefs(scope?: SecretScope): readonly string[] {
  if (ephemeralEnabled()) {
    if (!scope?.tenantId) return [];
    return Array.from(ephemeralBucket(scope.tenantId).keys());
  }
  const { storage } = requireConfigured();
  return storage.listSecretRefs();
}

/** Wipe one tenant's ephemeral secrets. Called from the daily cleanup
 *  endpoint (P0.5) when an anon session passes its TTL. */
export function clearTenantEphemeralSecrets(tenantId: string): number {
  if (!ephemeralEnabled()) return 0;
  const b = ephemeralSecrets.get(tenantId);
  if (!b) return 0;
  const n = b.size;
  ephemeralSecrets.delete(tenantId);
  return n;
}

/** Wipe ephemeral secrets for any tenant whose id is NOT in `keep`.
 *  Used by the daily cleanup job to GC expired anon sessions in bulk. */
export function clearExpiredEphemeralSecrets(keep: ReadonlySet<string>): number {
  if (!ephemeralEnabled()) return 0;
  let n = 0;
  for (const tenantId of Array.from(ephemeralSecrets.keys())) {
    if (!keep.has(tenantId)) {
      n += ephemeralSecrets.get(tenantId)!.size;
      ephemeralSecrets.delete(tenantId);
    }
  }
  return n;
}

/** Test affordance — wipe the in-process cache without touching storage. */
export function clearCache(): void {
  plaintextCache.clear();
  ephemeralSecrets.clear();
}

/** Test affordance — wipe storage AND cache. */
export function clearAllSecrets(): void {
  if (ephemeralEnabled()) {
    ephemeralSecrets.clear();
    return;
  }
  const { storage } = requireConfigured();
  for (const ref of storage.listSecretRefs()) storage.deleteSecret(ref);
  plaintextCache.clear();
}
