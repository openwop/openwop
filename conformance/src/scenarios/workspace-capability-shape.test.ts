/**
 * workspace-capability-shape — RFC 0059 §A advertisement-shape verification.
 *
 * Status: ACTIVE (advertisement-shape; always runs). RFC 0059 (agent
 * workspace) promoted Draft → Active 2026-05-25 — the `capabilities.workspace`
 * block has landed in `schemas/capabilities.schema.json`.
 *
 * Always runs (shape-only): when the host advertises `capabilities.workspace`,
 * its fields MUST be well-formed.
 *
 * What this scenario asserts:
 *   1. `capabilities.workspace` is either absent or a well-formed object.
 *   2. `supported` is a boolean when the block is present.
 *   3. `maxFileBytes` / `maxFiles` / `maxVersions` are positive integers when present.
 *
 * Behavioral coverage (CRUD / ETag / cross-tenant isolation / run-snapshot)
 * lands at the implementation milestone (RFC 0059 §E), capability-gated on
 * `capabilities.workspace.supported`.
 *
 * @see RFCS/0059-agent-workspace.md §A
 * @see spec/v1/agent-workspace.md §"Capability advertisement"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

interface DiscoveryWorkspace {
  supported?: boolean;
  versioned?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  maxVersions?: number;
}

interface DiscoveryDoc {
  capabilities?: { workspace?: DiscoveryWorkspace };
}

async function readWorkspace(): Promise<DiscoveryWorkspace | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'workspace') ?? null;
}

const POSITIVE_INT_FIELDS = ['maxFileBytes', 'maxFiles', 'maxVersions'] as const;

describe('workspace-capability-shape: advertisement shape (RFC 0059 §A)', () => {
  it('capabilities.workspace is either absent or well-formed', async () => {
    const ws = await readWorkspace();
    if (ws === null) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    expect(
      typeof ws.supported,
      req('openwop.it.workspace-capability-shape.capabilities-workspace-is-either-absent-or-well-formed', 
        'capabilities.schema.json §workspace',
        'capabilities.workspace.supported MUST be a boolean when workspace is advertised',
      ),
    ).toBe('boolean');
  });

  it('maxFileBytes / maxFiles / maxVersions are positive integers when present', async () => {
    const ws = await readWorkspace();
    if (ws === null) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    for (const field of POSITIVE_INT_FIELDS) {
      const v = ws[field];
      if (v === undefined) continue;
      expect(
        Number.isInteger(v) && v >= 1,
        req('openwop.it.workspace-capability-shape.maxfilebytes-maxfiles-maxversions-are-positive-integers-when-present', 'RFC 0059 §A', `capabilities.workspace.${field} MUST be an integer >= 1, got: ${v}`),
      ).toBe(true);
    }
  });
});
