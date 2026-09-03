/**
 * Memory capability model — reconciled dimensions + degraded-projection shapes (RFC 0080).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.memory` declares the additive `writable` / `search` / `retention`
 *     dimensions (RFC 0080 §A), without disturbing the existing
 *     `supported` / `compaction` / `distillation` / `attribution` fields.
 *   - the `memory.search` / `memory.retention` sub-blocks validate conforming
 *     instances and reject malformed ones (`retention.ttl` non-boolean; an
 *     unknown `search.modes` enum value; an unknown property under
 *     `additionalProperties:false`).
 *   - `agent-inventory-response` declares the `memoryDegraded` (bool) +
 *     `degradedMemoryDimensions` (closed enum of the eight §A dimension names)
 *     inventory fields (RFC 0080 §C), and rejects an out-of-enum dimension.
 *   - the eight §A dimension names are stable (the `degradedMemoryDimensions` enum).
 *   - `deriveProfiles` surfaces `openwop-memory` for a read/write + long-term
 *     payload and withholds it for a `writable:false` payload (the §D predicate).
 *
 * Behavioral assertions (a live `GET /v1/agents` stamping `memoryDegraded` when an
 * agent's `memoryShape` exceeds the host's reconciled model) are gated on
 * `capabilities.agents.manifestRuntime` + `memory` and land in
 * `memory-degraded-projection.test.ts` (deferred per RFC 0080 §Conformance — the
 * degraded projection soft-skips until a reference host computes it). This scenario
 * asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md (§"Memory capability model")
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/profiles.md (§`openwop-memory`)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0080-agent-memory-capability-reconciliation.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { deriveProfiles } from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/** The canonical eight RFC 0080 §A dimension names, in table order. */
const DIMENSIONS = [
  'read',
  'write',
  'search',
  'long-term-durability',
  'compaction',
  'attribution',
  'replay-snapshot',
  'retention',
] as const;

describe('memory-capability-model-shape: reconciled dimensions (RFC 0080 §A, server-free)', () => {
  const caps = loadSchema('capabilities.schema.json');
  const memory = (caps.properties as Record<string, { properties?: Record<string, unknown> }>).memory;

  it('capabilities.memory declares the additive writable / search / retention dimensions', () => {
    for (const dim of ['writable', 'search', 'retention']) {
      expect(
        memory?.properties?.[dim],
        req('openwop.it.memory-capability-model-shape.capabilities-memory-declares-the-additive-writable-search-retention-dimensions', 'agent-memory.md §"Memory capability model"', `capabilities.memory.${dim} MUST be declared (RFC 0080 §A)`),
      ).toBeDefined();
    }
  });

  it('the pre-existing memory fields are untouched (additive, no relocation)', () => {
    for (const dim of ['supported', 'compaction', 'distillation', 'attribution']) {
      expect(
        memory?.properties?.[dim],
        req('openwop.it.memory-capability-model-shape.the-pre-existing-memory-fields-are-untouched-additive-no-relocation', 'COMPATIBILITY.md §2.1', `capabilities.memory.${dim} MUST remain (RFC 0080 is additive)`),
      ).toBeDefined();
    }
  });

  it('memory.search / memory.retention validate conforming instances and reject malformed ones', () => {
    const ajv = addFormats(new Ajv2020({ strict: false }));
    // Wrap the extracted sub-block in a standalone schema (no external $refs in the block).
    const validate = ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: { memory },
    } as Record<string, unknown>);

    expect(
      validate({ memory: { supported: true, writable: false, search: { supported: true, modes: ['semantic', 'filter'] }, retention: { ttl: true, forget: true } } }),
      req('openwop.it.memory-capability-model-shape.memory-search-memory-retention-validate-conforming-instances-and-reject-malforme', 'capabilities.md §memory', 'a full reconciled-memory advertisement MUST validate'),
    ).toBe(true);

    expect(
      validate({ memory: { retention: { ttl: 'yes' } } }),
      req('openwop.it.memory-capability-model-shape.memory-search-memory-retention-validate-conforming-instances-and-reject-malforme', 'RFC 0080 §A', 'retention.ttl MUST be boolean'),
    ).toBe(false);

    expect(
      validate({ memory: { search: { supported: true, modes: ['fuzzy'] } } }),
      req('openwop.it.memory-capability-model-shape.memory-search-memory-retention-validate-conforming-instances-and-reject-malforme', 'RFC 0080 §A', 'search.modes MUST be the closed enum [semantic, filter]'),
    ).toBe(false);

    expect(
      validate({ memory: { search: { supported: true, unknownField: 1 } } }),
      req('openwop.it.memory-capability-model-shape.memory-search-memory-retention-validate-conforming-instances-and-reject-malforme', 'RFC 0080 §A', 'memory.search MUST be additionalProperties:false'),
    ).toBe(false);
  });
});

describe('memory-capability-model-shape: degraded projection (RFC 0080 §C, server-free)', () => {
  const inventory = loadSchema('agent-inventory-response.schema.json');

  it('agent-inventory-response declares memoryDegraded + degradedMemoryDimensions', () => {
    const entry = ((inventory.$defs as Record<string, { properties?: Record<string, unknown> }>)
      .AgentInventoryEntry).properties;
    expect(
      entry?.memoryDegraded,
      req('openwop.it.memory-capability-model-shape.agent-inventory-response-declares-memorydegraded-degradedmemorydimensions', 'agent-memory.md §C-1', 'memoryDegraded MUST be declared on the inventory entry'),
    ).toBeDefined();
    expect(
      entry?.degradedMemoryDimensions,
      req('openwop.it.memory-capability-model-shape.agent-inventory-response-declares-memorydegraded-degradedmemorydimensions', 'agent-memory.md §C-1', 'degradedMemoryDimensions MUST be declared on the inventory entry'),
    ).toBeDefined();
  });

  it('degradedMemoryDimensions enumerates exactly the eight §A dimension names', () => {
    const entry = ((inventory.$defs as Record<string, { properties?: Record<string, { items?: { enum?: string[] } }> }>)
      .AgentInventoryEntry).properties;
    const enumVals = entry?.degradedMemoryDimensions?.items?.enum ?? [];
    expect(
      [...enumVals].sort(),
      req('openwop.it.memory-capability-model-shape.degradedmemorydimensions-enumerates-exactly-the-eight-a-dimension-names', 'agent-memory.md §A', 'the degraded-dimension enum MUST be the eight reconciled dimensions'),
    ).toEqual([...DIMENSIONS].sort());
  });

  it('the inventory schema round-trips a degraded entry and rejects an out-of-enum dimension', () => {
    const ajv = addFormats(new Ajv2020({ strict: false }));
    const validate = ajv.compile(inventory);
    const base = {
      agentId: 'a', persona: 'A', label: 'A', modelClass: 'standard',
      packName: 'p', packVersion: '1.0.0', toolAllowlist: [], hasHandoffSchemas: false,
    };
    expect(
      validate({ total: 1, agents: [{ ...base, memoryDegraded: true, degradedMemoryDimensions: ['write', 'long-term-durability'] }] }),
      req('openwop.it.memory-capability-model-shape.the-inventory-schema-round-trips-a-degraded-entry-and-rejects-an-out-of-enum-dim', 'agent-memory.md §C-1', 'a degraded inventory entry MUST validate'),
    ).toBe(true);
    expect(
      validate({ total: 1, agents: [{ ...base, memoryDegraded: true, degradedMemoryDimensions: ['telepathy'] }] }),
      req('openwop.it.memory-capability-model-shape.the-inventory-schema-round-trips-a-degraded-entry-and-rejects-an-out-of-enum-dim', 'agent-memory.md §C-1', 'an out-of-enum degraded dimension MUST be rejected'),
    ).toBe(false);
  });
});

describe('memory-capability-model-shape: openwop-memory derivation (RFC 0080 §D, server-free)', () => {
  it('deriveProfiles surfaces openwop-memory for a read/write + long-term host', () => {
    const c = {
      protocolVersion: '1.0',
      supportedEnvelopes: ['clarification.request'],
      schemaVersions: {},
      limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
      memory: { supported: true },
      agents: { memoryBackends: ['long-term'] },
    } as Record<string, unknown>;
    expect(
      deriveProfiles(c).includes('openwop-memory'),
      req('openwop.it.memory-capability-model-shape.deriveprofiles-surfaces-openwop-memory-for-a-read-write-long-term-host', 'profiles.md §openwop-memory', 'a read/write + long-term host MUST derive openwop-memory'),
    ).toBe(true);
  });

  it('deriveProfiles withholds openwop-memory from a read-only (writable:false) host', () => {
    const c = {
      protocolVersion: '1.0',
      supportedEnvelopes: ['clarification.request'],
      schemaVersions: {},
      limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
      memory: { supported: true, writable: false },
      agents: { memoryBackends: ['long-term'] },
    } as Record<string, unknown>;
    expect(
      deriveProfiles(c).includes('openwop-memory'),
      req('openwop.it.memory-capability-model-shape.deriveprofiles-withholds-openwop-memory-from-a-read-only-writable-false-host', 'profiles.md §openwop-memory', 'a read-only host MUST NOT derive openwop-memory'),
    ).toBe(false);
  });
});
