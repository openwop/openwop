/**
 * Replay retention-expiry scenario per `spec/v1/replay.md` §"Retention
 * and garbage collection."
 *
 * Verifies the normative `replay.md:246` requirement:
 *
 *   > If the source run still exists but the event range needed for
 *   > `fromSeq` has expired, the host MUST reject the fork with
 *   > `410 Gone` or `422 Unprocessable Entity` using the canonical
 *   > error envelope. The error `details` SHOULD include `sourceRunId`,
 *   > `fromSeq`, and the retention boundary when known.
 *
 * Forcing expiry is environmental (hosts don't standardize a force-
 * expire endpoint — that's the same RFC 0009 Q#1 surface area). The
 * scenario reads two operator-supplied env vars:
 *
 *   - `OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID` — runId of a run whose
 *     events past `fromSeq` are known-expired on the host under test.
 *   - `OPENWOP_TEST_EXPIRED_REPLAY_FROM_SEQ` — the `fromSeq` to
 *     fork against (defaults to 0; pre-expired ranges typically
 *     start from the earliest event).
 *
 * When neither is supplied, the scenario asserts only that the
 * `replay` capability advertisement is well-formed and that
 * `retention` metadata (when present) types correctly. The
 * 410/422 envelope assertion soft-skips.
 *
 * @see spec/v1/replay.md §"Retention and garbage collection"
 * @see RFCS/0009-production-profile-conformance.md §C (parallel
 *      retention-expiry pattern for run snapshots)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';

interface ReplayRetentionCaps {
  windowSeconds?: number;
}

interface ReplayCaps {
  supported?: boolean;
  modes?: string[];
  retention?: ReplayRetentionCaps;
}

const PROFILE = 'openwop-replay-fork';

async function readReplayCaps(): Promise<ReplayCaps | undefined> {
  // Per existing replay-fork.test.ts convention: `replay` lives at the
  // top level of the discovery body, not under capabilities.*.
  const disco = await driver.get('/.well-known/openwop', { authenticated: false });
  if (disco.status !== 200) return undefined;
  return (disco.json as { replay?: ReplayCaps }).replay;
}

function isProfileAdvertised(replay: ReplayCaps | undefined): boolean {
  return replay?.supported === true && Array.isArray(replay.modes) && replay.modes.length > 0;
}

describe('replay-retention-expiry: capability shape', () => {
  it('host advertising replay surfaces well-formed retention metadata when present', async () => {
    const replay = await readReplayCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(replay))) {
      return;
    }

    expect(replay?.supported, driver.describe(
      'replay.md §"Retention and garbage collection"',
      'replay.supported MUST be true when the host claims the openwop-replay-fork profile',
    )).toBe(true);

    expect(
      Array.isArray(replay?.modes) && (replay?.modes?.length ?? 0) > 0,
      driver.describe(
        'profiles.md §`openwop-replay-fork`',
        'replay.modes MUST be a non-empty array',
      ),
    ).toBe(true);

    // retention metadata is OPTIONAL per replay.md (the spec requires
    // hosts document retention; it doesn't yet require advertising
    // the window in discovery). When advertised, type strictly.
    if (replay?.retention?.windowSeconds !== undefined) {
      expect(
        Number.isInteger(replay.retention.windowSeconds) &&
          replay.retention.windowSeconds >= 0,
        driver.describe(
          'replay.md §"Retention and garbage collection"',
          'replay.retention.windowSeconds MUST be a non-negative integer when advertised',
        ),
      ).toBe(true);
    }
  });
});

describe('replay-retention-expiry: 410/422 on expired-range fork', () => {
  it('POST /v1/runs/{expiredRunId}:fork returns 410 or 422 with canonical envelope', async () => {
    const replay = await readReplayCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(replay))) {
      return;
    }

    const expiredRunId = process.env.OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID;
    if (!expiredRunId) {
      // eslint-disable-next-line no-console
      console.warn(
        '[replay-retention-expiry] OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID not supplied; skipping envelope assertion (operator must produce a known-expired run id and pass it via env)',
      );
      return;
    }

    const fromSeqEnv = process.env.OPENWOP_TEST_EXPIRED_REPLAY_FROM_SEQ;
    const fromSeq = fromSeqEnv ? Number.parseInt(fromSeqEnv, 10) : 0;
    if (!Number.isFinite(fromSeq) || fromSeq < 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[replay-retention-expiry] OPENWOP_TEST_EXPIRED_REPLAY_FROM_SEQ=${String(fromSeqEnv)} is not a non-negative integer; skipping`,
      );
      return;
    }

    // Pick a mode the host advertises. Per replay.md the envelope
    // assertion applies regardless of mode — replay and branch both
    // depend on the source event log past fromSeq.
    const mode = replay?.modes?.[0] ?? 'replay';

    const res = await driver.post(
      `/v1/runs/${encodeURIComponent(expiredRunId)}:fork`,
      { mode, fromSeq },
    );

    expect(
      res.status === 410 || res.status === 422,
      driver.describe(
        'replay.md §"Retention and garbage collection"',
        'fork against expired event range MUST return 410 Gone or 422 Unprocessable Entity',
      ),
    ).toBe(true);

    const body = res.json as {
      error?: string;
      message?: string;
      details?: {
        sourceRunId?: string;
        fromSeq?: number;
        retentionBoundary?: string | number;
      };
    };

    expect(typeof body.error, driver.describe(
      'replay.md §"Retention and garbage collection"',
      'expired-fork response MUST use the canonical error envelope ({error, message, details?})',
    )).toBe('string');
    expect((body.error ?? '').length).toBeGreaterThan(0);

    expect(typeof body.message).toBe('string');
    expect((body.message ?? '').length).toBeGreaterThan(0);

    // details.{sourceRunId, fromSeq, retentionBoundary} are SHOULD —
    // soft-check when present, MUST NOT mismatch when present.
    if (body.details?.sourceRunId !== undefined) {
      expect(body.details.sourceRunId, driver.describe(
        'replay.md §"Retention and garbage collection"',
        'details.sourceRunId (when present) MUST match the runId in the request path',
      )).toBe(expiredRunId);
    }

    if (body.details?.fromSeq !== undefined) {
      expect(body.details.fromSeq, driver.describe(
        'replay.md §"Retention and garbage collection"',
        'details.fromSeq (when present) MUST match the fromSeq supplied in the request body',
      )).toBe(fromSeq);
    }
  });
});
