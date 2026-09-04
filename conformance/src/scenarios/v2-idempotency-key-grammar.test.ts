/**
 * v2 — `idempotency-key-grammar` (suite 2.0.0; RFC 0170 §D.3;
 * `spec/v2/core/idempotency.md` §"Layer 1: Idempotency-Key").
 *
 * Witness class: witnessable — unaided. `Idempotency-Key` MUST match
 * `^[A-Za-z0-9._~-]{22,128}$`; a value outside the grammar MUST be rejected
 * with `400 idempotency_key_invalid` (and MUST NOT be cached); a 22+ character
 * key with 128 bits of entropy is accepted. The positive leg runs first so a
 * host that cannot create the noop fixture at all records `blocked` rather than
 * a false negative on the grammar.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/idempotency.md §Layer 1';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const GRAMMAR = /^[A-Za-z0-9._~-]{22,128}$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** 128 bits of entropy, base64url — 22 characters, inside the grammar. */
function validKey(): string {
  return randomBytes(16).toString('base64url');
}

describe('v2 idempotency-key-grammar (RFC 0170 §D.3)', () => {
  it('a 22+ character key inside the grammar is accepted', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const key = validKey();
    expect(GRAMMAR.test(key), req('openwop.requirement.0170.idempotency-key-grammar.valid-accepted', DOC, 'the suite\'s key MUST itself be inside ^[A-Za-z0-9._~-]{22,128}$')).toBe(true);
    const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }, { headers: { 'Idempotency-Key': key } }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status >= 400 && readErrorCode(res.json) !== 'idempotency_key_invalid') {
      return softSkip('blocked', `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the create itself was refused, so the key grammar cannot be observed (fixture not seeded?)`);
    }
    expect(res.status, req('openwop.requirement.0170.idempotency-key-grammar.valid-accepted', DOC, 'a UUIDv4-strength key in base64url form satisfies the grammar and MUST NOT be refused as idempotency_key_invalid')).toBe(201);
  });

  it('a key outside the grammar is refused with 400 idempotency_key_invalid', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }, { headers: { 'Idempotency-Key': 'short' } }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status >= 400 && readErrorCode(res.json) !== 'idempotency_key_invalid') {
      // Disambiguate "the key was not examined" from "the host refused the
      // create for another reason": the same body under a valid key is the control.
      const control = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }, { headers: { 'Idempotency-Key': validKey() } }));
      if (control === null || control.status >= 400) {
        return softSkip('blocked', `POST /runs answered ${res.status} ${readErrorCode(res.json) ?? ''} and the control create under a valid key answered ${control?.status ?? 'no response'} — the create itself is refused, so the key grammar cannot be observed (fixture not seeded?)`);
      }
    }
    expect(res.status, req('openwop.requirement.0170.idempotency-key-grammar.invalid-refused', DOC, 'a host MUST reject an Idempotency-Key outside ^[A-Za-z0-9._~-]{22,128}$ with 400')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0170.idempotency-key-grammar.invalid-refused', DOC, 'the refusal code MUST be idempotency_key_invalid')).toBe('idempotency_key_invalid');
  });
});
