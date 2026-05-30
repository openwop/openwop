/**
 * Agent deployment lifecycle — record + binding + event shapes (RFC 0082).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.deployment` is declared with its `supported` /
 *     `channels` / `canary` / `rollback` / `states` sub-flags.
 *   - `agent-deployment.schema.json` compiles and round-trips a conforming
 *     deployment record, and rejects malformed ones (an out-of-enum `state`;
 *     `canaryPercent` out of 0..100).
 *   - the `AgentRef` `channel` XOR `version` rule holds: each alone (and
 *     neither) validates; both together is rejected (the `not` clause).
 *   - the four `deployment.*` payload $defs validate conforming content-free
 *     payloads and reject malformed ones.
 *   - the four `deployment.*` payloads are CONTENT-FREE: a `deployment.promoted`
 *     carrying a `manifestBody`, and a `deployment.state.changed` carrying a
 *     `prompt`, are rejected (`additionalProperties:false`). This is the public
 *     test for the protocol-tier SECURITY invariant `deployment-event-no-content-leak`.
 *   - `agent.invocation.started` carries the additive recorded-fact
 *     `resolvedAgentVersion` / `resolvedChannel` fields (RFC 0082 §B).
 *   - all four event names appear in the RunEventType enum.
 *
 * Behavioral assertions (the authz → approvalGate → eval-verify → promotion path,
 * the fail-closed denial, the §B replay re-read of `resolvedAgentVersion`) are
 * gated on `capabilities.agents.deployment.supported` and land in
 * `agent-deployment-lifecycle.test.ts` (deferred per RFC 0082 §Conformance —
 * reference host deferred). This scenario asserts the wire contract, not host
 * behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-deployment.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0082-agent-deployment-lifecycle.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (deployment-event-no-content-leak)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

/** Server-free assertion-message helper. */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-deployment-shape: capability advertisement (RFC 0082, server-free)', () => {
  it('the capabilities schema declares agents.deployment with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).agents;
    const deployment = agents?.properties?.deployment;
    expect(deployment, why('capabilities.md §agents', 'agents.deployment MUST be declared')).toBeDefined();
    for (const flag of ['supported', 'channels', 'canary', 'rollback', 'states']) {
      expect(
        deployment?.properties?.[flag],
        why('agent-deployment.md §F', `agents.deployment.${flag} MUST be declared`),
      ).toBeDefined();
    }
  });
});

describe('agent-deployment-shape: deployment record + AgentRef binding (RFC 0082, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const record = ajv.compile(loadSchema('agent-deployment.schema.json'));
  const agentRef = ajv.compile(loadSchema('agent-ref.schema.json'));

  it('AgentDeployment validates a conforming record and rejects a bad state / out-of-range canary', () => {
    const good = { agentId: 'core.openwop.agents.support-resolver', version: '2.4.0', state: 'active', canaryPercent: 10, channels: ['stable'] };
    expect(record(good), why('RFC 0082 §C', 'a conforming deployment record MUST validate')).toBe(true);
    expect(record({ ...good, state: 'live' }), why('RFC 0082 §C', 'an out-of-enum state MUST be rejected')).toBe(false);
    expect(record({ ...good, canaryPercent: 150 }), why('RFC 0082 §C', 'canaryPercent > 100 MUST be rejected')).toBe(false);
  });

  it('AgentRef channel XOR version: each alone and neither validate; both is rejected (RFC 0082 §A)', () => {
    expect(agentRef({ agentId: 'core.x.y.z', version: '1.0.0' }), why('RFC 0082 §A', 'version-only AgentRef MUST validate')).toBe(true);
    expect(agentRef({ agentId: 'core.x.y.z', channel: 'stable' }), why('RFC 0082 §A', 'channel-only AgentRef MUST validate')).toBe(true);
    expect(agentRef({ agentId: 'core.x.y.z' }), why('RFC 0082 §A', 'a ref with neither version nor channel MUST validate (host default)')).toBe(true);
    expect(agentRef({ agentId: 'core.x.y.z', version: '1.0.0', channel: 'stable' }), why('RFC 0082 §A', 'a ref with BOTH version and channel MUST be rejected')).toBe(false);
  });
});

describe('agent-deployment-shape: deployment.* event payloads (RFC 0082, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  const promoted = ajv.getSchema('payloads#/$defs/deploymentPromoted');
  const rolledBack = ajv.getSchema('payloads#/$defs/deploymentRolledBack');
  const canary = ajv.getSchema('payloads#/$defs/deploymentCanaryAdjusted');
  const stateChanged = ajv.getSchema('payloads#/$defs/deploymentStateChanged');

  it('deployment.promoted validates a content-free promotion record and requires toVersion + toState', () => {
    expect(promoted, 'the deploymentPromoted $def MUST exist').toBeTruthy();
    expect(
      promoted!({ agentId: 'core.openwop.agents.support-resolver', toVersion: '2.4.0', toState: 'active', channel: 'stable', canaryPercent: 10, evalRunId: 'run_abc' }),
      why('RFC 0082 §D', 'a conforming deployment.promoted payload MUST validate'),
    ).toBe(true);
    expect(promoted!({ agentId: 'a' }), why('RFC 0082 §D', 'deployment.promoted without toVersion/toState MUST be rejected')).toBe(false);
  });

  it('deployment.rolled-back / canary.adjusted / state.changed validate conforming records', () => {
    expect(rolledBack!({ agentId: 'a', fromVersion: '2.4.0', toVersion: '2.3.1', rollbackPointer: '2.3.1' }), why('RFC 0082 §D', 'a conforming deployment.rolled-back MUST validate')).toBe(true);
    expect(canary!({ agentId: 'a', version: '2.4.0', fromPercent: 10, toPercent: 50 }), why('RFC 0082 §D', 'a conforming deployment.canary.adjusted MUST validate')).toBe(true);
    expect(stateChanged!({ agentId: 'a', version: '2.4.0', fromState: 'active', toState: 'paused' }), why('RFC 0082 §D', 'a conforming deployment.state.changed MUST validate')).toBe(true);
    expect(stateChanged!({ agentId: 'a', version: '2.4.0', fromState: 'active', toState: 'live' }), why('RFC 0082 §D', 'an out-of-enum toState MUST be rejected')).toBe(false);
  });

  it('deployment.* events are content-free — a manifest body and a prompt are rejected (deployment-event-no-content-leak)', () => {
    expect(
      promoted!({ agentId: 'a', toVersion: '2.4.0', toState: 'active', manifestBody: '{...}' }),
      why('SECURITY invariant deployment-event-no-content-leak', 'a deployment.promoted MUST NOT carry a manifest body'),
    ).toBe(false);
    expect(
      stateChanged!({ agentId: 'a', version: '2.4.0', fromState: 'active', toState: 'paused', prompt: 'system: …' }),
      why('SECURITY invariant deployment-event-no-content-leak', 'a deployment.state.changed MUST NOT carry prompt content'),
    ).toBe(false);
  });
});

describe('agent-deployment-shape: §B recorded-fact pin + enum (RFC 0082, server-free)', () => {
  it('agent.invocation.started carries the additive recorded-fact resolvedAgentVersion / resolvedChannel', () => {
    const payloads = loadSchema('run-event-payloads.schema.json');
    const started = ((payloads.$defs as Record<string, { properties?: Record<string, unknown> }>).agentInvocationStarted)?.properties ?? {};
    expect(started.resolvedAgentVersion, why('RFC 0082 §B', 'agent.invocation.started.resolvedAgentVersion MUST be declared (the channel pin)')).toBeDefined();
    expect(started.resolvedChannel, why('RFC 0082 §B', 'agent.invocation.started.resolvedChannel MUST be declared')).toBeDefined();
  });

  it('all four deployment event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    for (const e of ['deployment.promoted', 'deployment.rolled-back', 'deployment.canary.adjusted', 'deployment.state.changed']) {
      expect(enumVals).toContain(e);
    }
  });
});
