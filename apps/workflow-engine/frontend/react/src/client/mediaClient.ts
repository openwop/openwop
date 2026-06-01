/**
 * Chat-attachment client. Turns a picked `File` into a `ContentPart` for the
 * next chat turn, choosing transport by size:
 *
 *   - small files (≤ INLINE_THRESHOLD) go INLINE as `dataBase64` in the chat
 *     message — replay-safe by construction (the bytes live in `run.inputs`,
 *     copied verbatim on a fork/replay);
 *   - larger files UPLOAD to the host's durable media-asset store
 *     (`POST /v1/host/sample/media/upload`) and the message references them by
 *     `url`. The store is durable + read-through + tenant-scoped, and the
 *     responder node re-inlines the bytes (tenant-checked) before dispatch, so
 *     these are replay-safe too within the asset's retention window.
 *
 * All transport + auth goes through the shared `config.ts` helpers so it
 * follows the same bearer/cookie auth mode as every other client call.
 */

import { config, authedHeaders, fetchOpts } from './config.js';
import { blobToBase64 } from '../chat/hooks/useAudioRecorder.js';
import type { ContentPart } from '../chat/types.js';

/** Files at or below this go inline; larger ones upload. Mirrors the host's
 *  RFC 0055 §C inline-vs-URL cap (OPENWOP_MAX_INLINE_MEDIA_BYTES, 256 KiB). */
export const INLINE_THRESHOLD_BYTES = 256 * 1024;

/** Hard per-file ceiling. Kept under the host's ~6 MiB binary store cap
 *  (8 MiB of base64) so an over-cap file is rejected client-side with a clear
 *  message rather than bouncing off a 413. */
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

/** MIME allow-list — mirrors the host's `ALLOWED_UPLOAD_MIME` (fail-closed
 *  on both ends) and the file picker's `accept` attribute. */
export const ACCEPTED_ATTACHMENT_MIME: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
];

/** The `accept` attribute string for the `<input type="file">`. */
export const ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_MIME.join(',');

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Validate a picked file. Returns a user-facing reason string when it should
 *  be rejected, or null when acceptable. */
export function attachmentRejectionReason(file: File): string | null {
  // Some browsers leave `.md` files with an empty type; fall back by extension.
  const mime = mimeOf(file);
  if (!ACCEPTED_ATTACHMENT_MIME.includes(mime)) {
    return `"${file.name}" is an unsupported type. Allowed: images, PDF, and .txt/.md/.json/.csv.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" is too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MiB).`;
  }
  return null;
}

/** A file's effective MIME type: the browser-reported `type`, falling back to
 *  an extension lookup (some browsers leave `.md`/`.csv` with an empty type). */
export function mimeOf(file: File): string {
  return file.type || mimeFromName(file.name);
}

function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'md': return 'text/markdown';
    case 'csv': return 'text/csv';
    case 'json': return 'application/json';
    case 'txt': return 'text/plain';
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return '';
  }
}

/** Convert a picked File to a ContentPart (inlining small files, uploading
 *  large ones). Throws with a user-facing message on rejection or upload
 *  failure — the caller surfaces it and drops the attachment. */
export async function fileToContentPart(file: File): Promise<ContentPart> {
  const reason = attachmentRejectionReason(file);
  if (reason) throw new Error(reason);
  const mimeType = mimeOf(file);
  const dataBase64 = await blobToBase64(file);
  const isImage = isImageMime(mimeType);

  if (file.size <= INLINE_THRESHOLD_BYTES) {
    return isImage
      ? { type: 'image', mimeType, dataBase64, alt: file.name }
      : { type: 'file', mimeType, dataBase64, name: file.name };
  }

  // Large file → upload to the durable host store, reference by URL.
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/media/upload`,
    fetchOpts({
      method: 'POST',
      headers: { ...authedHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ contentBase64: dataBase64, contentType: mimeType, name: file.name }),
    }),
  );
  if (!res.ok) {
    let msg = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch { /* keep the status-derived message */ }
    throw new Error(`Couldn't attach "${file.name}": ${msg}`);
  }
  const json = (await res.json()) as { url: string };
  return isImage
    ? { type: 'image', mimeType, url: json.url, alt: file.name }
    : { type: 'file', mimeType, url: json.url, name: file.name };
}
