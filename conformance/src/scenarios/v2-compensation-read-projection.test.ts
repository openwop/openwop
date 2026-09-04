/**
 * RFC 0173 §B — `compensation-read-projection` (suite 2.0.0, target major 2; gated on `compensation`).
 *
 * Compensation is a core obligation with a declared witness: a host that
 * advertises `compensation` MUST serve `GET /runs/{runId}/compensation`
 * (`api/v2/openapi.yaml` `getRunCompensation`,
 * `schemas/v2/compensation-projection.schema.json`) — `{ runId, status, plan[],
 * attempts[] }` — so the obligation is deployed-wire evidence rather than
 * seam-only (RFC 0151 G9; RFC 0173 §B row C6.6; `spec/v2/core/security-defaults.md`
 * §Compensation).
 *
 * A fresh run of the noop fixture has nothing to compensate: the projection
 * validates with `status: "none"`, an empty plan and no attempts. An unknown
 * run is `404 not_found` through the canonical envelope.
 *
 * @see spec/v2/core/security-defaults.md §Compensation
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function waitTerminal(runId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    if (res.status === 200 && TERMINAL.has(String((res.json as { status?: unknown } | null)?.status))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('RFC 0173 §B — compensation-read-projection (gated on compensation)', () => {
  it('GET /runs/{runId}/compensation on a fresh run validates with status none', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('compensation'))) return softSkip('inapplicable', 'compensation family not advertised — no obligation (gate recorded under openwop.family.compensation)');
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to project`);

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.compensation-read-projection', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);

    const res = await driver.get(`/runs/${encodeURIComponent(runId)}/compensation`);
    expect(
      res.status,
      req('openwop.requirement.0173.compensation-read-projection', 'security-defaults.md §Compensation', 'a host advertising `compensation` MUST serve GET /runs/{runId}/compensation with 200 (RFC 0173 §B — the read projection is the obligation\'s witness)'),
    ).toBe(200);
    const check = v2Validator('compensation-projection')(res.json);
    expect(
      check.ok,
      req('openwop.requirement.0173.compensation-read-projection', 'compensation-projection.schema.json', `the projection MUST validate: ${check.errors}`),
    ).toBe(true);
    const body = res.json as { runId?: unknown; status?: unknown; plan?: unknown[]; attempts?: unknown[] };
    expect(body.runId, req('openwop.requirement.0173.compensation-read-projection', 'compensation-projection.schema.json runId', 'runId MUST echo the run read')).toBe(runId);
    expect(
      body.status,
      req('openwop.requirement.0173.compensation-read-projection', 'compensation-projection.schema.json status', 'a run with nothing to compensate MUST project status "none"'),
    ).toBe('none');
    expect(body.attempts, req('openwop.requirement.0173.compensation-read-projection', 'compensation-projection.schema.json attempts', 'no attempt exists before an unwind')).toEqual([]);
  });

  it('an unknown run projects 404 not_found through the canonical envelope', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('compensation'))) return softSkip('inapplicable', 'compensation family not advertised — no obligation (gate recorded under openwop.family.compensation)');
    const res = await driver.get('/runs/conformance-no-such-run-0173/compensation');
    expect(res.status, req('openwop.requirement.0173.compensation-read-projection.not-found', 'openapi.yaml getRunCompensation 404', 'an unknown runId MUST answer 404')).toBe(404);
    expect(
      readErrorCode(res.json),
      req('openwop.requirement.0173.compensation-read-projection.not-found', 'errors.md §Envelope', 'the 404 MUST carry the registered not_found code in the flat envelope'),
    ).toBe('not_found');
  });
});
