/**
 * Multi-Agent Shift Phase 2 — agent-pack install registers AgentManifest entries.
 * Normative reference: RFCS/0003-agent-packs.md
 *
 * Verifies that a pack containing an `agents[]` array surfaces those
 * agent manifests via the host's pack registry. The wire-shape contract
 * for AgentManifest entries is `schemas/agent-manifest.schema.json`.
 *
 * Capability-gated: skips when host doesn't advertise either
 * `capabilities.agents.supported: true` OR the pack-registry surface
 * (registry-operations.md). Fixture-gated: requires
 * `conformance-agent-pack-install` advertised.
 *
 * @see schemas/agent-manifest.schema.json
 * @see spec/v1/node-packs.md §`Manifest format`
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-agent-pack-install';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

/**
 * The AgentManifest validator (major 1 — this file is `[1]` in
 * scenario-majors.json). Peers are pre-loaded exactly as `fixtures-valid`
 * does: agent-manifest → prompt-ref → prompt-kind, under both the canonical
 * `$id` and the relative file name.
 */
function agentManifestValidator(): (doc: unknown) => { ok: boolean; errors: string } {
  const load = (n: string): Record<string, unknown> => JSON.parse(readFileSync(join(SCHEMAS_DIR, n), 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const promptRef = load('prompt-ref.schema.json');
  const promptKind = load('prompt-kind.schema.json');
  ajv.addSchema(promptRef, 'prompt-ref.schema.json');
  ajv.addSchema(promptRef, './prompt-ref.schema.json');
  ajv.addSchema(promptKind, 'prompt-kind.schema.json');
  ajv.addSchema(promptKind, './prompt-kind.schema.json');
  const validate = ajv.compile(load('agent-manifest.schema.json'));
  return (doc: unknown) => ({ ok: validate(doc) as boolean, errors: ajv.errorsText(validate.errors, { separator: '; ' }) });
}

describe.skipIf(SKIP)('agentPackInstall: pack agents[] entries surface as AgentManifest', () => {
  it('host exposes installed agent manifests with required AgentManifest fields', async () => {
    // Host-specific pack-listing endpoint. The conformance suite probes
    // common paths; hosts that don't expose pack listings via REST mark
    // this scenario as skip via their own capability advertisement.
    const res = await driver.get('/v1/packs');
    if (res.status === 404 || res.status === 501) {
      // Host doesn't expose pack registry over REST; scenario assertion is
      // skipped (capability surface is host-internal).
      return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 501` returned early (Host doesn\'t expose pack registry over REST; scenario assertion is skipped (capability surface is host-internal).) (seam, prior step, o…');
    }
    expect(res.status, req('openwop.it.agentPackInstall.host-exposes-installed-agent-manifests-with-required-agentmanifest-fields', 'RFCS/0003-agent-packs.md', 'host exposes installed agent manifests with required AgentManifest fields')).toBe(200);

    const body = res.json as {
      packs?: Array<{ agents?: Array<{ agentId?: string; modelClass?: string }> }>;
    };
    const packs = body.packs ?? [];
    const allAgents = packs.flatMap((p) => p.agents ?? []);

    expect(allAgents.length).toBeGreaterThan(0);
    // unfailable-leg audit wave 2, 2026-09-27: only a >=3-char string agentId
    // was checked, so a host listing `agents: [{ agentId: 'abc' }]` passed a
    // leg named "required AgentManifest fields". Each surfaced agents[] entry
    // now validates against schemas/agent-manifest.schema.json.
    const validate = agentManifestValidator();
    for (const a of allAgents) {
      expect(typeof a.agentId).toBe('string');
      expect(a.agentId!.length).toBeGreaterThanOrEqual(3);
      const v = validate(a);
      expect(v.ok, req('openwop.it.agentPackInstall.host-exposes-installed-agent-manifests-with-required-agentmanifest-fields', 'schemas/agent-manifest.schema.json', `pack agents[] entry ${String(a.agentId)} MUST validate as an AgentManifest (${v.errors})`)).toBe(true);
    }
  });
});
