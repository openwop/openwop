/**
 * RFC 0201 — shared plumbing for the four `v2-webhook-*` Standard Webhooks
 * scenarios: the gate, the registration call, the run that produces a
 * delivery, and cleanup. The verifier and the modal receiver live in
 * `webhook-receiver.ts`; this file only drives the host.
 *
 * Gating (RFC 0201 §Conformance): every leg reads the v2 `webhooks` facet. A
 * host that does not list `standard-webhooks-1` records `inapplicable`; a host
 * whose egress guard refuses the loopback receiver records `blocked`, as the
 * other webhook scenarios do; `OPENWOP_WEBHOOK_RECEIVER_URL` (a public https
 * front for the receiver) waives nothing and is the certification posture.
 *
 * @see spec/v2/core/webhooks.md §Standard Webhooks
 * @see RFCS/0201-standard-webhooks-signature-scheme.md
 */

import { driver, type OpenWOPResponse } from './driver.js';
import { v2Discovery, gateFamily } from './v2.js';
import { readErrorCode } from './error-envelope.js';
import type { SoftSkipKind } from './soft-skip.js';
import { projectBoundId } from './bound-id.js';
import { hitHeader, type ModalHit } from './webhook-receiver.js';
import { SEAMS_PREFIX } from './seams.js';

export const STANDARD_WEBHOOKS_ALG = 'standard-webhooks-1';
export const SW_FIXTURE = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export type SwGate =
  | { readonly ok: true; readonly doc: Record<string, unknown>; readonly facet: Record<string, unknown> }
  | { readonly ok: false; readonly kind: SoftSkipKind; readonly reason: string };

/**
 * The gate every RFC 0201 leg shares. A refusal carries its disposition so the
 * leg records it at the return site (`check-req-only` rule (c)):
 * `const g = await swGate(); if (!g.ok) return softSkip(g.kind, g.reason);`.
 */
export async function swGate(): Promise<SwGate> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const facet = await gateFamily('webhooks');
  if (!facet) return { ok: false, kind: 'inapplicable', reason: 'webhooks family not advertised (gate recorded under openwop.family.webhooks)' };
  const algs = Array.isArray(facet['signatureAlgorithms']) ? (facet['signatureAlgorithms'] as unknown[]) : [];
  if (!algs.includes(STANDARD_WEBHOOKS_ALG)) {
    return { ok: false, kind: 'inapplicable', reason: `webhooks.signatureAlgorithms does not list ${STANDARD_WEBHOOKS_ALG} (RFC 0201 §A.3) — the companion scheme is not offered` };
  }
  const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
  if (!fixtures.includes(SW_FIXTURE)) return { ok: false, kind: 'inapplicable', reason: `${SW_FIXTURE} fixture not advertised — no run to deliver` };
  return { ok: true, doc, facet };
}

const registered: string[] = [];

/** `POST /webhooks`; every 201 is remembered for `unregisterAllSw()`. */
export async function registerSw(body: Record<string, unknown>): Promise<OpenWOPResponse> {
  const res = await driver.post('/webhooks', body);
  const id = (res.json as { webhookId?: unknown } | null)?.webhookId;
  if (res.status === 201 && typeof id === 'string') registered.push(id);
  return res;
}

/**
 * The `blocked` reason when the host's SSRF guard refused the loopback receiver,
 * else `null`. A refusal of the operator's PUBLIC front is a finding, not a
 * block, and throws.
 */
export function loopbackRefusal(res: OpenWOPResponse, tunnelled: boolean): string | null {
  if (res.status === 400 && readErrorCode(res.json) === 'webhook_url_rejected') {
    if (tunnelled) throw new Error('host rejected the operator-supplied public https receiver with webhook_url_rejected — a public https destination is legitimate under webhooks.md §Egress');
    return 'host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https front for the suite receiver to witness';
  }
  return null;
}

/** Unregister every subscription this worker registered (best effort; the verdict is already recorded). */
export async function unregisterAllSw(): Promise<void> {
  for (const id of registered.splice(0)) {
    try { await driver.delete(`/webhooks/${projectBoundId(id)}`); } catch { /* best effort */ }
  }
}

/** Start one run of the noop fixture and wait (bounded) for it to finish. */
export async function driveRun(timeoutMs = 10_000): Promise<{ status: number; runId: string | null }> {
  const create = await driver.post('/runs', { workflowId: SW_FIXTURE });
  const runId = create.status === 201 ? ((create.json as { runId?: unknown } | null)?.runId as string | undefined) ?? null : null;
  if (runId !== null) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
      const st = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : '';
      if (TERMINAL.has(st) || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { status: create.status, runId };
}

export async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return pred();
}

/** The DELIVERIES (not verification requests) one subscription received for one run. */
export function deliveriesFor(hits: readonly ModalHit[], webhookId: string, runId: string | null): ModalHit[] {
  return hits.filter((h) => {
    if (h.verification) return false;
    if ((hitHeader(h, 'openwop-webhook-id') ?? hitHeader(h, 'x-openwop-webhook-id')) !== webhookId) return false;
    if (runId === null) return true;
    try { return (JSON.parse(h.body) as { runId?: unknown }).runId === runId; } catch { return false; }
  });
}

/** Every `webhook-*` header name on a hit (RFC 0201 §B.8 reads this as "must be empty" on a non-opted subscription). */
export function standardWebhooksHeaderNames(hit: ModalHit): string[] {
  return Object.keys(hit.headers).filter((k) => k.toLowerCase().startsWith('webhook-'));
}

export const ROTATION_OVERLAP_SEAM = `${SEAMS_PREFIX}/sample/webhooks/rotation-overlap`;

export type ShortenedOverlap =
  | { readonly ok: true; readonly expiresAt: number }
  | { readonly ok: false; readonly unserved: true; readonly reason: string }
  | { readonly ok: false; readonly unserved: false; readonly reason: string };

/**
 * Shorten the rotation overlap in progress on ONE subscription
 * (host-sample-test-seams.md §29, `shortenRotationOverlap`), so the RFC 0201
 * §E.20 post-overlap leg can be observed on a host whose advertised
 * `overlapSeconds` outlasts the wait cap. The seam only moves the stored expiry;
 * which secret signs after it is the production signer's decision, and that is
 * what the caller asserts on. UNSERVED (404/405/501) is reported apart from a
 * served seam that breaks its contract: the seam is OPTIONAL and newer than the
 * leg, so its absence falls back to the pre-seam partial witness.
 *
 * The contract checked here: `200 { webhookId, previousSecretExpiresAt }` with
 * the expiry `overlapSeconds` after the request (±1 s), and a foreign-tenant id
 * refused `403 id_tenant_mismatch` before the lookup, as `rotateWebhookSecret`
 * refuses it. The real call goes first so that a 404 can only mean "unserved".
 */
export async function shortenRotationOverlap(webhookId: string, overlapSeconds: number, foreignWebhookId: string): Promise<ShortenedOverlap> {
  const before = Date.now();
  let res: OpenWOPResponse;
  try { res = await driver.post(ROTATION_OVERLAP_SEAM, { webhookId, overlapSeconds }); } catch {
    return { ok: false, unserved: false, reason: `${ROTATION_OVERLAP_SEAM} unreachable (fetch failed)` };
  }
  const after = Date.now();
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    return { ok: false, unserved: true, reason: `${ROTATION_OVERLAP_SEAM} answered ${res.status} — the host does not serve the optional shortenRotationOverlap seam (host-sample-test-seams.md §29)` };
  }
  const body = (res.json ?? {}) as { webhookId?: unknown; previousSecretExpiresAt?: unknown };
  const expiresAt = typeof body.previousSecretExpiresAt === 'string' ? Date.parse(body.previousSecretExpiresAt) : Number.NaN;
  if (res.status !== 200 || body.webhookId !== webhookId || !Number.isFinite(expiresAt)) {
    return { ok: false, unserved: false, reason: `${ROTATION_OVERLAP_SEAM} answered ${res.status} ${readErrorCode(res.json) ?? ''} without 200 { webhookId, previousSecretExpiresAt } for ${webhookId} — the seam contract (api/seams-v2.yaml shortenRotationOverlap) is not honoured`.replace(/ +/g, ' ') };
  }
  const lo = before + overlapSeconds * 1000 - 1000;
  const hi = after + overlapSeconds * 1000 + 1000;
  if (expiresAt < lo || expiresAt > hi) {
    return { ok: false, unserved: false, reason: `${ROTATION_OVERLAP_SEAM} reported previousSecretExpiresAt ${body.previousSecretExpiresAt as string}, not ${overlapSeconds}s after the request (window ${new Date(lo).toISOString()}..${new Date(hi).toISOString()}) — the overlap it reports is not the one it was asked to set` };
  }
  let cross: OpenWOPResponse;
  try { cross = await driver.post(ROTATION_OVERLAP_SEAM, { webhookId: foreignWebhookId, overlapSeconds }); } catch {
    return { ok: false, unserved: false, reason: `${ROTATION_OVERLAP_SEAM} unreachable on the foreign-tenant probe (fetch failed)` };
  }
  if (cross.status !== 403 || readErrorCode(cross.json) !== 'id_tenant_mismatch') {
    return { ok: false, unserved: false, reason: `${ROTATION_OVERLAP_SEAM} answered ${cross.status} ${readErrorCode(cross.json) ?? ''} for a foreign-tenant webhookId — the seam MUST be tenant-checked before the lookup (403 id_tenant_mismatch), exactly as rotateWebhookSecret`.replace(/ +/g, ' ') };
  }
  return { ok: true, expiresAt };
}
