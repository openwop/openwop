/**
 * Self-tests for `proposal-pack-readback-witness.ts` (RFC 0253). Each judge
 * passes what a conforming host answers and FAILS each wrong answer: an
 * unapplied pack or agent served or listed, a minted id or missing version, a
 * read-back that dropped, added or re-synthesized a field, a forbidden artifact
 * that installed, and an equal-version install that was accepted.
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from './v2.js';
import type { Exchange, ProposalFinding } from './proposal-lifecycle-witness.js';
import {
  agentIdOf, freshAgentPack, freshChainPack, judgeInstallConflict, judgePackApplied, judgePackInert,
  judgePackReadback, judgePackRefused, judgePackRefusedAtSubmit, packMatches,
} from './proposal-pack-readback-witness.js';

const failed = (fs: readonly ProposalFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const ex = (status: number, json: unknown = {}): Exchange => ({ status, json });
const err = (status: number, code: string, details?: Record<string, unknown>): Exchange => ex(status, { error: code, message: code, ...(details ? { details } : {}) });
const C = freshChainPack('n1', 'original');
const C2 = { ...C, description: 'revised' };
const A = freshAgentPack('n1', 'You triage.');
const AID = agentIdOf(A);

describe('the fresh artifacts', () => {
  it('validate against their manifest schemas and comply with §D', () => {
    expect(v2Validator('workflow-chain-pack-manifest')(C).ok).toBe(true);
    expect(v2Validator('node-pack-manifest')(A).ok).toBe(true);
    expect(String(C['name'])).toMatch(/^private\./);
    expect(String(A['name'])).toMatch(/^private\./);
    expect(AID).toBe(`${String(A['name'])}.triage`);
  });
});

describe('packMatches', () => {
  it('is JCS equality with nothing host-owned', () => {
    expect(packMatches({ ...C2 }, C2)).toBe(true);
    expect(packMatches(JSON.parse(JSON.stringify(C2)), C2)).toBe(true);
    expect(packMatches({ ...C2, signing: { keyId: 'k', scheme: 'ed25519-canonical-json' } }, C2)).toBe(false);
    expect(packMatches({ ...C2, 'x-installedAt': '2026-10-31' }, C2)).toBe(false);
    const { description: _d, ...dropped } = C2 as Record<string, unknown>;
    expect(packMatches(dropped, C2)).toBe(false);
  });
});

describe('judgePackInert', () => {
  it('passes 404s and an absent agent; fails a served pack, a resolved agent, a listed agent', () => {
    const list = ex(200, { agents: [{ agentId: 'other' }], total: 1 });
    expect(failed(judgePackInert(ex(404)))).toEqual([]);
    expect(failed(judgePackInert(ex(404), { get: ex(404), list, agentId: AID }))).toEqual([]);
    expect(failed(judgePackInert(ex(200, C)))).toHaveLength(1);
    expect(failed(judgePackInert(ex(404), { get: ex(200), list, agentId: AID }))).toHaveLength(1);
    expect(failed(judgePackInert(ex(404), { get: ex(404), list: ex(200, { agents: [{ agentId: AID }], total: 1 }), agentId: AID }))).toHaveLength(1);
    expect(failed(judgePackInert(ex(404), { get: ex(404), list: ex(500), agentId: AID }))).toHaveLength(2);
  });
});

describe('judgePackApplied', () => {
  const ok = (kind: string, a: Record<string, unknown>) =>
    ex(200, { state: 'applied', activation: { installedArtifact: { kind, operationId: 'getInstalledPack', id: a['name'], version: a['version'] } } });
  it('passes the artifact name and version; fails a minted id, a missing version, the wrong read, an unresolved agent', () => {
    expect(failed(judgePackApplied(ok('workflow-chain-pack', C2), 'workflow-chain-pack', C2))).toEqual([]);
    expect(failed(judgePackApplied(ok('agent-pack', A), 'agent-pack', A, ex(200)))).toEqual([]);
    const minted = ex(200, { state: 'applied', activation: { installedArtifact: { kind: 'agent-pack', operationId: 'getInstalledPack', id: 'pk_123', version: '1.0.0' } } });
    expect(failed(judgePackApplied(minted, 'agent-pack', A))).toHaveLength(1);
    const noVersion = ex(200, { state: 'applied', activation: { installedArtifact: { kind: 'agent-pack', operationId: 'getInstalledPack', id: A['name'] } } });
    expect(failed(judgePackApplied(noVersion, 'agent-pack', A))).toHaveLength(1);
    const viaAgent = ex(200, { state: 'applied', activation: { installedArtifact: { kind: 'agent-pack', operationId: 'getAgent', id: AID, version: '1.0.0' } } });
    expect(failed(judgePackApplied(viaAgent, 'agent-pack', A))).toHaveLength(2);
    expect(failed(judgePackApplied(ok('agent-pack', A), 'agent-pack', A, ex(404)))).toHaveLength(1);
    expect(failed(judgePackApplied(ex(202, { runId: 'r' }), 'agent-pack', A))).toHaveLength(4);
  });
});

describe('judgePackReadback', () => {
  it('passes the revision; fails a 404, the original, and a host-added field', () => {
    expect(failed(judgePackReadback(ex(200, C2), C2, C))).toEqual([]);
    expect(failed(judgePackReadback(ex(404), C2, C))).toHaveLength(3);
    expect(failed(judgePackReadback(ex(200, C), C2, C))).toHaveLength(2);
    expect(failed(judgePackReadback(ex(200, { ...C2, 'x-source': 'proposal' }), C2, C))).toHaveLength(1);
  });
});

describe('judgePackRefused / judgePackRefusedAtSubmit', () => {
  it('passes 422 with nothing installed; fails an install, a state change, a 409', () => {
    expect(failed(judgePackRefused('ref', err(422, 'validation_error'), ex(200, { state: 'draft' }), ex(404), ex(404)))).toEqual([]);
    expect(failed(judgePackRefused('ref', ex(200, { state: 'applied' }), ex(200, { state: 'applied' }), ex(200), ex(200)))).toHaveLength(4);
    expect(failed(judgePackRefused('ref', err(409, 'proposal_install_conflict'), ex(200, { state: 'draft' }), ex(404)))).toHaveLength(1);
  });
  it('accepts a refusal at submit only when nothing installed', () => {
    expect(failed(judgePackRefusedAtSubmit('ref', err(422, 'validation_error'), ex(404)))).toEqual([]);
    expect(failed(judgePackRefusedAtSubmit('ref', err(400, 'validation_error'), ex(404)))).toEqual([]);
    expect(failed(judgePackRefusedAtSubmit('ref', ex(201), ex(404)))).toHaveLength(1);
    expect(failed(judgePackRefusedAtSubmit('ref', err(422, 'validation_error'), ex(200)))).toHaveLength(1);
  });
});

describe('judgeInstallConflict', () => {
  it('passes 409 version-not-greater with state unchanged; fails a replace, the wrong reason, a state change', () => {
    expect(failed(judgeInstallConflict(err(409, 'proposal_install_conflict', { reason: 'version-not-greater' }), ex(200, { state: 'draft' })))).toEqual([]);
    expect(failed(judgeInstallConflict(ex(200, { state: 'applied' }), ex(200, { state: 'applied' })))).toHaveLength(3);
    expect(failed(judgeInstallConflict(err(409, 'proposal_install_conflict', { reason: 'read-only' }), ex(200, { state: 'draft' })))).toHaveLength(1);
  });
});
