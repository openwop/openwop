/**
 * v2-provider-conflict — RFC 0177 §D.1; `spec/v2/core/connection-packs.md`
 * §"Provider identity" and §"The qualified form".
 *
 * Suite 2.0.0, target major 2. A `provider.id` MUST be unique per host. When an
 * installed pack and a built-in, or two installed packs, define the same bare
 * id the host MUST refuse the later registration with
 * `connection_provider_conflict` (409 in `spec/v2/errors.json`); version-based
 * precedence is gone. A connector MAY name a provider by the qualified form
 * `<packName>#<id>`, which resolves only to the named pack's definition.
 *
 * Seam-gated: driven through the RFC 0095 install/resolve seams
 * (`POST /v1/host/sample/connection-packs/{install,resolve}`,
 * `spec/v1/host-sample-test-seams.md` §10; the driver rewrites the v1 seam path
 * to `/conformance/seams/sample/…` under target major 2), gated on
 * `connections.packsSupported`.
 *
 *   1. install the `connection-pack-acme-widgets` fixture (engines rewritten to
 *      admit major 2), then a second pack claiming bare `acme-widgets` → the
 *      later one is refused with connection_provider_conflict. A host that
 *      happens to ship a built-in of the same id witnesses the same rule on the
 *      FIRST install.
 *   2. `resolve { provider: "<packName>#acme-widgets" }` → resolved, source: pack.
 *
 * **Why a fictional provider id (suite 2.0.4).** Until 2.0.3 this drove
 * `connection-pack-github`, and a host that ships a built-in `github` could
 * never witness leg 2: §D.1 says the later registration of a bare id MUST be
 * refused, so the fixture did not install, and the qualified-form leg recorded
 * `blocked` — permanently, on a host whose ONLY fault was obeying the rule the
 * scenario exists to check. Measured on a production host, which carried that
 * blocked row across a dozen cuts; a bundle with any blocked row does not
 * certify (RFC 0168 §E.1). `acme-widgets` is fictional precisely so no host
 * ships it built-in and the fixture always installs. The v1 scenario
 * `connection-provider-resolution` keeps the `github` fixture: v1 resolves a
 * collision by VERSION PRECEDENCE (`spec/v1/connection-packs.md:89`) rather
 * than refusing the install, so it is not trapped by the same choice — checked
 * rather than assumed.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §D.1
 * @see spec/v2/core/connection-packs.md
 * @see spec/v1/host-sample-test-seams.md §10
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { targetMajor } from '../lib/seams.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';

const SECTION = 'connection-packs.md §"Provider identity" (RFC 0177 §D.1)';
const FIXTURE = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-acme-widgets.json');
const INSTALL = '/v1/host/sample/connection-packs/install';
const RESOLVE = '/v1/host/sample/connection-packs/resolve';

type Manifest = Record<string, unknown> & { name: string; provider: Record<string, unknown> & { id: string } };
interface InstallResult { installed?: boolean; errors?: Array<{ code?: string; path?: string }> }
interface ResolveResult { resolved?: boolean; source?: 'pack' | 'builtin'; version?: string; code?: string }

function fixture(): Manifest {
  const m = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Manifest;
  // The v1 fixture pins `>=1.0.0`; a v2 host reads that as `<2.0.0` (RFC 0177 §A.1).
  return { ...m, engines: { openwop: '>=2.0.0 <3.0.0' } };
}
function conflicting(base: Manifest): Manifest {
  return { ...base, name: `core.openwop.v2-provider-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}
function codes(r: InstallResult | undefined): string[] {
  return (r?.errors ?? []).map((e) => e.code ?? '').filter((c) => c.length > 0);
}

async function preflight(): Promise<{ kind: SoftSkipKind; reason: string } | null> {
  if (targetMajor() !== 2) return { kind: 'inapplicable', reason: 'suite 2.0.0 v2 scenario: OPENWOP_TARGET_MAJOR is not 2' };
  let doc: Record<string, unknown> | null;
  try {
    doc = await v2Discovery();
  } catch {
    doc = null;
  }
  if (!doc) return { kind: 'blocked', reason: 'discovery unreachable — /.well-known/openwop (OpenWOP-Version: 2.0) did not answer 200 JSON' };
  const connections = await familyAdvertised('connections');
  if (!behaviorGate('connections.packsSupported', connections?.['packsSupported'] === true)) return { kind: 'inapplicable', reason: 'v2 discovery does not advertise connections.packsSupported (RFC 0095 §C)' };
  if (!existsSync(FIXTURE)) return { kind: 'blocked', reason: 'fixture connection-packs/connection-pack-acme-widgets.json is absent from this layout' };
  return null;
}

/** Install the fixture; null when the seam is unwired. */
async function installFixture(): Promise<{ res: InstallResult | undefined; status: number } | null> {
  const res = await driver.post(INSTALL, { manifest: fixture() });
  if (res.status === 404 || res.status === 403) return null;
  return { res: res.json as InstallResult | undefined, status: res.status };
}

describe('v2-provider-conflict (RFC 0177 §D.1)', () => {
  it('two definitions of one bare provider id fail closed: the later registration is refused with connection_provider_conflict', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const first = await installFixture();
    if (!first) return softSkip('blocked', 'RFC 0095 install seam not mounted (404/403) — connections.packsSupported advertised but /conformance/seams/sample/connection-packs/install is absent');
    // The branch is kept for a host that somehow ships a built-in of this id:
    // the fixture is then the LATER registration and the rule fires on the
    // first install. `acme-widgets` is fictional so the normal path is the
    // second one — the fixture installs, and a second pack claiming the same
    // bare id is the later registration. Keeping the branch costs nothing and
    // means the scenario does not depend on that assumption holding.
    const later = first.res?.installed === false && codes(first.res).includes('connection_provider_conflict')
      ? first.res
      : await (async () => {
          expect(first.res?.installed, req('openwop.requirement.0177.provider-conflict.fail-closed', SECTION, `the well-formed fixture MUST install when no other definition of acme-widgets exists (got ${first.status}: ${JSON.stringify(first.res)})`)).toBe(true);
          return (await driver.post(INSTALL, { manifest: conflicting(fixture()) })).json as InstallResult | undefined;
        })();
    expect(later?.installed, req('openwop.requirement.0177.provider-conflict.fail-closed', SECTION, 'the later registration of a bare provider id MUST NOT install (no version precedence)')).toBe(false);
    expect(codes(later), req('openwop.requirement.0177.provider-conflict.fail-closed', SECTION, 'the later registration MUST be refused with connection_provider_conflict')).toContain('connection_provider_conflict');
  });

  it('the qualified form <packName>#acme-widgets resolves to the named pack\'s definition', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const first = await installFixture();
    if (!first) return softSkip('blocked', 'RFC 0095 install seam not mounted (404/403) — connections.packsSupported advertised but /conformance/seams/sample/connection-packs/install is absent');
    if (first.res?.installed !== true) return softSkip('blocked', `the fixture did not install (${codes(first.res).join(',') || first.status}) — a host with a built-in acme-widgets cannot exercise the qualified form through the pack`);
    const packName = fixture().name;
    const hit = await driver.post(RESOLVE, { provider: `${packName}#acme-widgets` });
    if (hit.status === 404) return softSkip('blocked', 'RFC 0095 resolve seam not mounted (404)');
    const resolved = hit.json as ResolveResult | undefined;
    expect(resolved?.resolved, req('openwop.requirement.0177.provider-conflict.qualified-form', 'connection-packs.md §"The qualified form" (RFC 0177 §D.1)', `${packName}#acme-widgets MUST resolve (got ${JSON.stringify(resolved)})`)).toBe(true);
    expect(resolved?.source, req('openwop.requirement.0177.provider-conflict.qualified-form', 'connection-packs.md §"The qualified form" (RFC 0177 §D.1)', 'a qualified reference resolves only to the named pack\'s definition (source: pack)')).toBe('pack');
  });
});
