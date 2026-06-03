import { afterEach, describe, expect, it } from 'vitest';
import { managedAnonSignInRequired, readDeployPosture } from '../src/host/deployPosture.js';

describe('deploy posture env contract', () => {
  afterEach(() => {
    delete process.env.OPENWOP_DEPLOY_POSTURE;
    delete process.env.OPENWOP_AUTH_ENFORCE_BEARER;
    delete process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED;
  });

  it('defaults to cookie-per-visitor demo posture with managed anon allowed', () => {
    expect(readDeployPosture()).toBe('cookie-per-visitor');
    expect(managedAnonSignInRequired()).toBe(false);
  });

  it('auth posture keeps the managed-tier sign-in wall', () => {
    process.env.OPENWOP_DEPLOY_POSTURE = 'auth';
    expect(readDeployPosture()).toBe('auth');
    expect(managedAnonSignInRequired()).toBe(true);
  });

  it('explicit managed anon override wins over posture inference', () => {
    process.env.OPENWOP_DEPLOY_POSTURE = 'cookie-per-visitor';
    process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED = 'true';
    expect(managedAnonSignInRequired()).toBe(true);

    process.env.OPENWOP_DEPLOY_POSTURE = 'auth';
    process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED = 'false';
    expect(managedAnonSignInRequired()).toBe(false);
  });

  it('legacy bearer enforcement infers auth posture', () => {
    process.env.OPENWOP_AUTH_ENFORCE_BEARER = 'true';
    expect(readDeployPosture()).toBe('auth');
    expect(managedAnonSignInRequired()).toBe(true);
  });
});
