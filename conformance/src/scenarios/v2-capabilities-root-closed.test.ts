/**
 * v2 — `capabilities-root-closed` (suite 2.0.0; RFC 0169 §A.4, §C.1;
 * `spec/v2/core/capabilities.md` §3 "The closed root").
 *
 * Witness class: witnessable — unaided. The v2 representation of
 * `/.well-known/openwop` MUST validate against `schemas/v2/capabilities.schema.json`,
 * whose root is `additionalProperties: false`. A copy of the host's document with
 * an unknown root key, a dotted mirror key, the v1 `capabilities` wrapper, or a
 * root `profiles[]` injected MUST fail validation — the closure is a property of
 * the schema artifact, so those legs run against the host's document when it is
 * reachable and against the minimal valid root otherwise.
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §3';
const MINIMAL_ROOT: Record<string, unknown> = { protocolVersions: ['2.0'], preferredVersion: '2.0' };

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** The host's document when reachable, else the minimal valid v2 root. */
async function base(): Promise<Record<string, unknown>> {
  return (await discovery()) ?? MINIMAL_ROOT;
}

describe('v2 capabilities-root-closed (RFC 0169 §A.4, §C.1)', () => {
  it('the host document validates against capabilities.schema.json', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const validate = v2Validator('capabilities');
    const r = validate(doc);
    expect(r.ok, req('openwop.requirement.0169.capabilities-root-closed.valid', DOC, `the v2 discovery document MUST validate against schemas/v2/capabilities.schema.json (${r.errors})`)).toBe(true);
  });

  it('an unknown root key fails validation', async () => {
    const validate = v2Validator('capabilities');
    const injected = { ...(await base()), openwopConformanceUnknownRootKey: { status: 'stable', since: '2.0', witness: 'claims-check' } };
    expect(validate(injected).ok, req('openwop.requirement.0169.capabilities-root-closed.unknown-root-key', DOC, 'any root key that is not a metadata key, a declared family, or `extensions` MUST fail validation')).toBe(false);
  });

  it('a dotted mirror key fails validation', async () => {
    const validate = v2Validator('capabilities');
    const injected = { ...(await base()), 'host.replay': { status: 'stable', since: '2.0', witness: 'claims-check' } };
    expect(validate(injected).ok, req('openwop.requirement.0169.capabilities-root-closed.dotted-key', DOC, 'a dotted key (the v1 `host.<family>` mirror) MUST fail validation at the closed root')).toBe(false);
  });

  it('the v1 `capabilities` wrapper fails validation', async () => {
    const validate = v2Validator('capabilities');
    const injected = { ...(await base()), capabilities: {} };
    expect(validate(injected).ok, req('openwop.requirement.0169.capabilities-root-closed.wrapper', DOC, 'the v1 `capabilities` wrapper MUST fail validation at the closed root (migration row C2.1)')).toBe(false);
  });

  it('a root `profiles[]` fails validation', async () => {
    const validate = v2Validator('capabilities');
    const injected = { ...(await base()), profiles: ['openwop-discovery-core'] };
    expect(validate(injected).ok, req('openwop.requirement.0169.capabilities-root-closed.profiles', 'spec/v2/core/capabilities.md §7', 'no `profiles[]` exists at the v2 root; a host that emits one MUST fail schema validation (row C2.10)')).toBe(false);
  });
});
