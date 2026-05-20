/**
 * prompt-end-to-end-events — RFC 0027 + RFC 0029 end-to-end emission.
 *
 * Asserts: when a workflow node carries `config.systemPromptRef` and
 * the host advertises `capabilities.prompts.supported: true`,
 * dispatching the run MUST cause the host to emit (in this order)
 * one `agent.promptResolved` event (per RFC 0029 §A — the resolution
 * chain trace with `applied: true` on the winning layer) followed by
 * one `prompt.composed` event (per RFC 0027 §E — the composed body
 * + sha256 hash + per-variable hashes), and the run MUST reach
 * terminal `completed` carrying the composed body's mock-AI
 * completion.
 *
 * This is the integration regression pin: prior conformance scenarios
 * exercised composition + resolution via the host-extension test
 * seams (`/v1/host/sample/prompt/{compose,resolve}`); this scenario
 * exercises the SAME pipeline through real workflow-engine dispatch.
 * If the executor stops wiring the prompt-library helpers into node
 * execution, this scenario fails first.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.supported: true`. Under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`, the gate hardens from SKIP to
 * FAIL via `behaviorGate('prompts-supported', ...)`.
 *
 * @see spec/v1/prompts.md §"Composition + observability"
 * @see spec/v1/prompts.md §"Resolution chain (normative)"
 * @see RFCS/0027-prompt-templates.md §E
 * @see RFCS/0029-prompt-override-hierarchy.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { behaviorGate } from '../lib/behavior-gate.js';

const WORKFLOW_ID = 'conformance-prompt-end-to-end';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface DiscoveryDoc {
  capabilities?: {
    prompts?: { supported?: unknown };
  };
}

interface RunEventDoc {
  eventId: string;
  runId: string;
  type: string;
  payload: unknown;
  sequence: number;
}

interface PollEventsResponse {
  events: RunEventDoc[];
  isComplete?: boolean;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function promptsSupported(d: DiscoveryDoc | null): boolean {
  return d?.capabilities?.prompts?.supported === true;
}

/** Drain the run's event log via polling. The fixture is tiny so all
 *  events fit in one page; conformance hosts may paginate via the
 *  optional `nextSequence` but our local sample doesn't. */
async function readAllEvents(runId: string): Promise<RunEventDoc[]> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0`);
  if (res.status !== 200) return [];
  const body = res.json as PollEventsResponse;
  return body.events ?? [];
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(SKIP_NO_FIXTURE || HTTP_SKIP)('prompt-end-to-end-events: real dispatch emits agent.promptResolved + prompt.composed (RFC 0027/0029)', () => {
  it('emits agent.promptResolved with chain[].applied: true for layer "node" when systemPromptRef is set on node.config', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(
      create.status,
      driver.describe(
        'spec/v1/rest-endpoints.md',
        'POST /v1/runs MUST return 201 on accepted creation',
      ),
    ).toBe(201);
    const { runId } = create.json as { runId: string };

    const terminal = await pollUntilTerminal(runId);
    expect(
      terminal.status,
      driver.describe(
        'fixtures.md conformance-prompt-end-to-end §Terminal status',
        'fixture MUST reach terminal `completed`',
      ),
    ).toBe('completed');

    const events = await readAllEvents(runId);
    const resolved = events.find((e) => e.type === 'agent.promptResolved');
    expect(
      resolved,
      driver.describe(
        'spec/v1/prompts.md §"Resolution chain (normative)"',
        'host MUST emit `agent.promptResolved` when a node carries a `*PromptRef` and prompts.supported is advertised',
      ),
    ).toBeDefined();

    const payload = resolved!.payload as {
      nodeId?: string;
      kind?: string;
      chain?: Array<{ layer?: string; applied?: boolean; source?: string }>;
      resolved?: string | null;
    };
    expect(payload.nodeId, 'agent.promptResolved.nodeId MUST be set').toBe('writer');
    expect(payload.kind, 'agent.promptResolved.kind MUST match the resolved kind').toBe('system');
    const applied = (payload.chain ?? []).find((c) => c.applied === true);
    expect(
      applied?.layer,
      driver.describe(
        'spec/v1/prompts.md §"Resolution chain (normative)" — Layer 1',
        'node-config ref MUST win when no higher-precedence run-configurable layer is configured',
      ),
    ).toBe('node');
    expect(payload.resolved).toBe('prompt:conformance.prompt.writer-system@1.0.0');
  });

  it('emits prompt.composed with sha256:<hex64> hash + non-empty composed body for system-kind template', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    if (create.status !== 201) return;
    const { runId } = create.json as { runId: string };
    await pollUntilTerminal(runId);
    const events = await readAllEvents(runId);

    const composed = events.find((e) => e.type === 'prompt.composed');
    expect(
      composed,
      driver.describe(
        'spec/v1/prompts.md §"Composition + observability"',
        'host MUST emit `prompt.composed` after `agent.promptResolved` when a ref resolves and observability !== off',
      ),
    ).toBeDefined();

    const payload = composed!.payload as {
      nodeId?: string;
      kind?: string;
      hash?: string;
      composed?: string;
      systemPrompt?: string;
      contentTrust?: string;
    };
    expect(
      payload.hash && /^sha256:[0-9a-f]{64}$/.test(payload.hash),
      driver.describe(
        'schemas/run-event-payloads.schema.json §promptComposed.hash',
        'hash MUST match `^sha256:[0-9a-f]{64}$`',
      ),
    ).toBe(true);
    expect(payload.kind, 'system-only kind composition').toBe('system-only');
    expect(
      typeof payload.composed === 'string' && payload.composed.length > 0,
      driver.describe(
        'spec/v1/prompts.md §"Composition + observability"',
        'composed body MUST be non-empty for system-kind under observability: full',
      ),
    ).toBe(true);
    // systemPrompt should mirror composed for system-kind templates.
    expect(payload.systemPrompt).toBe(payload.composed);
  });

  it('emits agent.promptResolved before prompt.composed (causal ordering)', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    if (create.status !== 201) return;
    const { runId } = create.json as { runId: string };
    await pollUntilTerminal(runId);
    const events = await readAllEvents(runId);

    const resolvedIdx = events.findIndex((e) => e.type === 'agent.promptResolved');
    const composedIdx = events.findIndex((e) => e.type === 'prompt.composed');
    expect(resolvedIdx, 'agent.promptResolved MUST appear in the event log').toBeGreaterThanOrEqual(0);
    expect(composedIdx, 'prompt.composed MUST appear in the event log').toBeGreaterThanOrEqual(0);
    expect(
      resolvedIdx,
      driver.describe(
        'spec/v1/prompts.md §"Resolution chain (normative)"',
        'agent.promptResolved MUST emit BEFORE the corresponding prompt.composed (resolution precedes composition)',
      ),
    ).toBeLessThan(composedIdx);
  });
});
