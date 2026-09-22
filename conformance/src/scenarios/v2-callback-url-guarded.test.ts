/**
 * RFC 0196 §A.3 — a host that advertises `interrupt.callbackDelivery` holds
 * `createRun.callbackUrl` to the `webhooks.md` §SSRF guard at create time
 * (`spec/v2/core/interrupt.md` §Callback delivery). Target major 2.
 *
 * `callbackUrl` is an outbound request to a URL the CALLER chooses — the
 * surface the SSRF guard exists for. Measured on three hosts before the RFC:
 * one ignored it, one refused it, one delivered to it with no guard at all.
 *
 * Gated on the facet: a host that does not advertise delivery has no egress
 * here to guard (it SHOULD refuse the member, which this file does not assert).
 * No committed host advertises the facet today, so this row is witnessed on
 * none; it is written so the first host that does is held to it.
 *
 * @see spec/v2/core/interrupt.md §Callback delivery
 * @see RFCS/0196-callbackurl-and-embedded-ipv4-egress.md §A.3
 */
import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0196.callback-url-guarded';
const DOC = 'spec/v2/core/interrupt.md §Callback delivery (RFC 0196 §A.3)';
const FIXTURE = 'conformance-approval';
const PROBES = [
  { url: 'https://127.0.0.1/openwop-callback-probe', cls: 'loopback (IPv4)' },
  { url: 'https://169.254.169.254/latest/meta-data/', cls: 'cloud metadata' },
  { url: 'https://[::ffff:7f00:1]/openwop-callback-probe', cls: 'loopback as IPv4-mapped IPv6 (hex)' },
];

describe('v2 callbackUrl egress guard (RFC 0196 §A.3)', () => {
  it('a host advertising callback delivery refuses a callbackUrl its egress guard would refuse', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const fam = await gateFamily('interrupt');
    if (!fam) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (fam['callbackDelivery'] !== true) return softSkip('inapplicable', 'the host does not advertise interrupt.callbackDelivery — it delivers nothing to callbackUrl, so there is no egress to guard (RFC 0196 §A.2: it SHOULD refuse the member)');
    const workflowId = isFixtureAdvertised(FIXTURE) ? FIXTURE : 'conformance-noop';
    const accepted: string[] = [];
    const wrong: string[] = [];
    for (const p of PROBES) {
      const r = await driver.post('/runs', { workflowId, callbackUrl: p.url });
      if (r.status === 201) { accepted.push(`${p.cls} (${p.url})`); const id = (r.json as { runId?: unknown } | null)?.runId; if (typeof id === 'string') await driver.post(`/runs/${encodeURIComponent(id)}/cancel`, {}).catch(() => undefined); continue; }
      const field = (r.json as { details?: { field?: unknown } } | null)?.details?.field;
      if (r.status !== 400 || readErrorCode(r.json) !== 'validation_error' || field !== 'callbackUrl') wrong.push(`${p.cls}: ${r.status} ${readErrorCode(r.json) ?? ''} field=${String(field)}`);
    }
    expect(accepted, req(ID, DOC, 'a host advertising interrupt.callbackDelivery MUST refuse at createRun a callbackUrl the webhooks.md §SSRF registration guard would refuse')).toEqual([]);
    expect(wrong, req(ID, DOC, 'the refusal MUST be 400 validation_error naming details.field "callbackUrl"')).toEqual([]);
  });
});
