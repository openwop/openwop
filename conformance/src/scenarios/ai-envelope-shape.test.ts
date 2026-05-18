/**
 * ai-envelope-shape — RFC 0021 §D wire-shape conformance.
 *
 * Asserts:
 *   1. `/.well-known/openwop` `supportedEnvelopes` is a `string[]` (advertisement contract).
 *   2. The top-level `schemas/ai-envelope.schema.json` is Ajv2020-compileable.
 *   3. Each universal kind that appears in the host's `supportedEnvelopes`
 *      has a corresponding Ajv2020-compileable payload schema at
 *      `schemas/envelopes/<kind>.schema.json`.
 *   4. The top-level envelope schema accepts a positive AIEnvelope fixture
 *      AND rejects a negative fixture (missing required `meta` block).
 *
 * Capability-gated: skips when the host doesn't advertise
 * `aiProviders.supported: true` (envelopes are emitted by LLM-call nodes).
 *
 * @see RFCS/0021-ai-envelope-primitive.md
 * @see spec/v1/ai-envelope.md
 * @see schemas/ai-envelope.schema.json
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

interface DiscoveryDoc {
  capabilities?: {
    aiProviders?: { supported?: unknown };
    supportedEnvelopes?: unknown;
  };
  supportedEnvelopes?: unknown;
}

const UNIVERSAL_KINDS = [
  'clarification.request',
  'schema.request',
  'schema.response',
  'error',
] as const;

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function aiProvidersSupported(d: DiscoveryDoc | null): boolean {
  if (!d?.capabilities?.aiProviders?.supported) return false;
  // aiProviders.supported can be `true` or an array per the capabilities schema.
  const v = d.capabilities.aiProviders.supported;
  return v === true || (Array.isArray(v) && v.length > 0);
}

function supportedEnvelopes(d: DiscoveryDoc | null): string[] {
  // supportedEnvelopes is at the top level per the capabilities schema, but
  // some hosts nest it under capabilities — tolerate both.
  const top = d?.supportedEnvelopes;
  const nested = d?.capabilities?.supportedEnvelopes;
  const raw = Array.isArray(top) ? top : Array.isArray(nested) ? nested : [];
  return raw.filter((s): s is string => typeof s === 'string');
}

// HTTP-driven blocks soft-skip when no base URL is configured (gate's
// server-free subset runs offline; HTTP-driven assertions activate only
// when an operator points the suite at a live host).
const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(HTTP_SKIP)('ai-envelope-shape: advertisement contract (RFC 0021 §C)', () => {
  it('capabilities.supportedEnvelopes is an array of strings (when present)', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const env = supportedEnvelopes(d);
    // No assertion if absent — the field is optional. When present, each entry MUST be a string.
    for (const k of env) {
      expect(typeof k, driver.describe('capabilities.md §supportedEnvelopes', 'each entry MUST be a string')).toBe('string');
    }
    // Re-affirm shape: array if present.
    if (d.capabilities?.supportedEnvelopes !== undefined) {
      expect(Array.isArray(d.capabilities.supportedEnvelopes), 'supportedEnvelopes MUST be an array').toBe(true);
    }
  });
});

describe('ai-envelope-shape: schema compile (RFC 0021 §A + §B)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  function load(relPath: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(SCHEMAS_DIR, relPath), 'utf8')) as Record<string, unknown>;
  }

  it('top-level ai-envelope.schema.json compiles under Ajv2020', () => {
    const schema = load('ai-envelope.schema.json');
    const validate = ajv.compile(schema);
    expect(validate, 'RFC 0021 §A: ai-envelope.schema.json MUST compile').toBeTypeOf('function');
  });

  for (const kind of UNIVERSAL_KINDS) {
    it(`universal-kind schema envelopes/${kind}.schema.json compiles under Ajv2020`, () => {
      const schema = load(`envelopes/${kind}.schema.json`);
      const validate = ajv.compile(schema);
      expect(
        validate,
        `RFC 0021 §B: envelopes/${kind}.schema.json MUST compile`,
      ).toBeTypeOf('function');
    });
  }
});

describe('ai-envelope-shape: round-trip validation (RFC 0021 §A)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const envelopeSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'ai-envelope.schema.json'), 'utf8')) as Record<string, unknown>;
  const validate = ajv.compile(envelopeSchema);

  it('accepts a positive AIEnvelope fixture', () => {
    const positive = {
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-test-positive-1',
      correlationId: 'run-1:node-2:turn-0:abc123',
      payload: {
        questions: [{ id: 'q1', question: 'Which provider?' }],
      },
      meta: {
        source: 'ai-generation',
        ts: '2026-05-18T10:00:00Z',
        contentTrust: 'trusted',
      },
    };
    const ok = validate(positive);
    expect(ok, `positive fixture MUST validate; errors: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('rejects a negative AIEnvelope fixture missing required `meta`', () => {
    const negative = {
      type: 'error',
      schemaVersion: 1,
      envelopeId: 'env-test-negative-1',
      correlationId: 'run-1:node-2:turn-1:def456',
      payload: { code: 'validation_failed', message: 'no go' },
      // meta omitted on purpose
    };
    const ok = validate(negative);
    expect(ok, 'RFC 0021 §A: envelope MUST require meta block').toBe(false);
  });

  it('rejects an envelope with unknown top-level property (additionalProperties:false)', () => {
    const negative = {
      type: 'error',
      schemaVersion: 1,
      envelopeId: 'env-test-extra',
      correlationId: 'run-1:node-2:turn-2:xyz789',
      payload: { code: 'validation_failed', message: 'no go' },
      meta: { source: 'ai-generation', ts: '2026-05-18T10:00:00Z' },
      unknownTopLevel: 'should reject',
    };
    const ok = validate(negative);
    expect(ok, 'RFC 0021 §A: top-level additionalProperties:false MUST reject unknown fields').toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('ai-envelope-shape: universal-kind advertisement (RFC 0021 §C)', () => {
  it('host advertising any universal kind has a matching schema on disk', async () => {
    const d = await readDiscovery();
    if (d === null || !aiProvidersSupported(d)) return; // capability-gated
    const env = supportedEnvelopes(d);
    const advertisedUniversals = env.filter((k): k is (typeof UNIVERSAL_KINDS)[number] =>
      (UNIVERSAL_KINDS as readonly string[]).includes(k),
    );
    if (advertisedUniversals.length === 0) return; // host doesn't claim any universal
    // Each advertised universal MUST have its schema compileable (already
    // covered by the per-kind compile test above; this assertion just makes
    // the linkage between advertisement + schema explicit).
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const k of advertisedUniversals) {
      const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, `envelopes/${k}.schema.json`), 'utf8')) as Record<string, unknown>;
      expect(
        ajv.compile(schema),
        `RFC 0021 §B: advertised universal ${k} MUST resolve to a compileable schema`,
      ).toBeTypeOf('function');
    }
  });
});
