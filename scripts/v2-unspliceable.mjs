/**
 * RFC 0193 §B — a v1 property carries payload the family record cannot splice
 * when it has no `properties` of its own but is not merely a presence flag.
 * `boolean` is exempt: presence of the record IS the claim in v2 (RFC 0192), so
 * a v1 boolean loses nothing. An open object (`additionalProperties: true`, or
 * absent with no properties) is exempt for the same reason — it asserted no shape.
 *
 * Side-effect free on purpose: generate-from-declaration.mjs reads and checks the
 * corpus at import time, so this predicate lives here to be importable by the
 * parity self-test (conformance/src/lib/v2-projection.test.ts), which holds it
 * equal to the host-facing copy in conformance/src/lib/v2-projection.ts. The
 * copy exists because that lib ships in the npm package and this file does not.
 */
export function carriesUnspliceablePayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.properties && Object.keys(p.properties).length) return false;
  if (p.type === 'boolean') return false;
  if (Array.isArray(p.enum)) return true;
  if (p.type === 'array') return true;
  if (p.type === 'string' || p.type === 'integer' || p.type === 'number') return true;
  if (p.type === 'object' && p.additionalProperties && typeof p.additionalProperties === 'object') return true;
  return false;
}
