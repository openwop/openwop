/**
 * a2ui-surface-shape — RFC 0102 §A wire-shape conformance (server-free).
 *
 * Asserts (always-on, Ajv2020, no host required):
 *   1. `schemas/envelopes/ui.a2ui-surface.schema.json` compiles under Ajv2020.
 *   2. A positive surface payload (closed catalog components, advertised
 *      `catalogVersion`, a confined resume/exchange action) validates.
 *   3. Negatives fail per the closed schema:
 *        - missing required `catalogVersion` / `surface`
 *        - an out-of-catalog component object (additionalProperties:false)
 *        - a component carrying an extra/script-bearing property
 *        - a `catalogVersion` the schema does not enumerate
 *        - an `action.button` whose `action.target` is outside
 *          `enum["resume","exchange"]` (the structural half of
 *          `a2ui-action-confinement`), or carries an arbitrary URL field.
 *
 * The closed `anyOf` `surface` shape is the enabling precondition for the
 * render-side invariants `a2ui-surface-no-code-exec` /
 * `a2ui-surface-no-network-egress` (reference-app probes): a surface that
 * smuggles a script-bearing field or an unconfined action target fails
 * validation before it can reach a renderer.
 *
 * @see RFCS/0102-a2ui-agent-authored-interface-surfaces.md §A
 * @see spec/v1/ai-envelope.md §"A2UI surfaces"
 * @see schemas/envelopes/ui.a2ui-surface.schema.json
 * @see SECURITY/invariants.yaml (a2ui-action-confinement)
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'envelopes/ui.a2ui-surface.schema.json'), 'utf8'),
) as Record<string, unknown>;

function positivePayload(): Record<string, unknown> {
  return {
    catalogVersion: '0.9.1',
    surface: {
      title: 'Schedule the kickoff',
      components: [
        { component: 'heading', text: 'Kickoff', level: 2 },
        { component: 'text', text: 'Pick a date and confirm.' },
        { component: 'field.text', id: 'name', label: 'Your name', required: true },
        { component: 'field.date', id: 'when', label: 'Date' },
        {
          component: 'field.select',
          id: 'room',
          label: 'Room',
          options: [
            { value: 'a', label: 'Room A' },
            { value: 'b', label: 'Room B' },
          ],
        },
        { component: 'field.checkbox', id: 'remind', label: 'Remind me', default: true },
        { component: 'action.button', id: 'go', label: 'Confirm', action: { target: 'resume' } },
      ],
    },
    reasoning: 'Collect the kickoff details.',
  };
}

describe('a2ui-surface-shape: schema compile + round-trip (RFC 0102 §A)', () => {
  const validate = ajv.compile(schema);

  it('ui.a2ui-surface.schema.json compiles under Ajv2020', () => {
    expect(
      validate,
      'RFC 0102 §A: the core ui.a2ui-surface payload schema MUST compile',
    ).toBeTypeOf('function');
  });

  it('accepts a positive surface payload (closed catalog + confined action)', () => {
    const ok = validate(positivePayload());
    expect(
      ok,
      `RFC 0102 §A: positive surface MUST validate; errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('accepts an exchange-targeted action (the other confined target)', () => {
    const p = positivePayload();
    (p.surface as { components: Array<Record<string, unknown>> }).components = [
      { component: 'action.button', id: 'send', label: 'Send', action: { target: 'exchange' } },
    ];
    expect(validate(p)).toBe(true);
  });

  it('rejects a payload missing required `catalogVersion`', () => {
    const p = positivePayload();
    delete p.catalogVersion;
    expect(validate(p), 'RFC 0102 §A: `catalogVersion` is REQUIRED').toBe(false);
  });

  it('rejects a payload missing required `surface`', () => {
    const p = positivePayload();
    delete p.surface;
    expect(validate(p), 'RFC 0102 §A: `surface` is REQUIRED').toBe(false);
  });

  it('rejects a `catalogVersion` the schema does not enumerate (unknown version)', () => {
    const p = positivePayload();
    p.catalogVersion = '9.9.9';
    expect(
      validate(p),
      'RFC 0102 §A.3: an unadvertised catalogVersion MUST fail the enumerated set',
    ).toBe(false);
  });

  it('rejects an out-of-catalog component object (additionalProperties:false)', () => {
    const p = positivePayload();
    (p.surface as { components: Array<Record<string, unknown>> }).components = [
      { component: 'iframe', src: 'https://evil.example/x' } as Record<string, unknown>,
    ];
    expect(
      validate(p),
      'RFC 0102 §A.1: an out-of-catalog component MUST fail the closed anyOf',
    ).toBe(false);
  });

  it('rejects a known component carrying an extra (script-bearing) property', () => {
    const p = positivePayload();
    (p.surface as { components: Array<Record<string, unknown>> }).components = [
      { component: 'heading', text: 'Hi', onClick: "fetch('https://evil')" } as Record<string, unknown>,
    ];
    expect(
      validate(p),
      'RFC 0102 §A.1: additionalProperties:false MUST reject a smuggled code field',
    ).toBe(false);
  });

  it('rejects an action whose target is outside enum["resume","exchange"] (action confinement)', () => {
    const p = positivePayload();
    (p.surface as { components: Array<Record<string, unknown>> }).components = [
      { component: 'action.button', id: 'x', label: 'X', action: { target: 'http://evil.example' } },
    ];
    expect(
      validate(p),
      'RFC 0102 §A.4 / SECURITY a2ui-action-confinement: an action target outside resume/exchange MUST be rejected',
    ).toBe(false);
  });

  it('rejects an action carrying an arbitrary URL field (no unconfined egress target)', () => {
    const p = positivePayload();
    (p.surface as { components: Array<Record<string, unknown>> }).components = [
      {
        component: 'action.button',
        id: 'x',
        label: 'X',
        action: { target: 'resume', url: 'https://evil.example/exfil' } as Record<string, unknown>,
      },
    ];
    expect(
      validate(p),
      'RFC 0102 §A.4: action additionalProperties:false MUST reject an arbitrary URL target',
    ).toBe(false);
  });
});
