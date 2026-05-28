import type { Ctx } from './context.js';
/** Host HTTP client — typed-ish wrapper over ctx.fetchImpl with bearer + JSON. */

import { HttpError } from './errors.js';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

/** Perform a JSON request against `ctx.baseUrl`; throws HttpError on non-2xx. */
export async function requestJson(ctx: Ctx, path: string, options: RequestOptions = {}): Promise<{ status: number; headers: Headers; body: any }> {
  // Join path RELATIVE to the base so a base with a path prefix
  // (e.g. https://app.openwop.dev/api) is preserved. `new URL(path, base)`
  // with an absolute `path` would otherwise reset the base path to '/' —
  // silently breaking any host that proxies under a prefix.
  const url = new URL(path.replace(/^\//, ''), ctx.baseUrl.endsWith('/') ? ctx.baseUrl : `${ctx.baseUrl}/`);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  if (options.auth !== false && ctx.apiKey) {
    headers.authorization = `Bearer ${ctx.apiKey}`;
  }
  const res = await ctx.fetchImpl(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const body = text.length > 0 ? parseJsonResponse(text) : null;
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, body);
  }
  return { status: res.status, headers: res.headers, body };
}

/** requestJson that never throws — returns {ok,...} for diagnostics (doctor). */
export async function safeRequest(ctx: Ctx, path: string, options: RequestOptions = {}): Promise<any> {
  try {
    const res = await requestJson(ctx, path, options);
    return { ok: true, path, status: res.status, body: res.body };
  } catch (err) {
    return { ok: false, path, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Unauthenticated reachability probe — returns {ok, message}. */
export async function probeEndpoint(ctx: Ctx, path: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await requestJson(ctx, path, { auth: false });
    return { ok: true, message: String(res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function parseJsonResponse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
