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
import { createPublicKey, verify } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { installPackTemplates, type PromptTemplate } from './promptStore.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('prompt-pack-loader');

// __dirname-equivalent for ESM. Used to anchor schema lookups.
const __dirname = dirname(fileURLToPath(import.meta.url));
// host/ → src → typescript → backend → workflow-engine → apps → repo-root
const SCHEMAS_DIR = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'schemas');

// Lazily compiled. Cross-refs to `prompt-kind.schema.json` +
// `prompt-template.schema.json` are pre-loaded so the manifest
// schema's $refs resolve without per-pack disk hits.
let _manifestValidator: ValidateFunction | null = null;

function loadManifestValidator(): ValidateFunction {
  if (_manifestValidator) return _manifestValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Pre-load every prompt-* schema so the manifest schema's relative
  // $refs (`./prompt-kind.schema.json`, `./prompt-template.schema.json`)
  // resolve. Order doesn't matter — Ajv resolves at compile time.
  for (const name of ['prompt-kind.schema.json', 'prompt-template.schema.json', 'prompt-ref.schema.json']) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
    ajv.addSchema(schema, name);
    ajv.addSchema(schema, `./${name}`);
  }
  const manifestSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'prompt-pack-manifest.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  _manifestValidator = ajv.compile(manifestSchema);
  return _manifestValidator;
}

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
  /** Signature-verification outcome for the manifest:
   *   - `"verified"`: the pack carried a `signing` block and the
   *     Ed25519 verify call returned true.
   *   - `"skipped"`: the pack carried no `signing` block (accepted
   *     under the in-tree-dev posture; rejected when
   *     `OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE=true`).
   *   - `"failed"`: the pack carried a `signing` block but verify
   *     returned false / threw — the pack was NOT installed. */
  signatureCheck: 'verified' | 'skipped' | 'failed';
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

      // Install-time validation step 2 per RFC 0028 §B: validate the
      // manifest against `prompt-pack-manifest.schema.json` before
      // calling installPackTemplates(). A malformed pack that slips
      // through here would otherwise surface garbage through
      // `GET /v1/prompts`, breaking the RFC 0028 §A response contract.
      const validate = loadManifestValidator();
      const isValid = validate(manifest);
      if (!isValid) {
        log.warn('prompt_pack_manifest_invalid', {
          packName: manifest.name,
          packVersion: manifest.version,
          errors: (validate.errors ?? []).slice(0, 8).map((e) => `${e.instancePath} ${e.message}`),
        });
        continue;
      }

      const signatureCheck = verifyManifestSignature(packDir, manifest);
      if (signatureCheck === 'skipped' && requireSig) {
        log.warn('prompt_pack_signature_required', {
          packName: manifest.name,
          packVersion: manifest.version,
          reason: 'OPENWOP_PROMPT_PACK_REQUIRE_SIGNATURE=true requires a signing block',
        });
        continue;
      }
      if (signatureCheck === 'failed') {
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
        signatureCheck,
      });
      results.push({
        packName: manifest.name,
        packVersion: manifest.version,
        templatesInstalled: install.installed,
        rejected: install.rejected,
        signatureCheck,
      });
    }
  }
  return results;
}

/** Verify a detached Ed25519 signature over `pack.json` bytes.
 *  Returns one of:
 *   - `"skipped"`: no `signing` block — nothing to verify.
 *   - `"verified"`: signing block present + verify returned true.
 *   - `"failed"`: signing block present but verify returned false,
 *     key/sig file missing, or the verify call threw.
 *
 *  Implementation aligns with `registry-operations.md` §"Signature
 *  verification" — same recipe as node + workflow-chain packs.
 *  Uses `node:crypto` Ed25519 verify (Node 16+ stdlib). */
function verifyManifestSignature(
  packDir: string,
  manifest: PromptPackManifest,
): 'verified' | 'skipped' | 'failed' {
  if (!manifest.signing) return 'skipped';
  const { publicKeyRef, signatureRef } = manifest.signing;
  if (!publicKeyRef || !signatureRef) return 'failed';
  const pubKeyPath = join(packDir, publicKeyRef);
  const sigPath = join(packDir, signatureRef);
  if (!existsSync(pubKeyPath) || !existsSync(sigPath)) return 'failed';

  try {
    const pubKeyPem = readFileSync(pubKeyPath, 'utf8');
    const signature = readFileSync(sigPath);
    const manifestBytes = readFileSync(join(packDir, 'pack.json'));
    const publicKey = createPublicKey({ key: pubKeyPem, format: 'pem' });
    return verify(null, manifestBytes, publicKey, signature) ? 'verified' : 'failed';
  } catch (err) {
    log.warn('prompt_pack_signature_verify_error', {
      packName: manifest.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}

/** Convenience helper: default pack roots for the workflow-engine
 *  sample. Includes the in-tree `examples/packs/` so the
 *  `vendor.openwop.prompt-sample` example pack auto-installs at boot
 *  without operator config. Production hosts override via the
 *  `roots: [...]` arg. */
export function defaultPromptPackRoots(): readonly string[] {
  const __filename = fileURLToPath(import.meta.url);
  // Walk seven `..` segments from this file to reach the repo root:
  //   promptPackLoader.ts → host → src → typescript → backend →
  //   workflow-engine → apps → <repo-root>.
  const repoRoot = join(__filename, '..', '..', '..', '..', '..', '..', '..');
  return [
    // In-tree examples (workflow-engine sample reads these directly).
    join(repoRoot, 'examples', 'packs'),
    // Operator-managed dir, when present.
    process.env.OPENWOP_PROMPT_PACKS_DIR ?? '',
  ].filter((p) => p.length > 0);
}
