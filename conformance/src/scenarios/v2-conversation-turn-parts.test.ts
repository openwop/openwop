/**
 * v2-conversation-turn-parts — RFC 0205 §B.5, the behavioural leg (suite 2.36.0,
 * target major 2).
 *
 * A v2 conversation turn MAY carry `parts`, a non-empty array of A2A `Part`s;
 * presence is the discriminator that marks the turn A2A-shaped. This leg reads a
 * live run's `conversation.exchanged` turns and checks every turn that carries
 * `parts` against `schemas/v2/conversation-turn.schema.json`. It mints
 * `openwop.requirement.0205.turn-parts-emitted`, the behavioural twin of the
 * server-free `turn-parts-shape` (a corpus row in
 * `src/coherence/a2a-parts-schemas.test.ts`), so a server-free pass can never
 * stand in for it.
 *
 * Gates, decided before any assertion:
 *   - `conversationPrimitive` not advertised, or the
 *     `conformance-conversation-lifecycle` fixture not advertised ⇒ `inapplicable`;
 *   - the run emits no `conversation.exchanged` turn ⇒ `blocked` (the fixture's
 *     own contract is one exchange);
 *   - no emitted turn carries `parts` ⇒ `inapplicable` ("host emits no
 *     A2A-shaped turns (SHOULD)"), never `executed-pass`.
 *
 * @see RFCS/0205-run-artifacts-and-turns-speak-a2a-parts.md
 * @see spec/v2/core/runs.md §"Conversation and residency capabilities"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { familyAdvertised, v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const FIXTURE = 'conformance-conversation-lifecycle';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function waitTerminal(runId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
    if (status !== null && TERMINAL.has(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('RFC 0205 §B.5 — an emitted turn that carries parts carries a valid Part[]', () => {
  it('every conversation.exchanged turn carrying parts validates against the v2 turn def', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await familyAdvertised('conversationPrimitive'))) return softSkip('inapplicable', 'host does not advertise conversationPrimitive');
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return softSkip('inapplicable', `host does not advertise the ${FIXTURE} fixture`);
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    if (create.status !== 201) return softSkip('blocked', `POST /runs {workflowId: ${FIXTURE}} answered ${create.status}`);
    const runId = String((create.json as { runId?: unknown } | null)?.runId ?? '');
    const status = await waitTerminal(runId, 20_000);
    if (status !== 'completed') return softSkip('blocked', `${FIXTURE} did not complete (status ${status})`);
    const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
    const events = ((poll.json as { events?: unknown } | null)?.events ?? []) as Json[];
    const turns = (Array.isArray(events) ? events : [])
      .filter((e) => e['type'] === 'conversation.exchanged')
      .map((e) => ((e['payload'] ?? {}) as Json)['turn'])
      .filter((t): t is Json => t !== null && typeof t === 'object' && !Array.isArray(t));
    if (turns.length === 0) return softSkip('blocked', `${FIXTURE} completed without a conversation.exchanged event carrying a turn`);
    const shaped = turns.filter((t) => 'parts' in t);
    if (shaped.length === 0) return softSkip('inapplicable', 'host emits no A2A-shaped turns (SHOULD)');
    const validate = v2Validator('conversation-turn');
    for (const t of shaped) {
      const r = validate(t);
      expect(r.ok, req('openwop.requirement.0205.turn-parts-emitted', 'RFC 0205 §B.5', `turn ${String(t['messageId'])} carries parts and MUST validate against schemas/v2/conversation-turn.schema.json: ${r.errors}`)).toBe(true);
    }
  });
});
