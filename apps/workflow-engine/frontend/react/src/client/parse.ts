/**
 * Minimal, dependency-free runtime guards for UNTRUSTED and host-extension
 * responses (GAP-ANALYSIS A-2 / E4).
 *
 * Scope (per the architect review): *core* protocol shapes stay validated by
 * the `@openwop/openwop` SDK — we do NOT fork them with a second schema layer.
 * These guards are only for surfaces the SDK does not own: the registry
 * (`packs.openwop.dev`, a different, untrusted origin) and the demo host's
 * `/v1/host/sample/*` extension endpoints, which are cast `as T` from raw
 * fetch. A malformed payload here previously crashed three components deep
 * (e.g. `.map()` on a non-array); these turn it into one typed error the page
 * error states / app error boundary can render.
 */

export class ResponseShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected response shape: ${what}`);
    this.name = 'ResponseShapeError';
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Assert an object (not null, not an array) before property access. */
export function assertRecord(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) throw new ResponseShapeError(`${what} is not an object`);
  return v;
}

/** Assert an array before `.map()` / `.filter()`. */
export function assertArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new ResponseShapeError(`${what} is not an array`);
  return v;
}

/** Assert `obj[key]` is an array (the common "list endpoint" shape). */
export function assertArrayField(obj: unknown, key: string, what: string): unknown[] {
  return assertArray(assertRecord(obj, what)[key], `${what}.${key}`);
}
