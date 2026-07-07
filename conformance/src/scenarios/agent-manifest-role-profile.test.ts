/**
 * Agent-manifest `role` + the Skill profile (RFC 0131).
 *
 * Always-on, server-free schema-shape probe of the additive optional
 * `AgentManifest.role` and the schema-encoded Skill profile (§B). The profile is
 * a JSON-Schema `if role==="skill" then {required:["handoff"], memoryShape.
 * {conversation,longTerm} !== true}` conditional, so a violating skill manifest
 * FAILS validation at publish/install — a malformed manifest (RFC 0003 §C author
 * error), NOT an RFC 0072 §C `degraded[]` runtime tier. This is the public
 * witness for the SECURITY invariant `agent-skill-profile-stateless`.
 *
 * Verifies:
 *   - `role` is EXPLICIT, never inferred: a manifest with NO `role` and any
 *     `memoryShape` (incl. conversation+longTerm) validates — unconstrained,
 *     exactly today's meaning. `handoff` presence does NOT reclassify it.
 *   - a `role:"skill"` manifest WITH `handoff` + scratchpad-only memory validates.
 *   - a `role:"skill"` manifest with `memoryShape.longTerm:true` FAILS validation.
 *   - a `role:"skill"` manifest with `memoryShape.conversation:true` FAILS.
 *   - a `role:"skill"` manifest MISSING `handoff` FAILS validation.
 *   - a `role:"assistant"` manifest with conversation+longTerm (+ optional
 *     handoff) validates — no profile binds it.
 *   - `role` outside the `["skill","assistant"]` enum FAILS.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0131-agent-manifest-role-and-skill-profile.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md (§B — reject vs §C degrade)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0072-agent-inventory-and-dispatch.md (the degraded[] marker this RFC does NOT overload)
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (agent-skill-profile-stateless)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const BASE = 'https://openwop.dev/spec/v1/';
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-manifest-role-profile: AgentManifest.role + Skill profile (RFC 0131, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMAS_DIR)) {
    if (f.endsWith('.schema.json')) {
      try {
        ajv.addSchema(loadSchema(f));
      } catch {
        /* duplicate/ignore */
      }
    }
  }
  const manifest = ajv.getSchema(`${BASE}agent-manifest.schema.json`)!;

  const base = { agentId: 'core.openwop.agents.demo', persona: 'Demo', modelClass: 'general', systemPrompt: 'do it' };
  const handoff = { taskSchemaRef: 'schemas/task.json', returnSchemaRef: 'schemas/return.json' };

  it('NO role + any memoryShape (conversation+longTerm) validates — explicit, never inferred', () => {
    expect(
      manifest({ ...base, memoryShape: { scratchpad: true, conversation: true, longTerm: true } }),
      why('RFC 0131 §A', 'absent role ⇒ unconstrained; nothing reclassifies (today’s meaning, unchanged)'),
    ).toBe(true);
  });

  it('NO role + handoff + rich memory validates — handoff presence does NOT imply skill', () => {
    expect(
      manifest({ ...base, handoff, memoryShape: { conversation: true, longTerm: true } }),
      why('RFC 0131 §A / Motivation 2', 'handoff is an interop contract, orthogonal to role — no inference'),
    ).toBe(true);
  });

  it('role:"skill" WITH handoff + scratchpad-only memory validates', () => {
    expect(
      manifest({ ...base, role: 'skill', handoff, memoryShape: { scratchpad: true, conversation: false, longTerm: false } }),
      why('RFC 0131 §B', 'a well-formed skill (handoff + scratchpad-only) MUST validate'),
    ).toBe(true);
  });

  it('role:"skill" with memoryShape.longTerm:true FAILS validation (malformed, not degraded)', () => {
    expect(
      manifest({ ...base, role: 'skill', handoff, memoryShape: { scratchpad: true, longTerm: true } }),
      why('RFC 0131 §B', 'a skill declaring longTerm memory is malformed — reject at publish/install'),
    ).toBe(false);
  });

  it('role:"skill" with memoryShape.conversation:true FAILS validation', () => {
    expect(
      manifest({ ...base, role: 'skill', handoff, memoryShape: { conversation: true } }),
      why('RFC 0131 §B', 'a skill declaring conversation memory is malformed — reject'),
    ).toBe(false);
  });

  it('role:"skill" MISSING handoff FAILS validation', () => {
    expect(
      manifest({ ...base, role: 'skill', memoryShape: { scratchpad: true } }),
      why('RFC 0131 §B', 'a skill MUST declare handoff (task→return capability)'),
    ).toBe(false);
  });

  it('role:"assistant" with conversation+longTerm (and handoff) validates — no profile binds it', () => {
    expect(
      manifest({ ...base, role: 'assistant', handoff, memoryShape: { scratchpad: true, conversation: true, longTerm: true } }),
      why('RFC 0131 §A', 'an assistant’s conversation + long-term memory are legitimate; it MAY ship handoff'),
    ).toBe(true);
  });

  it('role outside the ["skill","assistant"] enum FAILS', () => {
    expect(
      manifest({ ...base, role: 'agent' }),
      why('RFC 0131 §A', '"agent" is not an enum value (it is the overloaded word the RFC removes)'),
    ).toBe(false);
  });
});
