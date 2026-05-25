/**
 * Unit tests for `configFieldsFromSchema` — the pack-manifest JSON Schema
 * → ConfigField[] converter that the builder Inspector relies on. Pure
 * function (no React, no fetch), so the tests are vitest-style assertions
 * with zero stubs.
 *
 * **Runtime note (2026-05-25).** The frontend package (`apps/workflow-engine/
 * frontend/react/`) does not currently ship a test runner — the backend
 * sibling has vitest wired, but the frontend was UI-only for the lifetime
 * of the v1.x release cadence. This file is therefore **executable
 * documentation**: vitest-compatible syntax so the file becomes a live
 * regression suite the moment `vitest` is added as a frontend devDep, and
 * readable as-is in code review.
 *
 * To opt the file in today, add:
 *
 *   ```jsonc
 *   // apps/workflow-engine/frontend/react/package.json
 *   "scripts":      { "test": "vitest run", ... },
 *   "devDependencies": { "vitest": "^2.1.0", ... }
 *   ```
 *
 * then `npm install && npm test`. No code changes needed in this file.
 */

import { describe, it, expect } from 'vitest';
import { configFieldsFromSchema } from '../configFieldsFromSchema.js';
import type { ConfigField } from '../nodeCatalog.js';

/** Schema for the real `core.ai.chatCompletion` configSchema shipped in
 *  `packs/core.openwop.ai/schemas/chat-completion.config.json`. Used as
 *  the load-bearing regression fixture: every change to the converter
 *  is validated against the production-grade schema first. */
const CHAT_COMPLETION_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://packs.openwop.dev/core.openwop.ai/1.1.2/chat-completion.config.json',
  title: 'ChatCompletionConfig',
  type: 'object',
  required: ['provider', 'model'],
  properties: {
    provider: { type: 'string', description: 'AI provider id.' },
    model: { type: 'string', minLength: 1, description: 'Provider-specific model id.' },
    systemPrompt: { type: 'string', description: 'Optional system prompt.' },
    temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Sampling temperature.' },
    maxTokens: { type: 'integer', minimum: 1, maximum: 100000, description: 'Max tokens to generate.' },
    stopSequences: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 8,
      description: 'Optional stop sequences.',
    },
  },
  additionalProperties: false,
} as const;

function byKey(fields: readonly ConfigField[], key: string): ConfigField | undefined {
  return fields.find((f) => f.key === key);
}

describe('configFieldsFromSchema', () => {
  describe('top-level shape', () => {
    it('returns [] for non-object schema', () => {
      expect(configFieldsFromSchema(null)).toEqual([]);
      expect(configFieldsFromSchema(undefined)).toEqual([]);
      expect(configFieldsFromSchema('not a schema')).toEqual([]);
      expect(configFieldsFromSchema(42)).toEqual([]);
    });

    it('returns [] when schema has no `properties`', () => {
      expect(configFieldsFromSchema({ type: 'object' })).toEqual([]);
    });

    it('preserves property insertion order', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { c: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } },
      });
      expect(fields.map((f) => f.key)).toEqual(['c', 'a', 'b']);
    });

    it('marks required fields via `field.required`', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' }, b: { type: 'string' } },
      });
      expect(byKey(fields, 'a')?.required).toBe(true);
      expect(byKey(fields, 'b')?.required).toBe(false);
    });
  });

  describe('kind inference', () => {
    it('maps boolean → checkbox', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { flag: { type: 'boolean' } },
      });
      expect(byKey(fields, 'flag')?.kind).toBe('checkbox');
    });

    it('maps number / integer → number', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { n: { type: 'number' }, i: { type: 'integer' } },
      });
      expect(byKey(fields, 'n')?.kind).toBe('number');
      expect(byKey(fields, 'i')?.kind).toBe('number');
    });

    it('maps scalar enum → select with options', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { mode: { type: 'string', enum: ['a', 'b', 'c'] } },
      });
      const f = byKey(fields, 'mode')!;
      expect(f.kind).toBe('select');
      expect(f.options).toEqual([
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
        { value: 'c', label: 'c' },
      ]);
    });

    it('maps array<string> → string-list (NOT textarea)', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
      });
      expect(byKey(fields, 'tags')?.kind).toBe('string-list');
    });

    it('maps array<object> → textarea (JSON authoring)', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { rules: { type: 'array', items: { type: 'object' } } },
      });
      expect(byKey(fields, 'rules')?.kind).toBe('textarea');
    });

    it('maps object → textarea', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { meta: { type: 'object', properties: { a: { type: 'string' } } } },
      });
      expect(byKey(fields, 'meta')?.kind).toBe('textarea');
    });

    it('defaults to text input', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { name: { type: 'string' } },
      });
      expect(byKey(fields, 'name')?.kind).toBe('text');
    });
  });

  describe('label + help', () => {
    it('uses `title` when present, falls back to key', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: {
          a: { type: 'string', title: 'Alpha' },
          b: { type: 'string' },
        },
      });
      expect(byKey(fields, 'a')?.label).toBe('Alpha');
      expect(byKey(fields, 'b')?.label).toBe('b');
    });

    it('surfaces `description` as `help`', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { x: { type: 'string', description: 'some help' } },
      });
      expect(byKey(fields, 'x')?.help).toBe('some help');
    });

    it('appends items.pattern to help text on string-list fields', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', pattern: '^[a-z]+$' },
            description: 'Lowercase tags.',
          },
        },
      });
      expect(byKey(fields, 'tags')?.help).toBe('Lowercase tags. (each line MUST match: ^[a-z]+$)');
    });
  });

  describe('default values', () => {
    it('passes through scalar defaults', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: {
          s: { type: 'string', default: 'hi' },
          n: { type: 'number', default: 0.5 },
          b: { type: 'boolean', default: true },
        },
      });
      expect(byKey(fields, 's')?.defaultValue).toBe('hi');
      expect(byKey(fields, 'n')?.defaultValue).toBe(0.5);
      expect(byKey(fields, 'b')?.defaultValue).toBe(true);
    });

    it('passes through string[] defaults on string-list kind', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: {
          stops: { type: 'array', items: { type: 'string' }, default: ['END', 'STOP'] },
        },
      });
      expect(byKey(fields, 'stops')?.defaultValue).toEqual(['END', 'STOP']);
    });

    it('passes through object defaults on textarea kind (renderer pretty-prints)', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: {
          meta: { type: 'object', default: { region: 'us-east-1' } },
        },
      });
      // Pre-fix: this used to be silently dropped. The renderer now
      // pretty-prints the default into the textarea.
      expect(byKey(fields, 'meta')?.defaultValue).toEqual({ region: 'us-east-1' });
    });

    it('omits defaultValue entirely when default is absent', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
      });
      expect(byKey(fields, 'a')).not.toHaveProperty('defaultValue');
    });
  });

  describe('validation hints — number', () => {
    it('forwards minimum / maximum to min / max', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { t: { type: 'number', minimum: 0, maximum: 2 } },
      });
      const f = byKey(fields, 't')!;
      expect(f.min).toBe(0);
      expect(f.max).toBe(2);
    });

    it('forwards multipleOf to step', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { t: { type: 'number', multipleOf: 0.1 } },
      });
      expect(byKey(fields, 't')?.step).toBe(0.1);
    });

    it('defaults integer step to 1 when multipleOf absent', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { n: { type: 'integer' } },
      });
      expect(byKey(fields, 'n')?.step).toBe(1);
    });
  });

  describe('validation hints — text/textarea', () => {
    it('forwards minLength / maxLength on text', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { name: { type: 'string', minLength: 1, maxLength: 64 } },
      });
      const f = byKey(fields, 'name')!;
      expect(f.minLength).toBe(1);
      expect(f.maxLength).toBe(64);
    });

    it('forwards pattern on text', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { handle: { type: 'string', pattern: '^@[a-z]+$' } },
      });
      expect(byKey(fields, 'handle')?.pattern).toBe('^@[a-z]+$');
    });

    it('does NOT forward pattern to textarea (textarea has no HTML5 pattern attr)', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { body: { type: 'object', pattern: '.*' } },
      });
      expect(byKey(fields, 'body')).not.toHaveProperty('pattern');
    });
  });

  describe('validation hints — string-list', () => {
    it('forwards maxItems', () => {
      const fields = configFieldsFromSchema({
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, maxItems: 8 } },
      });
      expect(byKey(fields, 'tags')?.maxItems).toBe(8);
    });
  });

  describe('production-grade fixture — core.ai.chatCompletion configSchema', () => {
    const fields = configFieldsFromSchema(CHAT_COMPLETION_CONFIG_SCHEMA);

    it('produces exactly the 6 properties from the schema', () => {
      expect(fields.map((f) => f.key)).toEqual([
        'provider', 'model', 'systemPrompt', 'temperature', 'maxTokens', 'stopSequences',
      ]);
    });

    it('marks provider + model as required', () => {
      expect(byKey(fields, 'provider')?.required).toBe(true);
      expect(byKey(fields, 'model')?.required).toBe(true);
      expect(byKey(fields, 'systemPrompt')?.required).toBe(false);
    });

    it('renders temperature as a bounded number input', () => {
      const f = byKey(fields, 'temperature')!;
      expect(f.kind).toBe('number');
      expect(f.min).toBe(0);
      expect(f.max).toBe(2);
    });

    it('renders maxTokens as an integer input with step 1', () => {
      const f = byKey(fields, 'maxTokens')!;
      expect(f.kind).toBe('number');
      expect(f.min).toBe(1);
      expect(f.max).toBe(100000);
      expect(f.step).toBe(1);
    });

    it('renders stopSequences as a string-list with maxItems=8', () => {
      const f = byKey(fields, 'stopSequences')!;
      expect(f.kind).toBe('string-list');
      expect(f.maxItems).toBe(8);
    });

    it('renders model as a text input with minLength=1', () => {
      const f = byKey(fields, 'model')!;
      expect(f.kind).toBe('text');
      expect(f.minLength).toBe(1);
    });
  });
});
