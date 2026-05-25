/**
 * RFC 0025 — Test-mode registry namespace.
 *
 * Mirror of the production /v1/packs/* publish/get/delete/sig surface
 * against an isolated, in-memory catalog. Lets the conformance suite
 * exercise the documented 19-code publish error catalog without
 * `packs:publish` scope on the real registry.
 *
 * Gated on `OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true`. When unset, the
 * routes are not mounted — every request under /v1/packs-test/ falls
 * through to the global 404 handler.
 *
 * Routes:
 *   PUT    /v1/packs-test/{name}/-/{version}.tgz   — publish to test catalog
 *   GET    /v1/packs-test/{name}/-/{version}.tgz   — fetch published tarball
 *   DELETE /v1/packs-test/{name}/-/{version}       — unpublish (window-gated)
 *   GET    /v1/packs-test/{name}/-/{version}.sig   — detached signature
 *   POST   /v1/packs-test/reset                    — clear test catalog (suite teardown)
 *
 * The validation pipeline runs in spec order — URL → body shape →
 * tarball extraction → manifest contents → integrity → auth/conflict —
 * first-failing-check wins, matching the production publish handler's
 * order. Scenarios authored against this namespace prove the production-
 * namespace contract.
 *
 * Per RFC 0025 §C, the test catalog is persisted distinctly from any
 * production catalog and never appears in production discovery listings.
 *
 * @see RFCS/0025-test-mode-registry-namespace.md
 * @see spec/v1/node-packs.md §"Test-mode registry namespace"
 */

import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extract as tarExtract } from 'tar-stream';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.packs-test');

/** Reverse-DNS pack-name pattern (shape only — scope checked separately). */
const REVERSE_DNS_SHAPE_RE = /^[a-z][a-z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;
/** Recognized scope prefixes per spec/v1/node-packs.md §Naming. */
const RECOGNIZED_SCOPE_RE = /^(core|vendor|community|private|local|sample)\./;
/** Full reverse-DNS pack-name pattern (scope + author + pack). */
const PACK_NAME_RE = /^(core|vendor|community|private|local|sample)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

/** RFC 0025 reference-impl caps. Sized for tractable conformance fixtures;
 *  production registries pick their own per node-packs.md §"PUT". */
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const UNPUBLISH_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Accepted runtime languages — matches the reference impl's loader scope. */
const ACCEPTED_RUNTIMES = new Set(['typescript', 'javascript', 'wasm', 'wasm-component']);

interface TestPackRecord {
  name: string;
  version: string;
  tarball: Buffer;
  tarballSha256: string;
  signature?: Buffer;
  publishedAt: number;
}

/** Module-scoped catalog. Distinct from any production catalog (Storage
 *  isn't even imported here). Cleared on host restart and on POST /reset. */
const testCatalog = new Map<string, TestPackRecord>();

const keyFor = (name: string, version: string): string => `${name}@${version}`;

/** Pretty SHA-256 of the canonical `sha256-<base64>` form (and lowercase-hex equivalent
 *  the conformance suite frequently sends). */
function normalizeSha256Header(headerVal: string | undefined): string | undefined {
  if (!headerVal) return undefined;
  return headerVal.trim();
}

function computeSha256Base64(buf: Buffer): string {
  return `sha256-${createHash('sha256').update(buf).digest('base64')}`;
}

function shaMatchesHeader(computed: string, asserted: string): boolean {
  if (computed === asserted) return true;
  // Suite-friendly: accept caller's `sha256-<hex>` too.
  const hexFromBase64 = Buffer.from(computed.slice('sha256-'.length), 'base64').toString('hex');
  if (asserted === `sha256-${hexFromBase64}`) return true;
  // Some clients send the bare 64-char hex.
  if (asserted.toLowerCase() === hexFromBase64) return true;
  return false;
}

function validateUrlParams(name: string, version: string): void {
  // Order matters: a name that doesn't look like reverse-DNS at all (single
  // segment, uppercase scope) surfaces `invalid_pack_name`; a name that DOES
  // look like reverse-DNS but declares an unrecognized scope surfaces
  // `invalid_pack_scope` (per node-packs.md §"PUT /v1/packs/{name}/-/{version}.tgz").
  if (!REVERSE_DNS_SHAPE_RE.test(name)) {
    throw new OpenwopError(
      'invalid_pack_name',
      `Pack name "${name}" does not match the reverse-DNS pattern (scope.author.pack).`,
      400,
      { name },
    );
  }
  if (!RECOGNIZED_SCOPE_RE.test(name)) {
    throw new OpenwopError(
      'invalid_pack_scope',
      `Pack name "${name}" declares an unrecognized scope. Allowed: core / vendor / community / private / local / sample.`,
      400,
      { name },
    );
  }
  if (!PACK_NAME_RE.test(name)) {
    throw new OpenwopError(
      'invalid_pack_name',
      `Pack name "${name}" matches a recognized scope but fails the reverse-DNS detail pattern.`,
      400,
      { name },
    );
  }
  if (!SEMVER_RE.test(version)) {
    throw new OpenwopError(
      'invalid_version',
      `Version "${version}" is not a valid semver 2.0.0 string.`,
      400,
      { version },
    );
  }
}

function readGzipBytes(req: Request): Buffer {
  const ct = (req.headers['content-type'] ?? '').toString().toLowerCase();
  if (ct.startsWith('application/json')) {
    throw new OpenwopError(
      'invalid_body',
      'Body must be tarball bytes (application/octet-stream / application/gzip), not JSON.',
      400,
    );
  }
  const body = req.body as Buffer | undefined;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new OpenwopError(
      'invalid_body',
      'Body MUST be a non-empty Buffer of gzipped tarball bytes.',
      400,
    );
  }
  return body;
}

function decompressOrThrow(body: Buffer): Buffer {
  // Quick gzip-magic check — fast-path the most common malformed-body case.
  if (body.length < 2 || body[0] !== 0x1f || body[1] !== 0x8b) {
    throw new OpenwopError(
      'tarball_gunzip_failed',
      'Body is not a valid gzip stream (magic bytes 0x1f 0x8b missing).',
      400,
    );
  }
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(body);
  } catch (err) {
    throw new OpenwopError(
      'tarball_gunzip_failed',
      `Body could not be gunzipped: ${err instanceof Error ? err.message : String(err)}.`,
      400,
    );
  }
  if (decompressed.length > MAX_DECOMPRESSED_BYTES) {
    throw new OpenwopError(
      'tarball_too_large',
      `Decompressed tarball exceeds the test catalog's ${MAX_DECOMPRESSED_BYTES}-byte cap.`,
      400,
      { decompressedBytes: decompressed.length, cap: MAX_DECOMPRESSED_BYTES },
    );
  }
  return decompressed;
}

interface ParsedEntry {
  name: string;
  contents: Buffer;
}

/** Parse the decompressed tar stream into per-entry buffers. Synchronous
 *  in spirit — `tar-stream` is event-driven so we wrap into a Promise. */
function parseTar(body: Buffer): Promise<ParsedEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ParsedEntry[] = [];
    const extractor = tarExtract();
    extractor.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let traversal = false;
      const entryName = header.name;
      if (entryName.includes('..') || entryName.startsWith('/')) {
        traversal = true;
      }
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_ENTRY_BYTES) {
          stream.removeAllListeners('data');
          stream.resume();
          reject(new OpenwopError(
            'tarball_entry_too_large',
            `Entry "${entryName}" exceeds the per-file ${MAX_ENTRY_BYTES}-byte cap.`,
            400,
            { entry: entryName, cap: MAX_ENTRY_BYTES },
          ));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (traversal) {
          reject(new OpenwopError(
            'tarball_path_traversal',
            `Entry "${entryName}" attempts to escape the pack root.`,
            400,
            { entry: entryName },
          ));
          return;
        }
        entries.push({ name: entryName, contents: Buffer.concat(chunks) });
        next();
      });
      stream.on('error', (err) => {
        reject(new OpenwopError(
          'tarball_tar_parse_failed',
          `tar entry "${entryName}" failed to read: ${err.message}.`,
          400,
        ));
      });
      stream.resume();
    });
    extractor.on('finish', () => resolve(entries));
    extractor.on('error', (err: Error) => {
      reject(new OpenwopError(
        'tarball_tar_parse_failed',
        `tar parser could not read the stream past the gzip layer: ${err.message}.`,
        400,
      ));
    });
    extractor.end(body);
  });
}

interface Manifest {
  name?: unknown;
  version?: unknown;
  runtime?: { language?: unknown; entry?: unknown };
}

function validateManifest(
  entries: ParsedEntry[],
  urlName: string,
  urlVersion: string,
): { manifest: Manifest; signature?: Buffer } {
  const manifestEntry = entries.find((e) => e.name === 'pack.json' || e.name === './pack.json');
  if (!manifestEntry) {
    throw new OpenwopError(
      'tarball_manifest_missing',
      'No `pack.json` at the tarball root.',
      400,
    );
  }
  if (manifestEntry.contents.length > MAX_MANIFEST_BYTES) {
    throw new OpenwopError(
      'tarball_manifest_too_large',
      `pack.json exceeds the per-file ${MAX_MANIFEST_BYTES}-byte cap.`,
      400,
      { manifestBytes: manifestEntry.contents.length, cap: MAX_MANIFEST_BYTES },
    );
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestEntry.contents.toString('utf8')) as Manifest;
  } catch (err) {
    throw new OpenwopError(
      'tarball_manifest_not_json',
      `pack.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
      400,
    );
  }
  if (!manifest || typeof manifest !== 'object' || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new OpenwopError(
      'invalid_manifest',
      'pack.json must declare top-level string `name` and `version`.',
      400,
    );
  }
  if (manifest.name !== urlName && manifest.version !== urlVersion) {
    throw new OpenwopError(
      'manifest_mismatch',
      `manifest.name (${manifest.name}) and manifest.version (${manifest.version}) both differ from URL (${urlName}@${urlVersion}).`,
      400,
      { urlName, urlVersion, manifestName: manifest.name, manifestVersion: manifest.version },
    );
  }
  if (manifest.name !== urlName) {
    throw new OpenwopError(
      'manifest_name_mismatch',
      `manifest.name (${manifest.name}) differs from URL pack-name (${urlName}).`,
      400,
      { urlName, manifestName: manifest.name },
    );
  }
  if (manifest.version !== urlVersion) {
    throw new OpenwopError(
      'manifest_version_mismatch',
      `manifest.version (${manifest.version}) differs from URL version (${urlVersion}).`,
      400,
      { urlVersion, manifestVersion: manifest.version },
    );
  }
  const runtime = manifest.runtime;
  if (runtime && typeof runtime === 'object') {
    const lang = runtime.language;
    if (typeof lang === 'string' && !ACCEPTED_RUNTIMES.has(lang)) {
      throw new OpenwopError(
        'unsupported_runtime',
        `runtime.language "${lang}" is not accepted by this test catalog.`,
        400,
        { runtime: lang, accepted: Array.from(ACCEPTED_RUNTIMES) },
      );
    }
    if (typeof runtime.entry === 'string') {
      const entry = runtime.entry;
      const found = entries.find((e) => e.name === entry || e.name === `./${entry}`);
      if (!found) {
        throw new OpenwopError(
          'tarball_entry_missing',
          `manifest.runtime.entry "${entry}" is not present in the tarball.`,
          400,
          { entry },
        );
      }
    }
  }
  const sigEntry = entries.find((e) => e.name === 'pack.sig' || e.name === './pack.sig' || e.name === 'signature.sig');
  return { manifest, signature: sigEntry?.contents };
}

function isPackPublishScoped(req: Request): boolean {
  // The conformance suite's API key is treated as universally-scoped in the
  // reference impl — auth middleware sets req.principal but does not enforce
  // per-scope claims. Production registries MUST enforce `packs:publish` here.
  // This stub returns true so the §"forbidden" scenario soft-skips per RFC 0025
  // §C ("hosts MAY accept the suite key universally").
  return req.headers.authorization != null;
}

export function registerPackTestRoutes(app: Express): void {
  if (process.env.OPENWOP_PACKS_TEST_NAMESPACE_ENABLED !== 'true') {
    log.info('packs-test namespace disabled (set OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true to enable)');
    return;
  }
  log.warn(
    'packs-test namespace ENABLED — /v1/packs-test/* is reachable. ' +
    'Catalog is isolated from /v1/packs/* but NEVER expose this in production.',
  );

  // Raw-bytes body parser scoped to this namespace. Registered with a
  // wildcard content-type so JSON payloads still hit the validator (they
  // surface `invalid_body`). Limit slightly above the documented cap so
  // the `tarball_too_large` check fires inside the handler with a useful
  // envelope rather than express's terse 413.
  const rawBody = express.raw({ type: '*/*', limit: '60mb' });

  // POST /v1/packs-test/reset — RFC 0025 §C point 4. Suite teardown hook.
  app.post('/v1/packs-test/reset', (_req, res) => {
    const cleared = testCatalog.size;
    testCatalog.clear();
    res.status(200).json({ cleared });
  });

  // PUT /v1/packs-test/{name}/-/{version}.tgz
  app.put(
    /^\/v1\/packs-test\/([^/]+)\/-\/([^/]+)\.tgz$/,
    rawBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = req.params as Record<string, string>;
        const name = decodeURIComponent(params['0'] ?? '');
        const version = decodeURIComponent(params['1'] ?? '');
        validateUrlParams(name, version);

        if (!isPackPublishScoped(req)) {
          throw new OpenwopError(
            'forbidden',
            'Caller lacks `packs:publish` scope.',
            403,
          );
        }

        const gzipped = readGzipBytes(req);
        const decompressed = decompressOrThrow(gzipped);
        const entries = await parseTar(decompressed);
        const { manifest: _manifest, signature } = validateManifest(entries, name, version);

        const computedSha = computeSha256Base64(gzipped);
        const asserted = normalizeSha256Header(req.header('X-Pack-Sha256'));
        if (asserted && !shaMatchesHeader(computedSha, asserted)) {
          throw new OpenwopError(
            'pack_integrity_failure',
            'Server-computed SHA-256 does not match X-Pack-Sha256.',
            400,
            { computed: computedSha, asserted },
          );
        }

        const key = keyFor(name, version);
        const existing = testCatalog.get(key);
        if (existing) {
          if (existing.tarballSha256 === computedSha) {
            // Idempotent re-publish.
            res.status(200).json({
              name,
              version,
              tarballSha256: computedSha,
              publishedAt: new Date(existing.publishedAt).toISOString(),
              signed: existing.signature != null,
            });
            return;
          }
          throw new OpenwopError(
            'conflict',
            `Version ${name}@${version} already published with different content.`,
            409,
            { name, version, existingSha: existing.tarballSha256, newSha: computedSha },
          );
        }
        const record: TestPackRecord = {
          name,
          version,
          tarball: gzipped,
          tarballSha256: computedSha,
          publishedAt: Date.now(),
        };
        if (signature) record.signature = signature;
        testCatalog.set(key, record);
        res.status(201).json({
          name,
          version,
          tarballSha256: computedSha,
          publishedAt: new Date(record.publishedAt).toISOString(),
          signed: record.signature != null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /v1/packs-test/{name}/-/{version}.tgz
  app.get(/^\/v1\/packs-test\/([^/]+)\/-\/([^/]+)\.tgz$/, (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const name = decodeURIComponent(params['0'] ?? '');
      const version = decodeURIComponent(params['1'] ?? '');
      validateUrlParams(name, version);
      const record = testCatalog.get(keyFor(name, version));
      if (!record) {
        throw new OpenwopError(
          'pack_not_found',
          `Pack ${name}@${version} not found in the test catalog.`,
          404,
          { name, version },
        );
      }
      res.set('Content-Type', 'application/tar+gzip');
      res.set('ETag', `"${record.tarballSha256}"`);
      res.status(200).send(record.tarball);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /v1/packs-test/{name}/-/{version}
  app.delete(/^\/v1\/packs-test\/([^/]+)\/-\/([^/]+)$/, (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const name = decodeURIComponent(params['0'] ?? '');
      const version = decodeURIComponent(params['1'] ?? '');
      validateUrlParams(name, version);
      if (!isPackPublishScoped(req)) {
        throw new OpenwopError('forbidden', 'Caller lacks `packs:publish` scope.', 403);
      }
      const record = testCatalog.get(keyFor(name, version));
      if (!record) {
        throw new OpenwopError(
          'pack_not_found',
          `Pack ${name}@${version} not found in the test catalog.`,
          404,
          { name, version },
        );
      }
      if (Date.now() - record.publishedAt > UNPUBLISH_WINDOW_MS) {
        throw new OpenwopError(
          'unpublish_window_expired',
          `Version ${name}@${version} is older than the ${UNPUBLISH_WINDOW_MS / 3_600_000}h unpublish window.`,
          400,
          { name, version, ageMs: Date.now() - record.publishedAt },
        );
      }
      testCatalog.delete(keyFor(name, version));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/packs-test/{name}/-/{version}.sig
  app.get(/^\/v1\/packs-test\/([^/]+)\/-\/([^/]+)\.sig$/, (req, res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const name = decodeURIComponent(params['0'] ?? '');
      const version = decodeURIComponent(params['1'] ?? '');
      validateUrlParams(name, version);
      const record = testCatalog.get(keyFor(name, version));
      if (!record || !record.signature) {
        throw new OpenwopError(
          'signature_not_available',
          `Signature for ${name}@${version} not available (pack missing, yanked, or unsigned).`,
          404,
          { name, version },
        );
      }
      res.set('Content-Type', 'application/octet-stream');
      res.status(200).send(record.signature);
    } catch (err) {
      next(err);
    }
  });
}

/** Test-only accessor for the in-memory catalog. Exposed so cross-namespace
 *  isolation tests (RFC 0025 §C point 1) can introspect without going
 *  through the HTTP surface. NOT exported on the public route surface. */
export function _testGetCatalogSize(): number {
  return testCatalog.size;
}
