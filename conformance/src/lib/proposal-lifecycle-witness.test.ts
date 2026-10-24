/**
 * Self-tests for `proposal-lifecycle-witness.ts` (RFC 0249). Each judge passes
 * what a conforming host answers and FAILS each wrong answer: a draft served or
 * listed before apply, an unscoped or stale apply that installs, a hash passed
 * off as an install (the RFC 0096 correction), a minted id, a re-synthesized
 * install, a terminal proposal revised, and a foreign proposal that answers
 * differently from an unknown id.
 */

import { describe, it, expect } from 'vitest';
import {
  artifactDigest, byteMatches, freshTemplate, judgeApplied, judgeApplyStale, judgeApplyUnscoped, judgeForeign,
  judgeInert, judgeReadback, judgeRevised, judgeSubmitKindRefused, judgeTerminal, type Exchange, type ProposalFinding,
} from './proposal-lifecycle-witness.js';

const failed = (fs: readonly ProposalFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const ex = (status: number, json: unknown = {}): Exchange => ({ status, json });
const err = (status: number, code: string, details?: Record<string, unknown>): Exchange => ex(status, { error: { code, message: code, ...(details ? { details } : {}) } });
const T = freshTemplate('n1', 'original text');
const T2 = { ...T, text: 'revised text' };
const ID = T['templateId'] as string;

describe('digest and byte-match', () => {
  it('the digest is JCS-ordered and sha256-prefixed', () => {
    expect(artifactDigest({ b: 1, a: 2 })).toBe(artifactDigest({ a: 2, b: 1 }));
    expect(artifactDigest(T)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(artifactDigest(T)).not.toBe(artifactDigest(T2));
  });
  it('meta is host-owned on both sides; any other field is compared', () => {
    expect(byteMatches({ ...T2, meta: { source: 'user', createdAt: 'x' } }, T2)).toBe(true);
    expect(byteMatches({ ...T2, name: 'added by host' }, T2)).toBe(false);
  });
});

describe('judgeSubmitKindRefused', () => {
  it('passes 400 validation_error naming kind; fails a 201 and a wrong field', () => {
    expect(failed(judgeSubmitKindRefused(err(400, 'validation_error', { field: 'kind' })))).toEqual([]);
    expect(failed(judgeSubmitKindRefused(ex(201)))).toHaveLength(2);
    expect(failed(judgeSubmitKindRefused(err(400, 'validation_error', { field: 'artifact' })))).toHaveLength(1);
  });
});

describe('judgeInert', () => {
  const list = ex(200, { items: [{ templateId: 'other' }] });
  it('passes 404 / unlisted / render refused', () => {
    expect(failed(judgeInert(ex(404), list, ex(404), ID, 'draft'))).toEqual([]);
  });
  it('fails a draft served, listed or rendered before apply', () => {
    expect(failed(judgeInert(ex(200, T), list, ex(404), ID, 'draft'))).toHaveLength(1);
    expect(failed(judgeInert(ex(404), ex(200, { items: [T] }), ex(404), ID, 'draft'))).toHaveLength(1);
    expect(failed(judgeInert(ex(404), list, ex(200, { rendered: 'x' }), ID, 'draft'))).toHaveLength(1);
  });
});

describe('judgeRevised', () => {
  it('passes the revised digest; fails a stale digest', () => {
    expect(failed(judgeRevised(ex(200, { state: 'revised', artifactDigest: artifactDigest(T2) }), T2))).toEqual([]);
    expect(failed(judgeRevised(ex(200, { state: 'revised', artifactDigest: artifactDigest(T) }), T2))).toHaveLength(1);
  });
});

describe('judgeApplyUnscoped / judgeApplyStale', () => {
  const revised = ex(200, { state: 'revised' });
  it('passes refusals that install nothing', () => {
    expect(failed(judgeApplyUnscoped(err(403, 'forbidden'), revised, ex(404), 'Bearer error="insufficient_scope", scope="proposals:apply"'))).toEqual([]);
    expect(failed(judgeApplyStale(err(409, 'proposal_stale'), revised, ex(404)))).toEqual([]);
  });
  it('fails an unscoped apply that installs, and a 403 with no challenge', () => {
    expect(failed(judgeApplyUnscoped(ex(200, { state: 'applied' }), ex(200, { state: 'applied' }), ex(200, T2), null))).toHaveLength(4);
    expect(failed(judgeApplyUnscoped(err(403, 'forbidden'), revised, ex(404), null))).toHaveLength(1);
  });
  it('fails a stale apply that installs the old bytes', () => {
    expect(failed(judgeApplyStale(ex(200, { state: 'applied' }), ex(200, { state: 'applied' }), ex(200, T)))).toHaveLength(3);
  });
});

describe('judgeApplied', () => {
  const ok = (ia: Record<string, unknown>) => ex(200, { state: 'applied', activation: { installedArtifact: ia } });
  it('passes the resolvable read-back', () => {
    expect(failed(judgeApplied(ok({ kind: 'prompt-template', operationId: 'getPromptTemplate', id: ID }), ID))).toEqual([]);
  });
  it('fails the hash-as-install answer RFC 0096 was corrected for, and a minted id', () => {
    expect(failed(judgeApplied(ex(200, { state: 'applied', activation: { installedArtifactRef: 'installed:prompt-template:x:abc123' } }), ID))).toHaveLength(2);
    expect(failed(judgeApplied(ok({ kind: 'prompt-template', operationId: 'getPromptTemplate', id: 'host-minted-7' }), ID))).toHaveLength(1);
  });
});

describe('judgeReadback', () => {
  it('passes the revised bytes with host meta', () => {
    expect(failed(judgeReadback(ex(200, { ...T2, meta: { source: 'user' } }), T2, T))).toEqual([]);
  });
  it('fails a re-synthesized install (the original bytes) and no install', () => {
    expect(failed(judgeReadback(ex(200, T), T2, T))).toHaveLength(2);
    expect(failed(judgeReadback(ex(404), T2, T))).toHaveLength(3);
  });
});

describe('judgeTerminal', () => {
  it('passes 409 proposal_state_conflict naming applied; fails a revise that succeeds', () => {
    const c = err(409, 'proposal_state_conflict', { state: 'applied', action: 'revise' });
    expect(failed(judgeTerminal(c, c))).toEqual([]);
    expect(failed(judgeTerminal(ex(200, { state: 'revised' }), c))).toHaveLength(2);
  });
});

describe('judgeForeign', () => {
  it('passes identical 404s; fails a 403 oracle and a differing code', () => {
    const nf = err(404, 'not_found');
    expect(failed(judgeForeign([{ what: 'getProposal', foreign: nf, unknown: nf }]))).toEqual([]);
    expect(failed(judgeForeign([{ what: 'getProposal', foreign: err(403, 'id_tenant_mismatch'), unknown: nf }]))).toHaveLength(2);
    expect(failed(judgeForeign([{ what: 'getProposal', foreign: err(404, 'proposal_not_found'), unknown: nf }]))).toHaveLength(1);
  });
});
