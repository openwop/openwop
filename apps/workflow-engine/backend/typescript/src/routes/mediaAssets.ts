/**
 * RFC 0055 §C reference-host media-asset serving.
 *
 *   GET  /v1/host/sample/assets/:token   → serves the asset bytes (public,
 *                                          token-authed — like /v1/interrupts/{token}).
 *   POST /v1/host/sample/media/upload     → first-class chat-attachment upload
 *                                           (always-on, per-tenant daily quota).
 *   POST /v1/host/sample/media/put        → low-level asset put (test-seam gated).
 *
 * The serve route is token-authed: the capability token (32 random bytes,
 * base64url — the interrupt recipe) IS the credential, so the URL is
 * non-guessable and intrinsically tenant-scoped (the stored entry carries
 * its own tenantId). This satisfies the `media-asset-url-tenant-scoped`
 * SECURITY invariant — a token minted for tenant A never resolves to
 * tenant B's bytes, and B cannot guess A's token.
 *
 * `media/put` is the demo's low-level way to populate an asset (a real host
 * stores when an LLM node emits media); it stays gated behind the test-seam
 * env flag. The first-class `media/upload` route below replaces it for the
 * chat-attachment use case: it is ALWAYS ON (so the public demo can attach
 * files) but bounded by a per-tenant daily byte + count quota, so it cannot
 * be abused as unmetered object storage the way an ungated `put` could.
 */

import type { Express, Request, Response } from 'express';
import { resolveMediaAsset, storeMediaAsset } from '../host/inMemorySurfaces.js';
import { DurableCollection } from '../host/hostExtPersistence.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.mediaAssets');

/** RFC 0055 §C rule 2 — inline-vs-URL cap advertised on aiProviders. Default
 *  256 KiB (matches the schema default); operators widen via env. Files at or
 *  below this go inline (`dataBase64`) in the chat message — replay-safe by
 *  construction; larger files upload here and are referenced by URL. */
export const MAX_INLINE_MEDIA_BYTES = process.env.OPENWOP_MAX_INLINE_MEDIA_BYTES
  ? Math.max(0, Number(process.env.OPENWOP_MAX_INLINE_MEDIA_BYTES) || 0)
  : 262144;

// Cap a stored asset at 8 MiB of base64 (~6 MiB binary) so the demo's store
// can't be flooded by a single request. Kept in lockstep with the scoped
// body-parser limit mounted in index.ts (`/v1/host/sample/media` → 12mb).
const MAX_STORE_BASE64_LEN = 8 * 1024 * 1024;

// Per-tenant daily upload quota for the first-class `media/upload` route. The
// public demo mints a throwaway `anon:<sid>` tenant per session, so this caps
// each session; signed-in users (`user:<hash>`) get the same budget per day.
// Self-healing rolling window — no need to decrement on TTL expiry.
const UPLOAD_TENANT_DAILY_BYTES = process.env.OPENWOP_MEDIA_UPLOAD_DAILY_BYTES
  ? Math.max(0, Number(process.env.OPENWOP_MEDIA_UPLOAD_DAILY_BYTES) || 0)
  : 50 * 1024 * 1024; // 50 MiB/day/tenant
const UPLOAD_TENANT_DAILY_COUNT = process.env.OPENWOP_MEDIA_UPLOAD_DAILY_COUNT
  ? Math.max(0, Number(process.env.OPENWOP_MEDIA_UPLOAD_DAILY_COUNT) || 0)
  : 50; // 50 files/day/tenant
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

// Uploaded chat attachments outlive a single chat turn so a fork/replay of the
// run that referenced them by URL can still re-resolve (retention ≥ run
// lifetime). LLM-emitted media keeps the shorter inMemorySurfaces default.
const UPLOADED_ASSET_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Allow-list of MIME types a chat attachment may carry. Mirrors the FE
// `accept` attribute. Anything else is rejected fail-closed.
const ALLOWED_UPLOAD_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
]);

interface TenantUploadUsage {
  tenantId: string;
  windowStartMs: number;
  bytes: number;
  count: number;
}

/** Per-tenant rolling-window upload accounting (durable, read-through). One
 *  small row per tenant — never holds asset bytes. */
const _uploadUsage = new DurableCollection<TenantUploadUsage>('media:upload-usage', (u) => u.tenantId);

/** Charge `bytes` against the tenant's daily budget. Returns null when the
 *  charge fits (and persists the new total) or a reason string when it would
 *  exceed a cap (and persists nothing). */
async function chargeUploadQuota(tenantId: string, bytes: number): Promise<string | null> {
  const now = Date.now();
  const prev = await _uploadUsage.get(tenantId);
  const fresh = !prev || now - prev.windowStartMs >= QUOTA_WINDOW_MS;
  const windowStartMs = fresh ? now : prev!.windowStartMs;
  const usedBytes = fresh ? 0 : prev!.bytes;
  const usedCount = fresh ? 0 : prev!.count;
  if (usedCount + 1 > UPLOAD_TENANT_DAILY_COUNT) {
    return `daily upload count limit reached (${UPLOAD_TENANT_DAILY_COUNT} files/day)`;
  }
  if (usedBytes + bytes > UPLOAD_TENANT_DAILY_BYTES) {
    return `daily upload byte limit reached (${Math.floor(UPLOAD_TENANT_DAILY_BYTES / (1024 * 1024))} MiB/day)`;
  }
  await _uploadUsage.put({ tenantId, windowStartMs, bytes: usedBytes + bytes, count: usedCount + 1 });
  return null;
}

export function registerMediaAssetRoutes(app: Express): void {
  // Serve — always on. The token is the capability.
  app.get('/v1/host/sample/assets/:token', async (req, res) => {
    const token = req.params.token ?? '';
    const entry = await resolveMediaAsset(token);
    if (!entry) {
      res.status(404).json({ error: 'not_found', message: 'asset not found or expired' });
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', entry.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(entry.contentBase64, 'base64'));
  });

  // First-class chat-attachment upload — ALWAYS ON, quota-bounded. Tenant from
  // req.tenantId (never the body), per CTI-1. Accepts a base64 body so it rides
  // the same JSON pipeline as the rest of the demo (the scoped 12mb parser in
  // index.ts admits an 8mb-base64 payload).
  app.post('/v1/host/sample/media/upload', async (req: Request, res: Response) => {
    const tenantId = req.tenantId ?? 'default';
    const body = (req.body ?? {}) as { contentBase64?: unknown; contentType?: unknown; name?: unknown };
    if (typeof body.contentBase64 !== 'string' || body.contentBase64.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'contentBase64 (non-empty string) required' });
      return;
    }
    if (body.contentBase64.length > MAX_STORE_BASE64_LEN) {
      res.status(413).json({ error: 'payload_too_large', message: `attachment exceeds ${Math.floor(MAX_STORE_BASE64_LEN / (1024 * 1024))} MiB` });
      return;
    }
    const contentType = typeof body.contentType === 'string' ? body.contentType : '';
    if (!ALLOWED_UPLOAD_MIME.has(contentType)) {
      res.status(415).json({ error: 'unsupported_media_type', message: `contentType must be one of: ${[...ALLOWED_UPLOAD_MIME].join(', ')}` });
      return;
    }
    const bytes = Buffer.byteLength(body.contentBase64, 'base64');
    const quotaReason = await chargeUploadQuota(tenantId, bytes);
    if (quotaReason) {
      res.status(429).json({ error: 'quota_exceeded', message: quotaReason });
      return;
    }
    const stored = await storeMediaAsset(tenantId, {
      contentBase64: body.contentBase64,
      contentType,
      ttlSeconds: UPLOADED_ASSET_TTL_SECONDS,
    });
    const name = typeof body.name === 'string' && body.name ? body.name : undefined;
    res.status(201).json({ ...stored, contentType, ...(name ? { name } : {}) });
  });

  // Low-level store — test/demo affordance, env-gated like the test seam. The
  // first-class `media/upload` route above is the chat path; this stays for
  // tooling/tests that need to seed an asset without quota accounting.
  const storeEnabled = process.env.OPENWOP_TEST_SEAM_ENABLED === 'true';
  if (storeEnabled) {
    app.post('/v1/host/sample/media/put', async (req, res) => {
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
      const stored = await storeMediaAsset(tenantId, {
        contentBase64: body.contentBase64,
        contentType,
        ...(ttlSeconds ? { ttlSeconds } : {}),
      });
      res.status(201).json(stored);
    });
    log.warn('media-asset low-level store ENABLED (POST /v1/host/sample/media/put) — test/demo only.');
  }

  // ── Sample media generation endpoints (gap D-2) ──────────────────────
  // CLI-friendly demo wrappers that exercise the `core.openwop.ai`
  // image-generate / audio-transcribe / audio-synthesize node family
  // end-to-end WITHOUT a real BYOK provider. The demo backend honestly
  // advertises `aiProviders.imageGeneration: { supported: false }` (see
  // routes/discovery.ts) — no live provider is wired — so these endpoints
  // produce a DETERMINISTIC STUB asset derived purely from the request and
  // store it via the existing tenant-scoped media-asset store. The result
  // is a real, downloadable asset URL (the same surface a production host's
  // LLM-emitted media would use), but the bytes are a fixture so replays and
  // demos stay deterministic. Each response is tagged `stub: true`.
  //
  // Namespace: sample-extension under `/v1/host/sample/*` — NOT part of the
  // normative OpenWOP wire contract. Tenant always from req.tenantId (never
  // the body), per CTI-1.
  app.post('/v1/host/sample/media/generate-image', async (req, res) => {
    const tenantId = req.tenantId ?? 'default';
    const body = (req.body ?? {}) as { prompt?: unknown };
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (prompt.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'prompt (non-empty string) required' });
      return;
    }
    const stored = await storeMediaAsset(tenantId, { contentBase64: STUB_PNG_1x1_BASE64, contentType: 'image/png' });
    res.status(201).json({ ...stored, contentType: 'image/png', prompt, stub: true });
  });

  app.post('/v1/host/sample/media/transcribe', (req, res) => {
    const body = (req.body ?? {}) as { audioBase64?: unknown; language?: unknown };
    if (typeof body.audioBase64 !== 'string' || body.audioBase64.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'audioBase64 (non-empty string) required' });
      return;
    }
    if (body.audioBase64.length > MAX_STORE_BASE64_LEN) {
      res.status(413).json({ error: 'payload_too_large', message: `audioBase64 exceeds ${MAX_STORE_BASE64_LEN} chars` });
      return;
    }
    const language = typeof body.language === 'string' && body.language ? body.language : 'en';
    // Deterministic stub transcript: pure function of input size + language.
    const bytes = Buffer.byteLength(body.audioBase64, 'base64');
    const text = `[stub transcript] Decoded ${bytes} bytes of ${language} audio. The demo backend stubs speech-to-text so replays stay deterministic.`;
    res.status(200).json({ text, language, bytes, stub: true });
  });

  app.post('/v1/host/sample/media/synthesize', async (req, res) => {
    const tenantId = req.tenantId ?? 'default';
    const body = (req.body ?? {}) as { text?: unknown; voice?: unknown };
    const text = typeof body.text === 'string' ? body.text : '';
    if (text.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'text (non-empty string) required' });
      return;
    }
    const voice = typeof body.voice === 'string' && body.voice ? body.voice : 'default';
    const stored = await storeMediaAsset(tenantId, { contentBase64: STUB_WAV_BASE64, contentType: 'audio/wav' });
    res.status(201).json({ ...stored, contentType: 'audio/wav', voice, characters: text.length, stub: true });
  });

  log.info('media-asset serve + upload routes registered (GET /v1/host/sample/assets/:token, POST /v1/host/sample/media/upload)');
  log.info('sample media generation routes registered (POST /v1/host/sample/media/{generate-image,transcribe,synthesize})');
}

// A 1×1 transparent PNG — the deterministic stub the generate-image demo
// returns when no live image provider is wired.
const STUB_PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A minimal silent WAV (44-byte header, zero frames) — the deterministic
// stub the synthesize demo returns when no live TTS provider is wired.
const STUB_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
