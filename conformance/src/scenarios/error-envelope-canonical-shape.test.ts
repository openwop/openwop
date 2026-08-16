/**
 * S22 (2026-08-16) — the HTTP error envelope is FLAT, and the suite reads it
 * through one helper.
 *
 * `rest-endpoints.md` §"Error response shape" and `schemas/error-envelope.schema.json`
 * lock `{ error: <string code>, message, details? }` with `additionalProperties:
 * false`. A nested `{ error: { code, retriable } }` shape had crept into three
 * code-list entries, four seam contracts and ~15 scenarios; this scenario pins
 * the decision at the three places it lives — the schema, the helper that every
 * HTTP-envelope leg now reads through, and the prose — so it cannot re-open
 * quietly. Server-free, always-on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { readErrorCode, readRetriable, isCanonicalErrorEnvelope, isLegacyNestedEnvelope } from '../lib/error-envelope.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: pins the flat error-envelope decision against the schema, the helper and the prose';

describe('S22 — the canonical HTTP error envelope is flat', () => {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'error-envelope.schema.json'), 'utf8')) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  it('the schema says `error` is a string, requires `message`, and forbids other top-level keys', () => {
    expect(validate({ error: 'runner_unavailable', message: 'no runner', details: { retriable: true } })).toBe(true);
    expect(validate({ error: { code: 'runner_unavailable', retriable: true } })).toBe(false);
    expect(validate({ error: 'x', message: 'y', retriable: true })).toBe(false); // top-level retriable is illegal
    expect(validate({ error: 'x' })).toBe(false); // message required
  });

  it('readErrorCode / readRetriable read the canonical shape, and tolerate the legacy nested shape only as legacy', () => {
    const flat = { error: 'interop_version_unsupported', message: 'peer offers 0.3', details: { retriable: false, protocol: 'a2a' } };
    expect(readErrorCode(flat)).toBe('interop_version_unsupported');
    expect(readRetriable(flat)).toBe(false);
    expect(isCanonicalErrorEnvelope(flat)).toBe(true);
    expect(isLegacyNestedEnvelope(flat)).toBe(false);
    const nested = { error: { code: 'runner_unavailable', retriable: true } };
    expect(readErrorCode(nested)).toBe('runner_unavailable');
    expect(readRetriable(nested)).toBe(true);
    expect(isCanonicalErrorEnvelope(nested)).toBe(false);
    expect(isLegacyNestedEnvelope(nested)).toBe(true);
    expect(readErrorCode({ message: 'no code' })).toBeUndefined();
    expect(readErrorCode(null)).toBeUndefined();
    expect(readRetriable({ error: 'x', message: 'y' })).toBeUndefined();
  });

  it.skipIf(V1_DIR === null)('rest-endpoints.md states the precedence, the details.retriable convention, and carries no nested code-list entry', () => {
    const prose = readFileSync(join(V1_DIR as string, 'rest-endpoints.md'), 'utf8');
    expect(prose).toContain('flat** shape above');
    expect(prose).toContain('### `details.retriable` convention');
    // the three formerly-nested code-list entries are flat now
    for (const code of ['runner_unavailable', 'residency_unavailable', 'interop_version_unsupported']) {
      const line = prose.split('\n').find((l) => l.startsWith('- `' + code + '`')) ?? '';
      expect(line, code + ' code-list entry MUST exist').not.toBe('');
      expect(line, code + ' MUST NOT be described with the nested envelope').not.toMatch(/\{\s*"error"\s*:\s*\{/);
    }
    // the seam catalog too
    const seams = readFileSync(join(V1_DIR as string, 'host-sample-test-seams.md'), 'utf8');
    expect(seams).not.toMatch(/"error":\s*\{\s*"code"/);
  });
});
