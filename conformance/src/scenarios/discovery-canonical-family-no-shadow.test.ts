/**
 * RFC 0149 §E — a vendor extension MUST NOT shadow a canonical capability family.
 *
 * RFC 0073 put canonical families at the document root, and `host-extensions.md`
 * §"Canonical prefixes" puts vendor surface under `x-host-<vendor>-*`,
 * `vendor.<org>.*`, or `private.<host>.*`. Those two rules together are what make
 * discovery negotiable: a consumer reads the root for what the protocol defines
 * and treats a namespaced key as opaque.
 *
 * The gap is what happens when a canonical family name appears *inside* the
 * namespaced region — `vendor.acme.auth`, or an `x-host-acme-*` object carrying
 * its own `interrupts`. Nothing in the corpus forbade it, and a consumer that
 * merges vendor surface over the root before negotiating reads a vendor's
 * `auth` block as *the* auth contract. `host-extensions.md` already says clients
 * MUST treat extension surface as opaque, but "opaque" is a rule about the
 * consumer; it does not stop a host from publishing the collision, and the
 * consumer that gets it wrong is the one that most needed the guardrail.
 *
 * §E's second clause is separate and unconditional: no discovery example may
 * carry credentials or tenant data. Discovery is the one document a host serves
 * credential-free to anonymous callers (RFC 0100 requires `agentCardUrl` to GET-
 * resolve without credentials), so a secret pasted into an example is a secret
 * in the most-copied, least-guarded artifact in the corpus.
 *
 * Both legs are structural and server-free — they read the corpus, not a host.
 * `spec/v1/` and `RFCS/` are repository-only, so this self-skips under the
 * published tarball layout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { V1_DIR } from '../lib/paths.js';

const SCHEMA_PATH =
  V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'schemas', 'capabilities.schema.json');

/** The canonical families, read from the schema rather than hand-listed. */
function canonicalFamilies(): Set<string> {
  if (SCHEMA_PATH === null) return new Set();
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
    properties?: Record<string, unknown>;
  };
  return new Set(Object.keys(schema.properties ?? {}));
}

/** `host-extensions.md` §"Canonical prefixes". */
function isVendorKey(key: string): boolean {
  return /^x-host-/.test(key) || /^(vendor|private)\./.test(key);
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

/** Every fenced json/jsonc example under `dir`, paired with its source line. */
function fencedObjects(dir: string): { file: string; line: number; value: unknown }[] {
  const out: { file: string; line: number; value: unknown }[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^```(json|jsonc)\s*$/.test(lines[i]!.trim())) continue;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '```') body.push(lines[j++]!);
      try {
        out.push({ file: name, line: i + 2, value: JSON.parse(body.join('\n')) });
      } catch {
        // Unparseable blocks are RFC 0150 §D's problem, not this gate's.
      }
      i = j;
    }
  }
  return out;
}

/** Canonical family names appearing anywhere beneath a vendor-namespaced key. */
function shadowed(value: unknown, families: Set<string>, insideVendor: boolean): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nowInside = insideVendor || isVendorKey(key);
    if (insideVendor && families.has(key)) hits.push(key);
    hits.push(...shadowed(child, families, nowInside));
  }
  return hits;
}

/**
 * Credential detection runs on THREE axes with different failure modes, because
 * no one of them is complete and the ways they are incomplete do not overlap.
 *
 * A peer put the problem precisely: *a negative existence claim cannot be
 * established by grepping the vocabulary you would have chosen.* Axis 1 alone —
 * a hand-picked list of issuer prefixes — reports clean on every credential
 * format its author did not think of, and reports it in exactly the confident
 * tone of a real check. That is the vacuous-witness pattern wearing a different
 * hat: the gate is honest about what it observed and silent about what it
 * cannot see.
 *
 * None of the three closes the claim. Together they fail differently, which is
 * the most that can be said for them, and it is said here rather than implied by
 * a green run.
 */

/** Axis 1 — known issuer prefixes. Blind to any format not listed. */
const SECRET_PREFIX = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** Axis 2 — the property NAME claims to hold a credential. Blind to odd names. */
const CREDENTIAL_KEY = /secret|password|token|api_?key|credential|private_?key|bearer/i;

/** An example is allowed to say `sk-…` or `<your-key>`; that is what examples are for. */
function isPlaceholder(v: string): boolean {
  if (v.length < 16) return true;
  if (/^https?:\/\//.test(v)) return true;
  return /\.\.\.|…|<|>|\bexample\b|\bplaceholder\b|\bredacted\b|\byour-|\bchangeme\b|x{4,}/i.test(v);
}

/**
 * Axis 3 — dense random-looking material regardless of issuer. Requires no
 * separators, mixed case, digits, and high Shannon entropy, which is what
 * distinguishes a credential body from a long dotted identifier or an SRI hash.
 * Blind to low-entropy secrets and to anything with word structure.
 */
function isDenseToken(v: string): boolean {
  if (!/^[A-Za-z0-9]{24,}$/.test(v)) return false;
  if (!(/[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v))) return false;
  const counts = new Map<string, number>();
  for (const ch of v) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / v.length;
    entropy -= p * Math.log2(p);
  }
  return entropy >= 4.2;
}

function secrets(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (v: unknown, key: string | null): void => {
    if (typeof v === 'string') {
      for (const re of SECRET_PREFIX) if (re.test(v)) hits.push(`${v.slice(0, 24)} [issuer-prefix]`);
      if (key !== null && CREDENTIAL_KEY.test(key) && !isPlaceholder(v)) {
        hits.push(`${key}=${v.slice(0, 24)} [credential-named]`);
      }
      if (isDenseToken(v)) hits.push(`${v.slice(0, 24)} [dense-token]`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((c) => walk(c, key));
    if (v !== null && typeof v === 'object') {
      for (const [k, c] of Object.entries(v)) walk(c, k);
    }
  };
  walk(value, null);
  return [...new Set(hits)];
}

describe.skipIf(V1_DIR === null)('RFC 0149 §E — canonical families are not shadowed', () => {
  const v1Dir = V1_DIR as string;
  const rfcsDir = V1_DIR === null ? '' : pathResolve(v1Dir, '..', '..', 'RFCS');

  it('the canonical family list and the example corpus are both non-empty', () => {
    // Guard: an empty family set or an empty scan makes both legs vacuous —
    // the failure RFC 0148 exists to close.
    expect(canonicalFamilies().size, 'capabilities.schema.json MUST declare families').toBeGreaterThan(50);
    expect(fencedObjects(v1Dir).length, 'spec/v1 MUST contain parseable json examples').toBeGreaterThan(20);
  });

  it('no vendor-namespaced object re-declares a canonical family', () => {
    const families = canonicalFamilies();
    const findings: Finding[] = [];
    for (const dir of [v1Dir, rfcsDir]) {
      for (const { file, line, value } of fencedObjects(dir)) {
        const hits = shadowed(value, families, false);
        if (hits.length > 0) {
          const rel = dir === v1Dir ? 'spec/v1' : 'RFCS';
          findings.push({ file, line, detail: `${rel}/${file}:${line} → ${[...new Set(hits)].join(', ')}` });
        }
      }
    }
    expect(
      findings.map((f) => f.detail),
      'RFC 0149 §E: a canonical family name inside `x-host-*` / `vendor.*` / `private.*` shadows ' +
        'the family a consumer negotiates on. `host-extensions.md` tells clients to treat ' +
        'extension surface as opaque, but that binds the consumer — it does not stop a host from ' +
        'publishing the collision, and the consumer that merges vendor over root before ' +
        'negotiating is exactly the one the rule was meant to protect.\n  ' +
        findings.map((f) => f.detail).join('\n  '),
    ).toEqual([]);
  });

  it('no discovery example carries credential material', () => {
    const findings: string[] = [];
    for (const dir of [v1Dir, rfcsDir]) {
      for (const { file, line, value } of fencedObjects(dir)) {
        const hits = secrets(value);
        if (hits.length > 0) {
          const rel = dir === v1Dir ? 'spec/v1' : 'RFCS';
          findings.push(`${rel}/${file}:${line} → ${hits.join(', ')}…`);
        }
      }
    }
    expect(
      findings,
      'RFC 0149 §E: discovery is served credential-free to anonymous callers, so a real-shaped ' +
        'secret in an example sits in the most-copied, least-guarded artifact in the corpus. ' +
        'Use an obvious placeholder.\n  ' + findings.join('\n  '),
    ).toEqual([]);
  });
});
