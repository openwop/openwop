/**
 * HTTP client SSRF-guard advertisement contract.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.httpClient.supported = true`.
 *
 * Verifies that any host claiming an `httpClient` surface MUST advertise
 * `ssrfGuard: true` and `maxResponseBodyBytes` — without these two,
 * the host's "call any URL" node is a vector for both SSRF and DoS.
 *
 * The actual SSRF-rejection behavior is verified by the host's
 * in-process test (`http-client.test.ts`). The conformance suite only
 * asserts the advertisement shape — driving an SSRF rejection requires
 * a deployment that doesn't set `OPENWOP_HTTP_ALLOW_PRIVATE=true`,
 * which is the operator's choice, not the suite's.
 *
 * @see SECURITY/invariants.yaml id: http-client-ssrf-guard
 * @see spec/v1/capabilities.md §`httpClient` (additive)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

async function isHttpClientSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return (
    capabilityFamily<{ supported?: boolean }>(disco.json, 'httpClient')?.supported === true
  );
}

describe('http-client-ssrf: capability advertisement contract', () => {
  it('host advertising httpClient MUST declare ssrfGuard: true + maxResponseBodyBytes', async () => {
    if (!(await isHttpClientSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[http-client-ssrf] host does not advertise httpClient; skipping');
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isHttpClientSupported())` returned early ([http-client-ssrf] host does not advertise httpClient; skipping)');
    }
    const disco = await driver.get('/.well-known/openwop');
    const cap = capabilityFamily<{
      supported?: boolean;
      ssrfGuard?: boolean;
      maxResponseBodyBytes?: number;
      methods?: unknown;
    }>(disco.json, 'httpClient');

    expect(cap?.supported, req('openwop.it.http-client-ssrf.host-advertising-httpclient-must-declare-ssrfguard-true-maxresponsebodybytes', 
      'capabilities.md §httpClient',
      'httpClient.supported MUST be a boolean',
    )).toBe(true);

    expect(cap?.ssrfGuard, req('openwop.it.http-client-ssrf.host-advertising-httpclient-must-declare-ssrfguard-true-maxresponsebodybytes', 
      'SECURITY/threat-model-secret-leakage.md (SSRF probing analog)',
      'httpClient.ssrfGuard MUST be true — a host that lets any tenant POST a workflow with arbitrary URLs without SSRF protection enables blind probing of deployer-internal services',
    )).toBe(true);

    expect(typeof cap?.maxResponseBodyBytes, req('openwop.it.http-client-ssrf.host-advertising-httpclient-must-declare-ssrfguard-true-maxresponsebodybytes', 
      'capabilities.md §httpClient',
      'httpClient.maxResponseBodyBytes MUST be a number — a host that streams unbounded response bodies into variables is a DoS vector',
    )).toBe('number');
    expect((cap?.maxResponseBodyBytes ?? 0) > 0).toBe(true);

    expect(Array.isArray(cap?.methods), req('openwop.it.http-client-ssrf.host-advertising-httpclient-must-declare-ssrfguard-true-maxresponsebodybytes', 
      'capabilities.md §httpClient',
      'httpClient.methods MUST be an array of supported HTTP methods',
    )).toBe(true);
  });
});
