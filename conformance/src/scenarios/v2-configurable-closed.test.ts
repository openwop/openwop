/**
 * v2 — `configurable-closed` (suite 2.0.0; RFC 0171 §D.1;
 * `spec/v2/core/runs.md` §"RunOptions" / `configurable`;
 * `schemas/v2/configurable.schema.json`).
 *
 * Witness class: witnessable — unaided. `configurable` is a closed, nested,
 * versioned object. A dotted key (`ai.provider` as a string key inside a
 * section) and an unknown root key MUST be rejected with
 * `400 validation_error`. The schema leg is server-free (the closure is a
 * property of the standalone artifact); the two wire legs post the bodies to
 * `POST /runs` and record `blocked` when the host refuses the control body
 * for a reason unrelated to `configurable`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/runs.md §configurable';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const DOTTED = { version: 1, ai: { 'ai.provider': 'x' } };
const UNKNOWN = { version: 1, unknownKey: 1 };
const CONTROL = { version: 1 };

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** Post a body; when the CONTROL body is itself refused the wire leg is blocked. */
async function probe(configurable: Record<string, unknown>): Promise<OpenWOPResponse | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const control = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID, configurable: CONTROL }));
  if (control === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  if (control.status !== 201) return { reason: `POST /runs with the control body { version: 1 } answered ${control.status} ${readErrorCode(control.json) ?? ''} — the create itself is refused, so the closure of configurable cannot be observed (fixture not seeded?)`.trim() };
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID, configurable }));
  return res ?? { reason: 'POST /runs unreachable (fetch failed)' };
}

describe('v2 configurable-closed (RFC 0171 §D.1)', () => {
  it('the standalone schema rejects a dotted key and an unknown root key and accepts the versioned control', () => {
    const validate = v2Validator('configurable');
    expect(validate(CONTROL).ok, req('openwop.requirement.0171.configurable-closed.schema', DOC, '{ version: 1 } is the smallest valid configurable (version REQUIRED, const 1)')).toBe(true);
    expect(validate(DOTTED).ok, req('openwop.requirement.0171.configurable-closed.schema', DOC, 'a dotted key (`ai.provider` as a string key) MUST fail the closed nested schema')).toBe(false);
    expect(validate(UNKNOWN).ok, req('openwop.requirement.0171.configurable-closed.schema', DOC, 'an unknown root key MUST fail the closed schema (additionalProperties: false in the standalone artifact)')).toBe(false);
    expect(validate({ ai: { provider: 'x' } }).ok, req('openwop.requirement.0171.configurable-closed.schema', DOC, 'a configurable without `version` MUST fail')).toBe(false);
  });

  it('POST /runs rejects a dotted key with 400 validation_error', async () => {
    const res = await probe(DOTTED);
    if ('reason' in res) return softSkip('blocked', res.reason);
    expect(res.status, req('openwop.requirement.0171.configurable-closed.dotted-key', DOC, 'a dotted key inside a section MUST be rejected with 400')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0171.configurable-closed.dotted-key', DOC, 'the refusal code MUST be validation_error')).toBe('validation_error');
  });

  it('POST /runs rejects an unknown root key with 400 validation_error', async () => {
    const res = await probe(UNKNOWN);
    if ('reason' in res) return softSkip('blocked', res.reason);
    expect(res.status, req('openwop.requirement.0171.configurable-closed.unknown-key', DOC, 'an unknown root key MUST be rejected with 400')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0171.configurable-closed.unknown-key', DOC, 'the refusal code MUST be validation_error')).toBe('validation_error');
  });
});
