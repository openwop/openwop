/**
 * Bounded artifact-schema compilation (RFC 0071, `Active`).
 *
 * Always-on, server-free assertion for the SECURITY invariant
 * `artifact-schema-compile-bounded`. Artifact-type packs ship third-party
 * JSON Schemas that the engine compiles (Ajv) at install + validation time;
 * an unbounded compile is a denial-of-service vector (schema bombs:
 * pathological `$ref` recursion, keyword-count explosion, oversized payloads,
 * catastrophic-backtracking `pattern`s). This scenario asserts two things
 * that must hold for every release regardless of which host runs it:
 *
 *   PART 1 — contract present. `artifact-type-packs.md` carries the normative
 *   bounded-compilation MUST (serialized-size, `$ref`-depth, keyword-count
 *   bounds + wall-clock timeout), and `host-capabilities.md` §host.artifactTypes
 *   references it. Guards against the requirement being silently dropped.
 *
 *   PART 2 — defense is well-defined + implementable. A reference bounding
 *   predicate built from representative finite limits rejects three schema
 *   bombs and admits a benign artifact schema. The specific numeric limits are
 *   host-configurable per the spec (advertised, not protocol-mandated); the
 *   point is that *some* finite bound exists and catches the bombs while
 *   passing legitimate schemas.
 *
 * The behavioral end-to-end form (a host rejects an over-bounds pack at
 * registry `PUT` with `pack_validation_failed`) is capability-gated on
 * `host.artifactTypes.supported` and is `host-pending` until a reference host
 * lands; this server-free scenario is the always-on floor.
 *
 * @see spec/v1/artifact-type-packs.md §"Bounded schema compilation (normative)"
 * @see SECURITY/threat-model-node-packs.md §"Distributed artifact schemas"
 * @see RFCS/0071-artifact-type-and-chat-card-packs.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

describe('artifact-schema-compile-bounded: contract present in the corpus (RFC 0071, server-free)', () => {
  const artifactDoc = V1_DIR ? readFileSync(join(V1_DIR, 'artifact-type-packs.md'), 'utf8') : '';
  const hostCaps = V1_DIR ? readFileSync(join(V1_DIR, 'host-capabilities.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('artifact-type-packs.md declares the bounded-compilation MUST', () => {
    expect(
      /Bounded schema compilation/i.test(artifactDoc),
      why('artifact-type-packs.md', 'a "Bounded schema compilation" section MUST exist'),
    ).toBe(true);
    expect(
      /MUST bound/i.test(artifactDoc) && /MUST reject/i.test(artifactDoc),
      why('artifact-type-packs.md §"Bounded schema compilation"', 'host MUST bound + MUST reject over-limit schemas'),
    ).toBe(true);
    // The three structural axes + the timeout MUST all be named.
    for (const axis of [/byte size/i, /\$ref/i, /keyword/i, /timeout/i]) {
      expect(axis.test(artifactDoc), why('artifact-type-packs.md', `bound axis ${axis} MUST be named`)).toBe(true);
    }
  });

  it.skipIf(V1_DIR === null)('host-capabilities.md §host.artifactTypes references the bound', () => {
    expect(
      /artifact-schema-compile-bounded/.test(hostCaps),
      why('host-capabilities.md §host.artifactTypes', 'MUST reference the bounded-compilation invariant'),
    ).toBe(true);
  });
});

describe('artifact-schema-compile-bounded: a finite bound catches schema bombs (RFC 0071, server-free)', () => {
  // Representative, host-configurable limits (the spec leaves the exact values
  // to host advertisement; these stand in for "some finite bound").
  const LIMITS = { maxBytes: 64 * 1024, maxRefDepth: 16, maxKeywords: 2000 };

  function refDepth(node: unknown, seen = 0): number {
    if (node === null || typeof node !== 'object') return seen;
    const obj = node as Record<string, unknown>;
    const here = '$ref' in obj ? seen + 1 : seen;
    let max = here;
    for (const v of Object.values(obj)) max = Math.max(max, refDepth(v, here));
    return max;
  }
  function keywordCount(node: unknown): number {
    if (node === null || typeof node !== 'object') return 0;
    const obj = node as Record<string, unknown>;
    let n = Object.keys(obj).length;
    for (const v of Object.values(obj)) n += keywordCount(v);
    return n;
  }
  /** Reference bound predicate — the shape a conformant host applies at PUT/install. */
  function exceedsBounds(schema: unknown): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');
    if (bytes > LIMITS.maxBytes) return true;
    if (refDepth(schema) > LIMITS.maxRefDepth) return true;
    if (keywordCount(schema) > LIMITS.maxKeywords) return true;
    return false;
  }

  it('admits a benign artifact schema', () => {
    const benign = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://h.example/schemas/artifacts/vendor.acme.cad.model.schema.json',
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' }, dims: { type: 'array', items: { type: 'number' } } },
    };
    expect(exceedsBounds(benign), why('artifact-type-packs.md', 'a legitimate artifact schema MUST NOT be rejected')).toBe(false);
  });

  it('rejects a $ref-depth bomb', () => {
    // Nest $ref-bearing objects deeper than maxRefDepth so resolution depth accumulates.
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < LIMITS.maxRefDepth + 4; i++) node = { $ref: '#/x', properties: { nested: node } };
    expect(exceedsBounds({ type: 'object', properties: { deep: node } }), why('threat-model-node-packs.md', 'a $ref-depth bomb MUST be rejected')).toBe(true);
  });

  it('rejects a keyword-count bomb', () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < LIMITS.maxKeywords + 100; i++) props[`p${i}`] = { type: 'string' };
    expect(exceedsBounds({ type: 'object', properties: props }), why('threat-model-node-packs.md', 'a keyword-count bomb MUST be rejected')).toBe(true);
  });

  it('rejects an oversized schema', () => {
    const huge = { type: 'object', description: 'x'.repeat(LIMITS.maxBytes + 1) };
    expect(exceedsBounds(huge), why('threat-model-node-packs.md', 'an over-size schema MUST be rejected')).toBe(true);
  });
});
