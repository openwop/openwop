/**
 * v2 — `conversationTurnModelProvenance`, the emission legs
 * (`spec/v2/core/conversation.md` §`conversationTurnModelProvenance`). The v1
 * twin is `conversation-turn-model-provenance-shape`; the advertisement record
 * leg is `v2-conversation-turn-model-provenance-advertisement`.
 *
 *   stamp-requires-advert  a host that stamps `agent.model` on an agent turn
 *                          MUST advertise `conversationTurnModelProvenance`;
 *   stamp-closed           the stamp carries provider and model identifiers
 *                          only, so no prompt or completion content can ride
 *                          in it (closed at `conversation-turn.schema.json`).
 *
 * Both legs read the turns of one `conformance-conversation-lifecycle` run,
 * the fixture `v2-conversation-turn-parts` drives. A host whose turns carry no
 * stamp records both legs `inapplicable`: the rule binds a host that stamps,
 * and the suite cannot make it stamp.
 *
 * Gates, decided before any assertion: discovery unreadable ⇒ `blocked`;
 * `conversationPrimitive` or the fixture not advertised ⇒ `inapplicable`; the
 * fixture run not completing, or completing with no turn ⇒ `blocked` (the
 * fixture's own contract is one exchange).
 *
 * @see spec/v2/core/conversation.md §`conversationTurnModelProvenance`
 * @see schemas/v2/conversation-turn.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { familyAdvertised, v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const FIXTURE = 'conformance-conversation-lifecycle';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DOC = 'conversation.md §conversationTurnModelProvenance';
const ID_ADVERT = 'openwop.requirement.conversation-turn-model-provenance.stamp-requires-advert';
const ID_CLOSED = 'openwop.requirement.conversation-turn-model-provenance.stamp-closed';

type Turns = { kind: 'turns'; turns: Json[] } | { kind: 'skip'; disposition: 'blocked' | 'inapplicable'; reason: string };
let cached: Promise<Turns> | undefined;

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

/** One fixture run per file: both legs read the same turns. */
function fixtureTurns(): Promise<Turns> {
  cached ??= (async (): Promise<Turns> => {
    let doc: Json | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return { kind: 'skip', disposition: 'blocked', reason: 'v2 discovery unreachable' };
    if (!(await familyAdvertised('conversationPrimitive'))) return { kind: 'skip', disposition: 'inapplicable', reason: 'host does not advertise conversationPrimitive' };
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `host does not advertise the ${FIXTURE} fixture` };
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    if (create.status !== 201) return { kind: 'skip', disposition: 'blocked', reason: `POST /runs {workflowId: ${FIXTURE}} answered ${create.status}` };
    const runId = String((create.json as { runId?: unknown } | null)?.runId ?? '');
    const status = await waitTerminal(runId, 20_000);
    if (status !== 'completed') return { kind: 'skip', disposition: 'blocked', reason: `${FIXTURE} did not complete (status ${status})` };
    const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
    const events = ((poll.json as { events?: unknown } | null)?.events ?? []) as Json[];
    const turns = (Array.isArray(events) ? events : [])
      .filter((e) => e['type'] === 'conversation.exchanged')
      .map((e) => ((e['payload'] ?? {}) as Json)['turn'])
      .filter((t): t is Json => t !== null && typeof t === 'object' && !Array.isArray(t));
    if (turns.length === 0) return { kind: 'skip', disposition: 'blocked', reason: `${FIXTURE} completed without a conversation.exchanged event carrying a turn` };
    return { kind: 'turns', turns };
  })();
  return cached;
}

/** The `agent.model` stamps the run's turns carry. */
function stamps(turns: Json[]): { messageId: string; model: unknown }[] {
  return turns.flatMap((t) => {
    const agent = t['agent'];
    if (agent === null || typeof agent !== 'object' || Array.isArray(agent) || !('model' in agent)) return [];
    return [{ messageId: String(t['messageId']), model: (agent as Json)['model'] }];
  });
}

describe('v2 conversationTurnModelProvenance emission (conversation.md §conversationTurnModelProvenance)', () => {
  it('a host that stamps agent.model on a turn advertises conversationTurnModelProvenance', async () => {
    const out = await fixtureTurns();
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    const stamped = stamps(out.turns);
    if (stamped.length === 0) return softSkip('inapplicable', 'no emitted turn carries an agent.model stamp');
    const advertised = (await familyAdvertised('conversationTurnModelProvenance')) !== null;
    expect(advertised, req(ID_ADVERT, DOC, `${stamped.length} turn(s) carry agent.model (first: ${stamped[0]?.messageId}); a host that stamps MUST advertise conversationTurnModelProvenance`)).toBe(true);
  });

  it('every agent.model stamp carries provider and model identifiers only', async () => {
    const out = await fixtureTurns();
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    const stamped = stamps(out.turns);
    if (stamped.length === 0) return softSkip('inapplicable', 'no emitted turn carries an agent.model stamp');
    const validate = v2RefValidator('conversation-turn.schema.json#/properties/agent/properties/model');
    for (const s of stamped) {
      const r = validate(s.model);
      expect(r.ok, req(ID_CLOSED, DOC, `turn ${s.messageId}: agent.model MUST validate against schemas/v2/conversation-turn.schema.json (provider and model only): ${r.errors}`)).toBe(true);
    }
  });
});
