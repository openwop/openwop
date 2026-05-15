/**
 * Pack tarball loader with SRI + Ed25519 signature verification.
 *
 * For the sample, packs live as plain directories on disk under
 * OPENWOP_PACK_DIR (default ./packs). Each pack has:
 *   - pack.json              (manifest per spec/v1/node-packs.md)
 *   - index.mjs              (runtime entrypoint exporting `nodes` map)
 *   - schemas/*.json         (optional)
 *   - signatures/<keyId>.sig (optional Ed25519 signature over pack.json)
 *
 * The verifyPackSignature helper takes a tarball path + public key
 * and asserts SRI + Ed25519 in the way real registries serve packs.
 * The bootstrap path uses loadPackFromManifest, which trusts on-disk
 * packs (sample-grade — real impls require signed tarballs).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, verify as verifySig, KeyObject, createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { NodeModule } from '../executor/types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('packs.tarballLoader');

interface PackManifest {
  name: string;
  version: string;
  nodes?: Array<{ typeId: string; version: string }>;
  runtime?: { format?: string; entry?: string };
  /** Optional signature metadata. When present, loadPackFromManifest verifies. */
  signature?: {
    /** Path to the public key file relative to the pack dir. */
    publicKeyPath: string;
    /** Path to the detached signature file relative to the pack dir. */
    signaturePath: string;
    /** Expected SRI integrity hash of the manifest contents. */
    integrity: string;
  };
}

/**
 * Load a pack from a directory containing pack.json + index.mjs and
 * register its node modules. Returns the first node module loaded —
 * callers iterate the registry for the rest.
 */
export async function loadPackFromManifest(packDir: string): Promise<NodeModule | null> {
  const manifestPath = join(packDir, 'pack.json');
  const manifestRaw = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestRaw.toString('utf-8')) as PackManifest;

  // Per spec/v1/node-packs.md: SRI + Ed25519 verification is REQUIRED for
  // packs from a registry. The sample only loads from disk so verification
  // is opt-in via the manifest's `signature` block — this exists primarily
  // to demonstrate the verification path; production callers wire this for
  // every pack tarball before extraction.
  if (manifest.signature) {
    const pubPath = join(packDir, manifest.signature.publicKeyPath);
    const sigPath = join(packDir, manifest.signature.signaturePath);
    if (!existsSync(pubPath) || !existsSync(sigPath)) {
      log.warn('pack signature declared but key/sig file missing', { packDir, pubPath, sigPath });
      return null;
    }
    const result = verifyPackSignature({
      tarballBytes: manifestRaw,
      expectedIntegrity: manifest.signature.integrity,
      signatureBase64: readFileSync(sigPath, 'utf-8').trim(),
      publicKeyPem: readFileSync(pubPath, 'utf-8'),
    });
    if (!result.ok) {
      log.error('pack signature verification failed; refusing to load', { packDir, reason: result.reason });
      return null;
    }
    log.info('pack signature verified', { packDir });
  }

  const entry = manifest.runtime?.entry ?? './index.mjs';
  const entryPath = join(packDir, entry);
  const moduleUrl = pathToFileURL(entryPath).toString();

  // Dynamic import. Sample-grade — no sandbox. Real hosts run packs
  // in a worker_threads sandbox or wasm runtime per RFC 0008.
  const loaded = (await import(moduleUrl)) as { nodes?: Record<string, unknown> };
  if (!loaded.nodes || typeof loaded.nodes !== 'object') {
    log.warn('pack export missing `nodes` map', { packDir });
    return null;
  }

  const first: NodeModule | null = null;
  let firstReturned: NodeModule | null = first;
  const { getNodeRegistry } = await import('../executor/nodeRegistry.js');
  const registry = getNodeRegistry();
  for (const [typeId, fn] of Object.entries(loaded.nodes)) {
    if (typeof fn !== 'function') continue;
    const module: NodeModule = {
      typeId,
      version: manifest.version,
      async execute(ctx) {
        const result = await (fn as (c: unknown) => Promise<unknown>)({
          inputs: ctx.inputs,
          config: ctx.config,
        });
        const r = result as { status?: string; outputs?: unknown };
        if (r.status === 'success') {
          return { status: 'success', outputs: r.outputs };
        }
        return { status: 'failure', error: { code: 'pack_node_error', message: 'Pack node returned non-success outcome' } };
      },
    };
    registry.register(module);
    if (!firstReturned) firstReturned = module;
  }
  return firstReturned;
}

/**
 * Verify a pack tarball's SRI integrity hash + Ed25519 signature.
 *
 * Call before extracting/loading. Real registries serve packs with:
 *   - integrity: "sha384-<base64>"   (Subresource Integrity)
 *   - signature: <base64 Ed25519 sig over the canonical manifest hash>
 *   - publicKeyId: <opaque key id> resolved against the registry's keys
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export function verifyPackSignature(input: {
  tarballBytes: Buffer;
  expectedIntegrity: string;
  signatureBase64: string;
  publicKeyPem: string;
}): VerifyResult {
  // SRI: prefix is the algorithm name; we only support sha384 here.
  const [algo, expectedB64] = input.expectedIntegrity.split('-');
  if (algo !== 'sha384') {
    return { ok: false, reason: `unsupported integrity algorithm: ${algo}` };
  }
  const computed = createHash('sha384').update(input.tarballBytes).digest('base64');
  if (computed !== expectedB64) {
    return { ok: false, reason: 'sri_mismatch' };
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(input.publicKeyPem);
  } catch (err) {
    return { ok: false, reason: `invalid_public_key: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  // Ed25519 signs the SRI hash itself (canonical content-addressed).
  const sig = Buffer.from(input.signatureBase64, 'base64');
  const verified = verifySig(null, Buffer.from(computed, 'base64'), publicKey, sig);
  if (!verified) {
    return { ok: false, reason: 'signature_invalid' };
  }
  return { ok: true };
}
