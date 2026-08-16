/**
 * version-fold — `version-negotiation.md` §Cross-version interop matrix,
 * exercised via the test-keys-only `X-Force-Engine-Version` header
 * (§"Conformance via `X-Force-Engine-Version`"). Consumer of the
 * `conformance-version-fold` fixture (closes catalog gap F5 — the fixture
 * previously had no consuming scenario; see `fixtures.md`).
 *
 * Gating: `describe.skipIf` on the advertised `conformance-version-fold`
 * fixture id (RFC 0003). The forced-version seam itself is advertised via
 * `Capabilities.testing.forceEngineVersionRange = { min, max }` — hosts
 * that advertise the fixture but not the seam soft-skip with a warning
 * (mirroring the suite's other test-seam scenarios, e.g. the OTel
 * collector seams), because the header is a test seam, not a production
 * surface.
 *
 * What's asserted per the fixture driver (`fixtures.md` §`conformance-version-fold`):
 *   1. For each forced version in `[min, current, max]` (deduped), a run
 *      of the single-noop fixture reaches terminal `completed`.
 *   2. `GET /v1/runs/{runId}` returns a readable `RunSnapshot` (the
 *      projection tolerates the version mismatch via fold-best-effort).
 *   3. The event log is readable via `GET /v1/runs/{runId}/events/poll`
 *      and non-empty.
 *   4. Negative: a forced version outside the advertised range returns
 *      `400 unsupported_force_engine_version`.
 *
 * NOT black-box testable here: the production-key refusal
 * (`403 force_engine_version_forbidden`) — the suite holds a single API
 * key, which must be a test key for the positive legs to run at all.
 * When the host answers `403 force_engine_version_forbidden` the key is
 * production-scoped and the scenario soft-skips honestly.
 *
 * @see spec/v1/version-negotiation.md §"Conformance via `X-Force-Engine-Version`"
 * @see conformance/fixtures.md §`conformance-version-fold`
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE_ID = 'conformance-version-fold';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(FIXTURE_ID);

interface ForceRange {
  readonly min: number;
  readonly max: number;
}

/** Read `testing.forceEngineVersionRange` + the host's current `engineVersion`
 *  from discovery. Returns null when the host doesn't expose the seam. */
async function readForceSeam(): Promise<{ range: ForceRange; current: number | null } | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  const testing = capabilityFamily<{ forceEngineVersionRange?: unknown }>(res.json, 'testing');
  const range = testing?.forceEngineVersionRange as { min?: unknown; max?: unknown } | undefined;
  if (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max)) return null;
  const engineVersion = capabilityFamily<unknown>(res.json, 'engineVersion');
  return {
    range: { min: range.min as number, max: range.max as number },
    current: Number.isInteger(engineVersion) ? (engineVersion as number) : null,
  };
}

function errCode(json: unknown): string | undefined {
  const e = (json as { error?: unknown } | undefined)?.error;
  return typeof e === 'string' ? e : undefined;
}

async function createForcedRun(version: number): Promise<OpenWOPResponse> {
  return driver.post(
    '/v1/runs',
    { workflowId: FIXTURE_ID },
    { headers: { 'X-Force-Engine-Version': String(version) } },
  );
}

describe.skipIf(SKIP_NO_FIXTURE)('version-fold: forced engine versions fold-best-effort across the advertised range', () => {
  it('each version in [min, current, max] completes + snapshot and event log stay readable', async () => {
    const seam = await readForceSeam();
    if (seam === null) {
      // eslint-disable-next-line no-console
      console.warn(
        '[version-fold] host does not advertise Capabilities.testing.forceEngineVersionRange; ' +
          'skipping (the X-Force-Engine-Version seam is test-keys-only and optional)',
      );
      return softSkip('blocked', 'precondition not met — `seam === null` returned early (seam, prior step, or fixture unavailable)');
    }

    const candidates = [seam.range.min, ...(seam.current === null ? [] : [seam.current]), seam.range.max];
    const versions = [...new Set(candidates)].filter(
      (v) => v >= seam.range.min && v <= seam.range.max,
    );
    expect(
      versions.length,
      driver.describe(
        'version-negotiation.md §Conformance via X-Force-Engine-Version',
        'forceEngineVersionRange MUST describe a non-empty integer range (min <= max)',
      ),
    ).toBeGreaterThan(0);

    for (const v of versions) {
      const create = await createForcedRun(v);
      if (create.status === 403 && errCode(create.json) === 'force_engine_version_forbidden') {
        // eslint-disable-next-line no-console
        console.warn('[version-fold] API key is production-scoped (403 force_engine_version_forbidden); skipping');
        return softSkip('blocked', '[version-fold] API key is production-scoped (403 force_engine_version_forbidden); skipping (create.status === 403 && errCode(create.json) === \'force_engine_version_forbidden\')');
      }
      expect(
        create.status,
        driver.describe(
          'version-negotiation.md §Conformance via X-Force-Engine-Version',
          `POST /v1/runs with X-Force-Engine-Version: ${v} (within the advertised range) MUST be accepted on a test key`,
        ),
      ).toBe(201);
      const runId = (create.json as { runId: string }).runId;

      // 1) Terminal completed — the fold tolerates the forced version.
      const terminal = await pollUntilTerminal(runId);
      expect(
        terminal.status,
        driver.describe(
          'version-negotiation.md §Cross-version interop matrix',
          `the conformance-version-fold noop run MUST complete under forced engine version ${v} (fold-best-effort)`,
        ),
      ).toBe('completed');

      // 2) The projection (RunSnapshot) is readable.
      const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      expect(
        snap.status,
        driver.describe(
          'version-negotiation.md §Cross-version interop matrix',
          `GET /v1/runs/{runId} MUST return a readable RunSnapshot under forced engine version ${v}`,
        ),
      ).toBe(200);
      const snapBody = snap.json as { runId?: unknown; status?: unknown };
      expect(typeof snapBody.runId).toBe('string');
      expect(typeof snapBody.status).toBe('string');

      // 3) The event log is readable + non-empty.
      const events = await driver.get(
        `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
      );
      expect(
        events.status,
        driver.describe(
          'version-negotiation.md §Conformance via X-Force-Engine-Version',
          `the event log MUST be readable via events/poll under forced engine version ${v}`,
        ),
      ).toBe(200);
      const eventList = (events.json as { events?: unknown[] } | undefined)?.events ?? [];
      expect(
        eventList.length,
        driver.describe(
          'version-negotiation.md §Conformance via X-Force-Engine-Version',
          `events/poll MUST return a non-empty events[] for the forced-version run (v=${v})`,
        ),
      ).toBeGreaterThan(0);
    }
  });

  it('a forced version outside the advertised range is rejected with 400 unsupported_force_engine_version', async () => {
    const seam = await readForceSeam();
    if (seam === null) {
      // eslint-disable-next-line no-console
      console.warn('[version-fold] forceEngineVersionRange not advertised; skipping negative leg');
      return softSkip('inapplicable', '[version-fold] forceEngineVersionRange not advertised; skipping negative leg');
    }

    const outOfRange = seam.range.max + 1;
    const create = await createForcedRun(outOfRange);
    if (create.status === 403 && errCode(create.json) === 'force_engine_version_forbidden') {
      // eslint-disable-next-line no-console
      console.warn('[version-fold] API key is production-scoped; skipping negative leg');
      return softSkip('blocked', '[version-fold] API key is production-scoped; skipping negative leg (create.status === 403 && errCode(create.json) === \'force_engine_version_forbidden\')');
    }
    expect(
      create.status,
      driver.describe(
        'version-negotiation.md §Conformance via X-Force-Engine-Version',
        `X-Force-Engine-Version: ${outOfRange} (outside the advertised range) MUST return 400`,
      ),
    ).toBe(400);
    expect(
      errCode(create.json),
      driver.describe(
        'version-negotiation.md §Conformance via X-Force-Engine-Version',
        'the out-of-range refusal MUST carry the canonical unsupported_force_engine_version code',
      ),
    ).toBe('unsupported_force_engine_version');
  });
});
