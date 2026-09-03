/**
 * Host-provided safe-fetch behavior — `host-capabilities.md` §host.http
 * (`ctx.http.safeFetch`) + RFC 0076 §B.
 *
 * Seam-gated behavioral scenarios for the pack-facing `ctx.http.safeFetch`. When
 * a host advertises `capabilities.httpClient.safeFetch.supported`, the
 * host-mediated fetch MUST apply the §host.http SSRF guard (resolve→pin→connect)
 * so a pack can do outbound HTTP without reaching for `node:dns` / raw sockets:
 *
 *   1. SSRF block — a loopback / RFC 1918 / cloud-metadata target ⇒
 *      `{ outcome: "blocked", blocked: "ssrf" }`; the host MUST NOT connect.
 *   2. DNS-rebinding — a public name re-resolving to a blocked address
 *      (`simulateRebindTo`) ⇒ also blocked (the resolved IP is pinned).
 *   3. Connection-upgrade refusal — `Connection: upgrade` ⇒
 *      `{ outcome: "blocked", blocked: "upgrade" }` (no 101 socket-hijack escape).
 *   4. Audit-when-both — when `toolHooks.prePostEvents` is also advertised, a
 *      fetched call emits the `agent.toolCalled` / `agent.toolReturned` pair
 *      (`transport: "http"`).
 *
 * All drive `POST /v1/host/sample/http/safe-fetch` and soft-skip when the host
 * doesn't advertise `safeFetch` or doesn't wire the seam (404). Behavior grade
 * is `host-pending` until a `safeFetch` host lights it up. The SSRF *guarantee*
 * reuses the `http-client-ssrf-guard` SECURITY invariant — no new invariant.
 *
 * @see spec/v1/host-capabilities.md §host.http
 * @see spec/v1/host-sample-test-seams.md §"Open seams"
 * @see RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md §B
 * @see SECURITY/invariants.yaml id: http-client-ssrf-guard
 */

import { describe, it, expect } from 'vitest';
import { isSafeFetchSupported, isToolHookAuditOn, safeFetch } from '../lib/safeFetch.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('safefetch-behavior (RFC 0076 §B / §host.http)', () => {
  it('blocks a metadata-endpoint target (SSRF guard)', async () => {
    if (!(await isSafeFetchSupported())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isSafeFetchSupported())` returned early (capability absent — soft-skip)'); // capability absent — soft-skip
    const res = await safeFetch({ url: 'http://169.254.169.254/latest/meta-data/' });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip
    expect(
      res.outcome,
      req('openwop.it.safefetch-behavior.blocks-a-metadata-endpoint-target-ssrf-guard', 'host-capabilities.md §host.http', 'safeFetch MUST NOT connect to a cloud-metadata address'),
    ).toBe('blocked');
    expect(
      res.blocked,
      req('openwop.it.safefetch-behavior.blocks-a-metadata-endpoint-target-ssrf-guard', 'host-capabilities.md §host.http', 'a blocked SSRF target reports blocked:"ssrf" (http-client-ssrf-guard invariant)'),
    ).toBe('ssrf');
  });

  it('blocks a loopback target (SSRF guard)', async () => {
    if (!(await isSafeFetchSupported())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isSafeFetchSupported())` returned early');
    const res = await safeFetch({ url: 'http://127.0.0.1:6379/' });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.outcome,
      req('openwop.it.safefetch-behavior.blocks-a-loopback-target-ssrf-guard', 'host-capabilities.md §host.http', 'safeFetch MUST NOT connect to loopback'),
    ).toBe('blocked');
  });

  it('blocks DNS-rebinding (resolved IP is pinned for the connection)', async () => {
    if (!(await isSafeFetchSupported())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isSafeFetchSupported())` returned early');
    const res = await safeFetch({ url: 'http://example.com/', simulateRebindTo: '169.254.169.254' });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.outcome,
      req('openwop.it.safefetch-behavior.blocks-dns-rebinding-resolved-ip-is-pinned-for-the-connection', 'host-capabilities.md §host.http', 'a public name that re-resolves to a blocked address MUST be blocked (rebinding defeat)'),
    ).toBe('blocked');
  });

  it('refuses a Connection: upgrade request (no 101 socket-hijack escape)', async () => {
    if (!(await isSafeFetchSupported())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isSafeFetchSupported())` returned early');
    const res = await safeFetch({ url: 'https://example.com/', init: { headers: { Connection: 'upgrade' } } });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.outcome,
      req('openwop.it.safefetch-behavior.refuses-a-connection-upgrade-request-no-101-socket-hijack-escape', 'host-capabilities.md §host.http', 'safeFetch MUST refuse a connection-upgrade attempt'),
    ).toBe('blocked');
    expect(
      res.blocked,
      req('openwop.it.safefetch-behavior.refuses-a-connection-upgrade-request-no-101-socket-hijack-escape', 'host-capabilities.md §host.http', 'a refused upgrade reports blocked:"upgrade"'),
    ).toBe('upgrade');
  });

  it('emits the tool-hooks audit pair when prePostEvents is also advertised', async () => {
    if (!(await isSafeFetchSupported())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isSafeFetchSupported())` returned early');
    if (!(await isToolHookAuditOn())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isToolHookAuditOn())` returned early (audit MUST applies only when both advertised)'); // audit MUST applies only when both advertised
    const res = await safeFetch({ url: 'https://example.com/' });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    if (res.outcome !== 'fetched') return softSkip('blocked', 'precondition not met — `res.outcome !== \'fetched\'` returned early (only a completed call carries the pair) (seam, prior step, or fixture unavailable)'); // only a completed call carries the pair
    expect(
      res.toolCalled !== undefined && res.toolReturned !== undefined,
      req('openwop.it.safefetch-behavior.emits-the-tool-hooks-audit-pair-when-prepostevents-is-also-advertised', 'host-capabilities.md §host.http', 'when toolHooks.prePostEvents + safeFetch are both advertised, a safeFetch call MUST emit the agent.toolCalled/agent.toolReturned pair'),
    ).toBe(true);
    expect(
      (res.toolCalled as { transport?: string } | undefined)?.transport,
      req('openwop.it.safefetch-behavior.emits-the-tool-hooks-audit-pair-when-prepostevents-is-also-advertised', 'host-capabilities.md §host.http', 'the audit pair carries transport:"http"'),
    ).toBe('http');
  });
});
