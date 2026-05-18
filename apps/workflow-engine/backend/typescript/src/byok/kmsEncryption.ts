/**
 * KMS-backed envelope encryption for BYOK secrets owned by signed-in users.
 *
 * Used by the `user:*` tenant path (Firebase Auth + Postgres). Anon
 * tenants keep using the ephemeral in-memory store (which never
 * persists), and the legacy local-master-key path stays for non-public
 * dev. This file handles only the KMS-wrapped persistent path.
 *
 * Envelope scheme:
 *   1. Generate a fresh 32-byte DEK (data-encryption key) per record.
 *   2. AES-256-GCM-encrypt plaintext with DEK + random 12-byte IV.
 *   3. KMS-encrypt the DEK with the configured KMS key.
 *   4. Persist {wrappedDek, iv, ct, tag, kmsKeyName, v: 2}.
 *
 * The DEK never leaves process memory longer than necessary. The
 * KMS-wrapped DEK is the only on-disk durable token.
 *
 * KMS configuration:
 *   - OPENWOP_BYOK_KMS_KEY    `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>`
 *   - GOOGLE_APPLICATION_CREDENTIALS or workload-identity on Cloud Run
 *
 * Test seam: `setKmsClientForTesting()` swaps the KMS client with an
 * AES-256-GCM-backed stub. The wire shape is identical, so tests can
 * exercise the same encrypt/decrypt round-trip without a live KMS.
 */

import { KeyManagementServiceClient } from '@google-cloud/kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createLogger } from '../observability/logger.js';

const log = createLogger('byok.kmsEncryption');

const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm' as const;

export interface KmsEncryptedRecord {
  v: 2;
  iv: string;            // base64 12B
  ct: string;            // base64 ciphertext
  tag: string;           // base64 16B
  wrappedDek: string;    // base64 KMS-wrapped DEK
  kmsKeyName: string;    // for key rotation / auditing
}

/**
 * Minimal KMS client surface. Production wraps Google Cloud KMS;
 * tests wrap a local AES-256-GCM stub.
 */
export interface KmsClient {
  encrypt(plaintextDek: Buffer): Promise<Buffer>;
  decrypt(wrappedDek: Buffer): Promise<Buffer>;
  keyName(): string;
}

let configuredClient: KmsClient | null = null;

export function configureKmsClient(client: KmsClient): void {
  configuredClient = client;
}

export function isKmsConfigured(): boolean {
  return configuredClient !== null;
}

function requireKmsClient(): KmsClient {
  if (!configuredClient) {
    throw new Error('KMS client not configured — call configureKmsClient() at boot');
  }
  return configuredClient;
}

/**
 * Create a Google Cloud KMS client bound to a specific key.
 * Used at boot when OPENWOP_BYOK_KMS_KEY is set.
 */
export function createGoogleCloudKmsClient(keyName: string): KmsClient {
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyName)) {
    throw new Error(
      `OPENWOP_BYOK_KMS_KEY must match projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>; got: ${keyName}`,
    );
  }
  const client = new KeyManagementServiceClient();
  return {
    keyName: () => keyName,
    async encrypt(plaintextDek) {
      const [resp] = await client.encrypt({ name: keyName, plaintext: plaintextDek });
      const cipher = resp.ciphertext;
      if (!cipher) throw new Error('KMS encrypt returned empty ciphertext');
      return Buffer.from(cipher);
    },
    async decrypt(wrappedDek) {
      const [resp] = await client.decrypt({ name: keyName, ciphertext: wrappedDek });
      const plain = resp.plaintext;
      if (!plain) throw new Error('KMS decrypt returned empty plaintext');
      return Buffer.from(plain);
    },
  };
}

/**
 * AES-256-GCM-backed KmsClient for tests. The "wrapped DEK" is just
 * the DEK encrypted with a fixed test key. Same shape as Google KMS,
 * no network, deterministic in CI.
 */
export function createLocalAesKmsClient(testKey: Buffer, label = 'test/local-aes'): KmsClient {
  if (testKey.length !== 32) throw new Error('test KMS key must be 32 bytes');
  return {
    keyName: () => label,
    async encrypt(plaintextDek) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, testKey, iv);
      const ct = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Pack as iv|tag|ct for portability
      return Buffer.concat([iv, tag, ct]);
    },
    async decrypt(wrappedDek) {
      const iv = wrappedDek.subarray(0, IV_BYTES);
      const tag = wrappedDek.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ct = wrappedDek.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(ALGO, testKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    },
  };
}

/** Envelope-encrypt a UTF-8 plaintext string. Returns the record. */
export async function kmsEncrypt(plaintext: string): Promise<KmsEncryptedRecord> {
  const client = requireKmsClient();
  const dek = randomBytes(DEK_BYTES);
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrappedDek = await client.encrypt(dek);
    return {
      v: 2,
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: tag.toString('base64'),
      wrappedDek: wrappedDek.toString('base64'),
      kmsKeyName: client.keyName(),
    };
  } finally {
    // Best-effort zeroing of the DEK before GC.
    dek.fill(0);
  }
}

/** Envelope-decrypt a record. Throws on tamper or KMS denial. */
export async function kmsDecrypt(record: KmsEncryptedRecord): Promise<string> {
  if (record.v !== 2) throw new Error(`unsupported KMS record version: ${record.v}`);
  const client = requireKmsClient();
  const wrappedDek = Buffer.from(record.wrappedDek, 'base64');
  const iv = Buffer.from(record.iv, 'base64');
  const ct = Buffer.from(record.ct, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  if (iv.length !== IV_BYTES) throw new Error(`bad iv length: ${iv.length}`);
  if (tag.length !== TAG_BYTES) throw new Error(`bad tag length: ${tag.length}`);
  const dek = await client.decrypt(wrappedDek);
  try {
    if (dek.length !== DEK_BYTES) throw new Error(`bad DEK length: ${dek.length}`);
    const decipher = createDecipheriv(ALGO, dek, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf-8');
  } finally {
    dek.fill(0);
  }
}

/**
 * Bootstrap from environment. Returns true if KMS is configured.
 * Logs a structured info line for ops visibility.
 */
export function bootstrapKmsFromEnv(): boolean {
  const keyName = process.env.OPENWOP_BYOK_KMS_KEY;
  if (!keyName) return false;
  configureKmsClient(createGoogleCloudKmsClient(keyName));
  log.info('BYOK KMS configured', { kmsKeyName: keyName });
  return true;
}

/** Test affordance — wipe the configured client. */
export function _resetKmsForTesting(): void {
  configuredClient = null;
}
