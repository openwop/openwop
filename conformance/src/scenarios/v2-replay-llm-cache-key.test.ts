/**
 * v2 — LLM cache key recipe 2 (RFC 0260; the rules are the
 * `replay.llmCacheKeyRecipe` facet description in `spec/v2/facets/replay.schema.json`
 * and the `cacheKey` description in `schemas/v2/effect-ledger-projection.schema.json`).
 *
 * Server-free (always on):
 *   1. `0260.shape` — the effect-ledger record admits `cacheKey: {recipe, digest}`
 *      with a closed recipe vocabulary and a 64-hex digest, and refuses anything else.
 *
 * Host legs, unaided through the `conformance-llm-cache-key` fixture: its node makes
 * one `ctx.callAI` call through the host's conformance mock with the run's
 * `inputs.request` (prompt and params) unchanged. The suite reads the call's record
 * on `GET /runs/{runId}/effects` (idempotency.md §Witness), which is a normative
 * observation path, so no seam is needed:
 *   2. `0260.key-recorded`  — the record carries `cacheKey` with recipe `openwop-llm-key-2`
 *   3. `0260.params-in-key` — runs differing only in `maxTokens` have different digests
 *   4. `0260.key-stable`    — two identical runs have the same digest
 *   5. `0260.key-portable`  — the digest equals recipe 2 recomputed by the suite
 *                             (lib/llm-cache-key-2.ts) over the inputs the fixture pins
 *
 * Dispositions: `replay.llmCacheKeyRecipe` not advertised, `idempotency` absent, or the
 * fixture not listed ⇒ `inapplicable`. A run that cannot be created, read or finished,
 * or a ledger with no record for the node ⇒ `blocked`.
 *
 * @see RFCS/0260-llm-cache-key-recipe-2.md
 * @see spec/v2/core/replay.md §Suppression (the cache key for LLM-calling nodes)
 * @see conformance/fixtures.md §The LLM cache-key fixture
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { projectBoundId } from '../lib/bound-id.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import {
  RECIPE_2, FIXTURE, NODE_ID, fixtureInputs, readLedgerKey,
  judgeRecorded, judgeParamsInKey, judgeStable, judgePortable, type Finding, type LedgerKey, type NamedParam,
} from '../lib/llm-cache-key-2.js';

const DOC = 'replay facet llmCacheKeyRecipe + effect-ledger-projection cacheKey (RFC 0260)';
const R = (slug: string): string => `openwop.requirement.0260.${slug}`;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const PROMPT = 'Say ok.';
const PARAMS_A: Partial<Record<NamedParam, unknown>> = { maxTokens: 16, temperature: 0 };
const PARAMS_B: Partial<Record<NamedParam, unknown>> = { maxTokens: 32, temperature: 0 };

type Skip = readonly ['inapplicable' | 'blocked', string];
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const assertAll = (id: string, fs: readonly Finding[]): void => { for (const x of fs) expect(x.ok, req(id, DOC, x.message)).toBe(true); };

let disc: Promise<Record<string, unknown> | null> | undefined;
const discovery = (): Promise<Record<string, unknown> | null> => (disc ??= v2Discovery().catch(() => null));

async function gate(): Promise<Skip | null> {
  const doc = await discovery();
  if (!doc) return ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'];
  const replay = doc['replay'];
  if (!isRec(replay) || replay['llmCacheKeyRecipe'] !== RECIPE_2) return ['inapplicable', `the host does not advertise replay.llmCacheKeyRecipe "${RECIPE_2}" (absent ⇒ the RFC 0041 recipe, opt-in per RFC 0260)`];
  if (!isRec(doc['idempotency'])) return ['inapplicable', 'the host does not advertise idempotency, so it serves no effect ledger to read the key from'];
  if (!isFixtureAdvertised(FIXTURE)) return ['inapplicable', `the host does not advertise fixture ${FIXTURE}`];
  return null;
}

async function terminal(runId: string): Promise<string | null> {
  const deadline = Date.now() + scaledTimeoutMs(30_000);
  for (;;) {
    const snap = await http(() => driver.get(`/runs/${projectBoundId(runId)}`));
    const status = String((snap?.json as { status?: unknown } | undefined)?.status ?? '');
    if (TERMINAL.has(status)) return status;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** One fixture run with these params, and the key its provider-call record carries. Asserts nothing. */
async function keyed(params: Partial<Record<NamedParam, unknown>>): Promise<{ skip: Skip } | { key: LedgerKey | undefined }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: { request: { prompt: PROMPT, params } } }));
  const runId = (created?.json as { runId?: unknown } | undefined)?.runId;
  if (created === null || created.status !== 201 || typeof runId !== 'string') return { skip: ['blocked', `POST /runs {workflowId: ${FIXTURE}} answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim()] };
  const status = await terminal(runId);
  if (status !== 'completed') return { skip: ['blocked', `the ${FIXTURE} run ended ${status ?? 'not at all within the timeout'}, so its provider call is not on record`] };
  const ledger = await http(() => driver.get(`/runs/${projectBoundId(runId)}/effects`));
  if (ledger === null || ledger.status !== 200) return { skip: ['blocked', `GET /runs/{runId}/effects answered ${ledger?.status ?? 'nothing'} — idempotency.md §Witness owns that contract`] };
  const key = readLedgerKey(ledger.json, NODE_ID);
  if (key === 'no-record') return { skip: ['blocked', `the effect ledger has no record for node ${NODE_ID}: the host did not record the provider call as an effect (idempotency.md §Composition)`] };
  return { key };
}

const memo = new Map<string, ReturnType<typeof keyed>>();
const once = (name: 'a' | 'a2' | 'b'): ReturnType<typeof keyed> => {
  let p = memo.get(name);
  if (!p) { p = keyed(name === 'b' ? PARAMS_B : PARAMS_A); memo.set(name, p); }
  return p;
};

describe('v2 RFC 0260 — cacheKey wire shape (server-free)', () => {
  it('the effect-ledger record admits cacheKey {recipe, digest} and refuses anything else', () => {
    const v = v2RefValidator('effect-ledger-projection.schema.json');
    const base = { effectId: 'acme/0123456789abcdef', nodeId: 'llm-call', attempt: 1, keying: 'activity-recipe', state: 'completed', at: '2026-11-13T00:00:00Z' };
    const doc = (rec: Record<string, unknown>) => ({ runId: 'acme/0123456789abcdef', effects: [rec] });
    const digest = 'f1714d7aa2abf5994dd375f66aac14514b1c2439f203a6171dc6053c59f54402';
    expect(v(doc(base)).ok, req(R('shape'), DOC, 'a record without cacheKey MUST validate (the facet is opt-in)')).toBe(true);
    expect(v(doc({ ...base, cacheKey: { recipe: RECIPE_2, digest } })).ok, req(R('shape'), DOC, 'cacheKey {recipe: openwop-llm-key-2, digest: 64 hex} MUST validate')).toBe(true);
    expect(v(doc({ ...base, cacheKey: { recipe: 'spec-rfc-0041', digest } })).ok, req(R('shape'), DOC, 'an unregistered recipe MUST fail')).toBe(false);
    expect(v(doc({ ...base, cacheKey: { recipe: RECIPE_2, digest: digest.toUpperCase() } })).ok, req(R('shape'), DOC, 'an uppercase or short digest MUST fail')).toBe(false);
    expect(v(doc({ ...base, cacheKey: { recipe: RECIPE_2 } })).ok, req(R('shape'), DOC, 'digest is REQUIRED')).toBe(false);
    expect(v(doc({ ...base, cacheKey: { recipe: RECIPE_2, digest, preimage: '{}' } })).ok, req(R('shape'), DOC, 'cacheKey is closed: a preimage member MUST fail')).toBe(false);
  });
});

describe('v2 RFC 0260 — recipe 2 on the effect ledger (host)', () => {
  it('a host advertising replay.llmCacheKeyRecipe also advertises idempotency', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const replay = doc['replay'];
    if (!isRec(replay) || replay['llmCacheKeyRecipe'] === undefined) return softSkip('inapplicable', 'the host does not advertise replay.llmCacheKeyRecipe');
    expect(isRec(doc['idempotency']), req(R('implies-idempotency'), DOC, 'a host advertising replay.llmCacheKeyRecipe MUST advertise idempotency: the effect ledger is where the key is recorded')).toBe(true);
  });

  it('the provider-call record carries cacheKey with recipe openwop-llm-key-2', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const a = await once('a');
    if ('skip' in a) return softSkip(...a.skip);
    assertAll(R('key-recorded'), judgeRecorded(a.key));
  }, 120_000);

  it('two runs that differ only in maxTokens have different keys', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const a = await once('a');
    if ('skip' in a) return softSkip(...a.skip);
    const b = await once('b');
    if ('skip' in b) return softSkip(...b.skip);
    assertAll(R('params-in-key'), judgeParamsInKey(a.key, b.key));
  }, 120_000);

  it('two identical runs have the same key', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const a = await once('a');
    if ('skip' in a) return softSkip(...a.skip);
    const a2 = await once('a2');
    if ('skip' in a2) return softSkip(...a2.skip);
    assertAll(R('key-stable'), judgeStable(a.key, a2.key));
  }, 120_000);

  it('the key equals recipe 2 recomputed over the inputs the fixture pins', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const a = await once('a');
    if ('skip' in a) return softSkip(...a.skip);
    assertAll(R('key-portable'), judgePortable(a.key, fixtureInputs(PROMPT, PARAMS_A)));
  }, 120_000);
});
