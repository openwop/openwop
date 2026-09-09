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

export interface OpenWOPResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

export interface OpenWOPRequestInit {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly authenticated?: boolean;
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
    if (init.authenticated !== false) {
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
    const res = await fetch(url, fetchInit);

    const text = await res.text();
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
