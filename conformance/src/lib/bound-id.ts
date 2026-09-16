/**
 * The bound-id path projection (`spec/v2/core/identity.md` §5, RFC 0184 §A.1).
 *
 * A tenant-bound id is TWO segments joined by `/`; a URL path parameter is ONE
 * segment. Something has to carry the separator across, and the corpus used to
 * say `%2F`. That is what a tier-1 host's front door decoded back to `/` before
 * forwarding, leaving every bound id unreachable at its own origin
 * (`v2-created-run-readable.test.ts` records the measurement).
 *
 * So the escape marker is `~`, which RFC 3986 §2.3 lists as UNRESERVED. An
 * intermediary has no license to rewrite an unreserved character, so `~2F`
 * arrives byte-for-byte. `%2F` has no such protection in practice: handling it
 * correctly requires a front door to distinguish a percent-encoded RESERVED
 * octet (§6.2.2.2: MUST NOT decode) from an unreserved one (SHOULD decode), and
 * deployed front doors do not.
 *
 * The codec is TOTAL over bytes rather than conditional on the current id
 * grammar. That is deliberate: a conditional encoding is only unambiguous while
 * the grammar holds still, and this grammar has already moved once (the `anon:`
 * tenant prefix). Encoding every non-passthrough byte means a later widening
 * cannot invalidate a projection already on the wire.
 */

/** RFC 3986 unreserved MINUS `~`, which is reserved here as the escape marker. */
const PASSTHROUGH = /^[A-Za-z0-9._-]$/;

/** Encode a bound id into exactly one path segment. Identity on already-safe input. */
export function projectBoundId(id: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(id)) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && PASSTHROUGH.test(ch) ? ch : `~${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * Decode one path segment back to the bound id.
 *
 * Throws on a `~` that does not introduce two hex digits — the wire rule is
 * `400 validation_error`, and a decoder that silently passed a lone `~` through
 * would make the codec non-injective in exactly the direction that matters.
 */
export function unprojectBoundId(segment: string): string {
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] !== '~') continue;
    if (!/^[0-9A-Fa-f]{2}$/.test(segment.slice(i + 1, i + 3))) {
      throw new Error(`bound-id projection: '~' at index ${i} is not followed by two hex digits`);
    }
    i += 2;
  }
  const bytes: number[] = [];
  let i = 0;
  while (i < segment.length) {
    if (segment[i] === '~') { bytes.push(parseInt(segment.slice(i + 1, i + 3), 16)); i += 3; }
    else { bytes.push(...new TextEncoder().encode(segment[i]!)); i += 1; }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
}

/**
 * The tenant-bound id grammar, mirrored from `ids.schema.json` `$defs.runId`.
 *
 * Exported because four scenarios each kept their own copy, and copies drift:
 * all four still spelled the tenant segment `[A-Za-z0-9._~-]{1,128}` after
 * `tenantId` grew its `anon:` prefix, so every one of them would have rejected
 * a runId the schema accepts (RFC 0184 §A.3).
 */
export const BOUND_ID = /^(anon:)?[A-Za-z0-9._~-]{1,128}\/[A-Za-z0-9._~-]{16,128}$/;
