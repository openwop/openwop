/**
 * `core.http.request` typeId implementation for the Postgres reference host.
 *
 * Phase H.3 — myndhyve.ai launch-blocker. The "call this API" node is the
 * single most common node type in any workflow product; without it, the
 * host can only call its own AI proxy (H.1″) or MCP tools (H.2). With it,
 * workflows reach any HTTPS endpoint a tenant authorizes.
 *
 * **Wire contract** (canonical typeId per node-packs.md §"Built-in nodes"):
 *
 *     node = {
 *       id: '...',
 *       typeId: 'core.http.request',
 *       config: {
 *         url: 'https://api.example.com/v1/...',
 *         method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
 *         headers?: { [k: string]: string },
 *         body?: string | object,            // serialized JSON if object
 *         timeoutMs?: number,                // default 30_000
 *         expectStatus?: number | number[],  // any-of; default 200-299
 *       }
 *     }
 *
 * Emitted into the run's `variables[node.id]`:
 *
 *     {
 *       status: 200,
 *       headers: { ... },                    // response headers (lowercased keys)
 *       body: string,                        // raw text body, truncated
 *       bodyTruncated: false,
 *       durationMs: 142,
 *     }
 *
 * **SSRF guard.** All non-public destinations are rejected by default:
 * loopback (`127.0.0.0/8`, `::1`), RFC1918 (`10/8`, `172.16/12`,
 * `192.168/16`), link-local (`169.254/16`, `fe80::/10`), unique-local
 * (`fc00::/7`), and the special hostnames `localhost`, `*.local`,
 * `*.internal`, `*.cluster`. Bypass via `OPENWOP_HTTP_ALLOW_PRIVATE=true`
 * for local-receiver test setups.
 *
 * **No DNS resolution** — the guard inspects the literal URL hostname.
 * Production hosts would resolve and re-check (and re-resolve on each
 * call to defend against DNS rebinding). Documented limitation matching
 * the webhooks SSRF guard.
 *
 * **Redaction.** Response body is truncated to `MAX_RESPONSE_BODY_BYTES`
 * before being persisted to variables/events. Request `Authorization`
 * + `Cookie` headers are stripped from any event payload emitted by
 * the executor (the executor decides what to log; this module returns
 * full response). Sensitive request bodies are the caller's responsibility
 * to mark via `credentialRef` — see auth.md §"Secret resolution".
 *
 * @see spec/v1/node-packs.md §"Built-in nodes — core.http.request"
 * @see SECURITY/threat-model-ssrf.md (referenced via webhooks SSRF guard)
 */

import { isIP } from 'node:net';

const MAX_RESPONSE_BODY_BYTES = 1_048_576; // 1 MiB
const DEFAULT_TIMEOUT_MS = 30_000;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/**
 * Public-surface config for `core.http.request`. Every field is
 * optional at the type level so callers can pass `node.config ?? {}`
 * via `as Partial<HttpRequestConfig>`; `performHttpRequest` validates
 * `url` + `method` at runtime before touching them. Matches the
 * core.approvalGate / core.clarificationGate / core.mcp.toolCall
 * pattern in `examples/hosts/postgres/src/server.ts`.
 */
export interface HttpRequestConfig {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly expectStatus?: number | ReadonlyArray<number>;
}

export interface HttpRequestResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bodyTruncated: boolean;
  readonly durationMs: number;
}

export class HttpRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

/**
 * Run the SSRF guard on a destination URL. Returns `{ok: true}` on
 * accept, `{ok: false, reason}` on reject. Bypass with
 * `OPENWOP_HTTP_ALLOW_PRIVATE=true` (test scenarios with localhost
 * receivers only).
 */
export function checkHttpDestination(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'url is not a parseable URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `url protocol "${url.protocol}" is not http(s)` };
  }
  const host = url.hostname.toLowerCase();
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!bare) {
    return { ok: false, reason: 'url is missing a hostname' };
  }

  if (process.env.OPENWOP_HTTP_ALLOW_PRIVATE === 'true') {
    return { ok: true };
  }

  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return { ok: false, reason: 'url points at localhost (SSRF guard)' };
  }
  if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.cluster')) {
    return { ok: false, reason: `url hostname "${bare}" looks internal (SSRF guard)` };
  }

  const ipVersion = isIP(bare);
  if (ipVersion === 4) {
    const [a, b] = bare.split('.').map(Number) as [number, number];
    if (a === 127) return { ok: false, reason: '127.0.0.0/8 (loopback) (SSRF guard)' };
    if (a === 10) return { ok: false, reason: '10.0.0.0/8 (RFC1918) (SSRF guard)' };
    if (a === 172 && b >= 16 && b <= 31) {
      return { ok: false, reason: '172.16.0.0/12 (RFC1918) (SSRF guard)' };
    }
    if (a === 192 && b === 168) {
      return { ok: false, reason: '192.168.0.0/16 (RFC1918) (SSRF guard)' };
    }
    if (a === 169 && b === 254) {
      return { ok: false, reason: '169.254.0.0/16 (link-local; AWS metadata) (SSRF guard)' };
    }
    if (a === 0) return { ok: false, reason: '0.0.0.0/8 (SSRF guard)' };
  }
  if (ipVersion === 6) {
    if (bare === '::1' || bare === '::ffff:127.0.0.1') {
      return { ok: false, reason: 'IPv6 loopback (SSRF guard)' };
    }
    if (bare.startsWith('fc') || bare.startsWith('fd')) {
      return { ok: false, reason: 'fc00::/7 (unique local) (SSRF guard)' };
    }
    if (
      bare.startsWith('fe8') ||
      bare.startsWith('fe9') ||
      bare.startsWith('fea') ||
      bare.startsWith('feb')
    ) {
      return { ok: false, reason: 'fe80::/10 (link-local) (SSRF guard)' };
    }
  }

  return { ok: true };
}

/**
 * Execute a single HTTP request against a tenant-supplied destination.
 *
 * Throws `HttpRequestError` on any failure (validation, SSRF rejection,
 * unexpected status, timeout, network). The caller maps the error code
 * to a `node.failed` event payload. On success, returns the structured
 * result for persistence into variables.
 */
export async function performHttpRequest(
  config: HttpRequestConfig,
  signal?: AbortSignal,
): Promise<HttpRequestResult> {
  if (typeof config.url !== 'string' || !config.url) {
    throw new HttpRequestError('validation_error', 'core.http.request: config.url MUST be a non-empty string');
  }
  const method = (config.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new HttpRequestError(
      'validation_error',
      `core.http.request: method "${method}" is not in the allowed set ${[...ALLOWED_METHODS].join(', ')}`,
    );
  }
  const check = checkHttpDestination(config.url);
  if (!check.ok) {
    throw new HttpRequestError('http_url_rejected', check.reason, { url: config.url });
  }
  const timeoutMs = (() => {
    const t = config.timeoutMs;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(t, DEFAULT_TIMEOUT_MS * 4); // hard ceiling at 2 minutes
  })();

  const requestHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(config.headers ?? {})) {
    if (typeof v === 'string') requestHeaders[k] = v;
  }
  let requestBody: string | undefined;
  if (config.body !== undefined && config.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof config.body === 'string') {
      requestBody = config.body;
    } else {
      requestBody = JSON.stringify(config.body);
      const lowered = Object.fromEntries(
        Object.entries(requestHeaders).map(([k, v]) => [k.toLowerCase(), v]),
      );
      if (!('content-type' in lowered)) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }
  }

  const internalController = new AbortController();
  const timer = setTimeout(() => internalController.abort(), timeoutMs);
  const composedSignal = signal
    ? mergeSignals(signal, internalController.signal)
    : internalController.signal;

  const started = Date.now();
  let response: Response;
  const fetchInit: RequestInit = {
    method,
    headers: requestHeaders,
    signal: composedSignal,
    redirect: 'follow',
  };
  if (requestBody !== undefined) {
    fetchInit.body = requestBody;
  }
  try {
    response = await fetch(config.url, fetchInit);
  } catch (err: unknown) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    if (composedSignal.aborted && !signal?.aborted) {
      throw new HttpRequestError('http_timeout', `core.http.request: timed out after ${timeoutMs}ms`, {
        timeoutMs,
      });
    }
    throw new HttpRequestError('http_network_error', `core.http.request: network error — ${reason}`);
  }
  clearTimeout(timer);
  const durationMs = Date.now() - started;

  // Read response body with a byte cap so a hostile server can't OOM the
  // host by streaming 100 GB.
  const reader = response.body?.getReader();
  let bodyBytes = new Uint8Array(0);
  let bodyTruncated = false;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        bodyTruncated = true;
        const room = MAX_RESPONSE_BODY_BYTES - (total - value.byteLength);
        if (room > 0) chunks.push(value.subarray(0, room));
        try {
          await reader.cancel();
        } catch {
          // swallow — cancel best-effort
        }
        break;
      }
      chunks.push(value);
    }
    bodyBytes = concatBytes(chunks);
  }
  const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(bodyBytes);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });

  const expectedStatuses = normalizeExpectStatus(config.expectStatus);
  if (expectedStatuses && !expectedStatuses.includes(response.status)) {
    throw new HttpRequestError(
      'http_unexpected_status',
      `core.http.request: got ${response.status}, expected one of ${expectedStatuses.join(', ')}`,
      { actual: response.status, expected: expectedStatuses },
    );
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: bodyText,
    bodyTruncated,
    durationMs,
  };
}

function normalizeExpectStatus(input: HttpRequestConfig['expectStatus']): number[] | null {
  if (input === undefined) return null;
  if (typeof input === 'number') return [input];
  if (Array.isArray(input) && input.every((n) => typeof n === 'number')) return [...input];
  return null;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}
