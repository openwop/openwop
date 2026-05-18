/**
 * Auth hook for the SPA. Wraps `firebase.ts` in a React-friendly
 * subscription model so components can re-render on sign-in / sign-
 * out / token refresh.
 *
 * Returns:
 *   user      — AuthUser | null
 *   loading   — true until first onAuthChanged fires
 *   signIn    — { google, github } popup launchers
 *   signOut   — drops local session
 *
 * `useAuth()` is safe to call when Firebase isn't configured —
 * `user` stays null and `loading` flips false immediately.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type AuthUser,
  getCurrentUser,
  isAuthConfigured,
  onAuthChanged,
  signInWithGithub,
  signInWithGoogle,
  signOut as signOutImpl,
} from './firebase.js';

export interface UseAuth {
  user: AuthUser | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: {
    google: () => Promise<void>;
    github: () => Promise<void>;
  };
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const configured = isAuthConfigured();
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [loading, setLoading] = useState<boolean>(configured && user === null);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, [configured]);

  const signInGoogle = useCallback(async () => {
    await signInWithGoogle();
  }, []);
  const signInGithub = useCallback(async () => {
    await signInWithGithub();
  }, []);
  const handleSignOut = useCallback(async () => {
    await signOutImpl();
  }, []);

  return {
    user,
    loading,
    isConfigured: configured,
    signIn: { google: signInGoogle, github: signInGithub },
    signOut: handleSignOut,
  };
}
