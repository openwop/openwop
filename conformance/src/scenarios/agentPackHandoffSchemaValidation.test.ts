/**
 * Multi-Agent Shift Phase 2 — handoff-schema validation at dispatch (HV-1).
 * Normative reference: RFCS/0003-agent-packs.md §D (handoff schema resolution)
 *
 * Verifies that when an agent's manifest carries `handoff.taskSchemaRef`, the
 * host MUST validate inbound dispatch payloads against the referenced JSON
 * Schema (resolved at install time per RFC 0003 §D) BEFORE dispatching the
 * agent. Invalid payloads MUST be rejected with a structured error envelope
 * — the agent MUST NOT see the malformed payload.
 *
 * Symmetric assertion on `handoff.returnSchemaRef`: when an agent returns a
 * payload that fails return-schema validation, the host MUST reject before
 * persistence and surface a structured error rather than silently storing
 * an off-contract result.
 *
 * All three legs drive the WORKFLOW EXECUTOR via plain `POST /v1/runs`: the
 * gate fires off `definition.metadata.requiresAgentId` naming an agent that
 * declares `handoff.*SchemaRef`, BEFORE any node runs (the node is a trivial
 * no-op; the gate is what's under test). The fixture references the existing
 * `core.openwop.agent-examples.structured-fixture` agent — task schema
 * `required: [text, extractionFields]`, return schema a success-XOR-error
 * `oneOf` — so no schema authoring is needed suite-side; the host resolves the
 * pack and compiles the validators at pack-load.
 *
 * Gating (two independent conditions, both necessary):
 *   1. `isAgentSupported()` + `isFixtureAdvertised(FIXTURE)` — the host claims
 *      the agent surface AND advertises this fixture. A host that does not mount
 *      `core.openwop.agent-examples` cannot resolve the agent, so the gate would
 *      no-op (ok:true) and the run would complete regardless — such a host MUST
 *      NOT advertise the fixture, and the whole block skips cleanly.
 *   2. HV-1b / HV-1c additionally gate on `hasHandoffValidation()`
 *      (`agents.manifestRuntime.handoffValidation: true`). A host advertising
 *      `agents.supported: true` but NOT `handoffValidation` dispatches opaque
 *      payloads BY DESIGN (capabilities.schema.json §manifestRuntime) — asserting
 *      a rejection there is a false red, the conformance-tier form of "a
 *      normative claim asserted without gating on the capability that declares
 *      its enforcement surface." HV-1a (valid → completes) does NOT gate on it.
 *
 * Non-vacuity: HV-1a asserts the valid payload is NOT rejected; HV-1b is the
 * paired sabotage (same inputs minus the required `extractionFields` → the run
 * MUST flip to `failed` with `handoff_task_schema_violation`). If HV-1b did not
 * red on that removal, the gate is not firing and HV-1a is vacuous — so the two
 * legs together prove the gate runs, not just that a no-op completed.
 *
 * @see RFCS/0003-agent-packs.md §D
 * @see schemas/agent-manifest.schema.json #/properties/handoff
 * @see schemas/capabilities.schema.json #/properties/agents/properties/manifestRuntime
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported, hasHandoffValidation } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-pack-handoff-schema-validation';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

/** Poll a run to a terminal status (or timeout). */
async function settle(runId: string, terminal = ['completed', 'failed', 'waiting-approval']): Promise<{ status: string } | undefined> {
  for (let i = 0; i < 40; i++) {
    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = res.json as { status: string };
    if (terminal.includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

describe.skipIf(SKIP)('agentPackHandoffSchemaValidation: handoff schema enforcement at dispatch', () => {
  it('HV-1a: valid task payload that matches taskSchemaRef is dispatched and completes', async () => {
    // Valid inputs for `structured-fixture` task schema (required: text,
    // extractionFields). No `scenario` key → the gate takes the task probe,
    // `validateTask(inputs)` passes, the gate is ok, the no-op node runs.
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: {
        text: 'Invoice 42 from Acme, total $1200',
        extractionFields: ['vendor', 'total'],
      },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const snap = await settle(runId);
    expect(snap?.status, 'HV-1a: valid task payload should NOT be rejected by handoff-schema validation').toBe('completed');
  });

  // HV-1b / HV-1c assert a REJECTION, which only a host performing handoff
  // validation can produce — gate on the capability that declares that behavior.
  describe.skipIf(!hasHandoffValidation())('rejection legs (agents.manifestRuntime.handoffValidation)', () => {
    it('HV-1b: invalid task payload (missing required field) fails before dispatch with a structured violation', async () => {
      // HV-1a's inputs minus the required `extractionFields` — the paired
      // sabotage. `validateTask` fails `required` → the run MUST fail.
      const create = await driver.post('/v1/runs', {
        workflowId: FIXTURE,
        inputs: { text: 'Invoice 42' },
      });
      expect(create.status).toBe(201);
      const runId = (create.json as { runId: string }).runId;

      const snap = await settle(runId, ['completed', 'failed']);
      expect(
        snap?.status,
        'HV-1b: invalid task payload MUST cause the run to fail rather than silently dispatch off-contract',
      ).toBe('failed');

      const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
      const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> }).events ?? [];
      const validationFailure = list.find(
        (e) =>
          e.type === 'node.failed' &&
          typeof e.payload?.error === 'object' &&
          ((e.payload?.error as Record<string, unknown>)?.code === 'handoff_task_schema_violation' ||
            (e.payload?.error as Record<string, unknown>)?.code === 'agent_dispatch_validation_failed'),
      );
      expect(
        validationFailure,
        'HV-1b: failure event payload MUST carry a recognizable handoff-validation error code',
      ).toBeDefined();
    });

    it('HV-1c: agent return payload that fails returnSchemaRef surfaces a structured violation before persistence', async () => {
      // `scenario: 'mock-return-violation'` routes to the return probe, which
      // validates `{}` against the return schema's success-XOR-error `oneOf`
      // (satisfies neither branch) → a return-schema violation.
      const create = await driver.post('/v1/runs', {
        workflowId: FIXTURE,
        inputs: { scenario: 'mock-return-violation', text: 'x', extractionFields: ['a'] },
      });
      expect(create.status).toBe(201);
      const runId = (create.json as { runId: string }).runId;

      const snap = await settle(runId, ['completed', 'failed']);
      // Hosts MAY surface return-schema violations as a failed run OR a run that
      // completes with a flagged error envelope, but the persisted result MUST
      // NOT carry an off-schema body. Tolerate both; the strict assertion is that
      // downstream readers can detect the violation.
      expect(['completed', 'failed']).toContain(snap?.status);

      const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
      const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> }).events ?? [];
      const returnViolation = list.find(
        (e) =>
          (e.type === 'node.failed' || e.type === 'agent.error') &&
          typeof e.payload?.error === 'object' &&
          ((e.payload?.error as Record<string, unknown>)?.code === 'handoff_return_schema_violation' ||
            (e.payload?.error as Record<string, unknown>)?.code === 'agent_return_validation_failed'),
      );
      expect(
        returnViolation,
        'HV-1c: off-schema return payload MUST surface a structured violation event before persistence',
      ).toBeDefined();
    });
  });
});
