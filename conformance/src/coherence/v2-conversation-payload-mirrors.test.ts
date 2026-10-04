/**
 * v2-conversation-payload-mirrors — the conversation event payloads are defined
 * twice, and the two definitions must agree (corpus gate).
 *
 * `conversation.opened` has a closed def in `run-event-payloads.schema.json`
 * (`conversationOpened`) and another in `conversation-event.schema.json`
 * (`ConversationOpenedPayload`). `ConversationTurn` in `conversation-event` is an
 * inlined mirror of `conversation-turn.schema.json`, kept for per-file Ajv
 * compile order. Wave 3 (2026-10-04) found both pairs had drifted. The first
 * def had no `participants` seat, so a `multiPartyConversation` host could not
 * emit a valid `conversation.opened`. The turn mirror lacked `agent.model`, so
 * a turn stamped under `conversationTurnModelProvenance` failed. RFC 0186 fixed
 * the same defect for `conversation.exchanged`.
 *
 * Each leg checks property seats, so a field added to one side and not the
 * other fails here before a host emits it.
 *
 * @see spec/v2/core/conversation.md
 * @see schemas/v2/run-event-payloads.schema.json
 * @see schemas/v2/conversation-event.schema.json
 * @see schemas/v2/conversation-turn.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const read = (name: string): Json => JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', name), 'utf8')) as Json;
const defs = (s: Json): Json => s['$defs'] as Json;
const keys = (node: unknown): string[] => Object.keys(((node as Json)['properties'] ?? {}) as Json).sort();

const ID = 'openwop.requirement.conversation.payload-mirrors-agree';
const DOC = 'conversation.md';

describe('v2 conversation payload mirrors agree', () => {
  const payloads = defs(read('run-event-payloads.schema.json'));
  const event = defs(read('conversation-event.schema.json'));
  const turn = read('conversation-turn.schema.json');

  it('conversationOpened seats every field ConversationOpenedPayload carries', () => {
    const seated = keys(payloads['conversationOpened']);
    for (const k of keys(event['ConversationOpenedPayload'])) {
      expect(seated, req(ID, DOC, `run-event-payloads conversationOpened MUST seat \`${k}\`, which conversation-event ConversationOpenedPayload carries`)).toContain(k);
    }
  });

  it('the inlined ConversationTurn carries every field of conversation-turn.schema.json', () => {
    const mirror = event['ConversationTurn'] as Json;
    expect(keys(mirror), req(ID, DOC, 'the ConversationTurn mirror MUST carry the same top-level fields as conversation-turn.schema.json')).toEqual(keys(turn));
  });

  it('the inlined ConversationTurn.agent carries every field of the source agent', () => {
    const mirror = (event['ConversationTurn'] as Json)['properties'] as Json;
    const source = turn['properties'] as Json;
    expect(keys(mirror['agent']), req(ID, DOC, 'ConversationTurn.agent MUST carry the same fields as conversation-turn.schema.json agent (incl. `model`)')).toEqual(keys(source['agent']));
  });
});
