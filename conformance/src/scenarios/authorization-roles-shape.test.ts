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
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
  return capabilityFamily(body, 'authorization') ?? null;
}

describe('authorization-roles-shape: advertisement shape (RFC 0049 §A)', () => {
  it('capabilities.authorization is either absent or well-formed', async () => {
    const authz = await readAuthorization();
    if (authz === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `authz === null` returned early (host doesn\'t advertise authorization at all)'); // host doesn't advertise authorization at all
    expect(
      typeof authz.supported,
      req('openwop.it.authorization-roles-shape.capabilities-authorization-is-either-absent-or-well-formed', 
        'capabilities.schema.json §authorization',
        'capabilities.authorization.supported MUST be a boolean when authorization is advertised',
      ),
    ).toBe('boolean');
  });

  it('failClosed, when present, is exactly true (RFC 0049 §C)', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported || authz.failClosed === undefined) return softSkip('blocked', 'precondition not met — `!authz?.supported || authz.failClosed === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(
      authz.failClosed,
      req('openwop.it.authorization-roles-shape.failclosed-when-present-is-exactly-true-rfc-0049-c', 'RFC 0049 §C', 'capabilities.authorization.failClosed MUST be `true` (fail-closed)'),
    ).toBe(true);
  });

  it('every advertised role has a non-empty role name + a scopes array', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported || authz.roles === undefined) return softSkip('blocked', 'precondition not met — `!authz?.supported || authz.roles === undefined` returned early (seam, prior step, or fixture unavailable)');
    for (const entry of authz.roles) {
      expect(
        typeof entry.role === 'string' && entry.role.length > 0,
        req('openwop.it.authorization-roles-shape.every-advertised-role-has-a-non-empty-role-name-a-scopes-array', 'RFC 0049 §A', 'each capabilities.authorization.roles[] entry MUST declare a non-empty role'),
      ).toBe(true);
      expect(
        Array.isArray(entry.scopes),
        req('openwop.it.authorization-roles-shape.every-advertised-role-has-a-non-empty-role-name-a-scopes-array', 'RFC 0049 §A', 'each role MUST declare a scopes array'),
      ).toBe(true);
    }
  });
});
