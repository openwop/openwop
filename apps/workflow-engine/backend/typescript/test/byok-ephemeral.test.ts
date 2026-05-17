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
  beforeEach(() => {
    process.env.OPENWOP_BYOK_EPHEMERAL = 'true';
    clearAllSecrets();
  });

  afterAll(() => {
    clearAllSecrets();
    process.env.OPENWOP_BYOK_EPHEMERAL = '';
  });

  it('isolates secrets between tenants', () => {
    setSecret('anthropic', 'KEY-A', { tenantId: 'anon:alice' });
    setSecret('anthropic', 'KEY-B', { tenantId: 'anon:bob' });
    expect(resolveSecret('anthropic', { tenantId: 'anon:alice' })).toBe('KEY-A');
    expect(resolveSecret('anthropic', { tenantId: 'anon:bob' })).toBe('KEY-B');
  });

  it('returns null when scope is omitted in ephemeral mode (no global fallback)', () => {
    setSecret('anthropic', 'KEY-A', { tenantId: 'anon:alice' });
    // Caller forgot scope — must NOT leak alice's key.
    expect(resolveSecret('anthropic')).toBeNull();
  });

  it('listSecretRefs returns only the caller-scoped tenant refs', () => {
    setSecret('openai', 'A', { tenantId: 'anon:alice' });
    setSecret('anthropic', 'A2', { tenantId: 'anon:alice' });
    setSecret('openai', 'B', { tenantId: 'anon:bob' });
    expect([...listSecretRefs({ tenantId: 'anon:alice' })].sort()).toEqual(['anthropic', 'openai']);
    expect([...listSecretRefs({ tenantId: 'anon:bob' })]).toEqual(['openai']);
    expect([...listSecretRefs({ tenantId: 'anon:never-set' })]).toEqual([]);
  });

  it('removeSecret only affects the caller-scoped tenant', () => {
    setSecret('openai', 'A', { tenantId: 'anon:alice' });
    setSecret('openai', 'B', { tenantId: 'anon:bob' });
    removeSecret('openai', { tenantId: 'anon:alice' });
    expect(resolveSecret('openai', { tenantId: 'anon:alice' })).toBeNull();
    expect(resolveSecret('openai', { tenantId: 'anon:bob' })).toBe('B');
  });

  it('clearTenantEphemeralSecrets wipes only the named tenant', () => {
    setSecret('a', '1', { tenantId: 'anon:alice' });
    setSecret('b', '2', { tenantId: 'anon:bob' });
    const n = clearTenantEphemeralSecrets('anon:alice');
    expect(n).toBe(1);
    expect(resolveSecret('a', { tenantId: 'anon:alice' })).toBeNull();
    expect(resolveSecret('b', { tenantId: 'anon:bob' })).toBe('2');
  });

  it('clearExpiredEphemeralSecrets keeps only the named tenants', () => {
    setSecret('a', '1', { tenantId: 'anon:alice' });
    setSecret('b', '2', { tenantId: 'anon:bob' });
    setSecret('c', '3', { tenantId: 'anon:carol' });
    const wiped = clearExpiredEphemeralSecrets(new Set(['anon:alice']));
    expect(wiped).toBe(2);
    expect(resolveSecret('a', { tenantId: 'anon:alice' })).toBe('1');
    expect(resolveSecret('b', { tenantId: 'anon:bob' })).toBeNull();
    expect(resolveSecret('c', { tenantId: 'anon:carol' })).toBeNull();
  });

  it('setSecret without scope throws in ephemeral mode', () => {
    expect(() => setSecret('a', '1')).toThrow(/scope\.tenantId/);
  });
});
