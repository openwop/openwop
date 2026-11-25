/**
 * `v2-runner-frame-credential-free` (target major 2) — a self-hosted runner's
 * credential never transits the host (invariant `runner-credential-non-transit`).
 *
 * `spec/v2/core/execution.md` §Self-hosted runners: "A runner credential MUST
 * NOT transit the host or appear in any frame, event, result, debug bundle or
 * log. The runner bearer MUST NOT be a provider credential." The wire half is
 * the two closed frames, `schemas/v2/self-hosted-runner-dispatch-frame` and
 * `-result-frame`: the host sends `inputs`, receives `output`, and neither frame
 * has a seat a credential could ride in. The v1 file `self-hosted-runner` reads
 * the v1 frame schemas only.
 *
 * Legs:
 *   1. `execution.runner-frames-credential-free` (server-free) — a conforming
 *      dispatch frame and result frame validate (control); the same frames with
 *      a credential-named member at the root (`credential`, `apiKey`, `token`,
 *      `authorization`, `bearer`, `password`, `secret`, `providerCredential`)
 *      are refused.
 *   2. `execution.runner-frames-credential-free` (live; gated on
 *      `selfHostedRunner`) — the advertised record names no credential material
 *      (no member whose name is credential-shaped, and no value that looks like
 *      a bearer or key).
 *
 * Not asserted: a dispatch/result round trip with a canary credential on the
 * runner side, then a scan of the run's events, snapshot and result. That needs
 * a suite-driven runner, which the v2 seams do not offer; it is planned, not
 * witnessed (stated so the gap stays visible).
 *
 * Dispositions: leg 2 — no target ⇒ `inapplicable`; discovery unreachable ⇒
 * `blocked`; `selfHostedRunner` not advertised ⇒ `inapplicable`.
 *
 * Sabotage (corpus, local): `additionalProperties: true` on the v2 result frame
 * fails leg 1.
 *
 * @see spec/v2/core/execution.md §Self-hosted runners
 * @see SECURITY/invariants.yaml id: runner-credential-non-transit
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/execution.md §Self-hosted runners';
const ID = 'openwop.requirement.execution.runner-frames-credential-free';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];
const SMUGGLED = ['credential', 'apiKey', 'token', 'authorization', 'bearer', 'password', 'secret', 'providerCredential'];
const CREDENTIAL_NAME = /(secret|password|api[-_]?key|token|bearer|credential|private[-_]?key)/i;
const CREDENTIAL_VALUE = /^(Bearer\s|sk-|ghp_|xox[abp]-|AKIA)/;

const dispatch = { runId: 'tenant-a/run-0000000000000001', stepId: 'step-1', seq: 1, kind: 'model', provider: 'anthropic', model: 'claude', inputs: { prompt: 'ok' } };
const result = { runId: 'tenant-a/run-0000000000000001', stepId: 'step-1', seq: 1, output: { text: 'ok' } };

describe('v2 self-hosted runner frames carry no credential (execution.md §Self-hosted runners)', () => {
  it('the dispatch and result frames are closed: a credential-named member is refused', () => {
    const vd = v2Validator('self-hosted-runner-dispatch-frame');
    const vr = v2Validator('self-hosted-runner-result-frame');
    expect(vd(dispatch).ok, req(ID, DOC, `control: a conforming dispatch frame MUST validate (${vd(dispatch).errors})`)).toBe(true);
    expect(vr(result).ok, req(ID, DOC, `control: a conforming result frame MUST validate (${vr(result).errors})`)).toBe(true);
    for (const name of SMUGGLED) {
      expect(vd({ ...dispatch, [name]: 'sk-conformance-canary' }).ok, req(ID, DOC, `a dispatch frame carrying "${name}" MUST be refused — the host never sees the runner's credential`)).toBe(false);
      expect(vr({ ...result, [name]: 'sk-conformance-canary' }).ok, req(ID, DOC, `a result frame carrying "${name}" MUST be refused — a runner cannot hand its credential to the host`)).toBe(false);
    }
  });

  it('an advertised selfHostedRunner record names no credential material', async () => {
    if (HTTP_SKIP) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    if (!(await v2Discovery().catch(() => null))) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const rec = await familyAdvertised('selfHostedRunner');
    if (!rec) return softSkip('inapplicable', 'selfHostedRunner is not advertised — the host dispatches to no runner');
    const found: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') { if (CREDENTIAL_VALUE.test(node)) found.push(`${path} = ${node.slice(0, 12)}…`); return; }
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) { if (CREDENTIAL_NAME.test(k)) found.push(`${path}.${k}`); walk(v, `${path}.${k}`); }
    };
    walk(rec, 'selfHostedRunner');
    expect(found, req(ID, DOC, 'the advertised selfHostedRunner record MUST carry no credential material')).toEqual([]);
  });
});
