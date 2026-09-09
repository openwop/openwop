/**
 * Standing agent roster — entry + capability + attribution-event shapes (RFC 0086).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.roster` is declared with its `supported` /
 *     `installScope` / `portfolioTriggerSources` sub-flags.
 *   - `agent-roster-entry.schema.json` compiles and round-trips a conforming
 *     entry, and rejects malformed ones (a non-`host:` rosterId; an `agentRef`
 *     carrying BOTH `version` and `channel` — the RFC 0082 §A XOR rule).
 *   - the `roster.run.initiated` payload $def validates a conforming
 *     content-free attribution record and requires its ids + persona.
 *   - `roster.run.initiated` is CONTENT-FREE: a payload carrying a work-item
 *     `body` or a `prompt` is rejected (`additionalProperties:false`). This is
 *     the public test for the protocol-tier SECURITY invariant
 *     `roster-attribution-no-content`.
 *   - the `AgentInventoryEntry` carries the additive optional `roster`
 *     portfolio projection (RFC 0086 §B).
 *   - `roster.run.initiated` appears in the RunEventType enum.
 *
 * Behavioral assertions (a scheduled portfolio fire emitting roster.run.initiated
 * before agent.invocation.started; the work-item causation chain; the replay
 * re-read; cross-tenant 404) are gated on `capabilities.agents.roster.supported`
 * and land at Active → Accepted (reference-host roster store deferred per RFC 0086
 * §Conformance). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-roster.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (roster-attribution-no-content)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-roster-shape: capability advertisement (RFC 0086, server-free)', () => {
  it('the capabilities schema declares agents.roster with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).agents;
    const roster = agents?.properties?.roster;
    expect(roster, req('openwop.it.agent-roster-shape.the-capabilities-schema-declares-agents-roster-with-its-sub-flags', 'capabilities.md §agents', 'agents.roster MUST be declared')).toBeDefined();
    for (const flag of ['supported', 'installScope', 'portfolioTriggerSources']) {
      expect(roster?.properties?.[flag], req('openwop.it.agent-roster-shape.the-capabilities-schema-declares-agents-roster-with-its-sub-flags', 'agent-roster.md §F', `agents.roster.${flag} MUST be declared`)).toBeDefined();
    }
  });
});

describe('agent-roster-shape: roster entry (RFC 0086 §A, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const entry = ajv.compile(loadSchema('agent-roster-entry.schema.json'));

  it('AgentRosterEntry validates a conforming entry', () => {
    const good = {
      rosterId: 'host:sally-marketing',
      persona: 'Sally',
      agentRef: { agentId: 'core.openwop.agents.brief-writer', channel: 'stable' },
      workflows: ['marketing-email-campaign'],
      owner: { tenantId: 'acme', workspaceId: 'growth' },
      enabled: true,
    };
    expect(entry(good), req('openwop.it.agent-roster-shape.agentrosterentry-validates-a-conforming-entry', 'RFC 0086 §A', 'a conforming roster entry MUST validate')).toBe(true);
  });

  it('rejects a non-host: rosterId and an agentRef carrying both version and channel', () => {
    const base = {
      rosterId: 'host:sally-marketing',
      persona: 'Sally',
      agentRef: { agentId: 'core.openwop.agents.brief-writer' },
      owner: { tenantId: 'acme' },
    };
    expect(entry({ ...base, rosterId: 'core.openwop.agents.sally' }), req('openwop.it.agent-roster-shape.rejects-a-non-host-rosterid-and-an-agentref-carrying-both-version-and-channel', 'RFC 0086 §A', 'a non-`host:` rosterId MUST be rejected')).toBe(false);
    expect(
      entry({ ...base, agentRef: { agentId: 'core.x.y.z', version: '1.0.0', channel: 'stable' } }),
      req('openwop.it.agent-roster-shape.rejects-a-non-host-rosterid-and-an-agentref-carrying-both-version-and-channel', 'RFC 0082 §A', 'an agentRef with BOTH version and channel MUST be rejected'),
    ).toBe(false);
    expect(entry({ persona: 'x', agentRef: { agentId: 'core.x.y.z' }, owner: { tenantId: 'acme' } }), req('openwop.it.agent-roster-shape.rejects-a-non-host-rosterid-and-an-agentref-carrying-both-version-and-channel', 'RFC 0086 §A', 'a roster entry without rosterId MUST be rejected')).toBe(false);
  });
});

describe('agent-roster-shape: roster.run.initiated event (RFC 0086 §C, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');
  const initiated = ajv.getSchema('payloads#/$defs/rosterRunInitiated');

  it('roster.run.initiated validates a content-free attribution record and requires its ids', () => {
    expect(initiated, req('openwop.it.agent-roster-shape.roster-run-initiated-validates-a-content-free-attribution-record-and-requires-it', 'RFC 0086', 'the rosterRunInitiated $def MUST exist')).toBeTruthy();
    expect(
      initiated!({ rosterId: 'host:sally-marketing', persona: 'Sally', agentId: 'core.openwop.agents.brief-writer', workflowId: 'marketing-email-campaign', triggerSource: 'schedule' }),
      req('openwop.it.agent-roster-shape.roster-run-initiated-validates-a-content-free-attribution-record-and-requires-it', 'RFC 0086 §C', 'a conforming roster.run.initiated payload MUST validate'),
    ).toBe(true);
    expect(initiated!({ rosterId: 'host:s', persona: 'S' }), req('openwop.it.agent-roster-shape.roster-run-initiated-validates-a-content-free-attribution-record-and-requires-it', 'RFC 0086 §C', 'roster.run.initiated without agentId/workflowId/triggerSource MUST be rejected')).toBe(false);
  });

  it('roster.run.initiated is content-free — a work-item body and a prompt are rejected (roster-attribution-no-content)', () => {
    const base = { rosterId: 'host:s', persona: 'S', agentId: 'a.b.c.d', workflowId: 'wf', triggerSource: 'queue' };
    expect(
      initiated!({ ...base, body: 'the card description' }),
      req('openwop.it.agent-roster-shape.roster-run-initiated-is-content-free-a-work-item-body-and-a-prompt-are-rejected', 'SECURITY invariant roster-attribution-no-content', 'roster.run.initiated MUST NOT carry the work-item body'),
    ).toBe(false);
    expect(
      initiated!({ ...base, prompt: 'system: …' }),
      req('openwop.it.agent-roster-shape.roster-run-initiated-is-content-free-a-work-item-body-and-a-prompt-are-rejected', 'SECURITY invariant roster-attribution-no-content', 'roster.run.initiated MUST NOT carry prompt content'),
    ).toBe(false);
  });
});

describe('agent-roster-shape: inventory projection + enum (RFC 0086 §B, server-free)', () => {
  it('AgentInventoryEntry carries the additive optional roster portfolio projection', () => {
    const inv = loadSchema('agent-inventory-response.schema.json');
    const entry = (inv.$defs as Record<string, { properties?: Record<string, unknown> }>).AgentInventoryEntry?.properties ?? {};
    expect(entry.roster, req('openwop.it.agent-roster-shape.agentinventoryentry-carries-the-additive-optional-roster-portfolio-projection', 'RFC 0086 §B', 'AgentInventoryEntry.roster (the portfolio projection) MUST be declared')).toBeDefined();
  });

  it('roster.run.initiated appears in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(enumVals, req('openwop.it.agent-roster-shape.roster-run-initiated-appears-in-the-runeventtype-enum', 'RFC 0086', 'roster.run.initiated appears in the RunEventType enum')).toContain('roster.run.initiated');
  });

  it('the GET /v1/agents/roster response schema validates + rejects extras (RFC 0086 §B)', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(loadSchema('agent-roster-entry.schema.json'), 'https://openwop.dev/spec/v1/agent-roster-entry.schema.json');
    const resp = ajv.compile(loadSchema('agent-roster-response.schema.json'));
    const good = {
      roster: [{ rosterId: 'host:sally', persona: 'Sally', agentRef: { agentId: 'core.x.y.z' }, owner: { tenantId: 'acme' } }],
      total: 1,
    };
    expect(resp(good), req('openwop.it.agent-roster-shape.the-get-v1-agents-roster-response-schema-validates-rejects-extras-rfc-0086-b', 'RFC 0086 §B', 'a conforming GET /v1/agents/roster response MUST validate')).toBe(true);
    expect(resp({ ...good, unexpected: true }), req('openwop.it.agent-roster-shape.the-get-v1-agents-roster-response-schema-validates-rejects-extras-rfc-0086-b', 'RFC 0086 §B', 'an extra top-level property MUST be rejected')).toBe(false);
    expect(resp({ roster: [] }), req('openwop.it.agent-roster-shape.the-get-v1-agents-roster-response-schema-validates-rejects-extras-rfc-0086-b', 'RFC 0086 §B', 'the response MUST require `total`')).toBe(false);
  });
});
