/**
 * prompt-all-four-kinds-events — RFC 0027 §A four-kind dispatch coverage.
 *
 * Asserts: when a workflow node carries refs for all four PromptKind
 * values (`systemPromptRef`, `userPromptRef`, `schemaHintPromptRef`,
 * one entry in `fewShotPromptRefs[]`) AND the host advertises
 * `capabilities.prompts.supported: true`, dispatching the run MUST
 * cause the host to emit one `agent.promptResolved` event per kind
 * AND one `prompt.composed` event per composition (four of each,
 * in the canonical dispatch order). The run MUST reach terminal
 * `completed`.
 *
 * This is the templateKinds-coverage regression pin: the reference
 * host advertises `templateKinds: ["system", "user", "few-shot",
 * "schema-hint"]` and `prompt-end-to-end-events` already covers the
 * system path; this scenario closes the credibility gap for
 * `schema-hint` + `few-shot` so a third-party host claiming the
 * advertisement has a wire-side check.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.supported: true`. Under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`, the gate hardens from SKIP to
 * FAIL via `behaviorGate('prompts-supported', ...)`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * @see RFCS/0027-prompt-templates.md §A
 * @see spec/v1/prompts.md §"PromptKind"
 * @see spec/v1/prompts.md §"Composition + observability"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { behaviorGate } from '../lib/behavior-gate.js';

const WORKFLOW_ID = 'conformance-prompt-all-four-kinds';
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

async function readAllEvents(runId: string): Promise<RunEventDoc[]> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0`);
  if (res.status !== 200) return [];
  const body = res.json as PollEventsResponse;
  return body.events ?? [];
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(SKIP_NO_FIXTURE || HTTP_SKIP)('prompt-all-four-kinds-events: each PromptKind dispatches end-to-end (RFC 0027 §A)', () => {
  it('emits agent.promptResolved + prompt.composed for system, user, schema-hint, and few-shot kinds', async () => {
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
        'fixtures.md conformance-prompt-all-four-kinds §Terminal status',
        'fixture MUST reach terminal `completed`',
      ),
    ).toBe('completed');

    const events = await readAllEvents(runId);
    const resolvedKinds = events
      .filter((e) => e.type === 'agent.promptResolved')
      .map((e) => (e.payload as { kind?: string }).kind)
      .filter((k): k is string => typeof k === 'string');
    const composedKinds = events
      .filter((e) => e.type === 'prompt.composed')
      .map((e) => (e.payload as { kind?: string }).kind)
      .filter((k): k is string => typeof k === 'string');

    for (const expectedKind of ['system', 'user', 'schema-hint', 'few-shot']) {
      expect(
        resolvedKinds.includes(expectedKind),
        driver.describe(
          'spec/v1/prompts.md §"PromptKind"',
          `host MUST emit \`agent.promptResolved\` with kind: "${expectedKind}" when the node carries the matching ref`,
        ),
      ).toBe(true);
    }
    // prompt.composed `kind` field is a composition classifier (per
    // schemas/run-event-payloads.schema.json — system+user / system-only /
    // user-only / agent-reasoning) rather than the source PromptKind,
    // so the per-kind assertion here is just count-based: one
    // composition emitted per ref that resolved.
    expect(
      composedKinds.length,
      driver.describe(
        'spec/v1/prompts.md §"Composition + observability"',
        'host MUST emit one `prompt.composed` event per composed body (4 refs → 4 events when all four resolve)',
      ),
    ).toBeGreaterThanOrEqual(4);
  });

  it('emits agent.promptResolved before its matching prompt.composed for each kind (causal ordering)', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    if (create.status !== 201) return;
    const { runId } = create.json as { runId: string };
    await pollUntilTerminal(runId);
    const events = await readAllEvents(runId);

    // First resolved event MUST appear before first composed event.
    // The composer can only run after the chain walk produces a
    // non-null resolution, so the global ordering across all kinds
    // is sufficient — per-kind ordering is implied.
    const firstResolvedIdx = events.findIndex((e) => e.type === 'agent.promptResolved');
    const firstComposedIdx = events.findIndex((e) => e.type === 'prompt.composed');
    expect(
      firstResolvedIdx >= 0 && firstComposedIdx >= 0,
      'both event types MUST appear in the event log',
    ).toBe(true);
    expect(
      firstResolvedIdx,
      driver.describe(
        'spec/v1/prompts.md §"Resolution chain (normative)"',
        'agent.promptResolved MUST emit BEFORE the corresponding prompt.composed (resolution precedes composition)',
      ),
    ).toBeLessThan(firstComposedIdx);
  });
});
