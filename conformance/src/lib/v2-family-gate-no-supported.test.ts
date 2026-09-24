/**
 * No `v2-*` scenario gates on a `supported` flag.
 *
 * At major 2 the presence of a family record IS the claim (RFC 0169 §A.2): the
 * closed records in `schemas/v2/capabilities.schema.json` carry no `supported`
 * property, so `rec['supported'] === true` is false on every schema-valid host.
 * A scenario gated that way records `inapplicable` forever and never executes —
 * and nothing turns red, because `inapplicable` is an honest-looking outcome.
 * `v2-content-locale-keys` shipped exactly that gate (RFC 0206
 * `delivery-extended-locale`, corrected 2026-09-24); the gate is
 * `familyAdvertised` / `gateFamily` (lib/v2.ts).
 *
 * The rule is mechanical: in a `v2-*` scenario, `supported` is never compared
 * to a boolean. Arrays named `supported` in error bodies (`details.supported`,
 * `data.supported`) are read with `Array.isArray` / `.includes`, never `=== true`,
 * so they do not trip it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from './paths.js';

const SCENARIOS = new URL('../scenarios/', import.meta.url).pathname;

/** `x['supported'] === true`, `x?.supported !== false`, `true === x.supported`, … */
const SUPPORTED_BOOL_GATE = /(?:\[\s*['"]supported['"]\s*\]|\??\.supported\b)\s*[!=]==?\s*(?:true|false)\b|\b(?:true|false)\s*[!=]==?\s*[\w$?.[\]'"]*(?:\[\s*['"]supported['"]\s*\]|\.supported\b)/;

function offenders(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(SCENARIOS)) {
    if (!f.startsWith('v2-') || !f.endsWith('.test.ts')) continue;
    readFileSync(join(SCENARIOS, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (SUPPORTED_BOOL_GATE.test(line)) out.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe('v2 scenarios gate on family presence, never on `supported`', () => {
  it('the premise holds: no v2 capability record declares a `supported` property', () => {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as { properties: Record<string, { properties?: Record<string, unknown> }> };
    const withSupported = Object.entries(schema.properties).filter(([, v]) => v?.properties !== undefined && 'supported' in v.properties).map(([k]) => k);
    expect(withSupported).toEqual([]);
    expect(schema.properties['content']?.properties).toBeDefined();
  });

  it('the detector catches the shipped defect and passes the legitimate array reads', () => {
    for (const bad of [
      "if (content === null || content['supported'] !== true) return softSkip('inapplicable', '…');",
      'if (rec?.supported === true) {',
      'const on = true === doc.content.supported;',
    ]) expect(SUPPORTED_BOOL_GATE.test(bad), bad).toBe(true);
    for (const ok of [
      "if (content === null) return softSkip('inapplicable', '…');",
      'const supported = (probe?.json as { details?: { supported?: unknown } } | null)?.details?.supported;',
      "expect(Array.isArray(unsupported.error?.data?.['supported'])).toBe(true);",
      "const supported = Array.isArray(content['supportedLocales']) ? content['supportedLocales'] : [];",
    ]) expect(SUPPORTED_BOOL_GATE.test(ok), ok).toBe(false);
  });

  it('no v2-* scenario compares `supported` to a boolean', () => {
    expect(offenders()).toEqual([]);
  });
});
