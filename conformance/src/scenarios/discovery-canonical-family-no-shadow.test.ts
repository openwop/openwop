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

/** Values shaped like real credentials. Placeholders are the point of examples. */
const SECRET_VALUE = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

function secrets(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const re of SECRET_VALUE) if (re.test(v)) hits.push(v.slice(0, 24));
      return;
    }
    if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return hits;
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
