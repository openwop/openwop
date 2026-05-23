/**
 * Unit tests for the schema-responder pure function.
 *
 * Exercises the four resolution paths the responder advertises:
 *   1. exact typeId match
 *   2. trailing-segment match ("mock-ai" → "local.sample.demo.mock-ai")
 *   3. case-insensitive segment match ("MockAi", "mock_ai")
 *   4. notFound (no match)
 *
 * Plus the bundleVersion contract: hash-based, deterministic per
 * sorted-typeId-list, distinct for distinct registries.
 *
 * The responder reads the in-process NodeRegistry singleton. The
 * sample backend's bootstrap registers a known set at module load,
 * so the test exercises the responder against that real registry
 * rather than mocking — keeps the contract honest.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { ensureNodesRegistered } from '../src/bootstrap/nodes.js';
import { buildSchemaResponse } from '../src/host/schemaResponder.js';

describe('schemaResponder.buildSchemaResponse', () => {
  beforeAll(() => {
    // Ensure the sample-app node bootstrap has run so `noop`, `delay`,
    // `mock-ai`, etc. exist in the in-process registry. Idempotent.
    ensureNodesRegistered();
  });

  it('resolves an exact typeId match', () => {
    const res = buildSchemaResponse({ names: ['core.noop'] });
    expect(res.schemas).toHaveLength(1);
    expect(res.schemas[0]?.typeId).toBe('core.noop');
    expect(res.notFound).toEqual([]);
  });

  it('resolves a trailing-segment match (kind → typeId)', () => {
    const res = buildSchemaResponse({ names: ['noop'] });
    expect(res.schemas).toHaveLength(1);
    expect(res.schemas[0]?.kind).toBe('noop');
    // Trailing-segment resolution lands on whichever typeId ends in `.noop`.
    expect(res.schemas[0]?.typeId.endsWith('.noop')).toBe(true);
  });

  it('resolves case-insensitive variants of the trailing segment', () => {
    // The sample registers `local.sample.demo.mock-ai`. The responder
    // strips `-`/`_` before comparing so `MockAi`, `mock_ai`, `MOCK-AI`
    // all hit the same entry.
    const variants = ['mock-ai', 'MockAi', 'mock_ai', 'MOCK-AI'];
    for (const v of variants) {
      const res = buildSchemaResponse({ names: [v] });
      expect(res.schemas, `variant=${v}`).toHaveLength(1);
      expect(res.schemas[0]?.kind, `variant=${v}`).toBe('mock-ai');
    }
  });

  it('returns notFound for unknown names', () => {
    const res = buildSchemaResponse({ names: ['definitely-not-a-real-node-kind'] });
    expect(res.schemas).toEqual([]);
    expect(res.notFound).toEqual(['definitely-not-a-real-node-kind']);
  });

  it('handles a mixed batch (some resolve, some do not)', () => {
    const res = buildSchemaResponse({ names: ['core.noop', 'nope-not-a-thing'] });
    expect(res.schemas).toHaveLength(1);
    expect(res.schemas[0]?.typeId).toBe('core.noop');
    expect(res.notFound).toEqual(['nope-not-a-thing']);
  });

  it('skips empty / non-string names without throwing', () => {
    const res = buildSchemaResponse({
      // Cast so the test exercises the runtime guard. Production
      // callers come from the normalizer registry which coerces to
      // string[] before this point.
      names: ['', 'core.noop'] as string[],
    });
    expect(res.schemas).toHaveLength(1);
    expect(res.schemas[0]?.typeId).toBe('core.noop');
    expect(res.notFound).toEqual([]);
  });

  it('returns a deterministic, hash-based bundleVersion', () => {
    const a = buildSchemaResponse({ names: ['core.noop'] });
    const b = buildSchemaResponse({ names: ['core.noop'] });
    expect(a.bundleVersion).toBe(b.bundleVersion);
    expect(a.bundleVersion).toMatch(/^registry-[0-9a-f]{12}$/);
  });

  it('emits inputs + outputs for resolved schemas', () => {
    const res = buildSchemaResponse({ names: ['core.noop'] });
    const schema = res.schemas[0];
    expect(schema).toBeDefined();
    expect(Array.isArray(schema?.inputs)).toBe(true);
    expect(Array.isArray(schema?.outputs)).toBe(true);
    // The noop module declares both, even if they're permissive.
    // (Defensive: we only assert presence + type, not exact port names,
    // so the test survives upstream port renames.)
    if (schema && schema.inputs.length > 0) {
      expect(typeof schema.inputs[0]?.name).toBe('string');
      expect(typeof schema.inputs[0]?.type).toBe('string');
    }
  });
});
