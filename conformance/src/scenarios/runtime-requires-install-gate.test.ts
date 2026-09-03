/**
 * Pack runtime-requirements install gate — `registry-operations.md`
 * §"Runtime-requirement install gate" + `node-packs.md` §"Runtime platform
 * requirements" (RFC 0076 §A).
 *
 * Seam-gated behavioral scenarios for the install-time gate. A sandbox host MUST
 * evaluate a pack's `runtime.requires[]` against the primitives it will grant
 * and refuse install (`pack_runtime_requirement_unmet`) for any it won't grant —
 * rather than silently installing and failing at first invocation (the
 * `node:dns/promises` trial-load failure that motivated RFC 0076). A non-gating
 * host SHOULD instead project `runtime.requires[]` onto the pack's inventory
 * entry for operator visibility.
 *
 *   1. install-grant — requires ⊆ grant-set ⇒ install succeeds.
 *   2. install-refuse — a required primitive the host won't grant ⇒
 *      `pack_runtime_requirement_unmet { unmet, manifest, advice? }`, reusing the
 *      `capability_not_provided` envelope shape.
 *   3. non-sandbox projection — a host that does NOT gate platform access
 *      installs and projects the declared requires[] for visibility (the §A SHOULD).
 *
 * All three drive `POST /v1/host/sample/packs/install-gate` and soft-skip when
 * the host doesn't wire the seam (404). Behavior grade is `host-pending` until a
 * runtime-requires-gating host (MyndHyve is the first adopter) lights it up.
 *
 * @see spec/v1/registry-operations.md §"Runtime-requirement install gate"
 * @see spec/v1/host-sample-test-seams.md §"Open seams"
 * @see RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md §A
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { installGate } from '../lib/runtimeRequires.js';
import { req } from '../lib/requirement-ids.js';

function manifest(requires: string[]) {
  return {
    name: 'vendor.example.http',
    version: '1.0.0',
    engines: { openwop: '>=1.1 <2.0.0' },
    runtime: { language: 'javascript', entry: 'index.mjs', requires },
    nodes: [{ typeId: 'vendor.example.http.fetch', version: '1.0.0', category: 'integration', role: 'side-effect' }],
  };
}

describe('runtime-requires install gate (RFC 0076 §A)', () => {
  it('install-grant: requires ⊆ grant-set ⇒ install succeeds', async () => {
    const res = await installGate({ manifest: manifest(['net.dns']), grantSet: ['net.dns', 'net.outbound'] });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      res.status,
      req('openwop.it.runtime-requires-install-gate.install-grant-requires-grant-set-install-succeeds', 'registry-operations.md §"Runtime-requirement install gate"', 'a pack whose runtime.requires are all grantable MUST install (no refusal)'),
    ).toBe(200);
    expect(
      res.body.outcome,
      req('openwop.it.runtime-requires-install-gate.install-grant-requires-grant-set-install-succeeds', 'registry-operations.md §"Runtime-requirement install gate"', 'a granted install reports outcome:"installed"'),
    ).toBe('installed');
  });

  it('install-refuse: an ungrantable primitive ⇒ pack_runtime_requirement_unmet', async () => {
    const res = await installGate({ manifest: manifest(['net.dns']), grantSet: [] });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      res.status,
      req('openwop.it.runtime-requires-install-gate.install-refuse-an-ungrantable-primitive-pack-runtime-requirement-unmet', 'registry-operations.md §"Runtime-requirement install gate"', 'a pack requiring an ungranted primitive MUST be refused at install (not at first invocation)'),
    ).toBe(400);
    expect(
      res.body.error,
      req('openwop.it.runtime-requires-install-gate.install-refuse-an-ungrantable-primitive-pack-runtime-requirement-unmet', 'registry-operations.md §"Runtime-requirement install gate"', 'the refusal MUST carry error code pack_runtime_requirement_unmet'),
    ).toBe('pack_runtime_requirement_unmet');
    expect(
      Array.isArray(res.body.unmet) && (res.body.unmet as unknown[]).includes('net.dns'),
      req('openwop.it.runtime-requires-install-gate.install-refuse-an-ungrantable-primitive-pack-runtime-requirement-unmet', 'registry-operations.md §"Runtime-requirement install gate"', 'unmet[] MUST list the ungranted primitive(s) (capability_not_provided envelope)'),
    ).toBe(true);
    expect(
      typeof res.body.manifest === 'string' && (res.body.manifest as string).includes('vendor.example.http'),
      req('openwop.it.runtime-requires-install-gate.install-refuse-an-ungrantable-primitive-pack-runtime-requirement-unmet', 'registry-operations.md §"Runtime-requirement install gate"', 'the refusal MUST name the offending manifest (name@version)'),
    ).toBe(true);
  });

  it('non-sandbox projection: a non-gating host installs and projects requires[] (§A SHOULD)', async () => {
    const res = await installGate({ manifest: manifest(['net.dns', 'net.outbound']), gating: false });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    // A non-gating host installs unconditionally; the SHOULD is the projection.
    // If the host gates anyway (returns 400) the projection SHOULD does not apply — tolerate either install shape.
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    if (res.body.requiresProjected === undefined) return softSkip('inapplicable', 'SHOULD, not MUST — a non-projecting host is conformant');
    const projected = res.body.requiresProjected as unknown;
    expect(
      Array.isArray(projected) && ['net.dns', 'net.outbound'].every((t) => (projected as unknown[]).includes(t)),
      req('openwop.it.runtime-requires-install-gate.non-sandbox-projection-a-non-gating-host-installs-and-projects-requires-a-should', 'node-packs.md §"Runtime platform requirements"', 'a non-gating host that projects SHOULD surface the declared runtime.requires[] on the inventory entry verbatim'),
    ).toBe(true);
  });
});
