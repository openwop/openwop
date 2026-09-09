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
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
  return capabilityFamily(d, 'prompts')?.supported === true;
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
      req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
        'spec/v1/rest-endpoints.md',
        'POST /v1/runs MUST return 201 on accepted creation',
      ),
    ).toBe(201);
    const { runId } = create.json as { runId: string };

    const terminal = await pollUntilTerminal(runId);
    expect(
      terminal.status,
      req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
        'fixtures.md conformance-prompt-all-four-kinds §Terminal status',
        'fixture MUST reach terminal `completed`',
      ),
    ).toBe('completed');

    const events = await readAllEvents(runId);
    const resolvedKinds = events
      .filter((e) => e.type === 'agent.promptResolved')
      .map((e) => (e.payload as { kind?: string }).kind)
      .filter((k): k is string => typeof k === 'string');
    const resolvedRefs = events
      .filter((e) => e.type === 'agent.promptResolved')
      .map((e) => (e.payload as { resolved?: string | null }).resolved)
      .filter((r): r is string => typeof r === 'string');
    const composedRefs = events
      .filter((e) => e.type === 'prompt.composed')
      .flatMap((e) => {
        const refs = (e.payload as { refs?: unknown }).refs;
        return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [];
      });

    for (const expectedKind of ['system', 'user', 'schema-hint', 'few-shot']) {
      expect(
        resolvedKinds.includes(expectedKind),
        req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
          'spec/v1/prompts.md §"PromptKind"',
          `host MUST emit \`agent.promptResolved\` with kind: "${expectedKind}" when the node carries the matching ref`,
        ),
      ).toBe(true);
    }

    // Per-templateId regression pin. The fixture carries 5 distinct
    // templates in 5 distinct config slots (system, user, schema-hint,
    // few-shot[0], few-shot[1]); the multi-entry few-shot exercises
    // the resolver's `fewShotPromptRefs[slotIndex]` per-index lookup
    // — a host that hard-codes `[0]` would emit the same template
    // twice in the few-shot events and `expectedTemplates` below
    // would fail because `few-shot-2@1.0.0` wouldn't appear.
    const expectedTemplates = [
      'prompt:conformance.prompt.writer-system@1.0.0',
      'prompt:conformance.prompt.writer-user@1.0.0',
      'prompt:conformance.prompt.schema-hint@1.0.0',
      'prompt:conformance.prompt.few-shot@1.0.0',
      'prompt:conformance.prompt.few-shot-2@1.0.0',
    ];
    for (const expectedRef of expectedTemplates) {
      expect(
        resolvedRefs.includes(expectedRef),
        req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
          'spec/v1/prompts.md §"Resolution chain (normative)"',
          `\`agent.promptResolved.resolved\` MUST surface "${expectedRef}" — the fixture carries it on the node config and the resolver MUST return it (multi-entry few-shot[slotIndex] regression pin)`,
        ),
      ).toBe(true);
      expect(
        composedRefs.includes(expectedRef),
        req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
          'spec/v1/prompts.md §"Composition + observability"',
          `\`prompt.composed.refs[]\` MUST contain "${expectedRef}" — one composition per resolved ref`,
        ),
      ).toBe(true);
    }
    // Count check: 5 refs configured → 5 composed events. A host that
    // silently dropped non-zero few-shot indices would emit fewer.
    expect(
      composedRefs.length,
      req('openwop.it.prompt-all-four-kinds-events.emits-agent-promptresolved-prompt-composed-for-system-user-schema-hint-and-few-s', 
        'spec/v1/prompts.md §"Composition + observability"',
        'host MUST emit one `prompt.composed` event per composed body (5 refs → 5 events when all five resolve, including both few-shot entries)',
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it('emits the first agent.promptResolved before the first prompt.composed (resolution-precedes-composition ordering)', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    if (create.status !== 201) return softSkip('blocked', 'precondition not met — `create.status !== 201` returned early (seam, prior step, or fixture unavailable)');
    const { runId } = create.json as { runId: string };
    await pollUntilTerminal(runId);
    const events = await readAllEvents(runId);

    // Narrower than per-kind ordering: assert only the GLOBAL "first
    // resolved precedes first composed" invariant. The composer can
    // only run after the chain walk produces a non-null resolution,
    // so a single global pair-check is sufficient to detect a host
    // that swapped the emission order.
    const firstResolvedIdx = events.findIndex((e) => e.type === 'agent.promptResolved');
    const firstComposedIdx = events.findIndex((e) => e.type === 'prompt.composed');
    expect(
      firstResolvedIdx >= 0 && firstComposedIdx >= 0,
      req('openwop.it.prompt-all-four-kinds-events.emits-the-first-agent-promptresolved-before-the-first-prompt-composed-resolution', 'spec/v1/prompts.md §"Composition + observability"', 'both event types MUST appear in the event log'),
    ).toBe(true);
    expect(
      firstResolvedIdx,
      req('openwop.it.prompt-all-four-kinds-events.emits-the-first-agent-promptresolved-before-the-first-prompt-composed-resolution', 
        'spec/v1/prompts.md §"Composition + observability"',
        'resolution events MUST precede the first composition event in the run log (composition cannot start before any resolution completes)',
      ),
    ).toBeLessThan(firstComposedIdx);
  });
});
