/**
 * Pre-validation normalizers for envelope payloads.
 *
 * Mirrors the pattern myndhyve uses in
 * `src/core/ai/envelope/EnvelopeHandler.ts::normalizeEnvelopePayload()`:
 * coerce common LLM-shape drift BEFORE running the per-kind Zod/Ajv
 * validator. Warnings are appended to the acceptor's outcome but
 * never block — the goal is "silently fix the common drift so the
 * model doesn't waste a turn retrying" rather than "reject all
 * non-canonical input."
 *
 * Each normalizer is a pure function:
 *   (payload, warnings) => normalizedPayload
 *
 * Registered per-kind. When no normalizer is registered for an
 * envelope `type`, the payload passes through unchanged. The acceptor
 * runs the normalizer before payload validation, so a payload that
 * was non-canonical on the wire may validate after coercion.
 *
 * Universal-kind coverage:
 * - clarification.request: options may arrive as a single string instead of array
 * - schema.request: names may arrive as a single string instead of array
 * - result: payload may arrive as a primitive instead of an object wrapper
 *
 * Add new normalizers by registering in `ENVELOPE_NORMALIZERS` below.
 */

export interface NormalizerWarning {
  field: string;
  reason: string;
  /** Original value before coercion, for diagnostics. */
  originalShape: string;
}

export type EnvelopeNormalizer = (
  payload: unknown,
  warnings: NormalizerWarning[],
) => unknown;

/** Coerce string→array. Common AI drift: model emits a single value
 *  for a field declared as array. Cheap to fix server-side. */
function coerceToStringArray(
  payload: Record<string, unknown>,
  field: string,
  warnings: NormalizerWarning[],
): void {
  const v = payload[field];
  if (typeof v === 'string') {
    payload[field] = [v];
    warnings.push({
      field,
      reason: `coerced single string to one-element array`,
      originalShape: 'string',
    });
  } else if (Array.isArray(v)) {
    // Already an array — defensive type-check that every entry is a
    // string. Filter non-strings with a warning.
    const cleaned = v.filter((x): x is string => typeof x === 'string');
    if (cleaned.length !== v.length) {
      payload[field] = cleaned;
      warnings.push({
        field,
        reason: `dropped ${v.length - cleaned.length} non-string entries`,
        originalShape: 'mixed-array',
      });
    }
  }
}

const NORMALIZE_CLARIFICATION_REQUEST: EnvelopeNormalizer = (payload, warnings) => {
  if (!payload || typeof payload !== 'object') return payload;
  const obj = { ...(payload as Record<string, unknown>) };
  // `options` field commonly drifts string → array.
  if ('options' in obj) coerceToStringArray(obj, 'options', warnings);
  // `question` field MAY drift array → string (model emits a list of
  // sentences instead of a single question). Join with a newline.
  const q = obj.question;
  if (Array.isArray(q)) {
    obj.question = q.filter((x) => typeof x === 'string').join('\n');
    warnings.push({
      field: 'question',
      reason: 'joined array of strings into a single multi-line question',
      originalShape: 'array',
    });
  }
  return obj;
};

const NORMALIZE_SCHEMA_REQUEST: EnvelopeNormalizer = (payload, warnings) => {
  if (!payload || typeof payload !== 'object') return payload;
  const obj = { ...(payload as Record<string, unknown>) };
  // Canonical field is `names`. Models commonly emit `name` (singular)
  // or `schema` (the resource they want) — normalize both into names[].
  if ('name' in obj && !('names' in obj)) {
    obj.names = obj.name;
    delete obj.name;
    warnings.push({
      field: 'names',
      reason: 'renamed singular `name` field to canonical `names`',
      originalShape: 'singular',
    });
  }
  if ('schema' in obj && !('names' in obj)) {
    obj.names = obj.schema;
    delete obj.schema;
    warnings.push({
      field: 'names',
      reason: 'renamed `schema` field to canonical `names`',
      originalShape: 'aliased',
    });
  }
  coerceToStringArray(obj, 'names', warnings);
  return obj;
};

const NORMALIZE_RESULT: EnvelopeNormalizer = (payload, warnings) => {
  // `result` payloads are intentionally open-shape — the LLM emits
  // whatever it produced. Only normalize the wrapper:
  // if the model emitted a primitive (string/number/etc) instead of
  // an object, wrap it as { value: <primitive> } so downstream
  // consumers can rely on the object shape.
  if (payload !== null && typeof payload !== 'object') {
    warnings.push({
      field: '$root',
      reason: 'wrapped primitive payload in { value: <primitive> }',
      originalShape: typeof payload,
    });
    return { value: payload };
  }
  return payload;
};

/** Per-envelope-type normalizer registry. Keyed by a string-literal
 *  union so a typo (e.g., 'clarification.requests') fails at compile
 *  time. Add new entries by extending `NormalizableKind`. Unregistered
 *  kinds pass through unchanged. */
type NormalizableKind = 'clarification.request' | 'schema.request' | 'result';

const ENVELOPE_NORMALIZERS: Record<NormalizableKind, EnvelopeNormalizer> = {
  'clarification.request': NORMALIZE_CLARIFICATION_REQUEST,
  'schema.request': NORMALIZE_SCHEMA_REQUEST,
  'result': NORMALIZE_RESULT,
};

export interface NormalizeOutcome {
  payload: unknown;
  warnings: NormalizerWarning[];
}

/** Pre-validation pass. Returns the (possibly-coerced) payload + a
 *  list of warnings describing what changed. The acceptor uses the
 *  returned payload for downstream validation and surfaces warnings
 *  in its outcome so callers can audit + log them. */
export function normalizeEnvelopePayload(
  type: string,
  payload: unknown,
): NormalizeOutcome {
  if (!isNormalizableKind(type)) {
    return { payload, warnings: [] };
  }
  const normalizer = ENVELOPE_NORMALIZERS[type];
  const warnings: NormalizerWarning[] = [];
  const normalized = normalizer(payload, warnings);
  return { payload: normalized, warnings };
}

function isNormalizableKind(type: string): type is NormalizableKind {
  return type in ENVELOPE_NORMALIZERS;
}

export function _hasNormalizer(type: string): boolean {
  return isNormalizableKind(type);
}
