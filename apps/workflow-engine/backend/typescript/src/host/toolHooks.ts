/**
 * RFC 0064 — tool-invocation hooks + per-tool authorization/rate-limit.
 *
 * A host advertising `capabilities.toolHooks` wraps every tool invocation
 * (MCP / HTTP / native) with a pre/post hook pair that emits the additive
 * `agent.toolCalled` / `agent.toolReturned` fields and applies per-tool
 * authorization + rate limiting. This module is the host-side evaluator;
 * it is driven both by the live MCP path and by the
 * `POST /v1/host/sample/toolhooks/invoke` conformance seam.
 *
 * Contract (RFC 0064 §"Proposal"):
 *   - `agent.toolCalled` gains `{ argsHash, principal, transport }`.
 *     `argsHash` is the JCS (RFC 8785) + SHA-256 digest of the args, with
 *     SR-1 secret redaction applied to the preimage FIRST so a hashed
 *     argument can never carry a secret (the content-free-audit guarantee).
 *   - `agent.toolReturned` gains `{ status: 'ok'|'forbidden'|'rate_limited',
 *     durationMs }`. `durationMs` is absent when the call never started
 *     (forbidden / rate_limited).
 *   - Authorization is fail-closed (reuses RFC 0049's `forbidden` error +
 *     `authorization-fail-closed` invariant): if `requiredScopes` are
 *     declared and the principal does not demonstrably hold all of them,
 *     refuse with `forbidden` (403) before the tool runs.
 *   - Rate limiting is a per-`(principal, tool)` token bucket; on
 *     exhaustion refuse with `rate_limited` (429) before the tool runs.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md
 * @see spec/v1/host-capabilities.md §host.toolHooks
 * @see SECURITY/invariants.yaml — authorization-fail-closed (RFC 0049)
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../providers/llmCacheKey.js';
import { sanitizeFreeTextDeep } from '../byok/textRedaction.js';

export type ToolHookStatus = 'ok' | 'forbidden' | 'rate_limited';
export type ToolTransport = 'mcp' | 'http' | 'native';

export interface ToolHookRequest {
  /** RFC 0048 principal id making the call. */
  principal: string;
  toolName: string;
  /** RFC 0049 scopes the tool requires. Empty/absent ⇒ no authz gate. */
  requiredScopes?: string[];
  /** Scopes the principal demonstrably holds. Absent ⇒ unevaluable ⇒
   *  fail-closed when `requiredScopes` is non-empty. */
  grantedScopes?: string[];
  /** Tool arguments — hashed (after SR-1 redaction), never emitted raw. */
  args?: unknown;
  transport?: ToolTransport;
  /** Conformance hook: force the rate-limit branch deterministically. */
  simulateRateLimitExhausted?: boolean;
}

export interface ToolCalledFields {
  toolName: string;
  principal: string;
  transport: ToolTransport;
  argsHash: string;
}

export interface ToolReturnedFields {
  toolName: string;
  status: ToolHookStatus;
  durationMs?: number;
}

export interface ToolHookResult {
  toolCalled: ToolCalledFields;
  toolReturned: ToolReturnedFields;
  /** 200 ok · 403 forbidden · 429 rate_limited. */
  httpStatus: number;
  /** Reuses RFC 0049 `forbidden` / existing `rate_limited` — no new code. */
  errorCode?: 'forbidden' | 'rate_limited';
}

/**
 * SR-1: redact secret-shaped strings in the args BEFORE canonicalizing +
 * hashing, so the hash preimage cannot contain a live secret. JCS (RFC
 * 8785) canonical bytes → SHA-256 → lowercase hex, mirroring the
 * `replay.md` §"LLM cache-key recipe" digest.
 */
export function computeArgsHash(args: unknown): string {
  const redacted = sanitizeFreeTextDeep(args ?? null);
  return createHash('sha256').update(canonicalize(redacted), 'utf8').digest('hex');
}

/** Per-`(principal, tool)` token bucket. Module-scoped — sample-grade;
 *  a production host would back this with a durable counter. */
interface Bucket {
  tokens: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
const BUCKET_CAPACITY = 5;
const BUCKET_WINDOW_MS = 60_000;

/** Reset all rate-limit buckets (test teardown). */
export function resetToolHookBuckets(): void {
  buckets.clear();
}

/** Evict expired buckets so the map can't grow unbounded across distinct
 *  (principal, tool) pairs. Cheap O(n) sweep, triggered only past a size
 *  threshold so the hot path stays O(1). */
function sweepExpired(now: number): void {
  if (buckets.size < 1024) return;
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}

function consumeToken(key: string, now: number): boolean {
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    sweepExpired(now);
    b = { tokens: BUCKET_CAPACITY, resetAt: now + BUCKET_WINDOW_MS };
    buckets.set(key, b);
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Evaluate the pre/post hook pair for one tool invocation. Pure w.r.t.
 * the run event log — the caller (seam or MCP path) emits the returned
 * `toolCalled`/`toolReturned` fields. Order of gates matches RFC 0064:
 * authorization (fail-closed) before rate limit, both before the tool runs.
 */
export function evaluateToolHook(req: ToolHookRequest, now: number = Date.now()): ToolHookResult {
  const transport: ToolTransport = req.transport ?? 'native';
  const toolCalled: ToolCalledFields = {
    toolName: req.toolName,
    principal: req.principal,
    transport,
    argsHash: computeArgsHash(req.args),
  };

  // Authorization — fail closed (RFC 0049 `authorization-fail-closed`).
  const required = req.requiredScopes ?? [];
  if (required.length > 0) {
    const granted = new Set(req.grantedScopes ?? []);
    const holdsAll = req.grantedScopes !== undefined && required.every((s) => granted.has(s));
    if (!holdsAll) {
      return {
        toolCalled,
        toolReturned: { toolName: req.toolName, status: 'forbidden' },
        httpStatus: 403,
        errorCode: 'forbidden',
      };
    }
  }

  // Rate limit — per-(principal, tool) token bucket.
  const exhausted =
    req.simulateRateLimitExhausted === true || !consumeToken(`${req.principal}::${req.toolName}`, now);
  if (exhausted) {
    return {
      toolCalled,
      toolReturned: { toolName: req.toolName, status: 'rate_limited' },
      httpStatus: 429,
      errorCode: 'rate_limited',
    };
  }

  // Authorized + within budget: the tool runs. The caller measures the
  // real duration; the seam reports a measured value, defaulting to 0.
  return {
    toolCalled,
    toolReturned: { toolName: req.toolName, status: 'ok', durationMs: 0 },
    httpStatus: 200,
  };
}
