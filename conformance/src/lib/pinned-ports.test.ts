import { describe, expect, it } from 'vitest';
import { pinnedPortWorkerConflict } from './pinned-ports.js';

describe('pinnedPortWorkerConflict — a pinned-port certification is single-worker', () => {
  const pinned = { OPENWOP_WEBHOOK_RECEIVER_PORT: '3841' };

  it('refuses --certify with a pinned port and two workers', () => {
    expect(pinnedPortWorkerConflict(pinned, 2, true)).toMatch(/requires --max-workers 1 \(got 2\)/);
  });

  it("refuses --certify with a pinned port and vitest's default worker count", () => {
    expect(pinnedPortWorkerConflict(pinned, undefined, true)).toMatch(/requires --max-workers 1/);
  });

  it('accepts --certify with a pinned port and one worker', () => {
    expect(pinnedPortWorkerConflict(pinned, 1, true)).toBeNull();
  });

  it('accepts a certification with no pinned ports at any worker count', () => {
    expect(pinnedPortWorkerConflict({}, 4, true)).toBeNull();
  });

  it('does not touch a non-certifying run', () => {
    expect(pinnedPortWorkerConflict(pinned, 4, false)).toBeNull();
  });

  it('names every pinned variable it found, including the OAuth doubles derived at runtime', () => {
    const msg = pinnedPortWorkerConflict({ OPENWOP_OAUTH_AS_PORT: '3844', OPENWOP_A2A_FAKE_PEER_PORT: '3842' }, 2, true) ?? '';
    expect(msg).toContain('OPENWOP_OAUTH_AS_PORT');
    expect(msg).toContain('OPENWOP_A2A_FAKE_PEER_PORT');
  });
});

describe('the synthetic OIDC issuer port is a pinned fixture port (2.39.4)', () => {
  it('OPENWOP_TEST_OIDC_ISSUER_PORT alone refuses a multi-worker --certify', () => {
    const msg = pinnedPortWorkerConflict({ OPENWOP_TEST_OIDC_ISSUER_PORT: '3839' }, 4, true);
    expect(msg).toMatch(/OPENWOP_TEST_OIDC_ISSUER_PORT/);
  });
  it('and is accepted single-worker', () => {
    expect(pinnedPortWorkerConflict({ OPENWOP_TEST_OIDC_ISSUER_PORT: '3839' }, 1, true)).toBeNull();
  });
});
