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
import { SuspendSignal } from '../executor/suspendSignal.js';
import { createLogger } from '../observability/logger.js';
import { isInstalledPack, verifyInstalledPack } from './registryInstaller.js';

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

  // Registry-installed packs carry a `.openwop-installed.json` trust
  // marker. Install-time verified the tarball SRI + Ed25519 signature
  // over `pack.json` bytes — re-verifying the legacy
  // `manifest.signature` (sha384-over-pack.json) would be both
  // redundant and use a different algorithm. We DO re-verify the
  // marker's content hashes on every load so post-install tampering
  // (e.g., `index.mjs` swapped) is caught.
  const trustedFromInstall = isInstalledPack(packDir);
  if (trustedFromInstall) {
    const reason = verifyInstalledPack(packDir);
    if (reason) {
      log.error('installed pack tampering detected; refusing to load', { packDir, reason });
      return null;
    }
  }

  // Per spec/v1/node-packs.md: SRI + Ed25519 verification is REQUIRED for
  // packs from a registry. The sample only loads from disk so verification
  // is opt-in via the manifest's `signature` block — this exists primarily
  // to demonstrate the verification path; production callers wire this for
  // every pack tarball before extraction.
  if (manifest.signature && !trustedFromInstall) {
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
        // Forward the spec-defined NodeContext surface to the pack.
        // Packs receive `inputs` + `config` (the static node config)
        // PLUS the host-capability methods (`callAI`, `callAIWithTools`,
        // `emit`, `secrets`, …) per `spec/v1/host-capabilities.md`.
        // The pack-side `pack-node-error` shape preserves whatever the
        // node throws; we don't downgrade errors with `code` to a
        // generic `pack_node_error` because policy-denied / model-not-
        // allowed errors need their canonical code to propagate to
        // the run event log.
        let result: unknown;
        try {
          result = await (fn as (c: unknown) => Promise<unknown>)(ctx);
        } catch (err) {
          // ctx.suspend/ctx.interrupt threw — let the executor convert it to a
          // suspended outcome (don't downgrade it to pack_node_error here).
          if (err instanceof SuspendSignal) throw err;
          const code =
            err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
              ? ((err as { code: string }).code)
              : 'pack_node_error';
          const rawMessage = err instanceof Error ? err.message : String(err);
          // {host_capability_missing, HOST_CAPABILITY_MISSING} is the
          // common case for packs that delegate to ctx.storage / ctx.db
          // / ctx.fs / etc. on hosts that don't advertise the surface.
          // Augment with a guide pointer instead of leaving the bare
          // delegate error. (The casing varies across packs — some use
          // SCREAMING_SNAKE, others lower_snake. Match both.)
          const message =
            code.toLowerCase() === 'host_capability_missing'
              ? `${rawMessage}. This host does not advertise the required surface — see GET /.well-known/openwop capabilities.hostSurfaces, or run examples/hosts/postgres for a host that wires every surface.`
              : rawMessage;
          return { status: 'failure', error: { code, message } };
        }
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
 * This helper covers the LEGACY on-disk shape (sha384 integrity over
 * the raw `pack.json` bytes; signature over those same bytes). It's
 * NOT the registry recipe — packs from packs.openwop.dev are SHA-256
 * SRI over the whole tarball, with Ed25519 signing the raw
 * `pack.json` bytes extracted from the tarball. See
 * `registry/scripts/verify-signatures.mjs` (canonical) and
 * `packs/registryInstaller.ts` (this codebase's consumer) for that
 * flow.
 *
 * SRI verifies bytes-vs-hash; signature verifies bytes-vs-key. The
 * signature is NOT over the SRI hash — that would be a layer of
 * indirection the canonical verifier doesn't perform.
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

  // Ed25519 signs the manifest bytes directly (NOT the SRI hash).
  // Mirrors `registry/scripts/verify-signatures.mjs` so a publisher
  // who reads either helper builds compatible signatures.
  const sig = Buffer.from(input.signatureBase64, 'base64');
  const verified = verifySig(null, input.tarballBytes, publicKey, sig);
  if (!verified) {
    return { ok: false, reason: 'signature_invalid' };
  }
  return { ok: true };
}
