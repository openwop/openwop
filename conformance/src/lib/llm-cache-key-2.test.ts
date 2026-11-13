/**
 * Self-tests for `llm-cache-key-2.ts` (RFC 0260). The recipe matches a pinned
 * known-answer vector, and each judge passes what a conforming host records and
 * FAILS each wrong answer: no cacheKey, the old recipe id, a digest that omits
 * `maxTokens` (the RFC 0041 recipe, which collides), an unstable key, and a key
 * computed over different inputs than the fixture pins.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJSON } from './jcs.js';
import {
  RECIPE_2, cacheKey2, keyPreimage, fixtureInputs, readLedgerKey,
  judgeRecorded, judgeParamsInKey, judgeStable, judgePortable, type Finding,
} from './llm-cache-key-2.js';

const failed = (fs: readonly Finding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const A = fixtureInputs('Say ok.', { maxTokens: 16, temperature: 0 });
const B = fixtureInputs('Say ok.', { maxTokens: 32, temperature: 0 });
const key = (i: typeof A) => ({ recipe: RECIPE_2, digest: cacheKey2(i) });

/** What RFC 0041's recipe hashes: no maxTokens, stop, seed or the other named parameters. */
const rfc0041 = (i: typeof A): string => createHash('sha256').update(canonicalJSON({
  model: i.model, provider: i.provider, messages: keyPreimage(i)['messages'], tools: [], temperature: i.params?.temperature ?? null, responseSchema: null,
}), 'utf8').digest('hex');

describe('llm-cache-key-2 — the recipe', () => {
  it('matches the pinned known-answer vector', () => {
    expect(canonicalJSON(keyPreimage(A))).toBe('{"messages":[{"content":[{"text":"Say ok.","type":"text"}],"role":"user"}],"model":"conformance-mock-1","params":{"frequencyPenalty":null,"maxTokens":16,"presencePenalty":null,"seed":null,"stop":null,"temperature":0,"topK":null,"topP":null},"provider":"conformance-mock","recipe":"openwop-llm-key-2","responseSchema":null,"toolChoice":null,"tools":[]}');
    expect(cacheKey2(A)).toBe('f1714d7aa2abf5994dd375f66aac14514b1c2439f203a6171dc6053c59f54402');
    expect(cacheKey2(B)).toBe('07e50afae3ca35d1bc0f52cab7c4bb55b46f8b82333d0a870d2b8dec3b85380b');
  });

  it('an unsent parameter is null, so it differs from a sent zero', () => {
    expect(cacheKey2(fixtureInputs('x', {}))).not.toBe(cacheKey2(fixtureInputs('x', { seed: 0 })));
  });

  it('stop is order- and duplicate-insensitive', () => {
    expect(cacheKey2(fixtureInputs('x', { stop: ['b', 'a', 'a'] }))).toBe(cacheKey2(fixtureInputs('x', { stop: ['a', 'b'] })));
  });

  it('a string content and its one-part array give the same key', () => {
    expect(cacheKey2({ ...A, messages: [{ role: 'user', content: [{ type: 'text', text: 'Say ok.' }] }] })).toBe(cacheKey2(A));
  });

  it('an extra parameter changes the key', () => {
    expect(cacheKey2(fixtureInputs('x', { extra: { logitBias: { '50256': -100 } } }))).not.toBe(cacheKey2(fixtureInputs('x', {})));
  });
});

describe('llm-cache-key-2 — judges', () => {
  it('pass a conforming host', () => {
    expect(failed(judgeRecorded(key(A)))).toEqual([]);
    expect(failed(judgeParamsInKey(key(A), key(B)))).toEqual([]);
    expect(failed(judgeStable(key(A), key(A)))).toEqual([]);
    expect(failed(judgePortable(key(A), A))).toEqual([]);
  });

  it('SABOTAGE: no cacheKey, or the old recipe id, fails key-recorded', () => {
    expect(failed(judgeRecorded(undefined)).length).toBeGreaterThan(0);
    expect(failed(judgeRecorded({ recipe: 'spec-rfc-0041', digest: cacheKey2(A) }))).toHaveLength(1);
    expect(failed(judgeRecorded({ recipe: RECIPE_2, digest: 'F1714D7A' }))).toHaveLength(1);
  });

  it('SABOTAGE: the RFC 0041 recipe collides on maxTokens and fails params-in-key', () => {
    expect(rfc0041(A)).toBe(rfc0041(B));
    expect(failed(judgeParamsInKey({ recipe: RECIPE_2, digest: rfc0041(A) }, { recipe: RECIPE_2, digest: rfc0041(B) }))).toHaveLength(1);
  });

  it('SABOTAGE: a key that includes a per-run nonce fails key-stable', () => {
    expect(failed(judgeStable(key(A), { recipe: RECIPE_2, digest: cacheKey2({ ...A, params: { ...A.params, extra: { requestId: 'r2' } } }) }))).toHaveLength(1);
  });

  it('SABOTAGE: a key over other inputs (a different model id) fails key-portable', () => {
    expect(failed(judgePortable({ recipe: RECIPE_2, digest: cacheKey2({ ...A, model: 'mock-mini' }) }, A))).toHaveLength(1);
  });

  it('readLedgerKey finds the node record, and says when there is none', () => {
    expect(readLedgerKey({ effects: [{ nodeId: 'llm-call', cacheKey: key(A) }] }, 'llm-call')).toEqual(key(A));
    expect(readLedgerKey({ effects: [{ nodeId: 'other' }] }, 'llm-call')).toBe('no-record');
    expect(readLedgerKey({ effects: [{ nodeId: 'llm-call' }] }, 'llm-call')).toBeUndefined();
    expect(readLedgerKey(null, 'llm-call')).toBe('no-record');
  });
});
