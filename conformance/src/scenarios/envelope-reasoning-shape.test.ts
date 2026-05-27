/**
 * envelope-reasoning-shape — RFC 0030 §A wire-shape conformance.
 *
 * Asserts:
 *   1. The three universal-kind payload schemas that carry reasoning
 *      (`clarification.request`, `schema.request`, `error`) declare the
 *      OPTIONAL `reasoning` property of type `string`.
 *   2. The fourth universal-kind schema (`schema.response`) does NOT
 *      declare `reasoning` (side-channel ack per RFC 0030 §A).
 *   3. Each of the three schemas validates payloads with and without
 *      `reasoning` populated (preserves v1.1 backward compatibility).
 *   4. `capabilities.envelopes.reasoning` advertisement shape (when
 *      present) conforms per RFC 0030 §C.
 *   5. `capabilities.envelopes.tierOneSubsetCompliance` is one of the
 *      three documented values when present.
 *
 * NOT capability-gated — schema-shape compilation always runs. Discovery
 * checks soft-skip when no live host is configured.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md
 * @see spec/v1/ai-envelope.md §"Reasoning field (normative)"
 * @see schemas/envelopes/clarification.request.schema.json
 * @see schemas/envelopes/schema.request.schema.json
 * @see schemas/envelopes/error.schema.json
 * @see schemas/envelopes/schema.response.schema.json
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: {
      reasoning?: {
        supported?: unknown;
        promptDirective?: unknown;
      };
      tierOneSubsetCompliance?: unknown;
    };
  };
}

function loadSchema(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, rel), 'utf8')) as Record<string, unknown>;
}

function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe('envelope-reasoning-shape: universal-kind schemas (RFC 0030 §A)', () => {
  const KINDS_WITH_REASONING = ['clarification.request', 'schema.request', 'error'] as const;

  for (const kind of KINDS_WITH_REASONING) {
    it(`${kind}.schema.json declares OPTIONAL \`reasoning: string\` per RFC 0030 §A`, () => {
      const schema = loadSchema(`envelopes/${kind}.schema.json`);
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[] | undefined) ?? [];
      expect(
        properties?.reasoning,
        `RFC 0030 §A: ${kind}.schema.json MUST declare a \`reasoning\` property`,
      ).toBeDefined();
      expect(
        properties?.reasoning?.type,
        'RFC 0030 §A: `reasoning` MUST be type: string on universal-kind schemas',
      ).toBe('string');
      expect(
        required.includes('reasoning'),
        `RFC 0030 §A: ${kind}.schema.json MUST NOT list \`reasoning\` in required (OPTIONAL field; absence is a valid envelope shape)`,
      ).toBe(false);
    });
  }

  it('schema.response.schema.json deliberately omits `reasoning` (side-channel ack per RFC 0030 §A)', () => {
    const schema = loadSchema('envelopes/schema.response.schema.json');
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    expect(
      properties?.reasoning,
      'RFC 0030 §A: `schema.response` is a side-channel ack envelope; it MUST NOT declare `reasoning`',
    ).toBeUndefined();
  });
});

describe('envelope-reasoning-shape: backward-compat round-trip (RFC 0030 §A)', () => {
  // Compile each schema once at describe-scope so re-validation across `it`
  // blocks reuses the same validator (Ajv refuses duplicate $id registration).
  const ajvClarification = makeAjv();
  const validateClarification = ajvClarification.compile(loadSchema('envelopes/clarification.request.schema.json'));
  const ajvError = makeAjv();
  const validateError = ajvError.compile(loadSchema('envelopes/error.schema.json'));
  const ajvSchemaRequest = makeAjv();
  const validateSchemaRequest = ajvSchemaRequest.compile(loadSchema('envelopes/schema.request.schema.json'));

  it('clarification.request validates a payload WITHOUT reasoning (backward compat)', () => {
    const payload = { questions: [{ id: 'q1', question: 'What do you mean by X?' }] };
    expect(
      validateClarification(payload),
      'RFC 0030 §A: existing v1.1 envelope without `reasoning` MUST remain valid',
    ).toBe(true);
  });

  it('clarification.request validates a payload WITH reasoning', () => {
    const payload = {
      reasoning: 'The user mentioned X twice but I am not sure which X they mean.',
      questions: [{ id: 'q1', question: 'What do you mean by X?' }],
    };
    expect(
      validateClarification(payload),
      'RFC 0030 §A: envelope with optional `reasoning` populated MUST be accepted',
    ).toBe(true);
  });

  it('error envelope validates without reasoning (backward compat)', () => {
    const payload = { code: 'validation_failed', message: 'Could not match the schema.' };
    expect(validateError(payload)).toBe(true);
  });

  it('error envelope validates with reasoning', () => {
    const payload = {
      reasoning: 'I analyzed each required field but the input was missing X.',
      code: 'validation_failed',
      message: 'Could not match the schema.',
    };
    expect(validateError(payload)).toBe(true);
  });

  it('schema.request validates without reasoning', () => {
    expect(validateSchemaRequest({ envelopeType: 'vendor.acme.prd.create' })).toBe(true);
  });

  it('rejects reasoning of non-string type (universal kinds use plain string, not string|null union)', () => {
    const payload = {
      reasoning: 42,
      questions: [{ id: 'q1', question: '?' }],
    };
    expect(
      validateClarification(payload),
      'RFC 0030 §A: universal-kind `reasoning` MUST be type: string; numbers reject',
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('envelope-reasoning-shape: capabilities.envelopes advertisement (RFC 0030 §C)', () => {
  it('capabilities.envelopes.reasoning (when present) conforms to RFC 0030 §C', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reasoning = capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<string, unknown> }>(d, 'envelopes')?.reasoning;
    if (reasoning === undefined) return; // optional block; host MAY omit
    expect(
      typeof reasoning.supported,
      'RFC 0030 §C: capabilities.envelopes.reasoning.supported MUST be boolean when block is advertised',
    ).toBe('boolean');
    if (reasoning.promptDirective !== undefined) {
      expect(
        ['mandatory', 'advisory', 'off'],
        'RFC 0030 §C: promptDirective MUST be one of the three documented values',
      ).toContain(String(reasoning.promptDirective));
    }
  });

  it('capabilities.envelopes.tierOneSubsetCompliance (when present) conforms to RFC 0030 §B', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const compliance = capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<string, unknown> }>(d, 'envelopes')?.tierOneSubsetCompliance;
    if (compliance === undefined) return; // optional; host MAY omit
    expect(
      ['strict', 'warn', 'off'],
      'RFC 0030 §B: tierOneSubsetCompliance MUST be one of strict|warn|off',
    ).toContain(String(compliance));
  });
});
