/**
 * RFC 0207 — W3C Trace Context carriers across MCP and A2A.
 *
 * One place that knows the `traceparent` grammar and the two carriers a host
 * may use, so the v1 and v2 carrier scenarios cannot disagree on what counts:
 *
 *   MCP  — `params._meta.traceparent` (unprefixed; MCP 2026-07-28 `_meta`,
 *          SEP-414) OR the HTTP `traceparent` header of the request.
 *   A2A  — `params.message.metadata.openwop.traceparent` OR the HTTP header.
 *
 * Either carrier conforms (decisions log D4); the in-message one is SHOULD.
 * `classifyCarriers` reports which it found so the row's detail keeps the
 * SHOULD visible (`header-only`) without failing a conforming host.
 *
 * @see RFCS/0207-trace-context-across-mcp-and-a2a.md §A, §B
 * @see https://www.w3.org/TR/trace-context/ §3.2 (traceparent)
 */
import { randomBytes } from 'node:crypto';

export interface Traceparent {
  readonly version: string;
  readonly traceId: string;
  readonly parentId: string;
  readonly flags: string;
}

const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);
const GRAMMAR = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** A fresh, valid version-00 `traceparent` with a random trace id and span id, sampled. */
export function makeTraceparent(): Traceparent & { readonly header: string } {
  let traceId = randomBytes(16).toString('hex');
  while (traceId === ZERO_TRACE) traceId = randomBytes(16).toString('hex');
  let parentId = randomBytes(8).toString('hex');
  while (parentId === ZERO_SPAN) parentId = randomBytes(8).toString('hex');
  return { version: '00', traceId, parentId, flags: '01', header: `00-${traceId}-${parentId}-01` };
}

/**
 * Parse a `traceparent` per W3C Trace Context §3.2: lowercase hex, version
 * `ff` invalid, all-zero trace id or parent id invalid, and a version-00 value
 * has exactly four fields. Returns null for anything else.
 */
export function parseTraceparent(value: unknown): Traceparent | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  // A future version may append fields after a '-'; version 00 has exactly four.
  const m = GRAMMAR.exec(v.slice(0, 55));
  if (m === null) return null;
  const version = m[1]!; const traceId = m[2]!; const parentId = m[3]!; const flags = m[4]!;
  if (version === 'ff') return null;
  if (v.length > 55 && (version === '00' || v[55] !== '-')) return null;
  if (traceId === ZERO_TRACE || parentId === ZERO_SPAN) return null;
  return { version, traceId, parentId, flags };
}

/** `params._meta.traceparent` of a recorded MCP request, or undefined. Only the UNPREFIXED key counts. */
export function mcpMetaTraceparent(params: unknown): unknown {
  const meta = (params as { _meta?: unknown } | null | undefined)?._meta;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  return (meta as Record<string, unknown>)['traceparent'];
}

/** `params.message.metadata.openwop.traceparent` of a recorded A2A JSON-RPC body, or undefined. */
export function a2aMetadataTraceparent(body: unknown): unknown {
  const message = (body as { params?: { message?: unknown } } | null | undefined)?.params?.message;
  const metadata = (message as { metadata?: unknown } | null | undefined)?.metadata;
  const openwop = (metadata as { openwop?: unknown } | null | undefined)?.openwop;
  if (openwop === null || typeof openwop !== 'object' || Array.isArray(openwop)) return undefined;
  return (openwop as Record<string, unknown>)['traceparent'];
}

export type CarrierVerdict =
  | { readonly ok: true; readonly detail: 'both' | 'in-message' | 'header-only' }
  | { readonly ok: false; readonly reason: string };

/**
 * The D4 verdict for one recorded outbound request.
 *
 *   - neither carrier present                        → fail
 *   - a present carrier does not parse                → fail (W3C grammar)
 *   - a present carrier's trace id is not `traceId`   → fail (the host minted a new trace)
 *   - otherwise pass; detail names what was found — `header-only` when the
 *     in-message carrier (SHOULD) is absent.
 */
export function classifyCarriers(inMessage: unknown, header: string | undefined, traceId: string, names: { inMessage: string }): CarrierVerdict {
  const hasMsg = inMessage !== undefined;
  const hasHdr = header !== undefined;
  if (!hasMsg && !hasHdr) return { ok: false, reason: `neither carrier is present: no ${names.inMessage} and no HTTP traceparent header` };
  for (const [where, raw] of [[names.inMessage, hasMsg ? inMessage : undefined], ['the HTTP traceparent header', hasHdr ? header : undefined]] as const) {
    if (raw === undefined) continue;
    const tp = parseTraceparent(raw);
    if (tp === null) return { ok: false, reason: `${where} is not a valid W3C traceparent: ${JSON.stringify(raw)}` };
    if (tp.traceId !== traceId.toLowerCase()) return { ok: false, reason: `${where} carries trace id ${tp.traceId}, not the suite's ${traceId} — the host started a new trace instead of propagating the run's` };
  }
  return { ok: true, detail: hasMsg && hasHdr ? 'both' : hasMsg ? 'in-message' : 'header-only' };
}
