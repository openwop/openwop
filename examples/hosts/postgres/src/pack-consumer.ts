/**
 * Host-side pack consumer (PACK-1 / PACK-2 from
 * `plans/openwop-protocol-gap-closure-plan.md`).
 *
 * Implements `spec/v1/node-packs.md` §"Dependency resolution + lockfile" +
 * §"Signing recipe" + §"Subresource integrity" for the Postgres reference
 * host. Loading a pack mounts no executor logic in v1 — that is the host's
 * concern and not part of the wire contract — but the host MUST perform
 * the canonical security checks before treating any tarball as trusted:
 *
 *   1. The lockfile bytes parse + validate against `pack-lockfile.schema.json`.
 *   2. The fetched tarball bytes' SHA-256 matches the lockfile's
 *      `integrity` field (Subresource Integrity recipe `sha256-<b64>=`).
 *   3. When a `signature` block is present, the Ed25519 signature verifies
 *      against the publisher's public key over the canonical signed bytes
 *      (whole-tarball for `method: "ed25519"`; pack.json for
 *      `method: "manual"` — out of scope for this consumer; we require
 *      whole-tarball signing).
 *   4. The version the registry serves matches the lockfile's pinned
 *      `version` (rejecting drift between resolve-time and install-time).
 *
 * Every failure mode is a typed `PackConsumerError` with a canonical
 * `code`: `pack_integrity_mismatch`, `pack_signature_invalid`,
 * `pack_version_mismatch`, `pack_lockfile_invalid`, `pack_fetch_failed`,
 * `pack_manifest_invalid`, or `pack_signature_unverifiable`. The host
 * MUST fail closed — a pack that doesn't pass all four checks is NEVER
 * mounted, and the failure surfaces with the runId scope when triggered
 * during run setup or with a host-startup error when triggered eagerly.
 *
 * **Test seam.** The smoke at
 * `examples/hosts/postgres/test/pack-consumer.test.ts` plants a
 * known-good pack under a tmpdir registry mirror and exercises both
 * the positive path and every negative path. No env flag is needed —
 * the module is a pure function the test harness invokes directly.
 *
 * @see spec/v1/node-packs.md
 * @see schemas/pack-lockfile.schema.json
 * @see registry/scripts/verify-signatures.mjs (canonical recipe reference)
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type PackConsumerErrorCode =
  | 'pack_lockfile_invalid'
  | 'pack_fetch_failed'
  | 'pack_integrity_mismatch'
  | 'pack_signature_invalid'
  | 'pack_signature_unverifiable'
  | 'pack_version_mismatch'
  | 'pack_manifest_invalid';

export class PackConsumerError extends Error {
  readonly code: PackConsumerErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: PackConsumerErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PackConsumerError';
    this.code = code;
    this.details = details;
  }
}

/** Canonical pack-lockfile shape (subset; matches `pack-lockfile.schema.json`). */
export interface PackLockfile {
  readonly lockfileVersion: number;
  readonly generatedAt: string;
  readonly registry?: string;
  readonly packs: ReadonlyArray<ResolvedPack>;
}

export interface ResolvedPack {
  readonly name: string;
  readonly version: string;
  /** SRI-style hash: `sha256-<43-char-base64>=`. */
  readonly integrity: string;
  readonly resolved?: string;
  readonly signature?: {
    readonly algorithm: 'ed25519';
    /** PEM- or raw-base64-encoded Ed25519 public key bytes. */
    readonly publicKey: string;
    /** Base64-encoded Ed25519 signature over the tarball. */
    readonly value: string;
  };
}

/**
 * Validate a parsed lockfile against the canonical shape per
 * `pack-lockfile.schema.json`. Returns the typed lockfile on success;
 * throws `PackConsumerError(pack_lockfile_invalid)` on failure.
 *
 * Validation is structural only — bytes-vs-hash checks belong to
 * `consumePack`. We accept any unknown top-level keys outside `packs[]`
 * (the schema says `additionalProperties: false` but the consumer
 * stays permissive so a lockfile pinned by a newer tool doesn't fail
 * an older host — fail-closed for security-relevant fields only).
 */
export function parseLockfile(text: string): PackLockfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `lockfile is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new PackConsumerError('pack_lockfile_invalid', 'lockfile MUST be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.lockfileVersion !== 'number' || !Number.isInteger(obj.lockfileVersion) || obj.lockfileVersion < 1) {
    throw new PackConsumerError('pack_lockfile_invalid', 'lockfile.lockfileVersion MUST be a positive integer');
  }
  if (typeof obj.generatedAt !== 'string') {
    throw new PackConsumerError('pack_lockfile_invalid', 'lockfile.generatedAt MUST be a string');
  }
  if (!Array.isArray(obj.packs)) {
    throw new PackConsumerError('pack_lockfile_invalid', 'lockfile.packs MUST be an array');
  }
  const packs: ResolvedPack[] = [];
  for (let i = 0; i < obj.packs.length; i++) {
    const p = obj.packs[i] as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') {
      throw new PackConsumerError('pack_lockfile_invalid', `lockfile.packs[${i}] MUST be an object`);
    }
    if (typeof p.name !== 'string' || p.name.length < 3) {
      throw new PackConsumerError('pack_lockfile_invalid', `lockfile.packs[${i}].name MUST be a string`);
    }
    if (typeof p.version !== 'string' || p.version.length === 0) {
      throw new PackConsumerError('pack_lockfile_invalid', `lockfile.packs[${i}].version MUST be a non-empty string`);
    }
    if (typeof p.integrity !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(p.integrity)) {
      throw new PackConsumerError(
        'pack_lockfile_invalid',
        `lockfile.packs[${i}].integrity MUST match the canonical SRI recipe sha256-<43-char-b64>=`,
      );
    }
    const resolved: ResolvedPack = {
      name: p.name,
      version: p.version,
      integrity: p.integrity,
      ...(typeof p.resolved === 'string' ? { resolved: p.resolved } : {}),
      ...(p.signature !== undefined ? { signature: parseSignature(p.signature, i) } : {}),
    };
    packs.push(resolved);
  }
  return {
    lockfileVersion: obj.lockfileVersion as number,
    generatedAt: obj.generatedAt as string,
    ...(typeof obj.registry === 'string' ? { registry: obj.registry as string } : {}),
    packs,
  };
}

function parseSignature(raw: unknown, idx: number): NonNullable<ResolvedPack['signature']> {
  if (typeof raw !== 'object' || raw === null) {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `lockfile.packs[${idx}].signature MUST be an object`,
    );
  }
  const s = raw as Record<string, unknown>;
  if (s.algorithm !== 'ed25519') {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `lockfile.packs[${idx}].signature.algorithm MUST be "ed25519"`,
    );
  }
  if (typeof s.publicKey !== 'string' || s.publicKey.length === 0) {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `lockfile.packs[${idx}].signature.publicKey MUST be a non-empty string`,
    );
  }
  if (typeof s.value !== 'string' || s.value.length === 0) {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `lockfile.packs[${idx}].signature.value MUST be a non-empty string`,
    );
  }
  return { algorithm: 'ed25519', publicKey: s.publicKey, value: s.value };
}

/**
 * Compute the SHA-256 SRI string `sha256-<b64>=` for the given bytes.
 * Matches the canonical recipe in `registry/scripts/build-index.mjs`.
 */
export function sriOf(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

export interface ConsumePackInput {
  /** Lockfile entry pinning the expected version + integrity + optional signature. */
  readonly resolved: ResolvedPack;
  /** Raw tarball bytes the registry served. */
  readonly tarball: Buffer;
  /** Optional version manifest the registry served alongside the tarball. Used to detect version drift between resolve-time and install-time. */
  readonly manifest?: { name?: string; version?: string };
}

export interface ConsumedPack {
  readonly name: string;
  readonly version: string;
  /** SHA-256 SRI of the tarball, verified equal to the lockfile pin. */
  readonly integrity: string;
  /** `true` when an Ed25519 signature was verified; `false` when the lockfile carried no signature block. */
  readonly signatureVerified: boolean;
  readonly byteSize: number;
}

/**
 * Run the canonical install-time security checks against a fetched pack.
 *
 *   1. Lockfile integrity vs. tarball bytes (always).
 *   2. Lockfile version vs. manifest version (when manifest present).
 *   3. Ed25519 signature over tarball bytes (when lockfile carries `signature`).
 *
 * Returns a `ConsumedPack` summary on success. Throws `PackConsumerError`
 * on any failure — the caller MUST treat a thrown error as fail-closed
 * (do NOT mount the pack, do NOT cache the bytes, do NOT execute any
 * code derived from them).
 */
export function consumePack(input: ConsumePackInput): ConsumedPack {
  const { resolved, tarball, manifest } = input;

  // 1. Subresource Integrity. Always required — fail closed if either
  //    side is missing or doesn't match.
  const actualSri = sriOf(tarball);
  if (actualSri !== resolved.integrity) {
    throw new PackConsumerError(
      'pack_integrity_mismatch',
      `pack '${resolved.name}@${resolved.version}' tarball integrity MUST match the lockfile pin`,
      { expected: resolved.integrity, actual: actualSri, byteSize: tarball.byteLength },
    );
  }

  // 2. Version drift between resolve-time and install-time. Belt-and-
  //    suspenders: if the registry serves a different version under
  //    the same canonical URL, refuse — the integrity check above
  //    would have caught any bit-level drift, but a registry that
  //    swaps versions under a stale name is still a supply-chain
  //    smell worth surfacing.
  if (manifest !== undefined) {
    if (manifest.name !== undefined && manifest.name !== resolved.name) {
      throw new PackConsumerError(
        'pack_manifest_invalid',
        `pack manifest name '${manifest.name}' does not match lockfile entry '${resolved.name}'`,
        { lockfile: resolved.name, manifest: manifest.name },
      );
    }
    if (manifest.version !== undefined && manifest.version !== resolved.version) {
      throw new PackConsumerError(
        'pack_version_mismatch',
        `pack '${resolved.name}' version drift: lockfile pinned '${resolved.version}', registry served '${manifest.version}'`,
        { lockfile: resolved.version, registry: manifest.version },
      );
    }
  }

  // 3. Ed25519 signature verification. Optional in the lockfile schema,
  //    but when present the host MUST verify against the publisher's
  //    public key over the canonical tarball bytes.
  let signatureVerified = false;
  if (resolved.signature !== undefined) {
    const { algorithm, publicKey, value } = resolved.signature;
    if (algorithm !== 'ed25519') {
      // Defensive — parseLockfile already enforces this.
      throw new PackConsumerError(
        'pack_signature_unverifiable',
        `pack '${resolved.name}': only ed25519 signatures are supported (got '${algorithm}')`,
      );
    }
    let keyObject;
    try {
      keyObject = createPublicKey(decodePublicKey(publicKey));
    } catch (err) {
      throw new PackConsumerError(
        'pack_signature_unverifiable',
        `pack '${resolved.name}' publicKey is not a valid Ed25519 public key: ${(err as Error).message}`,
      );
    }
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(value, 'base64');
    } catch (err) {
      throw new PackConsumerError(
        'pack_signature_unverifiable',
        `pack '${resolved.name}' signature.value is not valid base64: ${(err as Error).message}`,
      );
    }
    if (sigBytes.length !== 64) {
      throw new PackConsumerError(
        'pack_signature_unverifiable',
        `pack '${resolved.name}' Ed25519 signature MUST be 64 bytes (got ${sigBytes.length})`,
      );
    }
    const valid = cryptoVerify(null, tarball, keyObject, sigBytes);
    if (!valid) {
      throw new PackConsumerError(
        'pack_signature_invalid',
        `pack '${resolved.name}@${resolved.version}' Ed25519 signature does NOT verify against the lockfile-pinned public key`,
      );
    }
    signatureVerified = true;
  }

  return {
    name: resolved.name,
    version: resolved.version,
    integrity: resolved.integrity,
    signatureVerified,
    byteSize: tarball.byteLength,
  };
}

/**
 * Accept either PEM (`-----BEGIN PUBLIC KEY-----...`) or raw-base64
 * Ed25519 public keys in the lockfile. Raw-base64 is the convention
 * for sigstore-style transparency logs; PEM is the convention for
 * `registry/keys/*.pub`. Either decodes into a `KeyObject` via
 * `crypto.createPublicKey`.
 */
function decodePublicKey(key: string): string | Buffer {
  const trimmed = key.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  // Raw 32-byte Ed25519 keys are sometimes shared as base64. createPublicKey
  // accepts PEM/DER buffers; for a raw 32-byte key we'd need to prepend the
  // ASN.1 DER prefix. The canonical openwop convention is PEM
  // (registry/keys/*.pub), so reject raw-base64 with a clear error.
  throw new Error(
    'publicKey must be PEM-encoded (`-----BEGIN PUBLIC KEY-----...`); raw-base64 keys are not supported by this consumer',
  );
}

/**
 * Convenience: load a lockfile from disk + parse it.
 */
export function loadLockfile(path: string): PackLockfile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new PackConsumerError(
      'pack_lockfile_invalid',
      `failed to read lockfile at ${path}: ${(err as Error).message}`,
    );
  }
  return parseLockfile(text);
}
