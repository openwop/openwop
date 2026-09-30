/**
 * RFC 0229 — a production host can witness secret resolution without an oracle
 * (`spec/v1/capabilities.md` §"Run-supplied secrets"; suite 2.45.3, target
 * major 1; gated on `capabilities.secrets.runSecrets` and the
 * `openwop-secrets-run-witness` fixture). The v2 twin is
 * `v2-secrets-run-witness`, and the four rows are the same requirement ids.
 *
 * This file is the SECOND floor path of the v1 `openwop-secrets` profile
 * (`profiles.md` §`openwop-secrets`): the floor is an any-of group, satisfied
 * by a witnessed pass of either `byok-roundtrip.test.ts` or this file. A
 * production host can take this path: the node reads only a `run:` ref, which
 * resolves only to a value supplied with the same run, and outputs only
 * `{ matched }`, so it is no oracle over a stored secret.
 *
 * Rows: `run-witness-resolves`, `run-witness-redacted`,
 * `run-witness-scope-bound`, `run-secrets-outside-request-digest` — see the v2
 * twin for what each observes. Dispositions (RFC 0229 §F): facet absent ⇒
 * `inapplicable`; facet without the fixture ⇒ `blocked`; a `createRun` that
 * refuses a well-formed `runSecrets` ⇒ `executed-fail`.
 *
 * @see spec/v1/capabilities.md §"Run-supplied secrets"
 * @see spec/v1/profiles.md §openwop-secrets
 * @see RFCS/0229-production-safe-secrets-witness.md
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { blockedDespiteAssertions, softSkip } from '../lib/soft-skip.js';
import { CANARY_NAME, WITNESS_REF, WitnessHost, freshName, freshValue, hits, sha256Hex } from '../lib/run-secrets-witness.js';

const DOC = 'capabilities.md §"Run-supplied secrets" (RFC 0229)';
const host = new WitnessHost(1);

interface Witnessed { runId: string; createText: string; status: string; matched: boolean | undefined; value: string; digestSupplied: boolean }
type Outcome = { runs: [Witnessed, Witnessed] } | { skip: 'inapplicable' | 'blocked'; reason: string } | { refused: { status: number; detail: string } };

/** Run A (`C`, `sha256(C)`) and run B (`D`, the digest of a different value), once per file. */
let pair: Promise<Outcome> | undefined;
function witnessedPair(): Promise<Outcome> {
  pair ??= (async (): Promise<Outcome> => {
    const g = await host.gate();
    if (!g.ok) return { skip: g.kind, reason: g.reason };
    const out: Witnessed[] = [];
    for (const same of [true, false]) {
      const value = freshValue();
      const expected = same ? sha256Hex(value) : sha256Hex(freshValue());
      const res = await host.create({ ref: WITNESS_REF, expectedSha256: expected }, [{ ref: WITNESS_REF, value }]);
      if (res === null) return { skip: 'blocked', reason: 'POST /v1/runs unreachable (fetch failed)' };
      const runId = (res.json as { runId?: unknown } | null)?.runId;
      if (res.status !== 201 || typeof runId !== 'string') return { refused: { status: res.status, detail: `POST /v1/runs with a well-formed runSecrets answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() } };
      const snap = await host.waitTerminal(runId);
      out.push({ runId, createText: res.text, status: String(snap?.['status']), matched: await host.matched(runId, snap), value, digestSupplied: same });
    }
    return { runs: [out[0]!, out[1]!] };
  })();
  return pair;
}

/** A run that must end in `witness`'s `node.failed`; returns the code, or a blocked reason. */
async function failedCode(inputs: { ref: string; expectedSha256: string }, runSecrets?: ReadonlyArray<{ ref: string; value: string }>): Promise<{ code: string | null; status: string } | { reason: string }> {
  const res = await host.create(inputs, runSecrets);
  if (res === null) return { reason: 'POST /v1/runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /v1/runs answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const snap = await host.waitTerminal(runId);
  return { code: await host.nodeFailedCode(runId), status: String(snap?.['status']) };
}

describe('RFC 0229 — secrets-run-witness (gated on secrets.runSecrets + openwop-secrets-run-witness)', () => {
  it('a run-supplied secret resolves intact: matched true for its digest, false for another', async () => {
    const o = await witnessedPair();
    if ('skip' in o) return softSkip(o.skip, o.reason);
    const id = 'openwop.requirement.secrets.run-witness-resolves';
    if ('refused' in o) {
      expect(o.refused.status, req(id, DOC, `a host advertising runSecrets MUST accept a well-formed runSecrets on createRun (${o.refused.detail})`)).toBe(201);
      return blockedDespiteAssertions(`${o.refused.detail} with no runId — no run to witness`);
    }
    const [a, b] = o.runs;
    expect(a.status, req(id, DOC, 'the witness run with a matching digest MUST complete')).toBe('completed');
    expect(b.status, req(id, DOC, 'the witness run with a different digest MUST complete (a mismatch is an output, not a failure)')).toBe('completed');
    if (a.matched === undefined || b.matched === undefined) return blockedDespiteAssertions('the runs completed but witness\'s `matched` output was on no readable surface (node.completed outputs or the snapshot)');
    expect(a.matched, req(id, DOC, 'witness MUST output matched: true when expectedSha256 is the digest of the supplied value')).toBe(true);
    expect(b.matched, req(id, DOC, 'witness MUST output matched: false when expectedSha256 is the digest of a different value')).toBe(false);
  }, 90_000);

  it('a run-supplied secret appears on no readable surface, in any encoding or as its digest', async () => {
    const o = await witnessedPair();
    if ('skip' in o) return softSkip(o.skip, o.reason);
    if ('refused' in o) return softSkip('blocked', `${o.refused.detail} — no run to scan (row run-witness-resolves convicts the refusal)`);
    const id = 'openwop.requirement.secrets.run-witness-redacted';
    for (const r of o.runs) {
      const s = await host.surfaces(r.runId, [r.createText]);
      expect(hits(s.text, r.value, r.digestSupplied), req(id, DOC, `the supplied value MUST NOT appear on any surface (read: ${s.read.join(', ')}), raw, base64, hex, percent- or JSON-encoded, or as its SHA-256 where the suite did not send that digest itself`)).toEqual([]);
    }
  }, 90_000);

  it('a run: ref resolves only within the run that supplied it, and the witness refuses any other ref', async () => {
    const g = await host.gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const id = 'openwop.requirement.secrets.run-witness-scope-bound';
    const v = freshValue();
    const cases: Array<{ what: string; inputs: { ref: string; expectedSha256: string }; runSecrets?: Array<{ ref: string; value: string }>; code: string }> = [
      { what: `the canary name ${CANARY_NAME}`, inputs: { ref: CANARY_NAME, expectedSha256: sha256Hex(v) }, runSecrets: [{ ref: WITNESS_REF, value: v }], code: 'credential_forbidden' },
      { what: 'a fresh name without run:', inputs: { ref: freshName(), expectedSha256: sha256Hex(v) }, runSecrets: [{ ref: WITNESS_REF, value: v }], code: 'credential_forbidden' },
      { what: `${WITNESS_REF} with no runSecrets`, inputs: { ref: WITNESS_REF, expectedSha256: sha256Hex(v) }, code: 'credential_not_found' },
    ];
    const earlier = freshValue();
    const first = await host.create({ ref: WITNESS_REF, expectedSha256: sha256Hex(earlier) }, [{ ref: WITNESS_REF, value: earlier }]);
    const firstId = (first?.json as { runId?: unknown } | null)?.runId;
    if (first === null || first.status !== 201 || typeof firstId !== 'string') return softSkip('blocked', `the earlier run's POST /v1/runs answered ${first?.status ?? 'nothing'} ${readErrorCode(first?.json) ?? ''}`.trim());
    await host.waitTerminal(firstId);
    cases.push({ what: `an earlier run's ref (${WITNESS_REF}) while this run supplies only run:openwop-other`, inputs: { ref: WITNESS_REF, expectedSha256: sha256Hex(earlier) }, runSecrets: [{ ref: 'run:openwop-other', value: freshValue() }], code: 'credential_not_found' });
    for (const c of cases) {
      const r = await failedCode(c.inputs, c.runSecrets);
      if ('reason' in r) return blockedDespiteAssertions(`${c.what}: ${r.reason}`);
      expect(r.code, req(id, DOC, `${c.what}: witness MUST end in node.failed with ${c.code} (run status ${r.status})`)).toBe(c.code);
    }
    // §A.4: gated on replay advertising `branch` (RFC 0229 §F row 3).
    if (g.branchFork) {
      const fork = await host.fork(firstId);
      const forkId = (fork?.json as { runId?: unknown } | null)?.runId;
      // partial-witness-ok: the four scope legs above observed the requirement; this fork leg is conditional on a fork the host serves (the fork contract is not this row's)
      if (fork === null || fork.status !== 201 || typeof forkId !== 'string') return softSkip('inapplicable', `replay advertises branch, but POST /v1/v1/runs/{runId}:fork answered ${fork?.status ?? 'nothing'} ${readErrorCode(fork?.json) ?? ''} — the fork leg did not run (rest-endpoints.md owns the fork contract)`.trim());
      await host.waitTerminal(forkId);
      expect(await host.nodeFailedCode(forkId), req(id, DOC, 'a branch fork taken before witness MUST NOT inherit runSecrets: witness fails credential_not_found')).toBe('credential_not_found');
    }
  }, 180_000);

  it('the idempotency request digest excludes runSecrets: a retry differing only there replays, and its value is discarded', async () => {
    const g = await host.gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const id = 'openwop.requirement.secrets.run-secrets-outside-request-digest';
    const key = `openwop-witness-${randomUUID()}`;
    const c = freshValue();
    const c2 = freshValue();
    const inputs = { ref: WITNESS_REF, expectedSha256: sha256Hex(c) };
    const first = await host.create(inputs, [{ ref: WITNESS_REF, value: c }], key);
    const runId = (first?.json as { runId?: unknown } | null)?.runId;
    if (first === null) return softSkip('blocked', 'POST /v1/runs unreachable (fetch failed)');
    expect(first.status, req(id, DOC, 'a host advertising runSecrets MUST accept a well-formed runSecrets on createRun')).toBe(201);
    if (typeof runId !== 'string') return blockedDespiteAssertions('the 201 carried no runId');
    const retry = await host.create(inputs, [{ ref: WITNESS_REF, value: c2 }], key);
    if (retry === null) return blockedDespiteAssertions('the same-key retry was unreachable (fetch failed)');
    expect(readErrorCode(retry.json), req(id, `${DOC}; idempotency.md §Outcomes`, 'a same-key retry differing only in runSecrets MUST NOT be 409 idempotency_key_mismatch — the request digest MUST NOT cover runSecrets')).not.toBe('idempotency_key_mismatch');
    expect(retry.status, req(id, DOC, 'the retry MUST be answered from cache with the original 201')).toBe(201);
    expect((retry.json as { runId?: unknown } | null)?.runId, req(id, DOC, 'the retry MUST name the original runId')).toBe(runId);
    expect(retry.headers.get('openwop-idempotent-replay'), req(id, 'idempotency.md §Outcomes', 'a response served from cache MUST carry OpenWOP-Idempotent-Replay: true')).toBe('true');
    await host.waitTerminal(runId);
    const s = await host.surfaces(runId, [first.text, retry.text]);
    expect(hits(s.text, c2), req(id, DOC, `the retried value MUST be discarded unused: it appears on no surface of the run (read: ${s.read.join(', ')})`)).toEqual([]);
  }, 90_000);
});
