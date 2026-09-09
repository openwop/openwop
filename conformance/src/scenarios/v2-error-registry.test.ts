/**
 * v2 — `error-registry` (suite 2.0.0; RFC 0171 §B.1–§B.2;
 * `spec/v2/core/errors.md` §"The envelope", §"Retry timing").
 *
 * Witness class: witnessable — unaided (the `Retry-After` leg is gated on a
 * rate-limited response being observed). Every error response MUST be the
 * closed envelope `{ error, message, details? }` with a registered (or vendor)
 * code answered at its registered HTTP status; `details.retryAfter`,
 * `retryAfterMs` and `retryAfterSeconds` MUST NOT be emitted — retry timing
 * lives in `Retry-After` only, which a `429 rate_limited` MUST set. The
 * deliberately bad request is `GET /runs/does-not-exist` (outside the runId
 * grammar, so a host may answer `400 validation_error` or `404 not_found`).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/errors.md §The envelope';
const ERRORS_PATH = join(SCHEMAS_DIR, '..', 'spec', 'v2', 'errors.json');
const RETRY_SPELLINGS = ['retryAfter', 'retryAfterMs', 'retryAfterSeconds'];

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** code → registered httpStatus, when the registry ships in this layout. */
function registryStatus(): Map<string, number> | null {
  if (!existsSync(ERRORS_PATH)) return null;
  const rows = (JSON.parse(readFileSync(ERRORS_PATH, 'utf8')) as { rows?: Array<{ code: string; httpStatus: number }> }).rows ?? [];
  return new Map(rows.map((r) => [r.code, r.httpStatus]));
}

async function badRequest(): Promise<OpenWOPResponse | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const res = await http(() => driver.get('/runs/does-not-exist'));
  if (res === null) return { reason: 'GET /runs/does-not-exist unreachable (fetch failed)' };
  if (res.status < 400) return { reason: `GET /runs/does-not-exist answered ${res.status} — no error envelope to observe` };
  return res;
}

describe('v2 error-registry (RFC 0171 §B.1–§B.2)', () => {
  it('an error response is the closed envelope with a registered code at its registered status', async () => {
    const res = await badRequest();
    if ('reason' in res) return softSkip('blocked', res.reason);
    const r = v2Validator('error-envelope')(res.json);
    expect(r.ok, req('openwop.requirement.0171.error-registry.envelope', DOC, `every error body MUST be { error, message, details? } and nothing else, with error a registered or vendor code (${r.errors})`)).toBe(true);
    const code = readErrorCode(res.json);
    const registry = registryStatus();
    if (registry !== null && code !== undefined && registry.has(code)) {
      expect(res.status, req('openwop.requirement.0171.error-registry.envelope', DOC, `a host MUST answer ${code} with its registered status ${String(registry.get(code))}`)).toBe(registry.get(code));
    }
  });

  it('retry timing is never spelled inside details', async () => {
    const res = await badRequest();
    if ('reason' in res) return softSkip('blocked', res.reason);
    const details = (res.json as { details?: unknown } | undefined)?.details;
    const spelled = details !== null && typeof details === 'object' ? RETRY_SPELLINGS.filter((k) => k in (details as Record<string, unknown>)) : [];
    expect(spelled, req('openwop.requirement.0171.error-registry.no-retry-details', 'spec/v2/core/errors.md §Retry timing', 'details.retryAfter / retryAfterMs / retryAfterSeconds are not part of v2 and a host MUST NOT emit them — Retry-After is the only retry timing')).toEqual([]);
  });

  it('a 429 rate_limited response carries Retry-After', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    // The suite does not manufacture load; it inspects whatever the probes it
    // already makes return. A host that never rate-limits the suite records the
    // leg as inapplicable (witnessable — gated on a host advertising limits).
    const seen: OpenWOPResponse[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await http(() => driver.get('/runs/does-not-exist'));
      if (res !== null) seen.push(res);
    }
    const limited = seen.filter((r) => r.status === 429);
    if (limited.length === 0) return softSkip('inapplicable', 'no 429 rate_limited response was observed during the suite\'s probes — the Retry-After leg is gated on a rate-limited response');
    for (const r of limited) {
      expect(readErrorCode(r.json), req('openwop.requirement.0171.error-registry.retry-after', 'spec/v2/core/errors.md §Retry timing', 'a 429 MUST carry the registered code rate_limited')).toBe('rate_limited');
      expect(r.headers.get('retry-after'), req('openwop.requirement.0171.error-registry.retry-after', 'spec/v2/core/errors.md §Retry timing', 'a 429 rate_limited response MUST set Retry-After')).not.toBeNull();
    }
  });
});
