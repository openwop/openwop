/**
 * RFC 0211 — reading an A2A 1.0 error's details.
 *
 * A2A v1.0.1 §9.5: a JSON-RPC error's `data` is an ARRAY of ProtoJSON `Any`
 * objects, each carrying `@type`; §10.6/§11.6 name `google.rpc.ErrorInfo`
 * (`reason` UPPER_SNAKE without the `Error` suffix, `domain`
 * `a2a-protocol.org`, `metadata` a `map<string,string>`). The v2 profile makes
 * the ErrorInfo entry a MUST on the JSON-RPC binding (`interop.md`
 * §"The operation mappings", A2A error details).
 */

export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';
export const A2A_ERROR_DOMAIN = 'a2a-protocol.org';

export interface ErrorInfo { reason?: unknown; domain?: unknown; metadata?: unknown }

/** The ErrorInfo entries of an upstream-shaped `data` array (empty when `data` is not an array). */
export function errorInfos(data: unknown): ErrorInfo[] {
  if (!Array.isArray(data)) return [];
  return data.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && (x as Record<string, unknown>)['@type'] === ERROR_INFO_TYPE) as ErrorInfo[];
}

/**
 * The normalised details of an error, for comparing two answers (RFC 0211 §D):
 * per element `@type`, `reason`, `domain` and the sorted metadata keys, with an
 * echo of the requested id removed. Comparing `Object.keys(data)` instead is
 * vacuous: a one-element array has keys `["0"]` whatever it discloses.
 */
export function normaliseErrorData(data: unknown, requestedId?: string): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) return [{ notAnArray: typeof data, keys: data && typeof data === 'object' ? Object.keys(data as object).sort() : [] }];
  return data.map((x) => {
    const e = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    const md = (typeof e['metadata'] === 'object' && e['metadata'] !== null ? e['metadata'] : {}) as Record<string, unknown>;
    const keys = Object.keys(md).filter((k) => !(requestedId !== undefined && md[k] === requestedId)).sort();
    return { type: e['@type'], reason: e['reason'], domain: e['domain'], metadataKeys: keys };
  });
}

/** True when a body is the OpenWOP error envelope `{ error: "<code>", message }` (schemas/v2/error-envelope.schema.json). */
export function isOpenwopEnvelope(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b['error'] === 'string' && typeof b['message'] === 'string' && !('jsonrpc' in b);
}
