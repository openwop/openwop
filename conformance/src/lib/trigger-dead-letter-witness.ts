/**
 * The trigger dead-letter read witness (RFC 0232), leg 4's normative-surface
 * path in `trigger-bridge-delivery.test.ts`.
 *
 * A dead-lettered trigger delivery started no run, so it is on no run's log.
 * On a host that serves no test seam, the only place the suite can see it is
 * `GET /v1/trigger-subscriptions/{id}/dead-letters`. The suite causes one
 * unaided: it posts a body carrying a canary with a bad signature to a
 * `required` subscription (RFC 0230 leg 2), then reads the subscription's
 * dead letters.
 *
 * Two halves: {@link readDeadLetters} observes and asserts nothing; {@link judge}
 * is pure, so each defect it convicts is proven in `trigger-dead-letter-witness.test.ts`.
 *
 * Not witnessed here: a record's `stateChange`. No wire surface causes a
 * subscription state change on a host without the seam (RFC 0232 gap G2), so
 * that half of leg 4 stays seam-witnessed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from './driver.js';
import { SCHEMAS_DIR } from './paths.js';

export interface DeadLetterFacet {
  readonly retentionDays: number;
  readonly maxPageSize: number;
}

/** The advertised `triggerBridge.deadLetter` facet, or null when the host does not advertise it. */
export function deadLetterFacet(discovery: unknown): DeadLetterFacet | null {
  const d = discovery as { triggerBridge?: unknown; capabilities?: { triggerBridge?: unknown } } | null | undefined;
  const tb = (d?.triggerBridge ?? d?.capabilities?.triggerBridge) as { deadLetter?: unknown } | undefined;
  const f = tb?.deadLetter as { retentionDays?: unknown; maxPageSize?: unknown } | undefined;
  if (f === undefined || f === null || typeof f !== 'object') return null;
  if (typeof f.retentionDays !== 'number' || typeof f.maxPageSize !== 'number') return null;
  return { retentionDays: f.retentionDays, maxPageSize: f.maxPageSize };
}

/** A canary no conforming record can contain: it only ever travels in the refused body. */
export function freshCanary(): string {
  return `openwop-canary-${randomBytes(9).toString('hex')}`;
}

export interface DeadLetterRead {
  readonly status: number;
  readonly json: unknown;
}

/** GET one page of a subscription's dead letters. Asserts nothing. */
export async function readDeadLetters(subscriptionId: string, query: { limit?: number; cursor?: string } = {}): Promise<DeadLetterRead> {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor !== undefined) qs.set('cursor', query.cursor);
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
  const res = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(subscriptionId)}/dead-letters${suffix}`);
  return { status: res.status, json: res.json };
}

let pageValidator: ((v: unknown) => boolean) & { errors?: unknown } | undefined;
/** Validate a page against `trigger-dead-letter-page.schema.json` (v1), resolving the event payload `$ref`s. */
export function validatePage(page: unknown): { ok: boolean; errors: string } {
  if (pageValidator === undefined) {
    const ajv = addFormats(new Ajv2020({ strict: false }));
    const load = (n: string): Record<string, unknown> => JSON.parse(readFileSync(join(SCHEMAS_DIR, n), 'utf8')) as Record<string, unknown>;
    const payloads = load('run-event-payloads.schema.json');
    // Both carry `https://openwop.dev/spec/v1/…` ids, so the page's relative
    // `run-event-payloads.schema.json#/$defs/…` refs resolve to this schema.
    ajv.addSchema(payloads);
    pageValidator = ajv.compile(load('trigger-dead-letter-page.schema.json'));
  }
  const ok = pageValidator(page) === true;
  return { ok, errors: ok ? '' : JSON.stringify(pageValidator.errors ?? []).slice(0, 400) };
}

/** What the suite posted, so the judge can look for it in the record. */
export interface RefusedPost {
  readonly subscriptionId: string;
  readonly canary: string;
  readonly signature: string;
  readonly signingSecret: string;
  readonly retentionDays: number;
}

export type DeadLetterRule = 'page-valid' | 'present' | 'content-free' | 'attempt-shape' | 'no-state-change' | 'retention';

export interface DeadLetterFinding {
  readonly rule: DeadLetterRule;
  readonly ok: boolean;
  readonly message: string;
}

const DAY_MS = 86_400_000;
/** One minute of slack either way: hosts round timestamps. */
const RETENTION_SLACK_MS = 60_000;

/**
 * Judge one read against the refused post that should have produced a record.
 * Pure. `validate` defaults to {@link validatePage}; the unit tests pass it in.
 */
export function judge(read: DeadLetterRead, post: RefusedPost, validate: (page: unknown) => { ok: boolean; errors: string } = validatePage): DeadLetterFinding[] {
  const out: DeadLetterFinding[] = [];
  if (read.status !== 200) {
    out.push({ rule: 'page-valid', ok: false, message: `a host advertising triggerBridge.deadLetter MUST serve the read (answered ${read.status})` });
    return out;
  }
  const v = validate(read.json);
  out.push({ rule: 'page-valid', ok: v.ok, message: `the page MUST validate against trigger-dead-letter-page.schema.json${v.ok ? '' : `: ${v.errors}`}` });

  const deliveries = ((read.json as { deliveries?: unknown } | undefined)?.deliveries ?? []) as Array<Record<string, unknown>>;
  const mine = Array.isArray(deliveries)
    ? deliveries.filter((r) => r !== null && typeof r === 'object' && r['reason'] === 'verification_failed' && r['subscriptionId'] === post.subscriptionId)
    : [];
  out.push({ rule: 'present', ok: mine.length >= 1, message: `the refused delivery MUST appear with reason "verification_failed" (saw ${Array.isArray(deliveries) ? deliveries.length : 0} record(s), ${mine.length} matching)` });

  // Content-free: the canary, the signature and the secret appear nowhere in
  // ANY record on the page, not just the matched one — a host that leaked them
  // into a record it mis-labelled is still leaking them.
  const text = JSON.stringify(read.json ?? null);
  const leaked = [['the canary from the refused body', post.canary], ['the signature', post.signature], ['the signing secret', post.signingSecret]]
    .filter(([, needle]) => needle !== '' && text.includes(needle as string)).map(([what]) => what);
  const secretKey = post.signingSecret.replace(/^whsec_/, '');
  if (secretKey !== '' && secretKey !== post.signingSecret && text.includes(secretKey)) leaked.push('the signing key');
  out.push({ rule: 'content-free', ok: leaked.length === 0, message: `a record MUST NOT carry inbound content or credentials (found ${leaked.join(', ') || 'none'})` });

  const rec = mine[0];
  if (rec !== undefined) {
    const attempt = rec['attempt'] as Record<string, unknown> | undefined;
    const attemptOk = attempt !== undefined && attempt !== null && typeof attempt === 'object'
      && attempt['outcome'] === 'dead-lettered' && attempt['subscriptionId'] === post.subscriptionId;
    out.push({ rule: 'attempt-shape', ok: attemptOk, message: `attempt MUST be the dead-lettered trigger.delivery.attempted payload for this subscription (got ${JSON.stringify(attempt ?? null).slice(0, 200)})` });
    out.push({ rule: 'no-state-change', ok: !('stateChange' in rec), message: 'a delivery refused by verification MUST NOT carry a stateChange (a refused event MUST NOT change the subscription\'s state)' });
    const from = Date.parse(String(rec['deadLetteredAt']));
    const to = Date.parse(String(rec['expiresAt']));
    const want = post.retentionDays * DAY_MS;
    const retentionOk = Number.isFinite(from) && Number.isFinite(to) && Math.abs((to - from) - want) <= RETENTION_SLACK_MS;
    out.push({ rule: 'retention', ok: retentionOk, message: `expiresAt − deadLetteredAt MUST match retentionDays (${post.retentionDays}); got ${Number.isFinite(to - from) ? `${((to - from) / DAY_MS).toFixed(4)} days` : 'unparseable timestamps'}` });
  }
  return out;
}
