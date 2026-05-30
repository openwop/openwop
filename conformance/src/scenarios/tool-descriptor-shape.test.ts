/**
 * Portable tool catalog — descriptor + capability + session-event shapes (RFC 0078).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `tool-descriptor.schema.json` compiles and round-trips a conforming
 *     `ToolDescriptor`, and rejects a descriptor missing the REQUIRED
 *     `safetyTier`.
 *   - the §C-1 / §F-4 cross-field MUST is enforced: a `safetyTier: "exec"`
 *     descriptor MUST carry `source: "host-extension"` (RFC 0069 — exec is never
 *     protocol-tier); an `exec` + `node-pack` descriptor is rejected, an `exec`
 *     + `host-extension` descriptor is accepted.
 *   - `capabilities.toolCatalog` is declared with its `supported` / `sources` /
 *     `sessionLifecycle` sub-flags.
 *   - the `tool.session.opened` / `tool.session.closed` payload $defs validate
 *     conforming content-free records and reject malformed ones (a `closed`
 *     missing `outcome`; an out-of-enum `outcome`), and both event names appear
 *     in the RunEventType enum.
 *
 * Behavioral assertions (a live `GET /v1/tools` returning authorization-scoped
 * descriptors, the `404` non-disclosure, the `tool.session.*` bracket ordering)
 * are gated on `capabilities.toolCatalog.supported` and land in
 * `tool-catalog-projection.test.ts` + `tool-session-lifecycle.test.ts` (deferred
 * per RFC 0078 §Conformance — reference host deferred). This scenario asserts the
 * wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/tool-catalog.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0078-portable-tool-catalog-and-tool-session-contract.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0069-exec-class-tool-host-extension-safety-contract.md (exec ⇒ host-extension)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('tool-descriptor-shape: ToolDescriptor (RFC 0078 §C, server-free)', () => {
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const validate = ajv.compile(loadSchema('tool-descriptor.schema.json'));

  it('a conforming descriptor validates', () => {
    expect(
      validate({
        toolId: 'mcp:fs.read', source: 'mcp', title: 'Read file',
        inputSchema: { type: 'object' }, auth: { scopes: ['tools:fs:read'] },
        egress: 'none', approval: 'never', replayPolicy: 'idempotent',
        safetyTier: 'read', costHint: 'low', latencyHint: 'low',
      }),
      why('tool-catalog.md §C', 'a conforming ToolDescriptor MUST validate'),
    ).toBe(true);
  });

  it('a descriptor missing the REQUIRED safetyTier is rejected', () => {
    expect(
      validate({ toolId: 'x', source: 'mcp' }),
      why('tool-catalog.md §C', 'safetyTier is REQUIRED'),
    ).toBe(false);
  });

  it('enforces exec ⇒ host-extension (RFC 0069; §C-1/§F-4)', () => {
    expect(
      validate({ toolId: 'x-host-acme-shell', source: 'host-extension', safetyTier: 'exec', approval: 'always', egress: 'host-owned' }),
      why('tool-catalog.md §C-1', 'an exec tool sourced from host-extension MUST validate'),
    ).toBe(true);
    expect(
      validate({ toolId: 'openwop:run-shell', source: 'node-pack', safetyTier: 'exec' }),
      why('tool-catalog.md §C-1 / RFC 0069', 'an exec tool MUST NOT be protocol-tier (node-pack)'),
    ).toBe(false);
  });

  it('rejects an unknown property (additionalProperties:false)', () => {
    expect(
      validate({ toolId: 'x', source: 'mcp', safetyTier: 'read', danger: true }),
      why('tool-catalog.md §C', 'ToolDescriptor MUST be additionalProperties:false'),
    ).toBe(false);
  });
});

describe('tool-descriptor-shape: capability advertisement (RFC 0078 §A, server-free)', () => {
  it('capabilities.toolCatalog is declared with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const toolCatalog = (caps.properties as Record<string, { properties?: Record<string, unknown> }>).toolCatalog;
    expect(
      toolCatalog,
      why('capabilities.md §toolCatalog', 'capabilities.toolCatalog MUST be declared'),
    ).toBeDefined();
    for (const flag of ['supported', 'sources', 'sessionLifecycle']) {
      expect(
        toolCatalog?.properties?.[flag],
        why('tool-catalog.md §A', `capabilities.toolCatalog.${flag} MUST be declared`),
      ).toBeDefined();
    }
  });
});

describe('tool-descriptor-shape: session lifecycle events (RFC 0078 §D, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const compile = (defName: string) => ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: (payloads as { $defs: Record<string, unknown> }).$defs,
    $ref: `#/$defs/${defName}`,
  } as Record<string, unknown>);

  it('tool.session.opened validates a content-free record', () => {
    const v = compile('toolSessionOpened');
    expect(v({ sessionId: 's1', toolId: 'mcp:fs.read' }), why('tool-catalog.md §D', 'opened MUST validate')).toBe(true);
    expect(v({ toolId: 'mcp:fs.read' }), why('tool-catalog.md §D', 'opened requires sessionId')).toBe(false);
  });

  it('tool.session.closed validates + enforces the closed outcome enum', () => {
    const v = compile('toolSessionClosed');
    expect(v({ sessionId: 's1', toolId: 'mcp:fs.read', outcome: 'completed' }), why('tool-catalog.md §D', 'closed MUST validate')).toBe(true);
    expect(v({ sessionId: 's1', toolId: 'mcp:fs.read' }), why('tool-catalog.md §D', 'closed requires outcome')).toBe(false);
    expect(v({ sessionId: 's1', toolId: 'mcp:fs.read', outcome: 'exploded' }), why('tool-catalog.md §D', 'outcome is a closed enum')).toBe(false);
  });

  it('both session event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = ((runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum) ?? [];
    for (const name of ['tool.session.opened', 'tool.session.closed']) {
      expect(enumVals.includes(name), why('run-event.schema.json', `${name} MUST be in the RunEventType enum`)).toBe(true);
    }
  });
});
