/**
 * Agent-level capability requirements (RFC 0092).
 *
 * Always-on, server-free schema-shape probe of the additive
 * `AgentManifest.requiresCapabilities[]`: a manifest WITH it validates, a
 * manifest WITHOUT it still validates (absent ⇒ no requirements), and a
 * non-string-array value is rejected.
 *
 * The degraded-projection behavior (an unmet key surfaced in the inventory
 * `degraded[]`) is gated on `agents.manifestRuntime` and lands with a reference
 * host (RFC 0092 §Conformance — deferred to Active → Accepted).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0092-agent-capability-requirements.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0072-agent-inventory-and-dispatch.md (the degraded[] marker)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const BASE = 'https://openwop.dev/spec/v1/';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-requires-capabilities-shape: AgentManifest.requiresCapabilities (RFC 0092 §A, server-free)', () => {
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

  it('a manifest WITH requiresCapabilities validates', () => {
    expect(
      manifest({ ...base, requiresCapabilities: ['host.workspace', 'aiProviders.toolCalling'] }),
      req('openwop.it.agent-requires-capabilities-shape.a-manifest-with-requirescapabilities-validates', 'RFC 0092 §A', 'a manifest declaring requiresCapabilities MUST validate'),
    ).toBe(true);
  });

  it('a manifest WITHOUT it still validates (absent ⇒ no requirements)', () => {
    expect(manifest(base), req('openwop.it.agent-requires-capabilities-shape.a-manifest-without-it-still-validates-absent-no-requirements', 'RFC 0092 §A', 'requiresCapabilities is optional')).toBe(true);
  });

  it('rejects a non-string-array value', () => {
    expect(
      manifest({ ...base, requiresCapabilities: [123] }),
      req('openwop.it.agent-requires-capabilities-shape.rejects-a-non-string-array-value', 'RFC 0092 §A', 'requiresCapabilities items MUST be non-empty strings'),
    ).toBe(false);
  });
});
