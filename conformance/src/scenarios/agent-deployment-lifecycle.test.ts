/**
 * Agent deployment lifecycle — the §E promotion contract + §B channel pin
 * (RFC 0082) — behavioral.
 *
 * Capability-gated on `agents.deployment.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `agent-deployment-shape.test.ts`; this asserts host BEHAVIOR via the
 * `POST /v1/host/sample/agents/deployment-transition` seam + the test event-log
 * seam + the NORMATIVE `GET /v1/agents/{agentId}/deployments` read:
 *
 *   1. PROMOTE (§E) — authorize → approvalGate → eval-verify → a content-free
 *      `deployment.promoted` with `toState` in the seven-state vocabulary; the
 *      returned record validates against `agent-deployment.schema.json`.
 *   2. FAIL-CLOSED (§E-1, `deployment-promotion-fail-closed`) — a principal
 *      lacking `deploy:promote` is denied (`allowed !== true`) and emits NO
 *      `deployment.promoted`.
 *   3. EVAL-GATE-UNMET (§E-3) — a promote whose `evalRunId` has `passed:false`
 *      is denied with `eval_gate_unmet` and emits NO `deployment.promoted`.
 *   4. CHANNEL PIN (§B) — a `@channel`-bound run records the resolved version as
 *      `resolvedAgentVersion` on `agent.invocation.started` (the recorded fact a
 *      replay re-reads rather than re-resolving).
 *
 * Each leg soft-skips independently (seam absent / event-log seam absent).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-deployment.md (§B/§E)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0082-agent-deployment-lifecycle.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import {
  readDeploymentCap,
  driveDeploymentTransition,
  DEPLOYMENT_STATES,
  DEPLOYMENT_CONTENT_FORBIDDEN,
} from '../lib/agentDeployment.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

function expectContentFree(payload: Record<string, unknown>, where: string): void {
  for (const f of DEPLOYMENT_CONTENT_FORBIDDEN) {
    expect(
      !(f in payload),
      driver.describe('RFC 0082 §D (deployment-event-no-content-leak)', `${where} MUST be content-free (no ${f})`),
    ).toBe(true);
  }
}

describe('agent-deployment-lifecycle (RFC 0082 §B/§E)', () => {
  it('promotes via the eval+RBAC+approval gate, fails closed without scope/eval, and pins the channel version', async () => {
    const cap = await readDeploymentCap();
    if (!behaviorGate('openwop-deployment-lifecycle', cap?.supported === true)) return;
    if (!(await isEventLogSeamAvailable())) return; // event-log seam absent — soft-skip

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validateRecord = ajv.compile(loadSchema('agent-deployment.schema.json'));

    // ---- Leg 1: eval+RBAC+approval-gated promotion (§E) ------------------
    const promote = await driveDeploymentTransition({ scenario: 'promote' });
    if (promote === null) return; // deployment seam unwired — soft-skip the whole behavioral suite

    // The host has ADVERTISED agents.deployment AND wired the seam — missing
    // evidence is a FAILURE, not a soft-skip. A successful promote MUST return
    // a runId + a schema-valid record + emit ≥1 content-free deployment.promoted.
    expect(
      typeof promote.runId === 'string' && (promote.runId as string).length > 0,
      driver.describe('agent-deployment.md §E', 'a wired promote MUST return the runId'),
    ).toBe(true);
    expect(
      promote.record !== undefined && promote.record !== null,
      driver.describe('agent-deployment.md §E', 'a successful promote MUST return the deployment record'),
    ).toBe(true);
    expect(
      validateRecord(promote.record),
      driver.describe('agent-deployment.schema.json', `a promoted deployment record MUST validate (${ajv.errorsText(validateRecord.errors)})`),
    ).toBe(true);

    const promotedEvents = requireEvents(
      await queryTestEvents(promote.runId as string, { type: 'deployment.promoted' }),
      'deployment.promoted',
    );
    expect(
      promotedEvents.length >= 1,
      driver.describe('agent-deployment.md §E', 'a successful promote MUST emit at least one deployment.promoted'),
    ).toBe(true);
    for (const e of promotedEvents) {
      expectContentFree(e.payload, 'deployment.promoted');
      expect(
        typeof e.payload.toState === 'string' && DEPLOYMENT_STATES.includes(e.payload.toState as string),
        driver.describe('run-event-payloads.schema.json#/$defs/deploymentPromoted', 'toState MUST be in the seven-state vocabulary'),
      ).toBe(true);
      expect(
        typeof e.payload.toVersion === 'string' && (e.payload.toVersion as string).length > 0,
        driver.describe('agent-deployment.md §D', 'deployment.promoted MUST carry the promoted toVersion'),
      ).toBe(true);
    }

    // ---- Leg 2: fail-closed authz (§E-1; deployment-promotion-fail-closed) -
    const unauth = await driveDeploymentTransition({ scenario: 'unauthorized' });
    expect(
      unauth !== null && typeof unauth.runId === 'string' && (unauth.runId as string).length > 0,
      driver.describe('agent-deployment.md §E-1', 'the unauthorized scenario MUST return a runId to evidence the fail-closed denial'),
    ).toBe(true);
    expect(
      unauth!.allowed !== true,
      driver.describe('agent-deployment.md §E-1', 'a principal without deploy:promote MUST be denied (fail-closed)'),
    ).toBe(true);
    const unauthPromoted = requireEvents(
      await queryTestEvents(unauth!.runId as string, { type: 'deployment.promoted' }),
      'deployment.promoted (unauthorized)',
    );
    expect(
      unauthPromoted.length === 0,
      driver.describe('SECURITY invariant deployment-promotion-fail-closed', 'a denied transition MUST emit NO deployment.promoted'),
    ).toBe(true);

    // ---- Leg 3: eval-gate-unmet denial (§E-3) ----------------------------
    const evalUnmet = await driveDeploymentTransition({ scenario: 'eval-gate-unmet' });
    expect(
      evalUnmet !== null && typeof evalUnmet.runId === 'string' && (evalUnmet.runId as string).length > 0,
      driver.describe('agent-deployment.md §E-3', 'the eval-gate-unmet scenario MUST return a runId to evidence the denial'),
    ).toBe(true);
    expect(
      evalUnmet!.error === 'eval_gate_unmet' || evalUnmet!.allowed !== true,
      driver.describe('agent-deployment.md §E-3', 'a promote whose eval evidence has passed:false MUST be denied (eval_gate_unmet)'),
    ).toBe(true);
    const evalUnmetPromoted = requireEvents(
      await queryTestEvents(evalUnmet!.runId as string, { type: 'deployment.promoted' }),
      'deployment.promoted (eval-gate-unmet)',
    );
    expect(
      evalUnmetPromoted.length === 0,
      driver.describe('agent-deployment.md §E-3', 'an unmet eval gate MUST emit NO deployment.promoted'),
    ).toBe(true);

    // ---- Leg 4: channel-resolution pin (§B) ------------------------------
    const pin = await driveDeploymentTransition({ scenario: 'channel-pin', channel: 'stable' });
    expect(
      pin !== null && typeof pin.runId === 'string' && (pin.runId as string).length > 0,
      driver.describe('agent-deployment.md §B', 'the channel-pin scenario MUST return a runId'),
    ).toBe(true);
    const invEvents = requireEvents(
      await queryTestEvents(pin!.runId as string, { type: 'agent.invocation.started' }),
      'agent.invocation.started (channel-pin)',
    );
    expect(
      invEvents.length >= 1,
      driver.describe('agent-deployment.md §B', 'a @channel-bound run MUST emit agent.invocation.started'),
    ).toBe(true);
    const startedInv = invEvents.sort((a, b) => a.sequence - b.sequence)[0]!;
    expect(
      typeof startedInv.payload.resolvedAgentVersion === 'string' && (startedInv.payload.resolvedAgentVersion as string).length > 0,
      driver.describe('agent-deployment.md §B', 'a @channel-bound run MUST record resolvedAgentVersion on agent.invocation.started (the recorded fact a replay re-reads)'),
    ).toBe(true);

    await resetTestSeam();
  });
});
