/**
 * RFC 0024 — streaming `agent.reasoning.delta` events.
 *
 * Verifies that hosts advertising `capabilities.agents.reasoning.streaming: true`
 * emit incremental `agent.reasoning.delta` events while a reasoning
 * block is still open, followed by exactly one closing `agent.reasoned`
 * event carrying the full authoritative content.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.agents.supported: true` AND
 * `capabilities.agents.reasoning.streaming: true`, OR when reasoning
 * verbosity is `'off'`.
 *
 * Driven by the `core.conformance.mock-agent` typeId (RFC 0023)
 * extended with `mockReasoning.streamChunks` per RFC 0024 §"Conformance"
 * (see `schemas/core-conformance-mock-agent-config.schema.json`).
 *
 * @see RFCS/0024-agent-reasoning-streaming.md
 * @see schemas/run-event-payloads.schema.json §`agentReasoningDelta`
 * @see schemas/capabilities.schema.json §`agents.reasoning.streaming`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import {
  isAgentSupported,
  isReasoningStreamingSupported,
  getReasoningVerbosity,
} from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-reasoning-streaming';
/** Expected concatenation of the fixture's `streamChunks` — kept in sync
 *  with `conformance/fixtures/conformance-agent-reasoning-streaming.json`.
 *  When the fixture changes, this constant changes with it. */
const EXPECTED_CHUNKS = [
  'Let me think about this. ',
  'First, the user is asking a question. ',
  'Therefore, I should respond clearly.',
] as const;
const EXPECTED_FULL = EXPECTED_CHUNKS.join('');

const SKIP =
  !isAgentSupported() ||
  !isReasoningStreamingSupported() ||
  getReasoningVerbosity() === 'off' ||
  !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentReasoningStreaming: RFC 0024 incremental + closing event contract', () => {
  it('emits N agent.reasoning.delta events followed by exactly one closing agent.reasoned', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(events.status).toBe(200);
    const list = (events.json as { events: Array<{ type: string; payload?: Record<string, unknown> }> }).events;

    const deltas = list.filter((e) => e.type === 'agent.reasoning.delta');
    const finals = list.filter((e) => e.type === 'agent.reasoned');

    expect(
      deltas.length,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'streaming host MUST emit one agent.reasoning.delta per streamChunks entry',
      ),
    ).toBe(EXPECTED_CHUNKS.length);
    expect(
      finals.length,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'streaming host MUST emit exactly one closing agent.reasoned event after the deltas',
      ),
    ).toBe(1);
  });

  it('agent.reasoning.delta `sequence` starts at 0 and increments by 1 within the block', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events: Array<{ type: string; payload?: Record<string, unknown> }> }).events;

    const deltas = list.filter((e) => e.type === 'agent.reasoning.delta');
    const sequences = deltas
      .map((e) => e.payload?.sequence)
      .filter((s): s is number => typeof s === 'number');

    expect(
      sequences,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        '`sequence` MUST start at 0 and increment by 1 per delta within a block',
      ),
    ).toEqual(EXPECTED_CHUNKS.map((_, i) => i));
  });

  it('closing agent.reasoned.reasoning is the concatenation of the deltas (authoritative)', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events: Array<{ type: string; payload?: Record<string, unknown> }> }).events;

    const finalEvent = list.find((e) => e.type === 'agent.reasoned');
    expect(finalEvent, 'closing agent.reasoned must be present').toBeDefined();
    const reasoning = finalEvent?.payload?.reasoning;
    expect(typeof reasoning, 'closing event MUST carry a reasoning string').toBe('string');
    // The mock-agent's contract: closing reasoning equals concat(streamChunks).
    // Real hosts MAY transform at finalize (summary truncation, redaction);
    // for the mock-agent fixture, no transform applies — exact equality.
    expect(
      reasoning,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'closing agent.reasoned.reasoning is authoritative; for the mock-agent fixture, equals delta concatenation',
      ),
    ).toBe(EXPECTED_FULL);
  });

  it('agentId is consistent across all streaming + closing events in a block', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events: Array<{ type: string; payload?: Record<string, unknown> }> }).events;

    const relevant = list.filter(
      (e) => e.type === 'agent.reasoning.delta' || e.type === 'agent.reasoned',
    );
    const agentIds = new Set(
      relevant
        .map((e) => e.payload?.agentId)
        .filter((a): a is string => typeof a === 'string' && a.length > 0),
    );

    expect(
      agentIds.size,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'agentId MUST be consistent across all `agent.reasoning.delta` events AND the closing `agent.reasoned` for a given block',
      ),
    ).toBe(1);
  });

  it('all agent.reasoning.delta events arrive BEFORE the closing agent.reasoned', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as Array<{ type: string }> | { events: Array<{ type: string }> });
    const arr = Array.isArray(list) ? list : list.events;

    const closingIdx = arr.findIndex((e) => e.type === 'agent.reasoned');
    expect(closingIdx, 'closing event present').toBeGreaterThan(-1);
    const lastDeltaIdx = arr.map((e) => e.type).lastIndexOf('agent.reasoning.delta');

    // Guard against vacuous pass: a host advertising streaming but
    // emitting ZERO deltas would otherwise pass `-1 < closingIdx`
    // trivially. The fixture configures 3 streamChunks, so at least
    // one delta MUST appear in the event log.
    expect(
      lastDeltaIdx,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'streaming host MUST emit at least one `agent.reasoning.delta` for a fixture with non-empty `streamChunks`',
      ),
    ).toBeGreaterThan(-1);
    expect(
      lastDeltaIdx,
      driver.describe(
        'RFCS/0024-agent-reasoning-streaming.md §Proposal',
        'every `agent.reasoning.delta` MUST precede the closing `agent.reasoned` for the same block',
      ),
    ).toBeLessThan(closingIdx);
  });
});
