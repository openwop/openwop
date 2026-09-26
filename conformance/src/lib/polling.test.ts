/**
 * Unit tests for `polling.ts` — timeout scaling and major-correct paths.
 *
 * @see polling.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { driver } from './driver.js';
import { getRun, LIVE_RUN_POLL_MS, liveScenarioTimeoutMs, scaledTimeoutMs } from './polling.js';

const SCALE_KEY = 'OPENWOP_POLL_TIMEOUT_SCALE';

function withScale(value: string | undefined, fn: () => void): void {
  if (value === undefined) delete process.env[SCALE_KEY];
  else process.env[SCALE_KEY] = value;
  fn();
}

afterEach(() => {
  delete process.env[SCALE_KEY];
  delete process.env.OPENWOP_TARGET_MAJOR;
  vi.restoreAllMocks();
});

describe('polling: scaledTimeoutMs', () => {
  it('is an exact no-op when the knob is unset — no existing measurement moves', () => {
    withScale(undefined, () => {
      for (const ms of [100, 1_000, 5_000, 10_000, 15_000, 30_000, 60_000]) {
        expect(scaledTimeoutMs(ms)).toBe(ms);
      }
    });
  });

  it('is an exact no-op at scale 1, including the string form', () => {
    withScale('1', () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
    withScale('1.0', () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
  });

  it('scales explicit bounds, which the documented env var could never reach', () => {
    withScale('3', () => {
      expect(scaledTimeoutMs(10_000)).toBe(30_000);
      expect(scaledTimeoutMs(15_000)).toBe(45_000);
    });
  });

  it('preserves the ORDERING of deliberately-short bounds — the reason this scales rather than floors', () => {
    withScale('4', () => {
      const short = scaledTimeoutMs(100);
      const long = scaledTimeoutMs(10_000);
      expect(short).toBe(400);
      expect(long).toBe(40_000);
      expect(short).toBeLessThan(long);
    });
  });

  it('rounds up, so a fractional scale never shortens a bound', () => {
    withScale('1.5', () => expect(scaledTimeoutMs(1_001)).toBe(1_502));
    withScale('1.0001', () => expect(scaledTimeoutMs(100)).toBeGreaterThanOrEqual(100));
  });

  it('falls back to 1 for a mis-set knob rather than producing an instant failure', () => {
    for (const bad of ['0', '-2', 'abc', 'NaN', 'Infinity', '', '  ']) {
      withScale(bad, () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
    }
  });

  it('reads the environment at CALL time, so a harness may set it after import', () => {
    withScale('2', () => expect(scaledTimeoutMs(1_000)).toBe(2_000));
    withScale('5', () => expect(scaledTimeoutMs(1_000)).toBe(5_000));
  });
});

describe('polling path follows the selected protocol major', () => {
  it.each([
    ['1', '/v1/runs/run-1'],
    ['2', '/runs/default%2Frun-1'],
  ] as const)('uses the major-%s run path', async (major, expectedPath) => {
    process.env.OPENWOP_TARGET_MAJOR = major;
    const get = vi.spyOn(driver, 'get').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: '{"runId":"run-1","status":"completed"}',
      json: { runId: 'run-1', status: 'completed' },
    });

    await getRun(major === '2' ? 'default/run-1' : 'run-1');
    expect(get).toHaveBeenCalledWith(expectedPath);
  });
});

describe('polling: live-model scenario timeouts (RFC 0111, 2.42.1)', () => {
  it('outlasts vitest\'s global 30 s testTimeout, which killed the live scenarios before any assertion', () => {
    withScale(undefined, () => {
      expect(liveScenarioTimeoutMs(1)).toBe(240_000);
      expect(liveScenarioTimeoutMs(2)).toBe(420_000);
      expect(liveScenarioTimeoutMs(1)).toBeGreaterThan(30_000);
    });
  });

  it('scales with OPENWOP_POLL_TIMEOUT_SCALE — the knob an operator reaches for on a slow host', () => {
    withScale('3', () => {
      expect(liveScenarioTimeoutMs(1)).toBe(720_000);
      expect(liveScenarioTimeoutMs(2)).toBe(1_260_000);
    });
  });

  it('keeps every scaled poll deadline inside the test deadline, at every scale', () => {
    for (const scale of [undefined, '1', '0.5', '2', '6']) {
      withScale(scale, () => {
        for (const runs of [1, 2]) {
          expect(runs * scaledTimeoutMs(LIVE_RUN_POLL_MS)).toBeLessThan(liveScenarioTimeoutMs(runs));
        }
      });
    }
  });
});
