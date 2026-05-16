/**
 * BYOK encryption at rest — AES-256-GCM with a single master key.
 *
 * Security model (sample-grade, honest about its limits):
 *
 *   ✅ Protects against: backup leakage, database file extraction,
 *      casual sqlite browser inspection.
 *
 *   ✗ Does NOT protect against: an attacker with full filesystem
 *      access to the data directory (because the master key is on
 *      disk alongside the database).
 *
 *   ✗ Does NOT protect against: process memory inspection. The
 *      `secretResolver.ts` cache holds decrypted plaintexts in a
 *      module-level Map after first resolve, so a memory dump reveals
 *      every active BYOK secret as plaintext. A real KMS keeps the
 *      master key inside an HSM and returns cipher-text-bound tokens
 *      that never decrypt in your process; the sample's in-process
 *      cache is the corner that production deploys MUST replace.
 *
 * Real deployers swap the master-key source for KMS / Vault / a
 * hardware-backed secret AND wire `secretResolver.ts` to fetch each
 * decrypt-on-demand instead of caching plaintext. The wire shape of
 * the encrypted record stays the same — only `loadMasterKey()` and
 * the cache policy change.
 *
 * Master-key resolution order:
 *   1. OPENWOP_BYOK_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
 *   2. data/.byok-master-key file (auto-generated on first boot, 0600)
 *
 * Per-secret IV: 12 random bytes (GCM standard).
 * Auth tag: 16 bytes appended to the ciphertext via getAuthTag().
 *
 * Record shape (base64-encoded for sqlite storage):
 *   { v: 1, iv: <b64 12B>, ct: <b64 N B>, tag: <b64 16B> }
 *
 * `v` is a forward-compat marker — if we ever rotate algorithms,
 * the record format ID tells the decryptor what to do.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../observability/logger.js';

const log = createLogger('byok.encryption');

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm' as const;

export interface EncryptedRecord {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

let cachedMasterKey: Buffer | null = null;

/** Resolve the master key from env or disk, generating + persisting on first run. */
export function loadMasterKey(masterKeyPath: string): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envKey = process.env.OPENWOP_BYOK_ENCRYPTION_KEY;
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error(
        'OPENWOP_BYOK_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
          'Generate one with: openssl rand -hex 32',
      );
    }
    cachedMasterKey = Buffer.from(envKey, 'hex');
    log.info('loaded BYOK master key from env');
    return cachedMasterKey;
  }

  if (existsSync(masterKeyPath)) {
    const hex = readFileSync(masterKeyPath, 'utf-8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`BYOK master key file ${masterKeyPath} is malformed (expected 64 hex chars).`);
    }
    cachedMasterKey = Buffer.from(hex, 'hex');
    log.info('loaded BYOK master key from disk', { path: masterKeyPath });
    return cachedMasterKey;
  }

  // First boot: generate + persist with owner-only perms.
  const dir = dirname(masterKeyPath);
  mkdirSync(dir, { recursive: true });
  const fresh = randomBytes(KEY_BYTES);
  writeFileSync(masterKeyPath, fresh.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(masterKeyPath, 0o600);
  } catch {
    /* chmod may no-op on some filesystems; the writeFileSync mode already set perms */
  }
  cachedMasterKey = fresh;
  log.warn(
    'GENERATED a new BYOK master key — persisted to disk with 0600 perms. ' +
      'For production, supply OPENWOP_BYOK_ENCRYPTION_KEY explicitly + wire KMS-wrapped storage.',
    { path: masterKeyPath },
  );
  return cachedMasterKey;
}

/** Encrypt a UTF-8 plaintext string. Returns the record (caller persists). */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedRecord {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) throw new Error(`unexpected GCM tag length: ${tag.length}`);
  return {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Decrypt a record. Throws on auth-tag mismatch (tampered ciphertext). */
export function decrypt(record: EncryptedRecord, masterKey: Buffer): string {
  if (record.v !== 1) throw new Error(`unsupported encryption record version: ${record.v}`);
  const iv = Buffer.from(record.iv, 'base64');
  const ct = Buffer.from(record.ct, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  if (iv.length !== IV_BYTES) throw new Error(`bad iv length: ${iv.length}`);
  if (tag.length !== TAG_BYTES) throw new Error(`bad tag length: ${tag.length}`);
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf-8');
}

/** Test affordance — drop the cached key (forces re-load). */
export function resetCachedMasterKey(): void {
  cachedMasterKey = null;
}
