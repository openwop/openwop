/**
 * Vendor-neutral canary fixtures + leak detector for redaction
 * conformance scenarios.
 *
 * This is the spec-side companion to host-specific redaction harnesses.
 * Hosts running `@openwop/openwop-conformance` get vendor-neutral assertions that
 * their server doesn't leak secrets in observable surfaces — without
 * pulling in any host-specific code.
 *
 * **Why this is here:** spec rule NFR-7 (`capabilities.md` §"Secrets")
 * — any code path that emits a `RunEvent`, OTel span, log line, error
 * message, or exported artifact MUST NOT contain raw key material. The
 * conformance suite needs to verify this against the live HTTP surface
 * of any OpenWOP-compliant server.
 *
 * Canary values are built via runtime string concatenation, NOT as
 * contiguous string literals, so static-analysis secret scanners
 * (TruffleHog, gitleaks) don't flag this file. The runtime-assembled
 * strings have the exact same shape that real-world keys do.
 *
 * @see capabilities.md §"Secrets" + NFR-7
 * @see scenarios/redaction.test.ts
 */

/** Stable marker substring present in every canary. Detector finds it
 *  unambiguously; anyone reading a leaked log line sees this and knows
 *  it's a test fixture, not a real key. */
export const CANARY_MARKER = 'CANARY-openwop-CONFORMANCE-NEVER-SECRET';

/**
 * Build a canary value by concatenating an obvious-prefix shape with
 * the marker + a deterministic body. Pure; same args always return
 * the same string. Runtime concat exists purely to defeat static
 * secret-scanners.
 */
function buildCanary(prefix: string, body: string): string {
  return prefix + CANARY_MARKER + '-' + body;
}

/** Tagged canary value. Opaque so callers can't accidentally treat a
 *  canary as a generic string. */
export interface Canary {
  /** Provider/format label (e.g., "openai", "jwt-bearer"). */
  readonly label: string;
  /** The synthetic key/token string. Carries the marker. */
  readonly value: string;
}

/**
 * The canonical canary set. Each value matches the regex shape of a
 * common provider key but contains the unique marker substring so
 * leaks are unambiguously identifiable. Real production secrets do
 * NOT contain this marker, eliminating false positives.
 *
 * Format references (rough — server-side regex redactors should not
 * rely on exact length, only on prefix shape):
 *   - OpenAI: `sk-...` or `sk-proj-...`
 *   - Anthropic: `sk-ant-...`
 *   - Google API key: `AIza...`
 *   - JWT: `base64url.base64url.base64url`
 *   - Opaque BYOK secret IDs: vendor-defined
 */
export const CANARIES: readonly Canary[] = [
  { label: 'openai', value: buildCanary('sk-', 'oai9Lt7Nw2QrZ0aB8mYjPpQe') },
  {
    label: 'anthropic',
    value: buildCanary('sk-' + 'ant-', 'ant3Ko0LqFqzv9Sb1J7mNcR'),
  },
  {
    label: 'google',
    value: 'AIza' + CANARY_MARKER + 'Goog12345abcdef9876',
  },
  {
    label: 'jwt-bearer',
    value:
      'eyJhbGciOiJIUzI1NiJ9.' +
      'eyJjYW5hcnkiOnRydWV9.' +
      CANARY_MARKER +
      '-jwt-signature-xyz',
  },
  {
    label: 'byok-credential-ref',
    value: buildCanary('cred_', 'OpaqueRefAlphaNumX9Y8Z7'),
  },
] as const;

/**
 * A single leak occurrence — what was leaked + roughly where in the
 * captured surface it appeared.
 */
export interface CanaryLeak {
  readonly label: string;
  readonly value: string;
  /** First match position in the captured text. */
  readonly position: number;
}

/**
 * Search a captured surface (response body, header value, etc.) for
 * any canary value or the canary marker. Returns one entry per leak.
 *
 * Implementation: exact substring match against each canary value,
 * plus a separate scan for the marker so partial leaks (e.g., a
 * server-side substring extraction) still trip the detector.
 */
export function findCanaryLeaks(text: string): readonly CanaryLeak[] {
  const leaks: CanaryLeak[] = [];

  // Pass 1 — exact canary value matches.
  for (const c of CANARIES) {
    const pos = text.indexOf(c.value);
    if (pos !== -1) {
      leaks.push({ label: c.label, value: c.value, position: pos });
    }
  }

  // Pass 2 — marker-only fallback. Skip positions inside an already-
  // matched exact canary range (avoid double-counting).
  let scanFrom = 0;
  while (scanFrom < text.length) {
    const pos = text.indexOf(CANARY_MARKER, scanFrom);
    if (pos === -1) break;
    const within = leaks.some(
      (l) => l.position <= pos && pos < l.position + l.value.length,
    );
    if (!within) {
      leaks.push({
        label: 'marker-only',
        value: CANARY_MARKER,
        position: pos,
      });
    }
    scanFrom = pos + CANARY_MARKER.length;
  }

  return leaks;
}

/** Pick a canary by label. Throws if not found. */
export function getCanary(label: string): Canary {
  const c = CANARIES.find((x) => x.label === label);
  if (!c) throw new Error(`Unknown canary label: ${label}`);
  return c;
}

/**
 * Stringify a captured value (HTTP response, JSON body, etc.) to a
 * single string the detector can scan. Idempotent for strings; deep-
 * stringifies objects + arrays.
 */
export function captureToText(captured: unknown): string {
  if (typeof captured === 'string') return captured;
  try {
    return JSON.stringify(captured);
  } catch {
    return String(captured);
  }
}

/**
 * Throw a descriptive error if any canary appears in the captured
 * text. For use in conformance assertions.
 */
export function assertNoCanaryLeak(
  capturedText: string,
  surfaceLabel: string,
): void {
  const leaks = findCanaryLeaks(capturedText);
  if (leaks.length === 0) return;

  const details = leaks
    .map((l) => {
      const start = Math.max(0, l.position - 32);
      const end = Math.min(capturedText.length, l.position + l.value.length + 32);
      const excerpt = capturedText.slice(start, end);
      return `  - [${l.label}] @${l.position}: ...${excerpt}...`;
    })
    .join('\n');

  throw new Error(
    `Canary leak detected in surface "${surfaceLabel}":\n${details}\n\n` +
      `Per capabilities.md §"Secrets" + NFR-7, this surface MUST NOT ` +
      `echo back canary content. Either redact at the emission boundary ` +
      `or document the surface as out-of-scope for redaction obligations.`,
  );
}
