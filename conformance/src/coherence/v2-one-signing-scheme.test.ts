/**
 * v2-one-signing-scheme — RFC 0177 §C.3 (corpus wrapper, inline).
 *
 * One signing scheme for registry version manifests: a detached 64-byte Ed25519
 * signature over the canonical-JSON `pack.json` inside a deterministic tarball,
 * named `ed25519-canonical-json`; `method` and `publicKeyRef` are gone, the key
 * is addressed by `keyId` alone. This wrapper reads
 * `schemas/v2/registry-version-manifest.schema.json` and asserts
 * `signing.properties.scheme.const === 'ed25519-canonical-json'`, that `signing`
 * is closed, and that neither `method` nor `publicKeyRef` survives anywhere in
 * the `signing` object.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle, under `openwop.requirement.0177.one-signing-scheme`.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §C.3
 * @see schemas/v2/registry-version-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0177.one-signing-scheme';
const SECTION = 'RFC 0177 §C.3';

interface SigningSchema {
  additionalProperties?: unknown;
  required?: string[];
  properties?: Record<string, { const?: unknown }>;
}

describe('v2-one-signing-scheme (RFC 0177 §C.3)', () => {
  it('registry-version-manifest signing has exactly one scheme, ed25519-canonical-json, and no method / publicKeyRef', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'registry-version-manifest.schema.json'), 'utf8')) as { properties?: { signing?: SigningSchema } };
    const signing = schema.properties?.signing;
    expect(signing, req(ID, SECTION, 'registry-version-manifest.schema.json MUST define a `signing` object')).toBeDefined();
    const props = signing?.properties ?? {};
    expect(props['scheme']?.const, req(ID, SECTION, 'signing.scheme MUST be the single const `ed25519-canonical-json` — one scheme, not a menu')).toBe('ed25519-canonical-json');
    expect(signing?.required ?? [], req(ID, SECTION, 'signing MUST require `keyId` and `scheme`')).toEqual(expect.arrayContaining(['keyId', 'scheme']));
    expect(signing?.additionalProperties, req(ID, SECTION, 'signing MUST be closed (additionalProperties: false) so a second scheme cannot be smuggled in')).toBe(false);
    const text = JSON.stringify(signing);
    expect(/"method"/.test(text), req(ID, SECTION, 'signing.method is gone in v2 — it MUST NOT appear in the signing object')).toBe(false);
    expect(/"publicKeyRef"/.test(text), req(ID, SECTION, 'signing.publicKeyRef is gone in v2 — the key is addressed by keyId alone')).toBe(false);
  });
});
