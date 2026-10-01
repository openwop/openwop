/**
 * The backpressure witness, shared by every major (`major-profile.ts`).
 *
 * A host that advertises `production.backpressure.inflightCap` names a number
 * the suite can saturate: `cap` long-lived requests hold the slots and the
 * next request must be refused `503 service_unavailable` with `Retry-After`.
 *
 * Two halves, so each can be proven alone:
 *   - {@link saturate} drives the host and returns what it saw (or why it
 *     could not see anything). It asserts nothing.
 *   - {@link judge} is pure: observation in, findings out. The scenario turns
 *     findings into `expect` calls; the self-test feeds it a conforming and a
 *     defective observation and checks the verdicts differ.
 *
 * Run with `--no-file-parallelism`: saturating the cap leaves no headroom for
 * a neighbouring scenario's requests.
 */

import { driver, type OpenWOPResponse } from './driver.js';
import { loadEnv } from './env.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';

/** The long-running fixture that holds a slot, and the cheap one that probes. */
export const HOLD_FIXTURE = 'conformance-delay';
export const PROBE_FIXTURE = 'conformance-noop';
/** Long enough that the first slot is still held when the last is filled; the runs are cancelled afterwards. */
const HOLD_MS = 15_000;
/** The most streams the suite will hold open. A larger advertised cap is not saturated. */
export const MAX_SATURABLE_CAP = 64;
const STREAM_OPEN_MS = 5_000;
const RETRY_DETAIL_KEYS = ['retryAfter', 'retryAfterMs', 'retryAfterSeconds'] as const;

export interface Refusal {
  readonly cap: number;
  readonly status: number;
  readonly code: string | undefined;
  readonly retryAfterHeader: string | null;
  readonly details: Record<string, unknown> | null;
  readonly advertisedRetryAfterSeconds: number | undefined;
}
export type Saturation =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

export interface Finding {
  /** Which rule the finding is about; the scenario maps it to a requirement id. */
  readonly rule: 'refusal' | 'retry-after-advertised' | 'retry-timing';
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** Hold `cap` slots with long-lived event streams, send one more request, and report its answer. */
export async function saturate(profile: MajorProfile, discovery: unknown): Promise<Saturation> {
  const production = profile.family(discovery, 'production');
  if (production === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise production' };
  const bp = production['backpressure'];
  if (!isRecord(bp)) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise production.backpressure' };
  const cap = bp['inflightCap'];
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1) {
    return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise production.backpressure.inflightCap — there is no cap the suite can saturate' };
  }
  if (cap > MAX_SATURABLE_CAP) return { kind: 'skip', disposition: 'inapplicable', reason: `inflightCap ${cap} is above the ${MAX_SATURABLE_CAP} streams the suite will hold open — not saturated` };
  for (const f of [HOLD_FIXTURE, PROBE_FIXTURE]) {
    if (!isFixtureAdvertised(f)) return { kind: 'skip', disposition: 'inapplicable', reason: `${f} fixture not advertised — the suite cannot hold or probe a slot` };
  }

  const env = loadEnv();
  const streams: AbortController[] = [];
  const pending: Promise<number | null>[] = [];
  const runIds: string[] = [];
  try {
    for (let i = 0; i < cap; i++) {
      const created = await http(() => driver.post(profile.runsPath, { workflowId: HOLD_FIXTURE, inputs: { delayMs: HOLD_MS } }));
      if (created === null) return { kind: 'skip', disposition: 'blocked', reason: `POST ${profile.runsPath} unreachable while filling slot ${i + 1} of ${cap}` };
      const runId = (created.json as { runId?: unknown } | undefined)?.runId;
      if (created.status !== 201 || typeof runId !== 'string') {
        return { kind: 'skip', disposition: 'blocked', reason: `slot ${i + 1} of ${cap} could not be filled: POST ${profile.runsPath} answered ${created.status} ${readErrorCode(created.json) ?? ''} (already saturated by a parallel file? run with --no-file-parallelism)`.trim() };
      }
      runIds.push(runId);
      const ctl = new AbortController();
      streams.push(ctl);
      // `Accept: text/event-stream` keeps the request in flight; without it a
      // negotiating host answers a one-shot snapshot and the slot drops.
      const stream = fetch(`${env.baseUrl}${profile.runsPath}/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${env.apiKey}`, Accept: 'text/event-stream', ...profile.versionHeaders },
        signal: ctl.signal,
      }).then((r) => r.status, () => null);
      pending.push(stream);
      // The slot is held once the stream's headers are back, not after a
      // guessed delay. A probe sent before that would convict a host for a slot
      // the suite had not yet taken.
      const opened = await Promise.race([stream, new Promise<'slow'>((r) => setTimeout(() => r('slow'), STREAM_OPEN_MS))]);
      if (opened !== 200) {
        return { kind: 'skip', disposition: 'blocked', reason: `slot ${i + 1} of ${cap} was not held: the event stream ${opened === 'slow' ? `did not open within ${STREAM_OPEN_MS} ms` : opened === null ? 'failed to connect' : `answered ${opened}`}` };
      }
    }

    const probe = await http(() => driver.post(profile.runsPath, { workflowId: PROBE_FIXTURE }));
    if (probe === null) return { kind: 'skip', disposition: 'blocked', reason: `the cap+1 probe got no response (POST ${profile.runsPath})` };
    const accepted = (probe.json as { runId?: unknown } | undefined)?.runId;
    if (probe.status === 201 && typeof accepted === 'string') runIds.push(accepted);
    const body = isRecord(probe.json) ? probe.json : {};
    const advertised = bp['retryAfterSeconds'];
    return {
      kind: 'refused',
      refusal: {
        cap,
        status: probe.status,
        code: readErrorCode(probe.json) ?? undefined,
        retryAfterHeader: probe.headers.get('retry-after'),
        details: isRecord(body['details']) ? body['details'] : null,
        advertisedRetryAfterSeconds: typeof advertised === 'number' ? advertised : undefined,
      },
    };
  } finally {
    // The held runs outlive their streams. Cancel them so the next file does
    // not meet a saturated host.
    for (const c of streams) c.abort();
    if (runIds.length > 0) {
      const bulk = await http(() => driver.post(`${profile.runsPath}:bulk-cancel`, { runIds }));
      if (bulk === null || bulk.status >= 400) {
        for (const id of runIds) await http(() => driver.post(`${profile.runsPath}/${encodeURIComponent(id)}/cancel`, {}));
      }
    }
    await Promise.allSettled(pending);
  }
}

/** What the refusal must look like at this major. Pure. */
export function judge(profile: MajorProfile, r: Refusal): Finding[] {
  const home = `${profile.specRoot}/${profile.major === 1 ? 'production-profile.md §Backpressure' : 'conformance.md §Production profile'}`;
  const out: Finding[] = [];
  out.push({ rule: 'refusal', ok: r.status === 503, doc: home, message: `with inflightCap ${r.cap} slots held, the next request MUST be refused 503 (got ${r.status})` });
  out.push({ rule: 'refusal', ok: r.code === 'service_unavailable', doc: home, message: `the refusal MUST carry the code service_unavailable (got ${r.code ?? 'none'})` });
  const header = (r.retryAfterHeader ?? '').trim();
  out.push({ rule: 'refusal', ok: header.length > 0, doc: home, message: 'the 503 MUST set Retry-After' });

  if (r.advertisedRetryAfterSeconds !== undefined) {
    out.push({
      rule: 'retry-after-advertised',
      ok: /^\d+$/.test(header) && Number(header) === r.advertisedRetryAfterSeconds,
      doc: 'capabilities.schema.json production.backpressure.retryAfterSeconds',
      message: `Retry-After MUST equal the advertised retryAfterSeconds ${r.advertisedRetryAfterSeconds} (got "${header}")`,
    });
  }

  if (profile.retryTiming === 'header-only') {
    const spelled = RETRY_DETAIL_KEYS.filter((k) => r.details !== null && k in r.details);
    out.push({ rule: 'retry-timing', ok: spelled.length === 0, doc: `${profile.specRoot}/errors.md §Retry timing`, message: `retry timing lives in the Retry-After header only; details MUST NOT carry ${spelled.join(', ') || 'retryAfter*'}` });
  } else {
    const d = r.details?.['retryAfter'];
    out.push({ rule: 'retry-timing', ok: typeof d === 'number' && /^\d+$/.test(header) && d === Number(header), doc: home, message: 'details.retryAfter MUST be numeric and equal the Retry-After header in seconds' });
  }
  return out;
}
