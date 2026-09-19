/**
 * Project a v1 capability value into its v2 shape.
 *
 * WHY THIS EXISTS, in three measured instances from one week:
 *
 *   - openwop-app projected `aiProviders.selfHosted` by hand and turned a v1
 *     `string[]` into a v2 `boolean`.
 *   - The steward's own hand-authored v2 facet override flattened
 *     `aiProviders.input` and `aiProviders.policies` to
 *     `{ type: 'object', additionalProperties: true }` — losing the RFC 0091
 *     `modalities` enum, so a misspelled modality would have validated.
 *
 * Three hand-written projections, each wrong in a different direction. That is
 * not three mistakes; it is one missing function. A hand-written v2 copy is a
 * second source of truth, and the second source drifts.
 *
 * ── What the projection actually is ─────────────────────────────────────────
 * v2 retired the `supported` flag: presence of the record is the claim
 * (RFC 0192). v1 owners carry `supported` NESTED INSIDE each facet, not only at
 * family level, so a strip that only looks at the top level leaves ghosts
 * behind — which is exactly how 26 facet descriptions came to condition a MUST
 * on a field the closed v2 schema forbids. This strips at every depth.
 *
 * It deliberately does NOT invent shape. If a v1 value carries payload a v2
 * record cannot hold, that is RFC 0193's named-seat problem and needs a person
 * to name the seat; this function will not paper over it.
 */

/** Recursively drop `supported` — at every depth, and out of any `required[]`. */
export function stripSupported<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSupported(v)) as unknown as T;
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'supported') continue;
    out[k] = stripSupported(v);
  }
  // A `required` list naming `supported` keeps a retired field mandatory, which
  // is how a closed v2 record ends up unsatisfiable by any honest host.
  if (Array.isArray(out['required'])) {
    const kept = (out['required'] as unknown[]).filter((r) => r !== 'supported');
    if (kept.length > 0) out['required'] = kept;
    else delete out['required'];
  }
  return out as T;
}

/**
 * True when a v1 value carries payload a uniform v2 record cannot splice —
 * an array, a map, an enum or a scalar rather than an object with properties.
 *
 * RFC 0193: the v2 generator builds a record by splicing the seeded v1
 * property's `properties` in as siblings, so a family that WAS an object kept
 * its payload (`limits`) and one that was an array, a map or an enum lost it
 * SILENTLY. A production host published `supportedEnvelopes: {status:"stable"}`
 * — a stable claim to an envelope-kind catalog containing no catalog.
 *
 * Callers use this to REFUSE rather than to guess. The seat name cannot be
 * derived, because the v1 value *was* the whole property; only a person can
 * name it.
 */
export function carriesUnspliceablePayload(v1Value: unknown): boolean {
  if (v1Value === null || typeof v1Value !== 'object' || Array.isArray(v1Value)) return false;
  const p = v1Value as Record<string, unknown>;
  const props = p['properties'];
  if (props !== undefined && typeof props === 'object' && props !== null && Object.keys(props).length > 0) return false;
  if (p['type'] === 'boolean') return false; // presence of the record IS the claim
  if (Array.isArray(p['enum'])) return true;
  if (p['type'] === 'array') return true;
  if (p['type'] === 'string' || p['type'] === 'integer' || p['type'] === 'number') return true;
  if (p['type'] === 'object' && typeof p['additionalProperties'] === 'object' && p['additionalProperties'] !== null) return true;
  return false;
}
