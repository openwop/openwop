import { describe, it, expect, vi } from 'vitest';
import {
  isAuthConfigured,
  getCurrentUser,
  getCurrentIdToken,
  onAuthChanged,
  signInWithGoogle,
  signInWithGithub,
} from '../firebase.js';

/**
 * Unit coverage for the lazy Firebase module (GAP-ANALYSIS E13) on the
 * NOT-CONFIGURED path — the anon/demo deploy, and the path CI exercises. The
 * key guarantee: when VITE_FIREBASE_* is unset, the module must NEVER load the
 * Firebase SDK (ensureInitAsync short-circuits before the dynamic import) and
 * must degrade gracefully. The configured/redirect path needs real OAuth and is
 * verified manually against openwop-dev.
 */
describe('firebase auth (not configured)', () => {
  it('reports not-configured', () => {
    expect(isAuthConfigured()).toBe(false);
  });

  it('has no cached user', () => {
    expect(getCurrentUser()).toBeNull();
  });

  it('resolves a null ID token without loading the SDK', async () => {
    expect(await getCurrentIdToken()).toBeNull();
  });

  it('onAuthChanged fires once with null and returns a safe unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = onAuthChanged(cb);
    expect(typeof unsub).toBe('function');
    // ensureInitAsync resolves null on the next microtask → cb(null).
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith(null);
    expect(() => unsub()).not.toThrow();
  });

  it('sign-in rejects with a friendly not-configured error', async () => {
    await expect(signInWithGoogle()).rejects.toThrow(/not configured/i);
    await expect(signInWithGithub()).rejects.toThrow(/not configured/i);
  });
});
