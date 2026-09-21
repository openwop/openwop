/**
 * v2-webhook-egress-refusal — the webhook egress guard REFUSES, at major 2.
 *
 * `spec/v2/core/webhooks.md` §SSRF: "At registration a host MUST reject (`400
 * webhook_url_rejected`) non-`https://` URLs, RFC 1918 and loopback and
 * link-local ranges, IPv6 ULA, cloud metadata hosts, and `localhost`."
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Until 2.33.0 NO major-2 row asserted that sentence. The scenarios that do
 * (`http-client-ssrf`, `webhook-negative`) are registered at major 1 only, and
 * the three major-2 files that name `webhook_url_rejected` name it only as the
 * soft-skip taken when a host refuses the suite's own receiver. So a v2 bundle
 * could certify `openwop-core-standard` — the profile built on `webhooks` — on a
 * host whose guard refused nothing at all.
 *
 * It was found the expensive way: the steward's own reference host had been
 * cutting its certified bundles with the guard open (`OPENWOP_WEBHOOK_ALLOW_PRIVATE`,
 * because every suite fixture was a loopback listener) and recording no
 * relaxation, which `security-defaults.md` §Relaxations forbids. Nothing in the
 * suite could see it. `conformance/README.md` even said so: "the suite cannot
 * detect an undeclared one." For THIS relaxation that was never true — a host
 * that accepts `https://127.0.0.1/…` has shown on the wire that its guard is open.
 *
 * ── The three outcomes ───────────────────────────────────────────────────────
 *   every probe refused              → executed-pass. The guard holds.
 *   a probe ACCEPTED, relaxation
 *     DECLARED (OPENWOP_HOST_RELAXATIONS
 *     names a `webhooks.*` obligation) → inapplicable, with the declaration
 *                                        quoted. The bundle carries
 *                                        `host.relaxations[]` and the owning
 *                                        profile is denied by that (RFC 0173 §A.2).
 *   a probe ACCEPTED, nothing declared → executed-FAIL — and the emitter and
 *                                        verifier deny every profile that owns
 *                                        `webhooks` (`lib/v2-profiles.ts`
 *                                        `profilesDeniedByObservedRelaxation`).
 *
 * Registration-time only, by design: every probe is a destination the suite
 * does not own, so nothing is ever delivered and an accepted registration is
 * deleted at once. Delivery-time re-resolution is a separate MUST that needs a
 * resolver the suite controls; it is not claimed here.
 *
 * @see spec/v2/core/webhooks.md §SSRF
 * @see spec/v2/core/security-defaults.md §Relaxations
 */

import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { gateFamily, v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.webhook-egress-refused';
const DOC = 'spec/v2/core/webhooks.md §SSRF';
const EVENTS = ['run.completed'];

/** One destination per class the sentence names. None is ever contacted. */
const PROBES: ReadonlyArray<{ readonly url: string; readonly cls: string }> = [
  { url: 'http://webhook-egress-probe.example.com/hook', cls: 'non-https scheme' },
  { url: 'https://127.0.0.1/openwop-egress-probe', cls: 'loopback (IPv4)' },
  { url: 'https://[::1]/openwop-egress-probe', cls: 'loopback (IPv6)' },
  { url: 'https://localhost/openwop-egress-probe', cls: 'localhost' },
  { url: 'https://10.255.255.1/openwop-egress-probe', cls: 'RFC 1918 (10/8)' },
  { url: 'https://192.168.255.1/openwop-egress-probe', cls: 'RFC 1918 (192.168/16)' },
  { url: 'https://169.254.169.254/latest/meta-data/', cls: 'link-local / cloud metadata' },
  { url: 'https://[fd00::1]/openwop-egress-probe', cls: 'IPv6 ULA' },
  // 2.35.0 — the same MUST, spelled the way a URL parser spells it. An
  // IPv4-mapped IPv6 literal is normalised to HEX (`[::ffff:127.0.0.1]` has
  // hostname `::ffff:7f00:1`), and a guard that matched only the dotted mapped
  // form let loopback, metadata and RFC 1918 through at registration and at
  // delivery. Measured on the steward's own reference host.
  // These are loopback / link-local / RFC 1918 addresses by any reading of
  // webhooks.md §SSRF, so they enforce the existing obligation — same id.
  { url: 'https://[::ffff:7f00:1]/openwop-egress-probe', cls: 'loopback as IPv4-mapped IPv6 (hex)' },
  { url: 'https://[::ffff:a9fe:a9fe]/latest/meta-data/', cls: 'cloud metadata as IPv4-mapped IPv6 (hex)' },
  { url: 'https://[::ffff:a00:1]/openwop-egress-probe', cls: 'RFC 1918 (10/8) as IPv4-mapped IPv6 (hex)' },
];

/** The `webhooks.*` obligations the operator declared relaxed, if any. */
function declaredWebhookRelaxations(): string[] {
  const raw = process.env['OPENWOP_HOST_RELAXATIONS'];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ obligation?: unknown }>;
    return (Array.isArray(parsed) ? parsed : []).map((r) => String(r.obligation ?? '')).filter((o) => o.split('.')[0] === 'webhooks');
  } catch {
    return []; // the emitter rejects unparseable JSON loudly; this file does not second-guess it
  }
}

describe('v2-webhook-egress-refusal (webhooks.md §SSRF — the guard refuses, at major 2)', () => {
  it('a webhook registration naming a destination the guard MUST refuse is refused 400 webhook_url_rejected', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');

    const accepted: string[] = [];
    const wrongCode: string[] = [];
    for (const probe of PROBES) {
      const reg = await driver.post('/webhooks', { url: probe.url, events: EVENTS });
      if (reg.status === 201) {
        accepted.push(`${probe.cls} (${probe.url})`);
        const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
        if (typeof webhookId === 'string') await driver.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
      } else if (!(reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected')) {
        wrongCode.push(`${probe.cls}: ${reg.status} ${String(readErrorCode(reg.json))}`);
      }
    }

    if (accepted.length > 0) {
      const declared = declaredWebhookRelaxations();
      if (declared.length > 0) {
        return softSkip('inapplicable', `the egress guard is relaxed and the operator DECLARED it (OPENWOP_HOST_RELAXATIONS: ${declared.join(', ')}) — the host accepted ${accepted.length} of ${PROBES.length} destinations the guard MUST refuse (${accepted.join('; ')}). The refusal cannot be witnessed on a host running relaxed; the bundle carries host.relaxations[] and the profile that owns \`webhooks\` does not certify (security-defaults.md §Relaxations)`);
      }
    }
    expect(
      accepted,
      req(ID, DOC, `a host MUST reject (400 webhook_url_rejected) non-https URLs, RFC 1918, loopback, link-local, IPv6 ULA, cloud-metadata hosts and localhost at registration — this host ACCEPTED ${accepted.length} of ${PROBES.length} (${accepted.join('; ')}) and no \`webhooks.*\` relaxation is declared in OPENWOP_HOST_RELAXATIONS. An open guard nobody declared is an UNDECLARED RELAXATION: security-defaults.md §Relaxations requires it in host.relaxations[], and no profile built on \`webhooks\` certifies either way`),
    ).toEqual([]);
    expect(
      wrongCode,
      req(ID, DOC, `the refusal MUST be 400 webhook_url_rejected (spec/v2/errors.json) — other answers: ${wrongCode.join('; ')}`),
    ).toEqual([]);
  }, 60_000);
});
