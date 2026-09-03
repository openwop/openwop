/**
 * Verifier turn + gating (RFC 0090 §A/§B) — behavioral.
 *
 * Gated on `capabilities.multiAgent.executionModel.verifier.gating === true`
 * (root-first per RFC 0073). Soft-skips when unadvertised (default) / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives
 * in `agent-verifier-shape.test.ts`; this asserts host BEHAVIOR via the
 * documented host-sample seam `POST /v1/host/sample/agents/verify-run`
 * (soft-skips on 404 until a host wires it):
 *
 *   - a `fail` verdict on a gating host MUST block commit/terminate-as-success:
 *     the turn does NOT complete successfully, and a content-free `agent.verified`
 *     with `verdict: "fail"` is emitted (RFC 0090 §A/§B; composes the RFC 0063
 *     fail-closed merge gate);
 *   - a `pass` verdict completes normally.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0090-agent-verifier-and-convergence.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md (§"Verifier and convergence")
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/agents/verify-run';

/** Pull the agent.verified verdict out of a seam response's events[] (tolerant). */
function verifiedVerdict(json: unknown): string | undefined {
  const events = (json as { events?: Array<{ type?: string; verdict?: unknown }> })?.events ?? [];
  const v = events.find((e) => e?.type === 'agent.verified');
  return typeof v?.verdict === 'string' ? v.verdict : undefined;
}

/** Did the turn complete as a success? (tolerant of status/outcome shapes). */
function isSuccess(json: unknown): boolean {
  const j = json as { status?: unknown; outcome?: unknown; committed?: unknown };
  return j?.status === 'completed' || j?.outcome === 'completed' || j?.committed === true;
}

describe('verifier-gating (RFC 0090 §B)', () => {
  it('a fail verdict blocks commit on a gating host; a pass verdict completes', async () => {
    const ma = await readCapabilityFamily<Record<string, unknown>>('multiAgent');
    const em = ma?.executionModel as { verifier?: { gating?: unknown } } | undefined;
    const gating = em?.verifier?.gating === true;
    if (!behaviorGate('openwop-verifier-gating', gating)) return;

    // FAIL verdict → must NOT complete as success; agent.verified{fail} emitted.
    const failRes = await driver.post(SEAM, { simulateVerdict: 'fail' });
    if (failRes.status === 404) return softSkip('blocked', 'precondition not met — `failRes.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    expect(
      verifiedVerdict(failRes.json) === 'fail',
      req('openwop.it.verifier-gating.a-fail-verdict-blocks-commit-on-a-gating-host-a-pass-verdict-completes', 'RFC 0090 §A', 'a verify-run forcing a fail MUST emit agent.verified{verdict:"fail"}'),
    ).toBe(true);
    expect(
      !isSuccess(failRes.json),
      req('openwop.it.verifier-gating.a-fail-verdict-blocks-commit-on-a-gating-host-a-pass-verdict-completes', 'RFC 0090 §B', 'on a gating host a fail verdict MUST block commit/terminate-as-success'),
    ).toBe(true);

    // PASS verdict → completes normally.
    const passRes = await driver.post(SEAM, { simulateVerdict: 'pass' });
    if (passRes.status === 404) return softSkip('blocked', 'precondition not met — `passRes.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(
      verifiedVerdict(passRes.json) === 'pass',
      req('openwop.it.verifier-gating.a-fail-verdict-blocks-commit-on-a-gating-host-a-pass-verdict-completes', 'RFC 0090 §A', 'a verify-run forcing a pass MUST emit agent.verified{verdict:"pass"}'),
    ).toBe(true);
    expect(
      isSuccess(passRes.json),
      req('openwop.it.verifier-gating.a-fail-verdict-blocks-commit-on-a-gating-host-a-pass-verdict-completes', 'RFC 0090 §B', 'a pass verdict MUST allow the turn to complete'),
    ).toBe(true);
  });
});
