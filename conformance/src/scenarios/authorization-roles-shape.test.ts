/**
 * authorization-roles-shape — RFC 0049 §A advertisement-shape verification.
 *
 * Status: DRAFT. RFC 0049 (RBAC scopes & authorization decisions) is `Draft`.
 * The `capabilities.authorization` block has landed in
 * `schemas/capabilities.schema.json`.
 *
 * Always runs (shape-only): when the host advertises
 * `capabilities.authorization`, its fields MUST be well-formed.
 *
 * What this scenario asserts:
 *   1. `capabilities.authorization` is either absent or a well-formed object.
 *   2. When `supported: true`: `failClosed` (when present) is exactly `true`
 *      (RFC 0049 §C), and every `roles[]` entry has a non-empty `role` + a
 *      `scopes` array (RFC 0049 §A).
 *
 * @see RFCS/0049-rbac-scopes-and-authorization-decisions.md
 * @see spec/v1/auth.md §"Role-based authorization (RFC 0049)"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryRole {
  role?: string;
  scopes?: string[];
}

interface DiscoveryAuthorization {
  supported?: boolean;
  failClosed?: boolean;
  roles?: DiscoveryRole[];
}

interface DiscoveryDoc {
  capabilities?: {
    authorization?: DiscoveryAuthorization;
  };
}

async function readAuthorization(): Promise<DiscoveryAuthorization | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return body?.capabilities?.authorization ?? null;
}

describe('authorization-roles-shape: advertisement shape (RFC 0049 §A)', () => {
  it('capabilities.authorization is either absent or well-formed', async () => {
    const authz = await readAuthorization();
    if (authz === null) return; // host doesn't advertise authorization at all
    expect(
      typeof authz.supported,
      driver.describe(
        'capabilities.schema.json §authorization',
        'capabilities.authorization.supported MUST be a boolean when authorization is advertised',
      ),
    ).toBe('boolean');
  });

  it('failClosed, when present, is exactly true (RFC 0049 §C)', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported || authz.failClosed === undefined) return;
    expect(
      authz.failClosed,
      driver.describe('RFC 0049 §C', 'capabilities.authorization.failClosed MUST be `true` (fail-closed)'),
    ).toBe(true);
  });

  it('every advertised role has a non-empty role name + a scopes array', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported || authz.roles === undefined) return;
    for (const entry of authz.roles) {
      expect(
        typeof entry.role === 'string' && entry.role.length > 0,
        driver.describe('RFC 0049 §A', 'each capabilities.authorization.roles[] entry MUST declare a non-empty role'),
      ).toBe(true);
      expect(
        Array.isArray(entry.scopes),
        driver.describe('RFC 0049 §A', 'each role MUST declare a scopes array'),
      ).toBe(true);
    }
  });
});
