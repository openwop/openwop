/**
 * Runtime capabilities scenarios — optional v1 extension coverage.
 *
 * Runtime Capability Declarations let a NodeModule declare host facilities
 * it depends on via `requires: ['chat.sendPrompt']` and let the host
 * advertise registered providers via `runtimeCapabilities: string[]` in the
 * `/.well-known/openwop` response. The field is optional in v1; clients MUST
 * tolerate its absence.
 *
 * Scenarios in this file:
 *
 *   1. Forward-compat shape check — IF `runtimeCapabilities` is present
 *      in the discovery response, it MUST be a string array of unique,
 *      non-empty entries.
 *   2. End-to-end dispatch refusal — when a workflow uses a
 *      NodeModule that declares `requires: ['<unsupported>']`, the run
 *      MUST terminate with `RunSnapshot.error.code =
 *      'capability_not_provided'` and MUST NOT execute the node.
 *
 * The E2E path needs a fixture node that declares a `requires` entry
 * the conformance host is guaranteed not to provide. Hosts that do not
 * advertise that fixture skip-equivalent.
 *
 * Spec references:
 *   - capabilities.md §"Runtime capabilities"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const CAPABILITY_MISSING_WORKFLOW_ID = 'conformance-capability-missing';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(CAPABILITY_MISSING_WORKFLOW_ID);

describe('runtime-capabilities: /.well-known/openwop forward-compat shape', () => {
  it('IF runtimeCapabilities is present, it MUST be a string[] of unique non-empty entries', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });

    expect(res.status, req('openwop.it.runtime-capabilities.if-runtimecapabilities-is-present-it-must-be-a-string-of-unique-non-empty-entrie', 
      'capabilities.md §2',
      'discovery endpoint MUST return 200',
    )).toBe(200);

    const body = res.json as { runtimeCapabilities?: unknown } | undefined;
    const caps = body?.runtimeCapabilities;

    if (caps === undefined) {
      // Spec-allowed — runtimeCapabilities is optional. The vast majority
      // of v1 hosts will omit it. Assertion passes trivially; don't
      // force a value on a host that doesn't advertise any.
      expect(caps).toBeUndefined();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `caps === undefined` returned early');
    }

    expect(Array.isArray(caps), req('openwop.it.runtime-capabilities.if-runtimecapabilities-is-present-it-must-be-a-string-of-unique-non-empty-entrie', 
      'capabilities.md §"Runtime capabilities"',
      'runtimeCapabilities MUST be an array when present',
    )).toBe(true);

    const arr = caps as unknown[];
    for (const entry of arr) {
      expect(typeof entry, req('openwop.it.runtime-capabilities.if-runtimecapabilities-is-present-it-must-be-a-string-of-unique-non-empty-entrie', 
        'capabilities.md §"Runtime capabilities"',
        'every runtimeCapabilities entry MUST be a string',
      )).toBe('string');
      expect((entry as string).length, req('openwop.it.runtime-capabilities.if-runtimecapabilities-is-present-it-must-be-a-string-of-unique-non-empty-entrie', 
        'capabilities.md §"Runtime capabilities"',
        'every runtimeCapabilities entry MUST be non-empty',
      )).toBeGreaterThan(0);
    }

    const unique = new Set(arr as string[]);
    expect(unique.size, req('openwop.it.runtime-capabilities.if-runtimecapabilities-is-present-it-must-be-a-string-of-unique-non-empty-entrie', 
      'capabilities.md §"Runtime capabilities"',
      'runtimeCapabilities entries MUST be unique',
    )).toBe(arr.length);
  });

});

// ── E2E dispatch refusal ─────────────────────────────────────────────────
//
// Requires the host to have registered the `conformance.requiresMissing`
// fixture node + seeded `conformance-capability-missing` workflow. The
// Hosts that don't expose the optional fixture surface skip this describe
// block via fixture advertisement.

describe.skipIf(SKIP_NO_FIXTURE)('runtime-capabilities: dispatch refusal on unsatisfied requires', () => {
  it('terminates the run with error.code = capability_not_provided', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'conformance-capability-missing',
    });
    expect(create.status, req('openwop.it.runtime-capabilities.terminates-the-run-with-error-code-capability-not-provided', 
      'capabilities.md §"Runtime capabilities"',
      'POST /v1/runs MUST accept the run; refusal is engine-side at dispatch time, not request-validation',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);

    expect(terminal.status, req('openwop.it.runtime-capabilities.terminates-the-run-with-error-code-capability-not-provided', 
      'capabilities.md §"Runtime capabilities"',
      'a node with unsatisfied requires MUST cause the run to terminate as failed',
    )).toBe('failed');

    const error = (terminal as { error?: { code?: string; message?: string } }).error;
    expect(error?.code, req('openwop.it.runtime-capabilities.terminates-the-run-with-error-code-capability-not-provided', 
      'rest-endpoints.md §"Common error codes"',
      'terminal RunSnapshot.error.code MUST be "capability_not_provided"',
    )).toBe('capability_not_provided');

    expect(error?.message, req('openwop.it.runtime-capabilities.terminates-the-run-with-error-code-capability-not-provided', 
      'capabilities.md §"Runtime capabilities"',
      'error.message MUST name the missing capability id verbatim so operators can act without grepping logs',
    )).toContain('conformance.never-provided');
  });
});
