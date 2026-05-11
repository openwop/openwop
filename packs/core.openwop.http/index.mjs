/**
 * core.openwop.http — spec-canonical HTTP fetch node.
 *
 * Single typeId `core.openwop.http.fetch` implementing:
 *   - GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
 *   - URL template substitution from inputs.variables
 *   - JSON serialization of object/array bodies
 *   - Per-attempt timeout via AbortController
 *   - Exponential backoff on 5xx + network errors (NEVER on 4xx)
 *   - Deterministic Idempotency-Key derivation for replay safety
 *
 * Replay model (spec/v1/replay.md §"Replay determinism"):
 *   The pack manifest declares `side-effectful` capability, so the
 *   host's Layer-2 invocation log caches the terminal node.completed
 *   payload keyed on (runId, nodeId, idempotencyKey). On replay, the
 *   host returns the cached `{ status, headers, body, durationMs,
 *   attempts, idempotencyKey }` directly — this function is NOT
 *   re-executed and the remote endpoint is NOT re-called.
 *
 * Zero npm deps. Uses Node 20's globalThis.fetch (undici-backed).
 *
 * @see spec/v1/idempotency.md §"Idempotency-Key"
 * @see spec/v1/replay.md
 * @see docs/PACKS-MVP-PLAN.md
 */

import { createHash } from 'node:crypto';

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const NON_IDEMPOTENT = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Substitute `{{name}}` placeholders. Missing keys throw INVALID_URL.
 */
function substituteUrl(template, variables) {
  const vars = variables ?? {};
  const out = template.replace(TEMPLATE_RE, (_full, name) => {
    if (!(name in vars)) {
      throw makeError('INVALID_URL', `URL template references {{${name}}} but inputs.variables['${name}'] is absent`);
    }
    return encodeURIComponent(String(vars[name]));
  });
  if (!/^https?:\/\//.test(out)) {
    throw makeError('INVALID_URL', `URL must resolve to http:// or https:// scheme, got: ${out}`);
  }
  return out;
}

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Derive a deterministic Idempotency-Key from (runId, nodeId,
 * body-hash). Replays of the same run+node+body produce the same key,
 * so the remote server can dedupe on retry.
 *
 * Format: `openwop-<sha256-prefix-16>` — 16 hex chars is ~64 bits of
 * uniqueness, plenty for per-run dedup without bloating headers.
 */
function deriveIdempotencyKey(runId, nodeId, bodyBytes) {
  const h = createHash('sha256');
  h.update(String(runId), 'utf8');
  h.update('\0', 'utf8');
  h.update(String(nodeId), 'utf8');
  h.update('\0', 'utf8');
  if (bodyBytes) h.update(bodyBytes);
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/**
 * Parse the body if it looks like JSON, else return the raw string.
 * Empty body → null.
 */
function parseBody(text, contentType) {
  if (!text) return null;
  if (contentType && /application\/(?:json|.+\+json)/i.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      // Fallthrough to raw string — server lied about Content-Type.
    }
  }
  return text;
}

/**
 * Headers → plain object with lowercased keys.
 */
function headersToObject(h) {
  const out = {};
  for (const [k, v] of h.entries()) out[k.toLowerCase()] = v;
  return out;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
    if (signal?.aborted) { clearTimeout(t); reject(new Error('aborted')); }
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Pick the fetch implementation. Tests inject `ctx.fetch` to mock;
 * production uses globalThis.fetch (Node 20+ has it built in).
 */
function pickFetch(ctx) {
  return ctx?.fetch ?? globalThis.fetch;
}

/**
 * core.openwop.http.fetch
 *
 * Run the request through retry policy + idempotency-key + timeout
 * wrapper. Returns the schema-conforming output shape on terminal
 * success OR terminal failure (after retries exhausted). Throws only
 * on programmer errors (INVALID_URL, INVALID_BODY) — operational
 * failures (5xx after retries, network exhausted) surface as
 * `status: 5xx` or `{ status: 0, body: null }` so downstream nodes
 * can branch on the wire shape.
 */
export async function fetchNode(ctx) {
  const fetchImpl = pickFetch(ctx);
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  const method = (config.method ?? 'GET').toUpperCase();
  const url = substituteUrl(config.url, inputs.variables);
  const timeoutMs = config.timeoutMs ?? 30000;
  const retry = config.retry ?? {};
  const maxAttempts = retry.maxAttempts ?? 3;
  const initialDelayMs = retry.initialDelayMs ?? 500;
  const maxDelayMs = retry.maxDelayMs ?? 8000;
  const idempotencyMode = config.idempotency?.mode ?? 'auto';

  // Build request body + content-type.
  let bodyBytes = null;
  let contentType = null;
  const userHeaders = { ...(config.headers ?? {}) };
  const lowerKeys = Object.fromEntries(Object.keys(userHeaders).map((k) => [k.toLowerCase(), k]));
  if (inputs.body !== undefined && inputs.body !== null && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (typeof inputs.body === 'string') {
      bodyBytes = Buffer.from(inputs.body, 'utf8');
      contentType = userHeaders[lowerKeys['content-type']] ?? 'text/plain; charset=utf-8';
    } else {
      bodyBytes = Buffer.from(JSON.stringify(inputs.body), 'utf8');
      contentType = userHeaders[lowerKeys['content-type']] ?? 'application/json';
    }
  }

  // Idempotency-Key for non-idempotent methods.
  const idempotencyKey = (idempotencyMode === 'auto' && NON_IDEMPOTENT.has(method))
    ? deriveIdempotencyKey(ctx.runId, ctx.nodeId, bodyBytes)
    : null;

  // Compose final headers.
  const headers = { ...userHeaders };
  if (contentType && !lowerKeys['content-type']) headers['Content-Type'] = contentType;
  if (idempotencyKey && !lowerKeys['idempotency-key']) headers['Idempotency-Key'] = idempotencyKey;

  // Retry loop.
  const start = Date.now();
  let attempts = 0;
  let lastError = null;
  let lastResponse = null;

  while (attempts < maxAttempts) {
    attempts++;
    const attemptStart = Date.now();
    const attemptController = new AbortController();
    // Honour caller abort + per-attempt timeout.
    const onCallerAbort = () => attemptController.abort();
    ctx.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeoutHandle = setTimeout(() => attemptController.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body: bodyBytes ?? undefined,
        signal: attemptController.signal,
      });
      clearTimeout(timeoutHandle);
      ctx.signal?.removeEventListener('abort', onCallerAbort);

      // 4xx → terminal client error, never retry.
      // 5xx → retry with backoff (if attempts remaining).
      // 2xx/3xx → success.
      if (res.status >= 500 && res.status < 600 && attempts < maxAttempts) {
        lastResponse = res;
        ctx.emit?.({
          type: 'node.progress',
          data: { phase: 'retry', attempt: attempts, status: res.status },
        });
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempts - 1));
        await sleep(delay, ctx.signal);
        continue;
      }

      // Terminal.
      const text = await res.text();
      const headerObj = headersToObject(res.headers);
      return {
        status: 'success',
        outputs: {
          status: res.status,
          headers: headerObj,
          body: parseBody(text, headerObj['content-type']),
          durationMs: Date.now() - start,
          attempts,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      };
    } catch (err) {
      clearTimeout(timeoutHandle);
      ctx.signal?.removeEventListener('abort', onCallerAbort);
      lastError = err;
      // Network error / abort. Retry if attempts remaining AND not caller-aborted.
      if (ctx.signal?.aborted) {
        throw makeError('aborted', 'caller aborted request');
      }
      if (attempts < maxAttempts) {
        ctx.emit?.({
          type: 'node.progress',
          data: { phase: 'retry', attempt: attempts, error: err.message },
        });
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempts - 1));
        await sleep(delay, ctx.signal);
        continue;
      }
    }
  }

  // Retries exhausted. Surface the last seen state.
  if (lastResponse) {
    const text = await lastResponse.text().catch(() => '');
    const headerObj = headersToObject(lastResponse.headers);
    return {
      status: 'success',
      outputs: {
        status: lastResponse.status,
        headers: headerObj,
        body: parseBody(text, headerObj['content-type']),
        durationMs: Date.now() - start,
        attempts,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
    };
  }

  // Pure network failure — no response ever received. Surface as
  // status: 0 so workflow authors can branch on it. We don't throw
  // because side-effectful nodes' caching only triggers on completed
  // outcomes; throwing would emit node.failed which the host wouldn't
  // cache (replay would re-call), losing the side-effect-once
  // property.
  return {
    status: 'success',
    outputs: {
      status: 0,
      headers: {},
      body: null,
      durationMs: Date.now() - start,
      attempts,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      networkError: lastError?.message ?? 'unknown network error',
    },
  };
}

export const nodes = {
  'core.openwop.http.fetch': fetchNode,
};

export default nodes;
