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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-agent-pack-export';
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

/** Why the gate below holds, as RFC 0148 §A names it (openwop#1686: a describe-level skip recorded no disposition). */
const GATE_WHY: readonly [SoftSkipKind, string] =
  (!isAgentSupported()) ? ['inapplicable', `the host does not advertise the capability this scenario covers (isAgentSupported() is false)`] as const : 
  (!isFixtureAdvertised(FIXTURE)) ? ['blocked', `the \`${FIXTURE}\` fixture is not advertised`] as const : ['blocked', 'the gate held for no named reason'] as const;

describe('agentPackExport: workspace agents project to AgentManifest', () => {
  it('exported manifests contain required AgentManifest fields', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    const res = await driver.get('/v1/packs/export');
    if (res.status === 404 || res.status === 501) {
      // Host doesn't expose pack-export over REST; treated as skip.
      return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 501` returned early (Host doesn\'t expose pack-export over REST; treated as skip.) (seam, prior step, or fixture unavailable)');
    }
    expect(res.status, req('openwop.it.agentPackExport.exported-manifests-contain-required-agentmanifest-fields', 'RFCS/0003-agent-packs.md', 'exported manifests contain required AgentManifest fields')).toBe(200);

    const body = res.json as {
      manifests?: Array<{ agentId?: string; modelClass?: string; sourceManifestId?: string }>;
    };
    const manifests = body.manifests ?? [];
    expect(manifests.length).toBeGreaterThan(0);

    // unfailable-leg audit wave 2, 2026-09-27: only `typeof agentId ===
    // 'string'` was checked, so a host exporting `[{ agentId: 'x' }]` — no
    // persona, no modelClass, a non-namespaced id — passed a leg named
    // "required AgentManifest fields". Each exported manifest now validates
    // against schemas/agent-manifest.schema.json.
    const validate = agentManifestValidator();
    for (const m of manifests) {
      expect(typeof m.agentId).toBe('string');
      const v = validate(m);
      expect(v.ok, req('openwop.it.agentPackExport.exported-manifests-contain-required-agentmanifest-fields', 'schemas/agent-manifest.schema.json', `exported manifest ${String(m.agentId)} MUST validate as an AgentManifest (${v.errors})`)).toBe(true);
      // Exported manifests SHOULD carry sourceManifestId provenance when
      // they originated from a prior install (covered by agentPackProvenance).
    }
  });
});
