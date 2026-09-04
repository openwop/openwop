/**
 * RFC 0175 §D.3 — `negotiation-decided-emitted` (suite 2.0.0, target major 2; gated on a2a/mcp + seams).
 *
 * Every negotiation outcome — including the refused one — MUST emit a
 * content-free `negotiation.decided` event on the host's own event log
 * (`schemas/v2/run-event-payloads.schema.json#/$defs/negotiationDecided`:
 * `{ protocol, outcome, version?, floor?, peerDigest?, reason?, at }`, the peer
 * as a SHA-256 digest of its origin, never in clear). The event on the host's
 * log is the NORMATIVE witness of the silent-downgrade invariants; the seams
 * profile drives the exchange (`spec/v2/core/interop.md` §The audit event;
 * RFC 0175 §D.3/§D.5, row C8.5).
 *
 * How the exchange is driven: exactly as the v1 versioned-composition
 * scenarios do (`a2a-version-negotiation.test.ts`, `mcp-version-negotiation.test.ts`)
 * — the host's real client path is pointed at the suite's fake peer / server
 * through the §22/§23 invoke seams (`/conformance/seams/sample/{a2a,mcp}/invoke`
 * under the v2 seams profile). The seam's `200` answers with the run whose log
 * carries the event (`runId`); the event is then read on the normative surface
 * (`GET /runs/{runId}/events/poll`). A seam answer without a `runId` leaves the
 * log unaddressable and records `blocked`.
 *
 * Callback-shaped (the host calls the suite's peer): unwitnessable when the
 * host is in a separate network namespace — `../lib/host-callback.ts`.
 *
 * @see spec/v2/core/interop.md §Negotiation is a protocol
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A/MCP client calls the suite's fake peer/server through the invoke seams; the negotiation.decided event is then read on the host's own log";

const EVENT = 'negotiation.decided';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** Ajv over the `negotiationDecided` payload definition (self-contained — no $refs). */
function payloadValidator(): ((p: unknown) => { ok: boolean; errors: string }) | null {
  const path = join(SCHEMAS_DIR, 'v2', 'run-event-payloads.schema.json');
  let def: unknown;
  try {
    def = (JSON.parse(readFileSync(path, 'utf8')) as { $defs?: Record<string, unknown> }).$defs?.['negotiationDecided'];
  } catch { return null; }
  if (!def || typeof def !== 'object') return null;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(def as Record<string, unknown>);
  return (p) => ({ ok: validate(p) as boolean, errors: ajv.errorsText(validate.errors, { separator: '; ' }) });
}

interface EventRow { type?: unknown; payload?: Record<string, unknown>; sequence?: unknown }
async function eventsOf(runId: string): Promise<EventRow[]> {
  const res = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  return res.status === 200 ? ((res.json as { events?: EventRow[] } | null)?.events ?? []) : [];
}

/** Drive one exchange; returns the seam response or null with the reason recorded. */
async function drive(protocol: 'a2a' | 'mcp', peerUrl: string): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const path = `${SEAMS_PREFIX}/sample/${protocol}/invoke`;
  const res = await driver.post(path, protocol === 'a2a' ? { peerUrl } : { serverUrl: peerUrl });
  if (res.status === 404 || res.status === 403 || res.status === 405) {
    seamAbsent(`host advertises ${protocol} but the invoke seam ${path} answered ${res.status} — the exchange cannot be driven (host-sample-test-seams.md §22/§23)`);
    return null;
  }
  return { status: res.status, body: (res.json ?? {}) as Record<string, unknown> };
}

function originDigest(url: string): string {
  return createHash('sha256').update(new URL(url).origin, 'utf8').digest('hex');
}

async function leg(protocol: 'a2a' | 'mcp', id: string): Promise<void> {
  const doc = await discovery();
  if (!doc) return softSkip('blocked', 'discovery unreachable');
  const facet = await familyAdvertised(protocol);
  if (!facet) return softSkip('inapplicable', `${protocol} facet not advertised — no negotiation to audit`);
  if (!seamsProfileAdvertised(doc)) return softSkip('blocked', `the exchange is driven through the seams profile (RFC 0175 §D.3) — conformance.seamsProfile is not openwop-conformance-seams-v2`);
  const peer = protocol === 'a2a' ? getA2AFakePeer() : getMcpFakeServer();
  if (peer === null) return softSkip('blocked', `the suite ${protocol === 'a2a' ? 'A2A fake peer (OPENWOP_A2A_FAKE_PEER=true)' : 'MCP fake server (OPENWOP_MCP_FAKE_SERVER=true)'} is not started in this run`);
  peer.reset();
  const validate = payloadValidator();
  if (!validate) return softSkip('blocked', 'run-event-payloads.schema.json#/$defs/negotiationDecided not readable from SCHEMAS_DIR');

  const driven = await drive(protocol, peer.endpoint());
  if (!driven) return softSkip('blocked', 'invoke seam unavailable (reason recorded above)');
  const runId = driven.body['runId'];
  if (typeof runId !== 'string') {
    return softSkip('blocked', `the ${protocol} invoke seam answered ${driven.status} without a runId — the host log that carries ${EVENT} is not addressable from the suite (the seam MUST name the run whose log recorded the decision)`);
  }
  const events = await eventsOf(runId);
  const decided = events.filter((e) => e.type === EVENT);
  expect(
    decided.length,
    req(id, 'interop.md §The audit event', `every ${protocol} negotiation outcome MUST emit ${EVENT} on the host's own event log (RFC 0175 §D.3) — none found on run ${runId}`),
  ).toBeGreaterThan(0);
  const outcomeExpected = driven.status < 400 ? 'accepted' : 'refused';
  for (const e of decided) {
    const p = e.payload ?? {};
    const check = validate(p);
    expect(check.ok, req(id, 'run-event-payloads.schema.json negotiationDecided', `the payload MUST validate: ${check.errors}`)).toBe(true);
    expect(p['protocol'], req(id, 'run-event-payloads.schema.json negotiationDecided.protocol', `protocol MUST be ${protocol}`)).toBe(protocol);
    if (typeof p['peerDigest'] === 'string') {
      expect(
        p['peerDigest'],
        req(id, 'interop.md §The audit event', 'peerDigest MUST be the SHA-256 of the peer origin — never the origin in clear (RFC 0175 §D.3)'),
      ).toBe(originDigest(peer.endpoint()));
    }
    for (const v of Object.values(p)) {
      expect(
        typeof v === 'string' && v.includes(new URL(peer.endpoint()).host),
        req(id, 'interop.md §The audit event', 'the event is content-free: the peer origin MUST NOT appear in clear in any field'),
      ).toBe(false);
    }
  }
  const last = decided[decided.length - 1]!.payload ?? {};
  expect(
    last['outcome'],
    req(id, 'run-event-payloads.schema.json negotiationDecided.outcome', `the seam answered ${driven.status}, so the recorded outcome MUST be ${outcomeExpected}`),
  ).toBe(outcomeExpected);
  if (driven.status < 400) {
    expect(
      last['version'],
      req(id, 'interop.md §The audit event', 'an accepted negotiation records the version the host actually used, which MUST equal the seam-reported negotiatedVersion'),
    ).toBe(driven.body['negotiatedVersion']);
  }
}

describe('RFC 0175 §D.3 — negotiation-decided-emitted (gated on a2a/mcp + seams)', () => {
  it('an A2A exchange leaves negotiation.decided on the host log', async () => {
    await leg('a2a', 'openwop.requirement.0175.negotiation-decided-emitted');
  });
  it('an MCP exchange leaves negotiation.decided on the host log', async () => {
    await leg('mcp', 'openwop.requirement.0175.negotiation-decided-emitted.mcp');
  });
});
