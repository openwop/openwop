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
import { lookup } from 'node:dns/promises';

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const NON_IDEMPOTENT = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* ─── SSRF defense (closes OPENWOP-AUDIT-2026-002) ────────────
 * Every outbound fetch in this pack flows through `safeFetch` →
 * `assertPublicUrl`. The destination's hostname is resolved (via
 * node:dns/promises#lookup) and every returned address is checked
 * against the blocked-range table below. Caller-supplied headers
 * with sensitive names are stripped before the request leaves the
 * pack so an attacker controlling `inputs.headers` can't redirect
 * an Authorization bearer.
 *
 * Opt-out for local-dev / self-hosted: set
 *   OPENWOP_HTTP_ALLOW_PRIVATE_RANGES=true
 * on the host process. Production deployments MUST NOT set this
 * — the demo at app.openwop.dev runs with it unset.
 */
const PRIVATE_V4_RANGES = [
  // [networkInt, maskInt]
  [0x7F000000, 0xFF000000], // 127.0.0.0/8     loopback
  [0x0A000000, 0xFF000000], // 10.0.0.0/8      RFC 1918
  [0xAC100000, 0xFFF00000], // 172.16.0.0/12   RFC 1918
  [0xC0A80000, 0xFFFF0000], // 192.168.0.0/16  RFC 1918
  [0xA9FE0000, 0xFFFF0000], // 169.254.0.0/16  link-local + GCP/AWS metadata
  [0x00000000, 0xFF000000], // 0.0.0.0/8       "this network"
  [0x64400000, 0xFFC00000], // 100.64.0.0/10   CGNAT
  [0xE0000000, 0xF0000000], // 224.0.0.0/4     multicast
  [0xF0000000, 0xF0000000], // 240.0.0.0/4     reserved
];

function ipv4ToInt(addr) {
  return addr.split('.').reduce((acc, part) => (acc << 8) | (parseInt(part, 10) & 0xff), 0) >>> 0;
}

function isBlockedV4(addr) {
  const n = ipv4ToInt(addr);
  for (const [base, mask] of PRIVATE_V4_RANGES) {
    // JS `&` returns a signed 32-bit int — coerce to unsigned before
    // comparing against the unsigned literals in the range table.
    if (((n & mask) >>> 0) === base) return true;
  }
  return false;
}

function isBlockedV6(addr) {
  // Block loopback, unspecified, link-local, ULA, multicast.
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped + re-checked as v4.
  const low = addr.toLowerCase();
  if (low === '::1' || low === '::' || low === '0:0:0:0:0:0:0:0' || low === '0:0:0:0:0:0:0:1') return true;
  const v4mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isBlockedV4(v4mapped[1]);
  // fe80::/10 — link-local. First two hextets fall in fe80..febf.
  if (/^fe[89ab]/.test(low)) return true;
  // fc00::/7 — unique-local addresses.
  if (/^f[cd]/.test(low)) return true;
  // ff00::/8 — multicast.
  if (low.startsWith('ff')) return true;
  return false;
}

function parseLiteralIp(host) {
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return { v4: h };
  if (h.includes(':')) return { v6: h };
  return null;
}

const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
]);

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  if (Array.isArray(headers)) return headers; // Fetch supports [[k,v]] but pack never builds it that way; pass through.
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof k !== 'string') continue;
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); }
  catch { throw makeError('URL_INVALID', `invalid URL: ${rawUrl}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw makeError('URL_SCHEME_BLOCKED', `scheme not allowed: ${u.protocol}`);
  }
  if (process.env.OPENWOP_HTTP_ALLOW_PRIVATE_RANGES === 'true') return;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]') {
    throw makeError('URL_BLOCKED', `destination blocked (hostname): ${host}`);
  }
  const literal = parseLiteralIp(host);
  if (literal) {
    if (literal.v4 && isBlockedV4(literal.v4)) throw makeError('URL_BLOCKED', `destination blocked: ${host}`);
    if (literal.v6 && isBlockedV6(literal.v6)) throw makeError('URL_BLOCKED', `destination blocked: ${host}`);
    return;
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch (err) {
    throw makeError('URL_DNS_FAILED', `DNS resolution failed for ${host}: ${err.message}`);
  }
  for (const { address, family } of addrs) {
    if (family === 4 && isBlockedV4(address)) {
      throw makeError('URL_BLOCKED', `destination resolves to blocked IP: ${host} → ${address}`);
    }
    if (family === 6 && isBlockedV6(address)) {
      throw makeError('URL_BLOCKED', `destination resolves to blocked IP: ${host} → ${address}`);
    }
  }
}

/** SSRF-hardened fetch wrapper. ALL outbound calls in this pack go
 *  through this. Validates the URL, scrubs sensitive caller headers,
 *  then delegates to the injected fetch impl (`ctx.fetch` for tests
 *  or `globalThis.fetch` for production). */
async function safeFetch(rawUrl, init = {}, fetchImpl = globalThis.fetch) {
  await assertPublicUrl(rawUrl);
  const cleanInit = { ...init };
  if (cleanInit.headers) cleanInit.headers = sanitizeHeaders(cleanInit.headers);
  return fetchImpl(rawUrl, cleanInit);
}

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
      const res = await safeFetch(url, {
        method,
        headers,
        body: bodyBytes ?? undefined,
        signal: attemptController.signal,
      }, fetchImpl);
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
      // SSRF-defense errors are deterministic — no retry.
      if (err && (err.code === 'URL_BLOCKED' || err.code === 'URL_SCHEME_BLOCKED' || err.code === 'URL_INVALID' || err.code === 'URL_DNS_FAILED')) {
        throw err;
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

/* ─── v1.1 additions ────────────────────────────────────────── */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

async function bareFetch(url, init) {
  const r = await safeFetch(url, init);
  let body;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else if (ct.startsWith('text/')) body = await r.text();
  else body = await r.arrayBuffer().then((b) => Buffer.from(b).toString('base64'));
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body };
}

export async function openapiCall(ctx) {
  const { operationId } = ctx.config;
  const doc = ctx.inputs.openapi;
  if (!doc?.paths) throw Object.assign(new Error('openapi doc missing paths'), { code: 'CONFIG_INVALID' });
  let route = null, method = null;
  for (const [p, methods] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (op.operationId === operationId) { route = p; method = m; break; }
    }
    if (route) break;
  }
  if (!route) throw Object.assign(new Error(`operationId not found: ${operationId}`), { code: 'CONFIG_INVALID' });
  const base = (doc.servers?.[0]?.url) || ctx.config.baseUrl || '';
  let url = base + route;
  for (const [k, v] of Object.entries(ctx.inputs.pathParams ?? {})) url = url.replace('{' + k + '}', encodeURIComponent(v));
  const q = new URLSearchParams(ctx.inputs.queryParams ?? {}).toString();
  if (q) url += (url.includes('?') ? '&' : '?') + q;
  const init = {
    method: method.toUpperCase(),
    headers: { 'content-type': 'application/json', ...(ctx.inputs.headers ?? {}) },
  };
  if (ctx.inputs.body !== undefined && method.toUpperCase() !== 'GET') {
    init.body = typeof ctx.inputs.body === 'string' ? ctx.inputs.body : JSON.stringify(ctx.inputs.body);
  }
  const res = await bareFetch(url, init);
  return { status: 'success', outputs: { url, method: init.method, ...res } };
}

export async function graphqlQuery(ctx) {
  const res = await bareFetch(ctx.config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ctx.inputs.headers ?? {}) },
    body: JSON.stringify({ query: ctx.inputs.query, variables: ctx.inputs.variables ?? {}, operationName: ctx.inputs.operationName ?? null }),
  });
  return { status: 'success', outputs: { ...res, data: res.body?.data ?? null, errors: res.body?.errors ?? null } };
}

export const graphqlMutation = graphqlQuery;

export async function graphqlSubscription(ctx) {
  // Subscriptions require a graphql-ws WebSocket. Delegate to host.
  if (typeof ctx.graphqlSubscribe !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.graphqlSubscribe'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  const terminal = await ctx.graphqlSubscribe(
    { endpoint: ctx.config.endpoint, query: ctx.inputs.query, variables: ctx.inputs.variables ?? {}, headers: ctx.inputs.headers ?? {} },
    async (event) => { events.push(event); if (emit) await emit({ kind: 'node.progress', payload: event }); },
  );
  return { status: 'success', outputs: { terminal, events, eventCount: events.length } };
}

export async function soapCall(ctx) {
  const envelope = ctx.inputs.envelope;
  const res = await safeFetch(ctx.config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', 'soapaction': ctx.config.soapAction || '', ...(ctx.inputs.headers ?? {}) },
    body: envelope,
  });
  const text = await res.text();
  return { status: 'success', outputs: { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text } };
}

function makeGrpc(kind) {
  return async function (ctx) {
    if (typeof ctx.grpc?.[kind] !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.grpc.${kind}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const events = kind === 'unary' ? null : [];
    const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
    const result = await ctx.grpc[kind](
      {
        endpoint: ctx.config.endpoint, service: ctx.config.service, method: ctx.config.method,
        request: ctx.inputs.request, metadata: ctx.inputs.metadata ?? {},
      },
      events ? async (e) => { events.push(e); if (emit) await emit({ kind: 'node.progress', payload: e }); } : undefined,
    );
    return { status: 'success', outputs: events ? { result, events, eventCount: events.length } : { result } };
  };
}

export const grpcUnary = makeGrpc('unary');
export const grpcServerStream = makeGrpc('serverStream');
export const grpcClientStream = makeGrpc('clientStream');
export const grpcBidi = makeGrpc('bidi');

export async function sseConsume(ctx) {
  // Streaming SSE via fetch. Emits per-message; terminates when stream closes or after durationMs.
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  const controller = new AbortController();
  const timer = ctx.config.durationMs ? setTimeout(() => controller.abort(), ctx.config.durationMs) : null;
  const res = await safeFetch(ctx.inputs.url, { headers: { accept: 'text/event-stream', ...(ctx.inputs.headers ?? {}) }, signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop();
      for (const block of blocks) {
        const event = { data: '', event: 'message', id: null };
        for (const line of block.split(/\n/)) {
          if (line.startsWith('data:')) event.data += (event.data ? '\n' : '') + line.slice(5).trimStart();
          else if (line.startsWith('event:')) event.event = line.slice(6).trim();
          else if (line.startsWith('id:')) event.id = line.slice(3).trim();
        }
        events.push(event);
        if (emit) await emit({ kind: 'node.progress', payload: event });
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { status: 'success', outputs: { events, eventCount: events.length } };
}

export async function websocketClient(ctx) {
  if (typeof ctx.websocket?.connect !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.websocket.connect'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  await ctx.websocket.connect(
    { url: ctx.inputs.url, headers: ctx.inputs.headers ?? {}, durationMs: ctx.config.durationMs ?? 30000, send: ctx.inputs.send ?? [] },
    async (event) => { events.push(event); if (emit) await emit({ kind: 'node.progress', payload: event }); },
  );
  return { status: 'success', outputs: { events, eventCount: events.length } };
}

export async function longPoll(ctx) {
  const maxIter = ctx.config.maxIterations ?? 60;
  const intervalMs = ctx.config.intervalMs ?? 5000;
  let iter = 0;
  while (iter < maxIter) {
    iter++;
    const res = await bareFetch(ctx.inputs.url, { method: 'GET', headers: ctx.inputs.headers ?? {} });
    if (res.status >= 200 && res.status < 300 && res.body !== null && (Array.isArray(res.body) ? res.body.length > 0 : true)) {
      return { status: 'success', outputs: { ...res, iterations: iter } };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: 'success', outputs: { status: 204, headers: {}, body: null, iterations: iter, exhausted: true } };
}

export async function uploadMultipart(ctx) {
  const form = new FormData();
  for (const [k, v] of Object.entries(ctx.inputs.fields ?? {})) form.append(k, String(v));
  for (const file of ctx.inputs.files ?? []) {
    const buf = Buffer.from(file.contentBase64, 'base64');
    form.append(file.field, new Blob([buf], { type: file.contentType || 'application/octet-stream' }), file.filename);
  }
  const res = await bareFetch(ctx.inputs.url, { method: 'POST', body: form, headers: ctx.inputs.headers ?? {} });
  return { status: 'success', outputs: res };
}

export async function uploadResumable(ctx) {
  if (typeof ctx.upload?.resumable !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.upload.resumable'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const result = await ctx.upload.resumable({
    url: ctx.inputs.url, protocol: ctx.config.protocol || 'tus',
    contentBase64: ctx.inputs.contentBase64, contentType: ctx.inputs.contentType,
    metadata: ctx.inputs.metadata ?? {},
  });
  return { status: 'success', outputs: { result } };
}

export async function downloadStream(ctx) {
  const res = await safeFetch(ctx.inputs.url, { method: 'GET', headers: ctx.inputs.headers ?? {} });
  const chunks = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  const reader = res.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (emit) await emit({ kind: 'node.progress', payload: { receivedBytes: total } });
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { status: 'success', outputs: { status: res.status, totalBytes: total, contentBase64: buf.toString('base64'), contentType: res.headers.get('content-type') } };
}

function paginate(strategy) {
  return async function (ctx) {
    const pages = [];
    const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
    let url = ctx.inputs.url;
    let cursor = ctx.inputs.startCursor ?? null;
    let offset = ctx.inputs.startOffset ?? 0;
    let pageNum = 0;
    const max = ctx.config.maxPages ?? 100;
    while (pageNum < max && url) {
      pageNum++;
      const requestUrl = strategy === 'offset'
        ? url + (url.includes('?') ? '&' : '?') + `offset=${offset}&limit=${ctx.config.pageSize ?? 50}`
        : strategy === 'cursor' && cursor
          ? url + (url.includes('?') ? '&' : '?') + `cursor=${encodeURIComponent(cursor)}`
          : url;
      const res = await bareFetch(requestUrl, { method: 'GET', headers: ctx.inputs.headers ?? {} });
      pages.push(res);
      if (emit) await emit({ kind: 'node.progress', payload: { pageNum, status: res.status } });
      if (strategy === 'offset') {
        const arr = Array.isArray(res.body) ? res.body : (res.body?.[ctx.config.itemsPath ?? 'items'] || []);
        if (arr.length < (ctx.config.pageSize ?? 50)) break;
        offset += arr.length;
      } else if (strategy === 'cursor') {
        cursor = res.body?.[ctx.config.cursorPath ?? 'nextCursor'] ?? null;
        if (!cursor) break;
      } else if (strategy === 'link-header') {
        const link = res.headers.link;
        const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
        url = m ? m[1] : null;
      }
    }
    return { status: 'success', outputs: { pages, pageCount: pages.length } };
  };
}

export const paginationCursor = paginate('cursor');
export const paginationOffset = paginate('offset');
export const paginationLinkHeader = paginate('link-header');

export async function retryRateLimitAware(ctx) {
  const max = ctx.config.maxAttempts ?? 5;
  const baseMs = ctx.config.baseDelayMs ?? 500;
  let attempt = 0;
  while (attempt < max) {
    attempt++;
    const res = await bareFetch(ctx.inputs.url, { method: ctx.inputs.method ?? 'GET', headers: ctx.inputs.headers ?? {}, body: ctx.inputs.body });
    if (res.status !== 429 && res.status < 500) {
      return { status: 'success', outputs: { ...res, attempts: attempt } };
    }
    const retryAfter = res.headers['retry-after'];
    const wait = retryAfter ? (isNaN(retryAfter) ? Math.max(0, new Date(retryAfter).getTime() - Date.now()) : Number(retryAfter) * 1000) : baseMs * 2 ** (attempt - 1) + Math.random() * baseMs;
    await new Promise((r) => setTimeout(r, wait));
  }
  return { status: 'success', outputs: { status: 0, headers: {}, body: null, attempts: attempt, exhausted: true } };
}

const CB_STATE = new Map();

export async function circuitBreaker(ctx) {
  const key = ctx.config.breakerKey || ctx.inputs.url;
  const now = Date.now();
  const state = CB_STATE.get(key) || { failures: 0, openUntil: 0 };
  if (state.openUntil > now) {
    return { status: 'success', outputs: { circuitOpen: true, status: 0, headers: {}, body: null, openUntilMs: state.openUntil - now } };
  }
  try {
    const res = await bareFetch(ctx.inputs.url, { method: ctx.inputs.method ?? 'GET', headers: ctx.inputs.headers ?? {}, body: ctx.inputs.body });
    if (res.status >= 500) state.failures++;
    else state.failures = 0;
    if (state.failures >= (ctx.config.threshold ?? 5)) {
      state.openUntil = now + (ctx.config.cooldownMs ?? 30000);
      state.failures = 0;
    }
    CB_STATE.set(key, state);
    return { status: 'success', outputs: { ...res, circuitOpen: false } };
  } catch (e) {
    state.failures++;
    if (state.failures >= (ctx.config.threshold ?? 5)) { state.openUntil = now + (ctx.config.cooldownMs ?? 30000); state.failures = 0; }
    CB_STATE.set(key, state);
    throw e;
  }
}

export async function idempotencyKey(ctx) {
  const mode = ctx.config.mode || 'uuid';
  if (mode === 'uuid') return { status: 'success', outputs: { key: randomUUID() } };
  if (mode === 'hash') {
    const h = createHash('sha256').update(JSON.stringify(ctx.inputs.payload)).digest('hex');
    return { status: 'success', outputs: { key: h } };
  }
  if (mode === 'composite') {
    const h = createHash('sha256').update(`${ctx.inputs.runId}:${ctx.inputs.nodeId}:${JSON.stringify(ctx.inputs.payload)}`).digest('hex');
    return { status: 'success', outputs: { key: h } };
  }
  throw Object.assign(new Error(`unknown mode: ${mode}`), { code: 'CONFIG_INVALID' });
}

export async function webhookVerify(ctx) {
  const family = ctx.config.family || 'stripe';
  const sigHeader = ctx.inputs.signatureHeader;
  const secret = ctx.inputs.secret;
  const body = ctx.inputs.body; // string
  if (family === 'stripe') {
    // t=...,v1=...
    const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
    const signed = parts.t + '.' + body;
    const expected = createHmac('sha256', secret).update(signed).digest('hex');
    const ok = parts.v1 && Buffer.from(parts.v1, 'hex').length === Buffer.from(expected, 'hex').length && timingSafeEqual(Buffer.from(parts.v1, 'hex'), Buffer.from(expected, 'hex'));
    return { status: 'success', outputs: { valid: ok, family } };
  }
  if (family === 'github') {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const ok = sigHeader.length === expected.length && timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    return { status: 'success', outputs: { valid: ok, family } };
  }
  if (family === 'slack') {
    const ts = ctx.inputs.timestampHeader;
    const base = `v0:${ts}:${body}`;
    const expected = 'v0=' + createHmac('sha256', secret).update(base).digest('hex');
    const ok = sigHeader.length === expected.length && timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    return { status: 'success', outputs: { valid: ok, family } };
  }
  if (family === 'raw-hmac') {
    const alg = ctx.config.algorithm || 'sha256';
    const expected = createHmac(alg, secret).update(body).digest('hex');
    const provided = sigHeader;
    const ok = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return { status: 'success', outputs: { valid: ok, family } };
  }
  throw Object.assign(new Error(`unknown family: ${family}`), { code: 'CONFIG_INVALID' });
}

export const nodes = {
  'core.openwop.http.fetch': fetchNode,
  'core.openwop.http.openapi-call': openapiCall,
  'core.openwop.http.graphql-query': graphqlQuery,
  'core.openwop.http.graphql-mutation': graphqlMutation,
  'core.openwop.http.graphql-subscription': graphqlSubscription,
  'core.openwop.http.soap-call': soapCall,
  'core.openwop.http.grpc-unary': grpcUnary,
  'core.openwop.http.grpc-server-stream': grpcServerStream,
  'core.openwop.http.grpc-client-stream': grpcClientStream,
  'core.openwop.http.grpc-bidi': grpcBidi,
  'core.openwop.http.sse-consume': sseConsume,
  'core.openwop.http.websocket-client': websocketClient,
  'core.openwop.http.long-poll': longPoll,
  'core.openwop.http.upload-multipart': uploadMultipart,
  'core.openwop.http.upload-resumable': uploadResumable,
  'core.openwop.http.download-stream': downloadStream,
  'core.openwop.http.pagination-cursor': paginationCursor,
  'core.openwop.http.pagination-offset': paginationOffset,
  'core.openwop.http.pagination-link-header': paginationLinkHeader,
  'core.openwop.http.retry-rate-limit-aware': retryRateLimitAware,
  'core.openwop.http.circuit-breaker': circuitBreaker,
  'core.openwop.http.idempotency-key': idempotencyKey,
  'core.openwop.http.webhook-verify': webhookVerify,
};

export default nodes;
