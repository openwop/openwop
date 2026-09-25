/**
 * Remove the retired `supported` flag from a v1 capability schema fragment
 * (or an advertised value), and flag payload a v2 record cannot splice.
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
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not the corpus's v2 facet projection. `projectV1FacetSchema` in
 * scripts/generate-from-declaration.mjs builds schemas/v2/capabilities.schema.json
 * and does four more things this does not:
 *
 *   - drops `tier` and `experimentalUntil` (the record's `status`/`until`
 *     absorb them — mapping a v1 tier onto a v2 status is a decision, not a strip);
 *   - folds `supported`-gated if/then into unconditional `required` (RFC 0192 §A);
 *     here the conditional stays, its `if` reduced to an always-true
 *     `{ properties: {} }` — the same verdict, but not the same schema;
 *   - closes objects (`additionalProperties: false`);
 *   - rewrites `supported` prose in descriptions (RFC 0192 §B).
 *
 * So `multiAgent.executionModel` passed through this still carries `tier` and
 * `experimentalUntil`. Both functions were named `stripSupported` until suite
 * 2.38.x, which hid that difference (the old name survives as a deprecated
 * alias for openwop-app's parity test); do not merge them — they have different
 * contracts. `carriesUnspliceablePayload` IS the same predicate as
 * scripts/v2-unspliceable.mjs, and a self-test holds the two copies equal.
 */

/** Recursively drop `supported` — at every depth, and out of any `required[]`. Nothing else. */
export function stripSupportedFlag<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSupportedFlag(v)) as unknown as T;
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'supported') continue;
    out[k] = stripSupportedFlag(v);
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
 * @deprecated Renamed `stripSupportedFlag` in suite 2.38.x; the old name was shared
 * with the generator's full schema projection and hid the difference. Kept because
 * openwop-app's `backend/typescript/test/whd7-v2-projection-parity.test.ts` imports
 * it by this name. Remove at the next suite major.
 */
export const stripSupported = stripSupportedFlag;

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
