/**
 * OpenWOPDriver — thin HTTP client wrapper used by all conformance scenarios.
 *
 * Why a wrapper rather than raw fetch in every test:
 *   1. Auth header is applied once.
 *   2. URL composition is consistent (base + path).
 *   3. Failure messages cite the implementation name + version so log
 *      output identifies the server under test.
 *   4. JSON decoding errors are surfaced with the raw body for debug.
 */

import { loadEnv } from './env.js';
import { seamPath, targetMajor } from './seams.js';
import { scaledTimeoutMs } from './timeout-scale.js';

/**
 * How long one request may go unanswered before the driver gives up (#1829).
 * Below vitest's 30 s `testTimeout`, so a lost response ends as a named
 * {@link TransportError} and not as a bare harness timeout. Driver long-polls
 * are at most 5 s. Scales with `OPENWOP_POLL_TIMEOUT_SCALE`.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Leads every {@link TransportError} message; `resolveItRecord` keys on it. */
export const TRANSPORT_LOSS_PREFIX = 'transport-loss: ';

/**
 * No response arrived: the request timed out or the connection failed. The
 * suite observed nothing about the host, so this is never a verdict on it. A
 * runner whose network dropped for 9 s once recorded `executed-fail` against a
 * host that had answered in 2.6 ms (MyndHyve cut, suite 2.45.2).
 */
export class TransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network',
    readonly method: string,
    /** Origin and path only. A query string can carry a token. */
    readonly target: string,
    reason: string,
  ) {
    super(`${TRANSPORT_LOSS_PREFIX}${method} ${target} got no response (${reason}); the suite could not observe the host`);
    this.name = 'TransportError';
  }
}

function withoutQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export interface OpenWOPResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

export interface OpenWOPRequestInit {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** `false` sends no default credential. A caller-supplied `Authorization`
   *  header is always sent as given, whatever this says. */
  readonly authenticated?: boolean;
  /** Replaces the driver's own bound entirely; an abort it raises is rethrown as-is. */
  readonly signal?: AbortSignal;
  /** Overrides {@link REQUEST_TIMEOUT_MS} for one request (scaled the same way). */
  readonly timeoutMs?: number;
}

class OpenWOPDriver {
  /**
   * Issue a request and return the decoded body. JSON decode is best-effort —
   * `json` is `undefined` if the response wasn't JSON.
   */
  async request(
    method: string,
    path: string,
    init: OpenWOPRequestInit = {},
  ): Promise<OpenWOPResponse> {
    const env = loadEnv();
    // An absolute URL is used as-is (a host may advertise its MCP server mount or
    // an A2A endpoint on another origin); a path is joined to the base URL.
    // Suite 2.0.0: under target major 2 a v1 seam path is rewritten to its
    // api/seams-v2.yaml address (RFC 0168 §C.2) and every request names the
    // contract it speaks with `OpenWOP-Version` (RFC 0172 §A.3) unless the
    // scenario set one itself (the negotiation scenarios do).
    const major = targetMajor();
    const effectivePath = major === 2 ? seamPath(path) : path;
    const url = /^https?:\/\//i.test(effectivePath) ? effectivePath : `${env.baseUrl}${effectivePath}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(major === 2 && !Object.keys(init.headers ?? {}).some((h) => h.toLowerCase() === 'openwop-version') ? { 'OpenWOP-Version': '2.0' } : {}),
      ...(init.headers ?? {}),
    };
    if (init.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    // A caller-supplied Authorization header (any case) is the credential the
    // scenario chose — a second tenant's key, a low-scope key — and is sent as
    // given. Until 2.39.3 the default key overwrote it unless the caller also
    // passed `authenticated: false`, so "tenant B reads A's file" was really the
    // owner reading its own file (200 → a false cross-tenant leak), and a
    // low-scope resolve was really a full-scope one (a false 403 miss).
    const callerAuth = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
    if (init.authenticated !== false && !callerAuth) {
      headers.Authorization = `Bearer ${env.apiKey}`;
    }

    const fetchInit: RequestInit = { method, headers };
    if (init.body !== undefined) {
      // Buffer / Uint8Array bodies are sent as raw bytes — needed by the
      // RFC 0025 test-mode publish scenarios so the host's body-shape
      // check sees the bytes the caller actually wrote (rather than a
      // JSON-stringified `{"type":"Buffer","data":[...]}` envelope).
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(init.body)) {
        fetchInit.body = new Uint8Array(init.body);
      } else if (init.body instanceof Uint8Array) {
        fetchInit.body = init.body;
      } else if (typeof init.body === 'string') {
        fetchInit.body = init.body;
      } else {
        fetchInit.body = JSON.stringify(init.body);
      }
    }
    const boundMs = scaledTimeoutMs(init.timeoutMs ?? REQUEST_TIMEOUT_MS);
    fetchInit.signal = init.signal ?? AbortSignal.timeout(boundMs);
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, fetchInit);
      // The body is read under the same bound: a response whose headers arrive
      // and whose body never does is the same lost observation.
      text = await res.text();
    } catch (err) {
      // The caller's own signal aborted: that is the caller's event, not a loss.
      if (init.signal?.aborted === true) throw err;
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError') throw new TransportError('timeout', method, withoutQuery(url), `no response within ${boundMs} ms`);
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new TransportError('network', method, withoutQuery(url), cause.slice(0, 160));
    }

    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    return {
      status: res.status,
      headers: res.headers,
      text,
      json,
    };
  }

  get(path: string, init: OpenWOPRequestInit = {}): Promise<OpenWOPResponse> {
    return this.request('GET', path, init);
  }

  post(path: string, body: unknown, init: OpenWOPRequestInit = {}): Promise<OpenWOPResponse> {
    return this.request('POST', path, { ...init, body });
  }

  /** PUT helper. The body is JSON-stringified by default; pass a string
   *  Content-Type header for raw-body PUTs (e.g. tarball uploads).
   *  Production hosts that accept tarball PUTs on /v1/packs/* expect
   *  `Content-Type: application/octet-stream`; callers MUST set the
   *  header explicitly when uploading non-JSON. */
  put(path: string, body: unknown, init: OpenWOPRequestInit = {}): Promise<OpenWOPResponse> {
    return this.request('PUT', path, { ...init, body });
  }

  /** DELETE alias for the canonical name. Keeps the call-site shorter
   *  for scenarios that delete via `driver.del(...)`. */
  del(path: string, init: OpenWOPRequestInit = {}): Promise<OpenWOPResponse> {
    return this.request('DELETE', path, init);
  }

  delete(path: string, init: OpenWOPRequestInit = {}): Promise<OpenWOPResponse> {
    return this.request('DELETE', path, init);
  }

  /**
   * Compose a "spec failure" message that cites the implementation under
   * test plus the spec section that requires the assertion. Use as the
   * second argument to `expect(...).toBe(..., msg)`-style assertions.
   */
  describe(specSection: string, requirement: string): string {
    const env = loadEnv();
    return `[${env.implementationName}@${env.implementationVersion}] ${specSection}: ${requirement}`;
  }
}

export const driver = new OpenWOPDriver();
