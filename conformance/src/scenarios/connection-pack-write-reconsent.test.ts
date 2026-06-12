/**
 * Connection-pack write re-consent — `connection-packs.md` §Manifest clause 4
 * (RFC 0095 §B.4) — behavioral.
 *
 * Capability-gated on `capabilities.connections.packsSupported: true`
 * (soft-skips when unadvertised; hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`). Drives the
 * `POST /v1/host/sample/connection-packs/consent-plan` test seam
 * (`host-sample-test-seams.md`); hosts that haven't wired the seam
 * soft-skip (404).
 *
 * For a `scopeModel: "groups"` oauth2 provider, requesting read AND write
 * scope groups MUST plan write as a SEPARATE consent step — a host MUST NOT
 * bundle write scopes into the initial read authorization (composes with the
 * RFC 0047 write-re-consent pattern):
 *
 *   1. The plan has ≥ 2 steps when both read and write groups are requested.
 *   2. The FIRST (initial) authorization step carries no write scope group.
 *   3. A read-only request plans a single step (no spurious re-consent).
 *
 * @see spec/v1/connection-packs.md
 * @see spec/v1/host-sample-test-seams.md
 * @see RFCS/0095-connection-packs-portable-provider-definitions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE_PATH = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-github.json');

interface ConsentStep {
  groups?: Array<{ key?: string; access?: 'read' | 'write' }>;
  includesWrite?: boolean;
}

interface ConsentPlan {
  steps?: ConsentStep[];
}

describe('connection-pack-write-reconsent (RFC 0095 §B.4)', () => {
  it('write scope groups are a separate consent step, never bundled into the initial read authorization', async () => {
    const connections = await readCapabilityFamily<{ packsSupported?: boolean }>('connections');
    if (!behaviorGate('connections.packsSupported', connections?.packsSupported === true)) return;

    const manifest = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    await driver.post('/v1/host/sample/connection-packs/install', { manifest });

    const res = await driver.post('/v1/host/sample/connection-packs/consent-plan', {
      provider: 'github',
      requested: ['read', 'write'],
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const plan = res.json as ConsentPlan | undefined;
    const steps = plan?.steps ?? [];
    expect(
      steps.length >= 2,
      driver.describe(
        'connection-packs.md §Manifest clause 4',
        'requesting read + write scope groups MUST plan write as a SEPARATE consent step (≥ 2 steps)',
      ),
    ).toBe(true);
    const first = steps[0] ?? {};
    const firstHasWrite =
      first.includesWrite === true || (first.groups ?? []).some((g) => g.access === 'write');
    expect(
      firstHasWrite,
      driver.describe(
        'connection-packs.md §Manifest clause 4',
        'the INITIAL authorization step MUST NOT bundle write scopes',
      ),
    ).toBe(false);

    const readOnly = await driver.post('/v1/host/sample/connection-packs/consent-plan', {
      provider: 'github',
      requested: ['read'],
    });
    if (readOnly.status !== 404 && readOnly.status !== 403) {
      const roSteps = (readOnly.json as ConsentPlan | undefined)?.steps ?? [];
      expect(
        roSteps.length,
        driver.describe('connection-packs.md §Manifest clause 4', 'a read-only request plans a single consent step'),
      ).toBe(1);
    }
  });
});
