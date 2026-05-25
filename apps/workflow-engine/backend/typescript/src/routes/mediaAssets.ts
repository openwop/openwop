/**
 * RFC 0055 §C reference-host media-asset serving.
 *
 *   GET  /v1/host/sample/assets/:token   → serves the asset bytes (public,
 *                                          token-authed — like /v1/interrupts/{token}).
 *   POST /v1/host/sample/media/put        → stores an asset, returns its
 *                                           tenant-scoped URL (authed, test-seam gated).
 *
 * The serve route is token-authed: the capability token (32 random bytes,
 * base64url — the interrupt recipe) IS the credential, so the URL is
 * non-guessable and intrinsically tenant-scoped (the stored entry carries
 * its own tenantId). This satisfies the `media-asset-url-tenant-scoped`
 * SECURITY invariant — a token minted for tenant A never resolves to
 * tenant B's bytes, and B cannot guess A's token.
 *
 * The store route is the demo's way to populate an asset (a real host
 * stores when an LLM node emits media); it's gated behind the same env
 * flag as the test seam so the anonymous public demo can't be used as
 * arbitrary object storage.
 */

import type { Express } from 'express';
import { resolveMediaAsset, storeMediaAsset } from '../host/inMemorySurfaces.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.mediaAssets');

/** RFC 0055 §C rule 2 — inline-vs-URL cap advertised on aiProviders. Default
 *  256 KiB (matches the schema default); operators widen via env. */
export const MAX_INLINE_MEDIA_BYTES = process.env.OPENWOP_MAX_INLINE_MEDIA_BYTES
  ? Math.max(0, Number(process.env.OPENWOP_MAX_INLINE_MEDIA_BYTES) || 0)
  : 262144;

// Cap a stored asset at 8 MiB of base64 so the demo's in-memory store can't
// be flooded by a single request.
const MAX_STORE_BASE64_LEN = 8 * 1024 * 1024;

export function registerMediaAssetRoutes(app: Express): void {
  // Serve — always on. The token is the capability.
  app.get('/v1/host/sample/assets/:token', (req, res) => {
    const token = req.params.token ?? '';
    const entry = resolveMediaAsset(token);
    if (!entry) {
      res.status(404).json({ error: 'not_found', message: 'asset not found or expired' });
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', entry.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(entry.contentBase64, 'base64'));
  });

  // Store — test/demo affordance, env-gated like the test seam. Tenant from
  // req.tenantId (never the body), per CTI-1.
  const storeEnabled = process.env.OPENWOP_TEST_SEAM_ENABLED === 'true';
  if (storeEnabled) {
    app.post('/v1/host/sample/media/put', (req, res) => {
      const tenantId = req.tenantId ?? 'default';
      const body = (req.body ?? {}) as { contentBase64?: unknown; contentType?: unknown; ttlSeconds?: unknown };
      if (typeof body.contentBase64 !== 'string' || body.contentBase64.length === 0) {
        res.status(400).json({ error: 'invalid_argument', message: 'contentBase64 (non-empty string) required' });
        return;
      }
      if (body.contentBase64.length > MAX_STORE_BASE64_LEN) {
        res.status(413).json({ error: 'payload_too_large', message: `contentBase64 exceeds ${MAX_STORE_BASE64_LEN} chars` });
        return;
      }
      const contentType = typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream';
      const ttlSeconds = typeof body.ttlSeconds === 'number' && body.ttlSeconds > 0 ? body.ttlSeconds : undefined;
      const stored = storeMediaAsset(tenantId, {
        contentBase64: body.contentBase64,
        contentType,
        ...(ttlSeconds ? { ttlSeconds } : {}),
      });
      res.status(201).json(stored);
    });
    log.warn('media-asset store ENABLED (POST /v1/host/sample/media/put) — test/demo only.');
  }

  log.info('media-asset serve route registered (GET /v1/host/sample/assets/:token)');
}
