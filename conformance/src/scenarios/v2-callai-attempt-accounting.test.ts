/**
 * v2 — `ctx.callAI` reports its provider attempts and takes a per-call retry
 * policy (RFC 0248; the rules are the `aiProviders.callAccounting` facet
 * descriptions in `spec/v2/facets/aiProviders.schema.json`).
 *
 * Unaided, through the `conformance-callai-attempt-accounting` fixture: its
 * node makes one `ctx.callAI` call, the host's conformance mock serves the
 * case's script, and the node echoes `attempts`. The suite wrote the script,
 * and `provider.usage` (one per provider invocation, `events.md`
 * §`providerUsage`) corroborates it where advertised. Judges in
 * `lib/callai-attempts-witness.ts`.
 *
 *   attempts-count / output-tokens-sum  invalid then valid → the count and the
 *                                       summed tokens match the script and log
 *   usage-incomplete                    a reply with no usage → usageComplete false
 *   structured-output                   absent without responseSchema; "native"
 *                                       when the mock declares it
 *   attempts-replayed                   a replay fork reproduces attempts
 *   max-attempts-cap                    maxAttempts 1, invalid first reply → fails
 *                                       after one request
 *   no-budget-growth                    growMaxTokens false → the over-budget
 *                                       reply stays truncated
 *   retry-malformed-refused             maxAttempts 0 → validation_error,
 *                                       details.field retry.maxAttempts
 *
 * Dispositions: the flag not advertised, or the fixture not listed ⇒
 * `inapplicable`. A run that cannot be created or read, or a count run that
 * failed because the host does not retry a schema violation ⇒ `blocked`.
 *
 * @see RFCS/0248-callai-attempt-accounting-and-retry-policy.md
 * @see conformance/fixtures.md §The ctx.callAI attempt-accounting fixture
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { forkDeclined } from '../lib/fork-availability.js';
import {
  CASES, runCase, replayOf, judgeCount, judgeSum, judgeIncomplete, judgeStructuredOutput, judgeCap, judgeNoGrowth, judgeMalformed, judgeReplayed,
  type CaseName, type CaseRun, type Drive, type Finding,
} from '../lib/callai-attempts-witness.js';

const ID_COUNT = 'openwop.requirement.0248.attempts-count';
const ID_SUM = 'openwop.requirement.0248.output-tokens-sum';
const ID_INCOMPLETE = 'openwop.requirement.0248.usage-incomplete';
const ID_STRUCTURED = 'openwop.requirement.0248.structured-output';
const ID_REPLAYED = 'openwop.requirement.0248.attempts-replayed';
const ID_CAP = 'openwop.requirement.0248.max-attempts-cap';
const ID_GROWTH = 'openwop.requirement.0248.no-budget-growth';
const ID_MALFORMED = 'openwop.requirement.0248.retry-malformed-refused';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

type Skip = readonly ['inapplicable' | 'blocked', string];
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

let disc: Promise<Record<string, unknown> | null> | undefined;
const discovery = (): Promise<Record<string, unknown> | null> => (disc ??= v2Discovery().catch(() => null));

async function gate(flag: 'attempts' | 'retryPolicy'): Promise<{ skip: Skip } | { usageEvents: boolean }> {
  const doc = await discovery();
  if (!doc) return { skip: ['blocked', UNREADABLE] };
  const ai = doc['aiProviders'];
  const acct = isRec(ai) && isRec(ai['callAccounting']) ? ai['callAccounting'] : undefined;
  if (acct?.[flag] !== true) return { skip: ['inapplicable', `the host does not advertise aiProviders.callAccounting.${flag}`] };
  return { usageEvents: isRec(doc['providerUsage']) };
}

const runs = new Map<CaseName, Promise<Drive>>();
const once = (name: CaseName): Promise<Drive> => { let p = runs.get(name); if (!p) { p = runCase(name); runs.set(name, p); } return p; };

async function observed(flag: 'attempts' | 'retryPolicy', name: CaseName): Promise<{ skip: Skip } | { run: CaseRun; usageEvents: boolean }> {
  const g = await gate(flag);
  if ('skip' in g) return g;
  const d = await once(name);
  if (d.kind === 'skip') return { skip: [d.disposition, d.reason] };
  return { run: d.run, usageEvents: g.usageEvents };
}

/** The count run, or why it cannot be judged: a host that does not retry a schema violation fails the call and has no result to read. */
async function countRun(): Promise<{ skip: Skip } | { run: CaseRun; usageEvents: boolean }> {
  const o = await observed('attempts', 'count');
  if ('skip' in o) return o;
  if (o.run.status === 'failed') return { skip: ['blocked', `the count call failed (${o.run.errorCode ?? 'no code'}): the host did not retry the scripted schema violation, so no multi-attempt result exists to read`] };
  return o;
}

const assertAll = (id: string, fs: readonly Finding[]): void => { for (const x of fs) expect(x.ok, req(id, x.doc, x.message)).toBe(true); };

describe('v2 RFC 0248 — ctx.callAI attempt accounting (§A)', () => {
  it('attempts.count equals the provider requests the call made', async () => {
    const o = await countRun();
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_COUNT, judgeCount(o.run, o.usageEvents));
  }, 180_000);

  it('attempts.outputTokens is the sum over every attempt, and usageComplete is true when all reported', async () => {
    const o = await countRun();
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_SUM, judgeSum(o.run, CASES.count, o.usageEvents));
  }, 180_000);

  it('an attempt that reported no usage makes usageComplete false', async () => {
    const o = await observed('attempts', 'incomplete');
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_INCOMPLETE, judgeIncomplete(o.run));
  }, 180_000);

  it('structuredOutput is absent without responseSchema and names the mode the final attempt used', async () => {
    const p = await observed('attempts', 'plain');
    if ('skip' in p) return softSkip(...p.skip);
    const n = await observed('attempts', 'native');
    if ('skip' in n) return softSkip(...n.skip);
    assertAll(ID_STRUCTURED, judgeStructuredOutput(p.run, n.run));
  }, 180_000);

  it('a replay fork reproduces the recorded attempts', async () => {
    const o = await countRun();
    if ('skip' in o) return softSkip(...o.skip);
    const doc = await discovery();
    const modes = isRec(doc?.['replay']) && Array.isArray((doc['replay'] as Record<string, unknown>)['modes']) ? ((doc['replay'] as Record<string, unknown>)['modes'] as unknown[]) : [];
    if (!modes.includes('replay')) return softSkip('inapplicable', 'the host does not advertise replay.modes including "replay"');
    const fork = await replayOf(o.run);
    if (typeof fork === 'string') return softSkip('blocked', fork);
    if ('declined' in fork) { forkDeclined(fork.declined, 'v2-callai-attempt-accounting replay'); return softSkip('blocked', `POST /runs/{runId}:fork declined with ${fork.declined}`); }
    assertAll(ID_REPLAYED, judgeReplayed(o.run, fork.run));
  }, 240_000);
});

describe('v2 RFC 0248 — ctx.callAI retry policy (§B)', () => {
  it('maxAttempts caps the provider requests', async () => {
    const o = await observed('retryPolicy', 'cap');
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_CAP, judgeCap(o.run, o.usageEvents));
  }, 180_000);

  it('growMaxTokens false keeps every attempt within the request budget', async () => {
    const o = await observed('retryPolicy', 'growth');
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_GROWTH, judgeNoGrowth(o.run, o.usageEvents));
  }, 180_000);

  it('a malformed retry policy is refused validation_error naming the key', async () => {
    const o = await observed('retryPolicy', 'malformed');
    if ('skip' in o) return softSkip(...o.skip);
    assertAll(ID_MALFORMED, judgeMalformed(o.run));
  }, 180_000);
});
