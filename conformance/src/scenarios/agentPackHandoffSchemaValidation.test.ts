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
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true` AND `capabilities.agents.dispatch: true`.
 * Fixture-gated: requires `conformance-agent-pack-handoff-schema-validation`.
 *
 * @see RFCS/0003-agent-packs.md §D
 * @see schemas/agent-manifest.schema.json #/properties/handoff
 * @see packs/core.openwop.agent-examples/agents[structured-fixture]
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-pack-handoff-schema-validation';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentPackHandoffSchemaValidation: handoff schema enforcement at dispatch', () => {
  it('valid task payload that matches taskSchemaRef is dispatched and completes', async () => {
    // The fixture workflow dispatches `core.openwop.agent-examples.structured-fixture`
    // with a VALID task payload matching schemas/structured-fixture.task.schema.json
    // (`{ text: string, extractionFields: string[], language?: string }`).
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: {
        scenario: 'valid-task',
        text: 'Acme Corp invoiced $1,200 on 2026-04-15 for Q2 consulting.',
        extractionFields: ['vendor', 'amount', 'date'],
      },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    let snap: { status: string } | undefined;
    for (let i = 0; i < 40; i++) {
      const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = res.json as { status: string };
      if (['completed', 'failed', 'waiting-approval'].includes(body.status)) {
        snap = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap?.status, 'HV-1a: valid task payload should NOT be rejected by handoff-schema validation').toBe('completed');
  });

  it('invalid task payload (missing required field) is rejected before dispatch with structured error', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: {
        scenario: 'invalid-task',
        // intentionally missing required `extractionFields`
        text: 'Some input text',
      },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    let snap: { status: string } | undefined;
    for (let i = 0; i < 40; i++) {
      const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = res.json as { status: string };
      if (['completed', 'failed'].includes(body.status)) {
        snap = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap?.status, 'HV-1b: invalid task payload MUST cause the run to fail rather than silently dispatch off-contract').toBe('failed');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

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

  it('agent return payload that fails returnSchemaRef is rejected before persistence', async () => {
    // The fixture's `mock-return-violation` scenario causes the agent runtime
    // to emit a return payload that violates schemas/structured-fixture.return.schema.json
    // (e.g., omits the required `extracted` field while not declaring `error`).
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: { scenario: 'mock-return-violation' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    let snap: { status: string } | undefined;
    for (let i = 0; i < 40; i++) {
      const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = res.json as { status: string };
      if (['completed', 'failed'].includes(body.status)) {
        snap = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // Hosts MAY surface return-schema violations as either a failed run OR a
    // run that completes with a flagged error envelope, but the persisted
    // result MUST NOT carry an off-schema body. Tolerate both outcomes here;
    // the strict assertion is that downstream readers can detect the violation.
    expect(['completed', 'failed']).toContain(snap?.status);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

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
