/**
 * Auth scenarios — credential rejection contracts.
 *
 * Tests that authenticated endpoints (manifest read, run create) return
 * the canonical 401 envelope when called with no credential or an
 * invalid credential. Per auth.md §3.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const KNOWN_AUTHED_PATH = '/v1/runs';

describe('auth: missing credential', () => {
  it('returns 401 with canonical error envelope per auth.md §3', async () => {
    const res = await driver.post(
      KNOWN_AUTHED_PATH,
      { workflowId: 'conformance-noop' },
      { authenticated: false },
    );

    expect(res.status, driver.describe(
      'auth.md §3',
      'request without Authorization header MUST return 401',
    )).toBe(401);

    const body = res.json as { error?: unknown; message?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'auth.md §3 + rest-endpoints.md error envelope',
      'response body MUST include `error` (machine code) string',
    )).toBe('string');
    expect(typeof body?.message, driver.describe(
      'auth.md §3 + rest-endpoints.md error envelope',
      'response body MUST include `message` (human description) string',
    )).toBe('string');
  });
});

describe('auth: invalid credential', () => {
  it('returns 401 (not 200, not 403) per auth.md §3', async () => {
    const res = await driver.post(
      KNOWN_AUTHED_PATH,
      { workflowId: 'conformance-noop' },
      {
        authenticated: false,
        headers: { Authorization: 'Bearer hk_definitely_not_a_real_key_12345' },
      },
    );

    expect(res.status, driver.describe(
      'auth.md §3',
      'request with invalid Authorization MUST return 401, not 403',
    )).toBe(401);
  });
});
