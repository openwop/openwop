/**
 * Self-hosted / OpenAI-compatible provider-class advertisement shape
 * (RFC 0108 §A / §D) — server-free, always-on.
 *
 * Verifies the additive `capabilities.aiProviders.selfHosted` field:
 *   - the schema declares it as a `string[]` with `uniqueItems` (a sibling of
 *     `byok` / `input` in the `aiProviders` block) and it is OPTIONAL (absent
 *     or empty is a valid discovery doc — today's behavior);
 *   - via Ajv2020 a conforming advertisement validates and a non-array /
 *     duplicate / empty-string form is rejected;
 *   - the two rules JSON Schema alone cannot express — §A.1 subset constraint
 *     (every `selfHosted` entry MUST also appear in `supported`) and §A.3 /
 *     `self-hosted-endpoint-no-disclosure` (no entry is URL-shaped: no `://`,
 *     no bare `host:port`, no leading `/` path) — are enforced by the
 *     `validateSelfHosted` checker and exercised against good/bad example docs.
 *
 * The behavioral honesty check (a real dispatch against a `selfHosted` id, and
 * the endpoint location absent from every run.* event / error payload) is
 * gated on `aiProviders.selfHosted.length > 0` and lands with a reference host
 * in `aiproviders-selfhosted-honesty.test.ts` (RFC 0108 §E — Active → Accepted).
 * This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md (§aiProviders.selfHosted)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0108-self-hosted-openai-compatible-provider-class.md (§A, §D)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/**
 * RFC 0108 §A.3 / `self-hosted-endpoint-no-disclosure`: a `selfHosted` id is an
 * opaque host-chosen label and MUST NOT encode the endpoint's network location.
 * Returns true if the id is URL-shaped (and therefore non-conformant).
 */
function isUrlShaped(id: string): boolean {
  if (id.includes('://')) return true; // scheme://host
  if (id.startsWith('/')) return true; // leading path
  // bare host:port — a colon followed by digits (rejects `compat:label`, flags `vllm:8000`)
  if (/:\d/.test(id)) return true;
  return false;
}

interface SelfHostedAdvert {
  supported?: string[];
  byok?: string[];
  selfHosted?: string[];
}

/**
 * Enforces the two RFC 0108 §A rules JSON Schema cannot express:
 *   §A.1 — every selfHosted entry is a subset of supported;
 *   §A.3 — no selfHosted entry is URL-shaped.
 * Returns the list of violations (empty ⇒ conformant). Absent selfHosted is conformant.
 */
function validateSelfHosted(ai: SelfHostedAdvert): string[] {
  const problems: string[] = [];
  const selfHosted = ai.selfHosted;
  if (!selfHosted) return problems; // optional — absence is valid
  const supported = new Set(ai.supported ?? []);
  for (const id of selfHosted) {
    if (!supported.has(id)) problems.push(`selfHosted entry "${id}" is not in supported[] (§A.1)`);
    if (isUrlShaped(id)) problems.push(`selfHosted entry "${id}" is URL-shaped (§A.3)`);
  }
  return problems;
}

describe('aiproviders-selfhosted-shape: self-hosted provider-class advertisement (RFC 0108 §A/§D, server-free)', () => {
  it('aiProviders.selfHosted is declared as a string[] with uniqueItems', () => {
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
      .aiProviders;
    const selfHosted = aiProviders?.properties?.selfHosted as
      | { type?: unknown; uniqueItems?: unknown; items?: { type?: unknown; minLength?: unknown } }
      | undefined;
    expect(
      selfHosted,
      req('openwop.it.aiproviders-selfhosted-shape.aiproviders-selfhosted-is-declared-as-a-string-with-uniqueitems', 'capabilities.md §aiProviders.selfHosted', 'aiProviders.selfHosted MUST be declared'),
    ).toBeDefined();
    expect(selfHosted?.type, req('openwop.it.aiproviders-selfhosted-shape.aiproviders-selfhosted-is-declared-as-a-string-with-uniqueitems', 'RFC 0108 §A', 'selfHosted MUST be an array')).toBe('array');
    expect(
      selfHosted?.uniqueItems,
      req('openwop.it.aiproviders-selfhosted-shape.aiproviders-selfhosted-is-declared-as-a-string-with-uniqueitems', 'RFC 0108 §A', 'selfHosted entries MUST be unique'),
    ).toBe(true);
    expect(selfHosted?.items?.type, req('openwop.it.aiproviders-selfhosted-shape.aiproviders-selfhosted-is-declared-as-a-string-with-uniqueitems', 'RFC 0108 §A', 'selfHosted entries MUST be strings')).toBe(
      'string',
    );
    expect(
      selfHosted?.items?.minLength,
      req('openwop.it.aiproviders-selfhosted-shape.aiproviders-selfhosted-is-declared-as-a-string-with-uniqueitems', 'RFC 0108 §A', 'a selfHosted id MUST be non-empty'),
    ).toBe(1);
  });

  it('selfHosted is NOT in aiProviders.required — absence (no self-hosted endpoint) is a valid default', () => {
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { required?: unknown }>).aiProviders;
    const required = Array.isArray(aiProviders?.required) ? (aiProviders!.required as string[]) : [];
    expect(
      required.includes('selfHosted'),
      req('openwop.it.aiproviders-selfhosted-shape.selfhosted-is-not-in-aiproviders-required-absence-no-self-hosted-endpoint-is-a-v', 'RFC 0108 §A.1', 'aiProviders.selfHosted MUST be optional'),
    ).toBe(false);
  });

  it('Ajv accepts a conforming selfHosted array and rejects non-array / duplicate / empty-string forms', () => {
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
      .aiProviders;
    const selfHostedSchema = aiProviders?.properties?.selfHosted as Record<string, unknown>;

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(selfHostedSchema);

    expect(
      validate(['ollama', 'compat']),
      req('openwop.it.aiproviders-selfhosted-shape.ajv-accepts-a-conforming-selfhosted-array-and-rejects-non-array-duplicate-empty', 'RFC 0108 §A', 'a conforming selfHosted array MUST validate'),
    ).toBe(true);
    expect(
      validate('ollama'),
      req('openwop.it.aiproviders-selfhosted-shape.ajv-accepts-a-conforming-selfhosted-array-and-rejects-non-array-duplicate-empty', 'RFC 0108 §A', 'a non-array selfHosted MUST be rejected'),
    ).toBe(false);
    expect(
      validate(['ollama', 'ollama']),
      req('openwop.it.aiproviders-selfhosted-shape.ajv-accepts-a-conforming-selfhosted-array-and-rejects-non-array-duplicate-empty', 'RFC 0108 §A', 'duplicate selfHosted entries MUST be rejected (uniqueItems)'),
    ).toBe(false);
    expect(
      validate(['']),
      req('openwop.it.aiproviders-selfhosted-shape.ajv-accepts-a-conforming-selfhosted-array-and-rejects-non-array-duplicate-empty', 'RFC 0108 §A', 'an empty-string selfHosted id MUST be rejected (minLength 1)'),
    ).toBe(false);
  });

  it('§A.1 subset + §A.3 non-disclosure: a conforming doc has no violations; an out-of-subset or URL-shaped id does', () => {
    // Conforming: every selfHosted id is in supported and none is URL-shaped.
    expect(
      validateSelfHosted({
        supported: ['anthropic', 'openai', 'ollama', 'compat'],
        byok: ['anthropic', 'openai', 'compat'],
        selfHosted: ['ollama', 'compat'],
      }),
      req('openwop.it.aiproviders-selfhosted-shape.a-1-subset-a-3-non-disclosure-a-conforming-doc-has-no-violations-an-out-of-subse', 'RFC 0108 §A.1/§A.3', 'a conforming advertisement MUST have no violations'),
    ).toEqual([]);

    // §A.1 violation: `vllm` not in supported.
    expect(
      validateSelfHosted({ supported: ['anthropic', 'ollama'], selfHosted: ['ollama', 'vllm'] }),
      req('openwop.it.aiproviders-selfhosted-shape.a-1-subset-a-3-non-disclosure-a-conforming-doc-has-no-violations-an-out-of-subse', 'RFC 0108 §A.1', 'a selfHosted id absent from supported MUST be flagged'),
    ).not.toEqual([]);

    // §A.3 violations: URL-shaped ids leak the endpoint location.
    for (const leaky of [
      'http://vllm.internal:8000/v1',
      'vllm.internal:8000',
      '/v1/chat/completions',
    ]) {
      expect(
        isUrlShaped(leaky),
        req('openwop.it.aiproviders-selfhosted-shape.a-1-subset-a-3-non-disclosure-a-conforming-doc-has-no-violations-an-out-of-subse', 'RFC 0108 §A.3', `the URL-shaped id "${leaky}" MUST be detected as non-conformant`),
      ).toBe(true);
    }

    // A label with a non-numeric suffix (`compat:label`) is NOT URL-shaped — it is a permitted opaque id.
    expect(
      isUrlShaped('compat:local-ollama'),
      req('openwop.it.aiproviders-selfhosted-shape.a-1-subset-a-3-non-disclosure-a-conforming-doc-has-no-violations-an-out-of-subse', 'RFC 0108 §A.3', 'an opaque `compat:<label>` id (no host:port) MUST be permitted'),
    ).toBe(false);
  });
});
