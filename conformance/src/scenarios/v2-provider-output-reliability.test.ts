/**
 * v2 — structured-output reliability through the mock provider
 * (`spec/v2/core/host-services.md` §Structured output; RFC 0255 §A, which moved
 * these rules unchanged from the deleted `envelopes` family).
 *
 * Unaided, through the `conformance-callai-attempt-accounting` fixture: its node
 * makes one `ctx.callAI` call with `responseSchema`, and the host's conformance
 * mock serves the case's script (`lib/callai-attempts-witness.ts`). The suite
 * wrote the script, so it knows what every provider request returned.
 *
 *   truncation  truncated, then valid → the host emits `envelope.truncated` and
 *               the call completes (gated on `reliability.completion.distinguishesTruncation`);
 *   exhaustion  every reply violates the schema, `retry.maxAttempts: 2` → the
 *               node fails `envelope_invalid`, after `envelope.retry-exhausted`
 *               and `cap.breached` `kind: "schema"`;
 *   refusal     the provider refuses → the node fails `envelope_refusal` after
 *               `envelope.refusal`, with no `envelope.retry-attempted`: a refusal
 *               is never retried.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `aiProviders.reliability` not
 * advertised, or the fixture not listed ⇒ `inapplicable`. A run that cannot be
 * created or read ⇒ `blocked`. A refusal script the host's mock refuses as input
 * (`validation_error`) ⇒ `blocked`.
 *
 * @see RFCS/0255-delete-the-ai-envelope.md §Conformance
 * @see conformance/fixtures.md §The ctx.callAI attempt-accounting fixture
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { runCase, type CaseRun } from '../lib/callai-attempts-witness.js';

const SECTION = 'host-services.md §Structured output';
const ID_TRUNCATION = 'openwop.requirement.0255.provider-output-truncation';
const ID_EXHAUSTION = 'openwop.requirement.0255.provider-output-exhaustion';
const ID_REFUSAL = 'openwop.requirement.0255.provider-output-refusal';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

type Skip = readonly ['inapplicable' | 'blocked', string];
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The advertised `aiProviders.reliability`, or why the legs cannot run. */
async function reliability(): Promise<{ skip: Skip } | { rel: Record<string, unknown> }> {
  const doc = await v2Discovery().catch(() => null);
  if (!doc) return { skip: ['blocked', UNREADABLE] };
  const ai = doc['aiProviders'];
  const rel = isRec(ai) && isRec(ai['reliability']) ? ai['reliability'] : undefined;
  if (!rel) return { skip: ['inapplicable', 'the host does not advertise aiProviders.reliability'] };
  return { rel };
}

async function drive(name: 'truncation' | 'exhaustion' | 'refusal'): Promise<{ skip: Skip } | { run: CaseRun }> {
  const d = await runCase(name);
  if (d.kind === 'skip') return { skip: [d.disposition, d.reason] };
  return { run: d.run };
}

describe('v2-provider-output-reliability (RFC 0255 §A)', () => {
  it('a truncated reply emits envelope.truncated and the retried call completes', async () => {
    const g = await reliability();
    if ('skip' in g) return softSkip(...g.skip);
    const completion = g.rel['completion'];
    if (!isRec(completion) || completion['distinguishesTruncation'] !== true) return softSkip('inapplicable', 'the host does not advertise aiProviders.reliability.completion.distinguishesTruncation');
    const o = await drive('truncation');
    if ('skip' in o) return softSkip(...o.skip);
    expect(o.run.types.filter((t) => t === 'envelope.truncated').length, req(ID_TRUNCATION, SECTION, 'a truncated reply MUST emit envelope.truncated')).toBeGreaterThanOrEqual(1);
    expect(o.run.status, req(ID_TRUNCATION, SECTION, `the call MUST complete once the retry returns valid output (got ${o.run.status}, ${o.run.errorCode ?? 'no code'})`)).toBe('completed');
  });

  it('when the repair budget runs out the node fails envelope_invalid after retry-exhausted and cap.breached schema', async () => {
    const g = await reliability();
    if ('skip' in g) return softSkip(...g.skip);
    const o = await drive('exhaustion');
    if ('skip' in o) return softSkip(...o.skip);
    expect(o.run.status, req(ID_EXHAUSTION, SECTION, 'a call whose every reply violates the schema MUST fail')).toBe('failed');
    expect(o.run.errorCode, req(ID_EXHAUSTION, SECTION, 'the node MUST fail with envelope_invalid')).toBe('envelope_invalid');
    expect(o.run.types.includes('envelope.retry-exhausted'), req(ID_EXHAUSTION, SECTION, 'exhaustion MUST emit envelope.retry-exhausted')).toBe(true);
    expect(o.run.capBreachedKinds.includes('schema'), req(ID_EXHAUSTION, SECTION, `exhaustion MUST emit cap.breached kind "schema" (got ${JSON.stringify(o.run.capBreachedKinds)})`)).toBe(true);
  });

  it('a refusal fails the node envelope_refusal after envelope.refusal and is never retried', async () => {
    const g = await reliability();
    if ('skip' in g) return softSkip(...g.skip);
    const o = await drive('refusal');
    if ('skip' in o) return softSkip(...o.skip);
    if (o.run.errorCode === 'validation_error') return softSkip('blocked', 'the host mock refused the `refusal` script kind as input (fixtures.md), so no refusal reached the call');
    expect(o.run.status, req(ID_REFUSAL, SECTION, `a refusal MUST fail the node, never fall through to the scripted valid reply (got ${o.run.status})`)).toBe('failed');
    expect(o.run.errorCode, req(ID_REFUSAL, SECTION, 'the node MUST fail with envelope_refusal')).toBe('envelope_refusal');
    expect(o.run.types.includes('envelope.refusal'), req(ID_REFUSAL, SECTION, 'a refusal MUST emit envelope.refusal')).toBe(true);
    expect(o.run.types.includes('envelope.retry-attempted'), req(ID_REFUSAL, SECTION, 'a host MUST NOT retry a refusal')).toBe(false);
  });
});
