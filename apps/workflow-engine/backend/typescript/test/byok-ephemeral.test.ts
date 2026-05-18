/**
 * Coverage for the P0.3 BYOK ephemeral mode:
 *   - When OPENWOP_BYOK_EPHEMERAL=true, setSecret + resolveSecret are
 *     tenant-scoped: tenant A's secrets MUST NOT be readable by
 *     tenant B.
 *   - listSecretRefs returns only the calling tenant's refs.
 *   - clearTenantEphemeralSecrets wipes one tenant's bucket.
 *   - clearExpiredEphemeralSecrets keeps only the listed tenants.
 *   - Without scope.tenantId, ephemeral resolveSecret returns null
 *     (closed by construction — there's no fallback global bucket).
 */

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  setSecret,
  resolveSecret,
  removeSecret,
  listSecretRefs,
  clearTenantEphemeralSecrets,
  clearExpiredEphemeralSecrets,
  clearAllSecrets,
} from '../src/byok/secretResolver.js';

describe('BYOK ephemeral mode (P0.3)', () => {
  beforeEach(async () => {
    process.env.OPENWOP_BYOK_EPHEMERAL = 'true';
    await clearAllSecrets();
  });

  afterAll(async () => {
    await clearAllSecrets();
    process.env.OPENWOP_BYOK_EPHEMERAL = '';
  });

  it('isolates secrets between tenants', async () => {
    await setSecret('anthropic', 'KEY-A', { tenantId: 'anon:alice' });
    await setSecret('anthropic', 'KEY-B', { tenantId: 'anon:bob' });
    expect(await resolveSecret('anthropic', { tenantId: 'anon:alice' })).toBe('KEY-A');
    expect(await resolveSecret('anthropic', { tenantId: 'anon:bob' })).toBe('KEY-B');
  });

  it('returns null when scope is omitted in ephemeral mode (no global fallback)', async () => {
    await setSecret('anthropic', 'KEY-A', { tenantId: 'anon:alice' });
    // Caller forgot scope — must NOT leak alice's key.
    expect(await resolveSecret('anthropic')).toBeNull();
  });

  it('listSecretRefs returns only the caller-scoped tenant refs', async () => {
    await setSecret('openai', 'A', { tenantId: 'anon:alice' });
    await setSecret('anthropic', 'A2', { tenantId: 'anon:alice' });
    await setSecret('openai', 'B', { tenantId: 'anon:bob' });
    expect([...(await listSecretRefs({ tenantId: 'anon:alice' }))].sort()).toEqual(['anthropic', 'openai']);
    expect([...(await listSecretRefs({ tenantId: 'anon:bob' }))]).toEqual(['openai']);
    expect([...(await listSecretRefs({ tenantId: 'anon:never-set' }))]).toEqual([]);
  });

  it('removeSecret only affects the caller-scoped tenant', async () => {
    await setSecret('openai', 'A', { tenantId: 'anon:alice' });
    await setSecret('openai', 'B', { tenantId: 'anon:bob' });
    await removeSecret('openai', { tenantId: 'anon:alice' });
    expect(await resolveSecret('openai', { tenantId: 'anon:alice' })).toBeNull();
    expect(await resolveSecret('openai', { tenantId: 'anon:bob' })).toBe('B');
  });

  it('clearTenantEphemeralSecrets wipes only the named tenant', async () => {
    await setSecret('a', '1', { tenantId: 'anon:alice' });
    await setSecret('b', '2', { tenantId: 'anon:bob' });
    const n = clearTenantEphemeralSecrets('anon:alice');
    expect(n).toBe(1);
    expect(await resolveSecret('a', { tenantId: 'anon:alice' })).toBeNull();
    expect(await resolveSecret('b', { tenantId: 'anon:bob' })).toBe('2');
  });

  it('clearExpiredEphemeralSecrets keeps only the named tenants', async () => {
    await setSecret('a', '1', { tenantId: 'anon:alice' });
    await setSecret('b', '2', { tenantId: 'anon:bob' });
    await setSecret('c', '3', { tenantId: 'anon:carol' });
    const wiped = clearExpiredEphemeralSecrets(new Set(['anon:alice']));
    expect(wiped).toBe(2);
    expect(await resolveSecret('a', { tenantId: 'anon:alice' })).toBe('1');
    expect(await resolveSecret('b', { tenantId: 'anon:bob' })).toBeNull();
    expect(await resolveSecret('c', { tenantId: 'anon:carol' })).toBeNull();
  });

  it('setSecret without scope throws in ephemeral mode', async () => {
    await expect(setSecret('a', '1')).rejects.toThrow(/scope\.tenantId/);
  });
});
