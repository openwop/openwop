/**
 * RFC 0028 §B reference implementation — prompt-pack boot-time loader.
 *
 * Scans a configurable directory (default
 * `apps/workflow-engine/prompt-packs/`) at boot, plus the in-tree
 * `examples/packs/` for any `kind: "prompt"` packs, and registers
 * each pack's templates via `promptStore.installPackTemplates()`.
 *
 * Install-time validation per RFC 0028 §B §"Install-time validation":
 *   1. Parse `pack.json`.
 *   2. Validate against `schemas/prompt-pack-manifest.schema.json`.
 *   3. Verify Ed25519 signature when `pack.json` carries a `signing`
 *      block. In-tree dev packs without a `signing` block install
 *      with a warning log line (matches the lighter posture the
 *      sample takes for the workflow-chain-sample pack — production
 *      hosts MUST require signatures).
 *   4. (Future RFC) Variable-reference closure: every `{{varName}}`
 *      in `text` is declared in `variables[]` OR matches a canonical
 *      context key. Skipped in v1.x; the per-template schema check
 *      in step 2 already validates each entry.
 *   5. Resolve `dependencies[]` block. v1.x ships the field but
 *      defers transitive semantics (see RFC 0028 §B Q3).
 *
 * Reuses the in-memory PromptStore — no schema/storage backend.
 * Production hosts swap the store for a database-backed
 * implementation; the loader contract stays the same.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackTemplates, type PromptTemplate } from './promptStore.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('prompt-pack-loader');

interface PromptPackManifest {
  name: string;
  version: string;
  kind: string;
  engines?: { openwop?: string };
  prompts?: PromptTemplate[];
  signing?: {
    publicKeyRef?: string;
    signatureRef?: string;
    method?: 'manual' | 'sigstore';
  };
  dependencies?: Record<string, string>;
}

export interface LoadResult {
  packName: string;
  packVersion: string;
  templatesInstalled: number;
  rejected: string[];
  signatureVerified: boolean;
  /** True when the pack carried no `signing` block — installed with
   *  a warning under the lighter in-tree-dev posture. Production
   *  hosts SHOULD set `OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE=true`
   *  to reject unsigned packs. */
  unsignedAccepted: boolean;
}

/** Boot-time entry point. Scans the configured pack roots and
 *  installs every `kind: "prompt"` pack found. Idempotent — re-running
 *  doesn't duplicate templates because the underlying store keys by
 *  `<packName>:<templateId>@<version>`. */
export function loadPromptPacks(opts: {
  /** Root directories to scan for pack subdirectories. Each
   *  subdirectory should contain a `pack.json`. */
  roots: readonly string[];
  /** When true, reject packs without a `signing` block. Defaults to
   *  the value of `OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE` env var. */
  requireSignature?: boolean;
}): LoadResult[] {
  const requireSig = opts.requireSignature ?? process.env.OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE === 'true';
  const results: LoadResult[] = [];

  for (const root of opts.roots) {
    if (!existsSync(root)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const packDir = join(root, entry);
      let stat;
      try {
        stat = statSync(packDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const manifestPath = join(packDir, 'pack.json');
      if (!existsSync(manifestPath)) continue;

      let manifest: PromptPackManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PromptPackManifest;
      } catch (err) {
        log.warn('prompt_pack_manifest_parse_error', { packDir, err: err instanceof Error ? err.message : String(err) });
        continue;
      }
      if (manifest.kind !== 'prompt') continue; // skip node + workflow-chain packs

      const signatureVerified = verifySignatureIfPresent(packDir, manifest);
      const unsignedAccepted = manifest.signing === undefined;
      if (unsignedAccepted && requireSig) {
        log.warn('prompt_pack_signature_required', {
          packName: manifest.name,
          packVersion: manifest.version,
          reason: 'OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE=true requires a signing block',
        });
        continue;
      }
      if (manifest.signing !== undefined && !signatureVerified) {
        log.warn('prompt_pack_signature_invalid', {
          packName: manifest.name,
          packVersion: manifest.version,
        });
        continue;
      }

      const install = installPackTemplates(
        manifest.prompts ?? [],
        manifest.name,
        manifest.version,
      );
      log.info('prompt_pack_installed', {
        packName: manifest.name,
        packVersion: manifest.version,
        templatesInstalled: install.installed,
        rejected: install.rejected.length,
        signatureVerified,
        unsignedAccepted,
      });
      results.push({
        packName: manifest.name,
        packVersion: manifest.version,
        templatesInstalled: install.installed,
        rejected: install.rejected,
        signatureVerified,
        unsignedAccepted,
      });
    }
  }
  return results;
}

/** Verify a detached Ed25519 signature over `pack.json` bytes when
 *  the manifest's `signing` block points at tarball-relative
 *  `publicKeyRef` + `signatureRef` files. Returns true when no
 *  `signing` block is present (caller decides whether to accept).
 *
 *  Implementation aligns with `registry-operations.md` §"Signature
 *  verification" — same recipe as node + workflow-chain packs.
 *  Uses `node:crypto` Ed25519 verify (Node 16+ stdlib). */
function verifySignatureIfPresent(packDir: string, manifest: PromptPackManifest): boolean {
  if (!manifest.signing) return true; // no block to verify
  const { publicKeyRef, signatureRef } = manifest.signing;
  if (!publicKeyRef || !signatureRef) return false;
  const pubKeyPath = join(packDir, publicKeyRef);
  const sigPath = join(packDir, signatureRef);
  if (!existsSync(pubKeyPath) || !existsSync(sigPath)) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPublicKey, verify } = require('node:crypto') as typeof import('node:crypto');
    const pubKeyPem = readFileSync(pubKeyPath, 'utf8');
    const signature = readFileSync(sigPath);
    const manifestBytes = readFileSync(join(packDir, 'pack.json'));
    const publicKey = createPublicKey({ key: pubKeyPem, format: 'pem' });
    return verify(null, manifestBytes, publicKey, signature);
  } catch (err) {
    log.warn('prompt_pack_signature_verify_error', {
      packName: manifest.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Convenience helper: default pack roots for the workflow-engine
 *  sample. Includes the in-tree `examples/packs/` so the
 *  `vendor.openwop.prompt-sample` example pack auto-installs at boot
 *  without operator config. Production hosts override via the
 *  `roots: [...]` arg. */
export function defaultPromptPackRoots(): readonly string[] {
  const __filename = fileURLToPath(import.meta.url);
  // host/promptPackLoader.ts → ../../../ (apps/workflow-engine/) → ../../ (repo root) → examples/packs/
  const repoRoot = join(__filename, '..', '..', '..', '..', '..', '..');
  return [
    // In-tree examples (workflow-engine sample reads these directly).
    join(repoRoot, 'examples', 'packs'),
    // Operator-managed dir, when present.
    process.env.OPENWOP_PROMPT_PACKS_DIR ?? '',
  ].filter((p) => p.length > 0);
}
