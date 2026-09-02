/**
 * protocol-versions-array — RFC 0165 §A verification.
 *
 * `protocolVersions: string[]` is the OPTIONAL root advertisement of every
 * `<major>.<minor>` a host serves, reserved for v2 major negotiation
 * (`version-negotiation.md` §"`protocolVersions[]`"). Three things are
 * checkable today:
 *
 *   1. Server-free: the schema declares the array with the SAME strict grammar
 *      as the scalar (RFC 0149 §C), not the looser A2A item pattern — one axis,
 *      one grammar; and the Levenshtein-1 neighbour of `protocolVersion` is a
 *      real property, so the root-layout typo lint cannot mistake it.
 *   2. Host, presence-gated: when advertised, every item matches, items are
 *      unique, and the array contains `protocolVersion`'s value.
 *   3. Host, presence-gated: profile derivation is unchanged by the array —
 *      `isCore` reads the scalar only (RFC 0165 §A.2, §Alternatives 6).
 *
 * A host that omits the array is conformant (`inapplicable`, not a pass).
 *
 * @see RFCS/0165-v2-preparation-wire-shapes.md §A
 * @see spec/v1/version-negotiation.md §"Protocol version grammar"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { isCore, type DiscoveryPayload } from '../lib/profiles.js';
import { softSkip } from '../lib/soft-skip.js';

interface CapsSchema {
  $schema: string;
  properties: {
    protocolVersion?: { pattern?: string };
    protocolVersions?: { type?: string; minItems?: number; uniqueItems?: boolean; items?: { pattern?: string } };
  };
}

const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as CapsSchema;

describe('protocol-versions-array: schema shape (RFC 0165 §A.1, server-free)', () => {
  it('declares root `protocolVersions` as a unique, non-empty string array', () => {
    const p = caps.properties.protocolVersions;
    expect(p, 'RFC 0165 §A.1: capabilities.schema.json MUST declare root `protocolVersions`').toBeDefined();
    expect(p?.type).toBe('array');
    expect(p?.minItems).toBe(1);
    expect(p?.uniqueItems).toBe(true);
  });

  it('item grammar equals the scalar grammar (one axis, one grammar)', () => {
    expect(
      caps.properties.protocolVersions?.items?.pattern,
      'RFC 0165 §A.1: protocolVersions items MUST use the RFC 0149 §C grammar, not the A2A item pattern',
    ).toBe(caps.properties.protocolVersion?.pattern);
  });

  it('accepts ["1.11", "2.0"], rejects "01.0", "1.0.0", duplicates, and empty', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile({ $schema: caps.$schema, ...(caps.properties.protocolVersions as Record<string, unknown>) });
    expect(validate(['1.11', '2.0'])).toBe(true);
    expect(validate(['01.0'])).toBe(false);
    expect(validate(['1.0.0'])).toBe(false);
    expect(validate(['1.0', '1.0'])).toBe(false);
    expect(validate([])).toBe(false);
  });
});

describe('protocol-versions-array: advertisement (RFC 0165 §A.2 — presence-gated)', () => {
  const GRAMMAR = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

  it('when advertised, every item matches the grammar, items are unique, and the array contains protocolVersion', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const doc = res.json as Record<string, unknown>;
    const arr = doc['protocolVersions'];
    if (arr === undefined) {
      return softSkip('inapplicable', 'host does not advertise protocolVersions (RFC 0165 §A — optional in v1.x)');
    }
    expect(Array.isArray(arr), driver.describe('RFC 0165 §A.1', 'protocolVersions MUST be an array')).toBe(true);
    const items = arr as unknown[];
    expect(items.length, driver.describe('RFC 0165 §A.1', 'protocolVersions MUST be non-empty')).toBeGreaterThan(0);
    for (const v of items) {
      expect(typeof v === 'string' && GRAMMAR.test(v), driver.describe('RFC 0165 §A.1', `protocolVersions item ${JSON.stringify(v)} MUST match the RFC 0149 §C grammar`)).toBe(true);
    }
    expect(new Set(items).size, driver.describe('RFC 0165 §A.1', 'protocolVersions items MUST be unique')).toBe(items.length);
    expect(items, driver.describe('RFC 0165 §A.2', 'protocolVersions MUST contain the value of protocolVersion')).toContain(doc['protocolVersion']);
  });

  it('profile derivation is unchanged by the array (isCore reads the scalar only)', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const doc = res.json as DiscoveryPayload & Record<string, unknown>;
    if (doc['protocolVersions'] === undefined) {
      return softSkip('inapplicable', 'host does not advertise protocolVersions (RFC 0165 §A — optional in v1.x)');
    }
    const without = { ...doc } as Record<string, unknown>;
    delete without['protocolVersions'];
    expect(
      isCore(doc),
      driver.describe('RFC 0165 §A.2', 'openwop-discovery-core derivation MUST NOT depend on protocolVersions in v1.x'),
    ).toBe(isCore(without as DiscoveryPayload));
  });
});
