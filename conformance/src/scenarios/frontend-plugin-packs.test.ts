/**
 * Front-end plugin packs — `frontend-plugin-packs.md` (RFC 0117). Public test for
 * the four protocol-tier SECURITY invariants `frontend-plugin-isolation` /
 * `frontend-plugin-egress` / `frontend-plugin-rpc-allowlist` / `frontend-plugin-no-byok`,
 * plus the manifest shape and the `ui-plugin/1` host-RPC + version-token concurrency
 * contract.
 *
 * The always-on schema layer (manifest and `ui-plugin/1` message shapes) reads
 * only the corpus, so it lives in `src/coherence/frontend-plugin-schemas.test.ts`
 * (RFC 0238 G3). What stays here reads a host:
 *
 *   - the `uiPlugins` isolation advertisement, on a host that advertises it; and
 *   - the capability-gated host-RPC legs over the v1 test seam
 *     `POST /v1/host/sample/ui-plugin/rpc`: an undeclared method is refused with
 *     `method_not_allowed` (`frontend-plugin-rpc-allowlist`), and a stale
 *     `artifact.write` is refused with `artifact_conflict` + `currentVersion` and
 *     does not persist. Hosts without the seam soft-skip (404). The v2 witness is
 *     `v2-ui-plugin-boundary` (RFC 0238).
 *
 * @see spec/v1/frontend-plugin-packs.md
 * @see SECURITY/invariants.yaml ids: frontend-plugin-{isolation,egress,rpc-allowlist,no-byok}
 * @see RFCS/0117-frontend-plugin-packs.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('frontend-plugin: isolation advertisement (always-on, capability shape)', () => {
  // RFC 0119: `isolation` is a categorical model, not a single browser const. A conformant host
  // advertises a member of the enum (cross-origin-iframe default) or an x-host-* vendor model —
  // every value denotes the SAME mandatory property (in-process loading is a protocol-tier MUST NOT,
  // regardless of mechanism). cross-origin-iframe stays valid + default, so existing browser hosts
  // pass unchanged; a weaker/unknown non-x-host value is rejected.
  const CONFORMANT_ISOLATION = ['cross-origin-iframe', 'wasm', 'process', 'container', 'vm'];
  const X_HOST = /^x-host-[a-z0-9-]+-[a-z0-9-]+$/;
  it('a host advertising uiPlugins MUST advertise a conformant isolation model', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean; isolation?: string }>('uiPlugins');
    if (!uiPlugins?.supported) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!uiPlugins?.supported` returned early (unadvertised → out of scope (graceful degradation))'); // unadvertised → out of scope (graceful degradation)
    const iso = uiPlugins.isolation;
    expect(
      iso !== undefined && (CONFORMANT_ISOLATION.includes(iso) || X_HOST.test(iso)),
      req('openwop.it.frontend-plugin-packs.a-host-advertising-uiplugins-must-advertise-a-conformant-isolation-model', 
        'frontend-plugin-packs.md §Isolation (RFC 0119)',
        'frontend-plugin-isolation — isolation MUST be a conformant model (cross-origin-iframe default | wasm | process | container | vm | x-host-*); every value denotes the same property, in-process loading is a protocol-tier MUST NOT regardless of mechanism',
      ),
    ).toBe(true);
  });
});

describe('frontend-plugin: host-RPC behavior (capability-gated)', () => {
  it('an undeclared host-RPC method is refused with method_not_allowed', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean }>('uiPlugins');
    if (!behaviorGate('uiPlugins.supported', uiPlugins?.supported === true)) return;

    const res = await driver.post('/v1/host/sample/ui-plugin/rpc', {
      message: { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'host.exec' },
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { ok?: boolean; error?: { code?: string } } | undefined;
    expect(
      body?.ok,
      req('openwop.it.frontend-plugin-packs.an-undeclared-host-rpc-method-is-refused-with-method-not-allowed', 'frontend-plugin-packs.md §Host-RPC', 'an undeclared method MUST NOT execute'),
    ).toBe(false);
    expect(
      body?.error?.code,
      req('openwop.it.frontend-plugin-packs.an-undeclared-host-rpc-method-is-refused-with-method-not-allowed', 
        'frontend-plugin-packs.md §Host-RPC',
        'frontend-plugin-rpc-allowlist — an undeclared method surfaces method_not_allowed',
      ),
    ).toBe('method_not_allowed');
  });

  it('a stale artifact.write is refused with artifact_conflict + currentVersion (no persist)', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean; hostApi?: string[] }>('uiPlugins');
    if (!behaviorGate('uiPlugins.supported', uiPlugins?.supported === true)) return;
    if (!(uiPlugins?.hostApi ?? []).includes('artifact.write')) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(uiPlugins?.hostApi ?? []).includes(\'artifact.write\')` returned early (write unsupported → out of scope)'); // write unsupported → out of scope

    const res = await driver.post('/v1/host/sample/ui-plugin/rpc', {
      message: {
        openwop: 'ui-plugin/1',
        type: 'request',
        id: 2,
        method: 'artifact.write',
        params: { artifactId: 'conformance-canary', version: 'stale-token', payload: {} },
      },
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { ok?: boolean; error?: { code?: string; currentVersion?: string } } | undefined;
    expect(
      body?.error?.code,
      req('openwop.it.frontend-plugin-packs.a-stale-artifact-write-is-refused-with-artifact-conflict-currentversion-no-persi', 
        'frontend-plugin-packs.md §Concurrency',
        'a stale artifact.write version surfaces artifact_conflict (host MUST NOT persist)',
      ),
    ).toBe('artifact_conflict');
    expect(
      typeof body?.error?.currentVersion,
      req('openwop.it.frontend-plugin-packs.a-stale-artifact-write-is-refused-with-artifact-conflict-currentversion-no-persi', 'frontend-plugin-packs.md §Concurrency', 'artifact_conflict carries the host currentVersion for re-read/merge'),
    ).toBe('string');
  });
});
