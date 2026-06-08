/**
 * Agent verifier turn + convergence criteria (RFC 0090).
 *
 * Always-on, server-free schema-shape probe. Verifies:
 *   - the `agentVerified` payload $def validates a content-free verdict and
 *     rejects an out-of-enum `verdict` and a content-carrying payload
 *     (additionalProperties:false — `verifier-no-content-leak`);
 *   - `agent.verified` appears in the RunEventType enum;
 *   - the `terminate` OrchestratorDecision accepts the additive `successCriteria`;
 *   - `capabilities.multiAgent.executionModel` accepts `version: 6` + the
 *     `verifier { supported, gating }` sub-block (and rejects version 7).
 *
 * Behavioral assertions (a `verifier.gating` host blocking a merge on `fail`)
 * are gated on `capabilities.multiAgent.executionModel.verifier.gating` and land
 * with a reference host (RFC 0090 §Conformance — deferred to Active → Accepted).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0090-agent-verifier-and-convergence.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const BASE = 'https://openwop.dev/spec/v1/';
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}
/** Register every corpus schema so relative cross-file $refs resolve. */
function newAjvWithCorpus(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMAS_DIR)) {
    if (f.endsWith('.schema.json')) {
      try {
        ajv.addSchema(loadSchema(f));
      } catch {
        /* duplicate/ignore */
      }
    }
  }
  return ajv;
}

describe('agent-verifier-shape: agent.verified payload (RFC 0090 §A, server-free)', () => {
  const ajv = newAjvWithCorpus();
  const verified = ajv.getSchema(`${BASE}run-event-payloads.schema.json#/$defs/agentVerified`);

  it('a conforming content-free verdict validates', () => {
    expect(verified, 'the agentVerified $def MUST exist').toBeTruthy();
    expect(
      verified!({ agentId: 'core.openwop.verifier', target: 'evt-42', verdict: 'pass', criteria: ['grounded'], confidence: 0.9 }),
      why('RFC 0090 §A', 'a conforming agent.verified payload MUST validate'),
    ).toBe(true);
  });

  it('rejects an out-of-enum verdict', () => {
    expect(verified!({ agentId: 'c', target: 'e', verdict: 'ok' }), why('RFC 0090 §A', 'verdict MUST be pass|fail|revise')).toBe(false);
  });

  it('rejects a content-carrying payload (verifier-no-content-leak)', () => {
    expect(
      verified!({ agentId: 'c', target: 'e', verdict: 'fail', result: 'the secret answer' }),
      why('RFC 0090 §SECURITY', 'agent.verified MUST be content-free (additionalProperties:false)'),
    ).toBe(false);
  });
});

describe('agent-verifier-shape: RunEventType + terminate + capability (RFC 0090)', () => {
  const ajv = newAjvWithCorpus();

  it('agent.verified is registered in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json') as { $defs?: { RunEventType?: { enum?: string[] } } };
    expect(
      runEvent.$defs?.RunEventType?.enum?.includes('agent.verified'),
      why('RFC 0090 §A', 'agent.verified MUST appear in the RunEventType enum'),
    ).toBe(true);
  });

  it('the terminate decision accepts the additive successCriteria', () => {
    const decision = ajv.getSchema(`${BASE}orchestrator-decision.schema.json`)!;
    expect(
      decision({ kind: 'terminate', reason: 'goal-reached', successCriteria: [{ key: 'goal-answered', met: true }] }),
      why('RFC 0090 §C', 'terminate MUST accept successCriteria[{key,met}]'),
    ).toBe(true);
    expect(
      decision({ kind: 'terminate', successCriteria: [{ key: 'x' }] }),
      why('RFC 0090 §C', 'a successCriteria entry MUST require both key and met'),
    ).toBe(false);
  });

  it('capabilities accepts executionModel.version 6 + verifier sub-block', () => {
    const execModel = ajv.getSchema(`${BASE}capabilities.schema.json#/properties/multiAgent/properties/executionModel`);
    expect(execModel, 'the executionModel sub-schema MUST exist').toBeTruthy();
    expect(
      execModel!({ supported: true, version: 6, verifier: { supported: true, gating: true } }),
      why('RFC 0090 §D', 'version:6 + verifier{supported,gating} MUST validate'),
    ).toBe(true);
    expect(execModel!({ supported: true, version: 7 }), why('RFC 0090 §D', 'version above the ceiling MUST be rejected')).toBe(false);
  });
});
