/**
 * Find a resolved secret on a readable surface — `host-services.md` §`secrets`:
 * "Raw key material MUST NOT appear in any event, log, trace, prompt, error,
 * export or screenshot".
 *
 * Two detectors, because the suite does not always know the secret:
 *
 *   - **value** — the operator told the runner the canary's plaintext
 *     (`OPENWOP_CANARY_SECRET_VALUE`, the same agreement
 *     `secret-leakage-otel-attribute` uses). The text is searched for the value
 *     in every common encoding: raw, JSON-string-escaped, percent-encoded,
 *     standard and URL-safe base64 with and without padding, lower- and
 *     upper-case hex.
 *   - **digest** — the runner does not know the value, but the
 *     `openwop-smoke-byok-roundtrip` node surfaced `{secretSha256,
 *     secretLength}` (fixtures.md). Every window of `secretLength` bytes in
 *     every string of the surface — and in every base64 / hex / percent-decoded
 *     token inside it — is hashed and compared with the digest. A match is a
 *     preimage of the secret's digest on the surface: the secret itself.
 *
 * The digest itself is NOT a finding here: the byok fixture's contract emits it
 * (fixtures.md §`openwop-smoke-byok-roundtrip`). RFC 0229's run witness, which
 * forbids a digest, owns that stricter rule for the values it supplies.
 */

import { createHash } from 'node:crypto';

export interface SecretDetector {
  /** What the detector knows, for the failure message — never the secret. */
  readonly label: string;
  /** The encoding in which the secret was found in `text`, or null. */
  find(text: string): string | null;
}

/** Upper bound on hashed window positions per surface, so a huge body cannot stall a leg. */
const MAX_WINDOWS = 4_000_000;

function b64(buf: Buffer): string { return buf.toString('base64'); }
function b64url(buf: Buffer): string { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_'); }

/** The known-value detector. `value` MUST be non-empty. */
export function valueDetector(value: string): SecretDetector {
  const bytes = Buffer.from(value, 'utf8');
  const forms: Array<[string, string]> = [
    ['raw', value],
    ['JSON-string-escaped', JSON.stringify(value).slice(1, -1)],
    ['percent-encoded', encodeURIComponent(value)],
    ['base64', b64(bytes)],
    ['base64 (unpadded)', b64(bytes).replace(/=+$/, '')],
    ['base64url', b64url(bytes)],
    ['base64url (unpadded)', b64url(bytes).replace(/=+$/, '')],
    ['hex', bytes.toString('hex')],
    ['HEX', bytes.toString('hex').toUpperCase()],
  ];
  return {
    label: `the operator-supplied canary value (OPENWOP_CANARY_SECRET_VALUE, ${bytes.length} bytes)`,
    find(text) {
      for (const [name, form] of forms) if (form.length > 0 && text.includes(form)) return name;
      return null;
    },
  };
}

/** Every string (keys and values) of a parsed JSON document; the raw text when it is not JSON. */
function stringsOf(text: string): string[] {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return [text]; }
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); walk(x); }
  };
  walk(doc);
  return out;
}

/** The byte sequences a string can carry the secret in: itself, and its decodable tokens. */
function candidatesOf(s: string, minBytes: number): Array<[string, Buffer]> {
  const out: Array<[string, Buffer]> = [['raw', Buffer.from(s, 'utf8')]];
  if (s.includes('%')) { try { out.push(['percent-decoded', Buffer.from(decodeURIComponent(s), 'utf8')]); } catch { /* not percent-encoded */ } }
  const minB64 = Math.max(4, Math.floor((minBytes * 4) / 3));
  for (const tok of s.match(new RegExp(`[A-Za-z0-9+/_-]{${minB64},}={0,2}`, 'g')) ?? []) {
    const buf = Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length >= minBytes) out.push(['base64-decoded', buf]);
  }
  for (const tok of s.match(new RegExp(`(?:[0-9a-fA-F]{2}){${minBytes},}`, 'g')) ?? []) out.push(['hex-decoded', Buffer.from(tok, 'hex')]);
  return out;
}

/** The digest detector: a preimage of `sha256Hex` of exactly `length` bytes anywhere on the surface. */
export function digestDetector(sha256Hex: string, length: number): SecretDetector {
  const want = sha256Hex.toLowerCase();
  return {
    label: `a preimage of the secretSha256 the byok fixture surfaced (${length}-byte windows)`,
    find(text) {
      let budget = MAX_WINDOWS;
      for (const s of stringsOf(text)) {
        if (Buffer.byteLength(s, 'utf8') < length) continue; // no encoding makes a string longer than its decoding
        for (const [enc, buf] of candidatesOf(s, length)) {
          for (let i = 0; i + length <= buf.length; i += 1) {
            if (budget-- <= 0) return null;
            if (createHash('sha256').update(buf.subarray(i, i + length)).digest('hex') === want) return enc;
          }
        }
      }
      return null;
    },
  };
}

/** A named readable surface of a run, as the host answered it. */
export interface Surface { readonly name: string; readonly text: string }

/** The surfaces (by name) on which any detector finds the secret, with the encoding. */
export function leaks(surfaces: readonly Surface[], detectors: readonly SecretDetector[]): string[] {
  const out: string[] = [];
  for (const s of surfaces) {
    for (const d of detectors) {
      const enc = d.find(s.text);
      if (enc !== null) { out.push(`${s.name} (${enc}, found by ${d.label})`); break; }
    }
  }
  return out;
}

/** `{secretSha256, secretLength}` wherever a surface carries it (the byok node's outputs), or null. */
export function findSecretDigest(docs: readonly unknown[]): { sha256: string; length: number } | null {
  let hit: { sha256: string; length: number } | null = null;
  const walk = (v: unknown): void => {
    if (hit !== null || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    const sha = o['secretSha256'];
    const len = o['secretLength'];
    if (typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha) && typeof len === 'number' && Number.isInteger(len) && len > 0) { hit = { sha256: sha, length: len }; return; }
    Object.values(o).forEach(walk);
  };
  docs.forEach(walk);
  return hit;
}
