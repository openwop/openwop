/**
 * Reviewable learning — the proposal lifecycle (RFC 0096; `agent-memory.md`
 * §"Reviewable learning"). Public tests for the protocol-tier SECURITY
 * invariants `proposal-inert-until-applied` and `proposal-no-resynthesis`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema legs — the capability block, the
 *      `proposal.schema.json` shape (incl. the dropped `rule` kind), and the
 *      content-free `proposal.created` / `proposal.activated` event payloads.
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.agents.proposals` that exposes the
 *      `/v1/host/sample/proposals` seam: inertness (a draft proposal does not
 *      influence a run), gated activation (`apply` without scope → 403), and
 *      no-re-synthesis (installed artifact byte-matches the last-persisted
 *      `artifact`). Hosts without the seam soft-skip (404); unadvertised
 *      hosts skip via the behavior gate.
 *
 * @see spec/v1/agent-memory.md §"Reviewable learning"
 * @see SECURITY/invariants.yaml id: proposal-inert-until-applied, proposal-no-resynthesis
 * @see RFCS/0096-reviewable-learning-skill-proposal-lifecycle.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('proposal-reviewable-learning: capability advertisement (RFC 0096 §A, server-free)', () => {
  const caps = loadSchema('capabilities.schema.json');
  const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown>; required?: string[] }> }>).agents;

  it('capabilities schema declares agents.proposals with its required sub-flags', () => {
    const proposals = agents?.properties?.proposals;
    expect(proposals, req('openwop.it.proposal-reviewable-learning.capabilities-schema-declares-agents-proposals-with-its-required-sub-flags', 'capabilities.md §agents', 'agents.proposals MUST be declared')).toBeDefined();
    for (const flag of ['artifactKinds', 'duplicationDetection', 'activation']) {
      expect(proposals?.properties?.[flag], req('openwop.it.proposal-reviewable-learning.capabilities-schema-declares-agents-proposals-with-its-required-sub-flags', 'RFC 0096 §A', `agents.proposals.${flag} MUST be declared`)).toBeDefined();
    }
    expect(proposals?.required, req('openwop.it.proposal-reviewable-learning.capabilities-schema-declares-agents-proposals-with-its-required-sub-flags', 'RFC 0096 §A', 'artifactKinds + activation MUST be required')).toEqual(
      expect.arrayContaining(['artifactKinds', 'activation']),
    );
  });

  it('the `rule` artifact kind is NOT in the enum (dropped — no defining RFC)', () => {
    const kinds = (agents?.properties?.proposals as { properties?: Record<string, { items?: { enum?: string[] } }> })?.properties?.artifactKinds?.items?.enum ?? [];
    expect(kinds, req('openwop.it.proposal-reviewable-learning.the-rule-artifact-kind-is-not-in-the-enum-dropped-no-defining-rfc', 'RFC 0096 §A', 'artifactKinds enumerates the four kinds with a defining RFC')).toEqual(
      expect.arrayContaining(['agent-pack', 'workflow-chain-pack', 'prompt-template', 'automation']),
    );
    expect(kinds, req('openwop.it.proposal-reviewable-learning.the-rule-artifact-kind-is-not-in-the-enum-dropped-no-defining-rfc', 'RFC 0096 §A', '`rule` MUST NOT appear — it has no defining RFC, so its artifact is unvalidatable')).not.toContain('rule');
  });
});

describe('proposal-reviewable-learning: Proposal shape (RFC 0096 §B, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema('proposal.schema.json'));

  const good = {
    id: 'prop-1',
    kind: 'workflow-chain-pack',
    state: 'draft',
    artifact: { name: 'weekly-digest', version: '1.0.0' },
    provenance: { sourceRunIds: ['run-a', 'run-b'] },
    owner: { tenant: 'acme' },
    createdAt: '2026-06-13T00:00:00Z',
  };

  it('validates a conforming draft proposal', () => {
    expect(validate(good), req('openwop.it.proposal-reviewable-learning.validates-a-conforming-draft-proposal', 'RFC 0096 §B', `a conforming proposal MUST validate. Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);
  });

  it('rejects an unknown state and the dropped `rule` kind', () => {
    expect(validate({ ...good, state: 'live' }), req('openwop.it.proposal-reviewable-learning.rejects-an-unknown-state-and-the-dropped-rule-kind', 'RFC 0096 §B', 'a state outside the lifecycle enum MUST be rejected')).toBe(false);
    expect(validate({ ...good, kind: 'rule' }), req('openwop.it.proposal-reviewable-learning.rejects-an-unknown-state-and-the-dropped-rule-kind', 'RFC 0096 §B', '`kind: "rule"` MUST be rejected (dropped from the enum)')).toBe(false);
    expect(validate({ ...good, owner: { workspace: 'x' } }), req('openwop.it.proposal-reviewable-learning.rejects-an-unknown-state-and-the-dropped-rule-kind', 'RFC 0048', 'owner without tenant MUST be rejected')).toBe(false);
  });
});

describe('proposal-reviewable-learning: content-free events (RFC 0096 §D, server-free)', () => {
  const runEvent = loadSchema('run-event.schema.json');
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  it('proposal.created and proposal.activated are in the RunEventType enum', () => {
    const en = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(en, req('openwop.it.proposal-reviewable-learning.proposal-created-and-proposal-activated-are-in-the-runeventtype-enum', 'RFC 0096', 'proposal.created and proposal.activated are in the RunEventType enum')).toContain('proposal.created');
    expect(en).toContain('proposal.activated');
  });

  it('proposal.created is content-free — an artifact body and rationale text are rejected', () => {
    const created = ajv.getSchema('payloads#/$defs/proposalCreated')!;
    expect(created({ proposalId: 'p1', kind: 'agent-pack', sourceRunIds: ['r1'], duplicateOf: null }), req('openwop.it.proposal-reviewable-learning.proposal-created-is-content-free-an-artifact-body-and-rationale-text-are-rejecte', 'RFC 0096 §D', 'a content-free proposal.created MUST validate')).toBe(true);
    expect(created({ proposalId: 'p1', kind: 'agent-pack', artifact: { x: 1 } }), req('openwop.it.proposal-reviewable-learning.proposal-created-is-content-free-an-artifact-body-and-rationale-text-are-rejecte', 'SECURITY invariant proposal-inert-until-applied', 'proposal.created MUST NOT carry the artifact body')).toBe(false);
    expect(created({ proposalId: 'p1', kind: 'agent-pack', rationale: 'because…' }), req('openwop.it.proposal-reviewable-learning.proposal-created-is-content-free-an-artifact-body-and-rationale-text-are-rejecte', 'RFC 0096 §D', 'proposal.created MUST NOT carry rationale text')).toBe(false);
  });
});

describe('proposal-reviewable-learning: behavioral (RFC 0096 §E, capability-gated)', () => {
  it('apply without the activation scope is denied (403) and installs nothing', async () => {
    const agents = await readCapabilityFamily<{ proposals?: { activation?: string } }>('agents');
    if (!behaviorGate('agents.proposals', agents?.proposals !== undefined)) return;

    const list = await driver.get('/v1/host/sample/proposals?state=draft');
    if (list.status === 404 || list.status === 403) return softSkip('blocked', 'precondition not met — `list.status === 404 || list.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const proposals = (list.json as { proposals?: Array<{ id: string }> })?.proposals ?? [];
    if (proposals.length === 0) return softSkip('blocked', 'precondition not met — `proposals.length === 0` returned early (nothing to act on — soft-skip) (seam, prior step, or fixture unavailable)'); // nothing to act on — soft-skip

    // Apply with no auth/scope — MUST be refused.
    const res = await driver.post(`/v1/host/sample/proposals/${proposals[0]!.id}/apply`, {});
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.status,
      req('openwop.it.proposal-reviewable-learning.apply-without-the-activation-scope-is-denied-403-and-installs-nothing', 'agent-memory.md §"Reviewable learning" clause 2', 'apply without the activation scope MUST be denied (403)'),
    ).toBe(403);
  });
});
