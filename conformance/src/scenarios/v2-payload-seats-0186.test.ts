/**
 * RFC 0186 — three payload seats the hosts measured and the corpus lacked
 * (suite 2.3.0, target major 2; server-free).
 *
 * §A.1 `conversation.exchanged` had TWO closed defs for one event that could not
 * both be satisfied: `run-event-payloads.conversationExchanged` seated `outcome`
 * and not `turn`; `conversation-event.ConversationExchangedPayload` seated
 * `turn` (required) and not `outcome`. The codemap bound the first; a tier-1
 * host emitted the second. The other host emits `outcome` (the `ctx.suspend`
 * resume value) and never `turn`. The union carries both, optional — a strict
 * widening of both prior shapes — and the orphan is an alias.
 *
 * §A.2 `reason` — a CAUSE axis on `interruptResolved` and `nodeSuspended`,
 * disjoint from `kind`, RFC 0183 `decision` and `action`. One host measured it
 * single-valued `timeout`; the other dropped it on 350 rows.
 *
 * §A.3 `ApprovalData.onTimeout` — `reject | approve | escalate`, the disposition
 * when `timeoutMs` elapses. Both hosts recorded it as a bare key on
 * `approval.requested` because the seat did not exist.
 *
 * The load-bearing legs are the NEGATIVE ones: the union still refuses a bare
 * key, the alias sitting inside `conversation-event`'s `oneOf` cannot
 * double-match `opened`/`closed`, and `onTimeout` refuses a value outside the
 * enum. Each is sabotage-checked.
 *
 * @see RFCS/0186-payload-seats.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0186.payload-seats';
const DOC = 'RFCS/0186-payload-seats.md';

function ajv(): Ajv2020 {
  const a = new Ajv2020({ strict: false, allErrors: true });
  addFormats(a);
  const dir = join(SCHEMAS_DIR, 'v2');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.schema.json') || statSync(join(dir, f)).isDirectory()) continue;
    try { a.addSchema(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>); } catch { /* duplicate $id */ }
  }
  return a;
}
// No cast: a compiled validator is already callable. `compile()` returns
// `ValidateFunction`, whose call result is `boolean` for a synchronous schema —
// `=== true` narrows away the async branch without asserting anything.
const v = (a: Ajv2020, ref: string): ((doc: unknown) => boolean) => { const fn = a.compile({ $ref: ref }); return (doc) => fn(doc) === true; };
const PAYLOADS = 'https://openwop.dev/spec/v2/run-event-payloads.schema.json#/$defs/';
const CONV = 'https://openwop.dev/spec/v2/conversation-event.schema.json';
const SUSPEND = 'https://openwop.dev/spec/v2/suspend-request.schema.json#/$defs/';

const turn = { messageId: 'm1', from: 'user', content: 'hello', ts: 1758110400000, role: 'user', turnIndex: 0 };

describe('RFC 0186 payload seats', () => {
  it('§A.1 conversation.exchanged is one union that both host shapes satisfy, still closed, and unambiguous inside the oneOf', () => {
    const a = ajv();
    const exchanged = v(a, `${PAYLOADS}conversationExchanged`);
    expect(exchanged({ conversationId: 'c1', turnIndex: 0, turn }), req(ID, DOC, 'the tier-1 host shape {conversationId, turnIndex, turn} MUST validate against the bound def')).toBe(true);
    expect(exchanged({ conversationId: 'c1', turnIndex: 0, outcome: { ok: true } }), req(ID, DOC, 'the tier-2 host shape {conversationId, turnIndex, outcome} MUST validate against the bound def')).toBe(true);
    expect(exchanged({ conversationId: 'c1', turnIndex: 0 }), req(ID, DOC, 'both turn and outcome are OPTIONAL — a payload with neither MUST validate, or the union is not a widening of the prior bound def')).toBe(true);
    expect(exchanged({ conversationId: 'c1', turnIndex: 0, notASeat: 1 }), req(ID, DOC, 'the union MUST stay closed — a bare unmodelled key still fails')).toBe(false);

    const alias = v(a, `${CONV}#/$defs/ConversationExchangedPayload`);
    expect(alias({ conversationId: 'c1', turnIndex: 0, outcome: 1 }), req(ID, DOC, 'the former orphan MUST be an alias of the union — the outcome-only shape validates through it')).toBe(true);

    const oneOf = v(a, CONV);
    expect(oneOf({ conversationId: 'c1', turnIndex: 0, turn }), req(ID, DOC, 'an exchanged payload MUST match exactly ONE branch of conversation-event oneOf')).toBe(true);
    expect(oneOf({ conversationId: 'c1', turnIndex: 3, finalTurn: turn }), req(ID, DOC, 'a closed payload MUST still match exactly one branch — the union MUST NOT absorb it (finalTurn is rejected by the closed union)')).toBe(true);
  });

  it('§A.2 reason seats on interruptResolved and nodeSuspended, and neither def reopens', () => {
    const a = ajv();
    const base = { nodeId: 'n1', interruptId: 't/0123456789abcdef', kind: 'approval' };
    for (const def of ['interruptResolved', 'nodeSuspended']) {
      const f = v(a, `${PAYLOADS}${def}`);
      expect(f({ ...base, reason: 'timeout' }), req(ID, DOC, `\`${def}\` MUST admit reason — the cause axis both hosts record`)).toBe(true);
      expect(f({ ...base, reason: '' }), req(ID, DOC, `\`${def}.reason\` MUST be non-empty`)).toBe(false);
      expect(f({ ...base, cause: 'timeout' }), req(ID, DOC, `\`${def}\` MUST still refuse a bare unmodelled key`)).toBe(false);
    }
  });

  it('§A.3 ApprovalData.onTimeout is a closed enum and the def stays closed', () => {
    const a = ajv();
    const f = v(a, `${SUSPEND}ApprovalData`);
    const base = { artifactId: 'a1', artifactType: 'doc', title: 'Review', actions: ['accept', 'reject'] };
    for (const d of ['reject', 'approve', 'escalate']) {
      expect(f({ ...base, onTimeout: d }), req(ID, DOC, `onTimeout MUST admit \`${d}\``)).toBe(true);
    }
    expect(f({ ...base, onTimeout: 'ignore' }), req(ID, DOC, 'onTimeout MUST refuse a value outside reject|approve|escalate — the domain came from a host type, not a sample')).toBe(false);
    expect(f({ ...base, message: 'x' }), req(ID, DOC, 'ApprovalData MUST still refuse the legacy bare `message` — it maps to `description`, which is the seat')).toBe(false);
  });
});
