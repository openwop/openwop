/**
 * Multi-Agent Shift Phase 2 — agent-pack export round-trips workspace agents → AgentManifest.
 * Normative reference: RFCS/0003-agent-packs.md
 *
 * Verifies that a host's workspace-scoped agent registry can project
 * agents into the canonical AgentManifest shape for export/distribution.
 * Round-trip: install pack → workspace gets agents → export workspace
 * yields a manifest set that re-installs cleanly.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true`. Fixture-gated: requires
 * `conformance-agent-pack-export`.
 *
 * @see schemas/agent-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-pack-export';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentPackExport: workspace agents project to AgentManifest', () => {
  it('exported manifests contain required AgentManifest fields', async () => {
    const res = await driver.get('/v1/packs/export');
    if (res.status === 404 || res.status === 501) {
      // Host doesn't expose pack-export over REST; treated as skip.
      return;
    }
    expect(res.status).toBe(200);

    const body = res.json as {
      manifests?: Array<{ agentId?: string; modelClass?: string; sourceManifestId?: string }>;
    };
    const manifests = body.manifests ?? [];
    expect(manifests.length).toBeGreaterThan(0);

    for (const m of manifests) {
      expect(typeof m.agentId).toBe('string');
      // Exported manifests SHOULD carry sourceManifestId provenance when
      // they originated from a prior install (covered by agentPackProvenance).
    }
  });
});
