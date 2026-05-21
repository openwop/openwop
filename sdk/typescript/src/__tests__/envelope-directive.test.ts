import { describe, it, expect } from 'vitest';
import { buildReasoningDirective } from '../envelope-directive.js';

describe('buildReasoningDirective: strength="off" short-circuits regardless of schema', () => {
  it('returns null even when schema declares reasoning', () => {
    const schema = {
      type: 'object',
      properties: { reasoning: { type: 'string' }, result: { type: 'string' } },
    };
    expect(buildReasoningDirective(schema, 'off')).toBeNull();
  });

  it('returns null when schema is undefined', () => {
    expect(buildReasoningDirective(undefined, 'off')).toBeNull();
  });
});

describe('buildReasoningDirective: schema-shape gating', () => {
  it('returns null when responseSchema is undefined', () => {
    expect(buildReasoningDirective(undefined, 'advisory')).toBeNull();
  });

  it('returns null when responseSchema is null', () => {
    expect(buildReasoningDirective(null, 'advisory')).toBeNull();
  });

  it('returns null when responseSchema is a primitive', () => {
    expect(buildReasoningDirective('not a schema', 'advisory')).toBeNull();
    expect(buildReasoningDirective(42, 'advisory')).toBeNull();
  });

  it('returns null when responseSchema has no properties', () => {
    expect(buildReasoningDirective({ type: 'object' }, 'advisory')).toBeNull();
  });

  it('returns null when responseSchema.properties is not an object', () => {
    expect(buildReasoningDirective({ properties: 'string' }, 'advisory')).toBeNull();
    expect(buildReasoningDirective({ properties: null }, 'advisory')).toBeNull();
  });

  it('returns null when properties.reasoning is absent', () => {
    const schema = {
      type: 'object',
      properties: { result: { type: 'string' } },
    };
    expect(buildReasoningDirective(schema, 'advisory')).toBeNull();
  });

  it('returns null when properties.reasoning is not an object (malformed schema)', () => {
    const schema = {
      type: 'object',
      properties: { reasoning: 'string' },
    };
    expect(buildReasoningDirective(schema, 'advisory')).toBeNull();
  });
});

describe('buildReasoningDirective: strength="advisory" wording', () => {
  it('returns a non-empty advisory string when schema has reasoning', () => {
    const schema = {
      type: 'object',
      required: ['result'],
      properties: { reasoning: { type: 'string' }, result: { type: 'string' } },
    };
    const directive = buildReasoningDirective(schema, 'advisory');
    expect(directive).not.toBeNull();
    expect(typeof directive).toBe('string');
    expect(directive!.length).toBeGreaterThan(50);
  });

  it('advisory wording cites Tam et al. arXiv 2408.02442 (the reasoning-collapse motivator per RFC 0030 §2.1)', () => {
    const schema = { properties: { reasoning: { type: 'string' } } };
    const directive = buildReasoningDirective(schema, 'advisory');
    expect(directive).toContain('2408.02442');
  });

  it('advisory wording explicitly notes the host accepts envelopes where reasoning is absent (RFC 0030 §A MUST NOT)', () => {
    const schema = { properties: { reasoning: { type: 'string' } } };
    const directive = buildReasoningDirective(schema, 'advisory');
    expect(directive).toContain('absent');
  });
});

describe('buildReasoningDirective: strength="mandatory" wording', () => {
  it('returns a non-empty mandatory string when schema has reasoning', () => {
    const schema = { properties: { reasoning: { type: 'string' } } };
    const directive = buildReasoningDirective(schema, 'mandatory');
    expect(directive).not.toBeNull();
    expect(typeof directive).toBe('string');
    expect(directive!.length).toBeGreaterThan(50);
  });

  it('mandatory wording uses firmer language than advisory', () => {
    const schema = { properties: { reasoning: { type: 'string' } } };
    const mandatory = buildReasoningDirective(schema, 'mandatory');
    const advisory = buildReasoningDirective(schema, 'advisory');
    expect(mandatory).not.toBe(advisory);
    // Mandatory should include MUST-equivalent language; advisory should not.
    expect(mandatory!.toLowerCase()).toMatch(/required|must|do not skip/);
  });

  it('mandatory wording still cites the spec MUST NOT (host accepts absent reasoning per RFC 0030 §A)', () => {
    const schema = { properties: { reasoning: { type: 'string' } } };
    const directive = buildReasoningDirective(schema, 'mandatory');
    expect(directive).toContain('absent');
    expect(directive).toContain('RFC 0030');
  });
});
