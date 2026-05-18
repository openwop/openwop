/**
 * Firebase Auth bootstrap for app.openwop.dev.
 *
 * Initializes the Firebase JS SDK once per page load and exposes a
 * minimal API:
 *   - signInWithGoogle / signInWithGithub — popup-based OAuth flows
 *   - signOut                              — drops the local session
 *   - getCurrentUser                       — sync access to the cached user
 *   - getCurrentIdToken                    — fresh ID token (auto-refreshes)
 *   - onAuthChanged                        — subscribe to user changes
 *
 * Config is read from Vite env at build time
 * (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID).
 * Anonymous demo deploys leave these unset; the auth module
 * gracefully no-ops (signIn surfaces a friendly error, hook reports
 * no user). The cookie-mode anon flow is the fallback when Firebase
 * isn't configured.
 *
 * Token caching: Firebase Auth caches ID tokens for ~1h and auto-
 * refreshes on `getIdToken(true)`. We rely on the SDK's own cache
 * rather than reimplementing one. Background refresh fires from
 * `onIdTokenChanged` — the `client/config.ts` helpers re-read the
 * cached token on every authedHeaders() call.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  fetchSignInMethodsForEmail,
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  onIdTokenChanged,
  type AuthCredential,
  type AuthProvider,
  type User,
  type Auth,
} from 'firebase/auth';
import { setCurrentIdToken } from '../client/config.js';

/**
 * Raised when sign-in fails because the email is already registered
 * via a different provider. Carries the email, the providers the
 * email IS registered with, AND the pending credential from the
 * attempted-but-rejected provider — together they let the caller
 * run the link-account flow:
 *
 *   1. UI prompts user to sign in with `existingProviders[0]`.
 *   2. After that succeeds, `linkPendingCredential(pendingCredential)`
 *      attaches the rejected credential to the now-signed-in user
 *      so subsequent visits work with EITHER provider.
 *
 * Matches the `auth/account-exists-with-different-credential` Firebase
 * error code. `pendingCredential` is null if the rejected provider was
 * one Firebase couldn't extract a credential from (e.g., password).
 */
export class ExistingProviderSignInError extends Error {
  constructor(
    public readonly email: string,
    public readonly existingProviders: readonly string[],
    public readonly pendingCredential: AuthCredential | null,
    public readonly attemptedProvider: 'google.com' | 'github.com',
  ) {
    const friendly = existingProviders.map(friendlyProviderName).join(' or ');
    super(
      `${email} is already signed up with ${friendly || 'another provider'}. ` +
        `Sign in with ${friendly || 'that provider'} to link your ${friendlyProviderName(attemptedProvider)} account.`,
    );
    this.name = 'ExistingProviderSignInError';
  }
}

function friendlyProviderName(providerId: string): string {
  switch (providerId) {
    case 'google.com':
    case 'googleAuthProvider': return 'Google';
    case 'github.com':
    case 'githubAuthProvider': return 'GitHub';
    case 'password': return 'email + password';
    default: return providerId;
  }
}

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

let auth: Auth | null = null;
let app: FirebaseApp | null = null;
let cachedUser: User | null = null;

function readConfigFromEnv(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (!apiKey || !authDomain || !projectId) return null;
  return { apiKey, authDomain, projectId };
}

/** Whether Firebase Auth is configured for this build. UI uses this
 *  to decide whether to render the SignInButton. */
export function isAuthConfigured(): boolean {
  return readConfigFromEnv() !== null;
}

function ensureInit(): Auth | null {
  if (auth) return auth;
  const cfg = readConfigFromEnv();
  if (!cfg) return null;
  app = initializeApp(cfg);
  auth = getAuth(app);
  // Eagerly capture the cached user (page reload restores the prior session).
  cachedUser = auth.currentUser;
  // Keep the cache in sync + propagate the fresh ID token to the
  // shared client/config cache so authedHeaders() reads it
  // synchronously on every fetch.
  onIdTokenChanged(auth, async (u) => {
    cachedUser = u;
    if (u) {
      try {
        const token = await u.getIdToken();
        setCurrentIdToken(token);
      } catch {
        setCurrentIdToken(null);
      }
    } else {
      setCurrentIdToken(null);
    }
  });
  return auth;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function project(u: User | null): AuthUser | null {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  };
}

type AttemptedProviderId = 'google.com' | 'github.com';

/**
 * Run the popup-sign-in flow against `provider`. On the cross-provider
 * collision (auth/account-exists-with-different-credential), throw an
 * `ExistingProviderSignInError` carrying enough state for the caller
 * to run the account-linking flow.
 */
async function signInWith(provider: AuthProvider, providerId: AttemptedProviderId): Promise<AuthUser> {
  const a = ensureInit();
  if (!a) throw new Error('Firebase Auth not configured');
  try {
    const result = await signInWithPopup(a, provider);
    return project(result.user)!;
  } catch (err) {
    type FbError = { code?: string; customData?: { email?: string } };
    const e = err as FbError;
    if (e.code === 'auth/account-exists-with-different-credential' && e.customData?.email) {
      const email = e.customData.email;
      // Extract the rejected credential so the caller can link it
      // after the user signs in with the existing provider. Each
      // provider has its own `credentialFromError` static.
      const pendingCred =
        providerId === 'google.com'
          ? GoogleAuthProvider.credentialFromError(err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0])
          : GithubAuthProvider.credentialFromError(err as Parameters<typeof GithubAuthProvider.credentialFromError>[0]);
      let providers: readonly string[] = [];
      try {
        providers = await fetchSignInMethodsForEmail(a, email);
      } catch {
        // fetchSignInMethodsForEmail can fail under email-enumeration
        // protection. We still raise the typed error; the UI just
        // shows the "another provider" fallback message and offers
        // both buttons.
      }
      throw new ExistingProviderSignInError(email, providers, pendingCred, providerId);
    }
    throw err;
  }
}

export async function signInWithGoogle(): Promise<AuthUser> {
  return signInWith(new GoogleAuthProvider(), 'google.com');
}

export async function signInWithGithub(): Promise<AuthUser> {
  return signInWith(new GithubAuthProvider(), 'github.com');
}

/**
 * Attach `pendingCredential` to the currently signed-in Firebase user.
 * Called after the user completes the existing-provider sign-in flow
 * to finalize linking. After this call, subsequent visits can sign
 * in with EITHER provider and land on the same Firebase user (= same
 * `user:<sha>` tenant on the backend).
 *
 * Throws if no user is signed in OR if the credential is invalid.
 */
export async function linkPendingCredential(pendingCredential: AuthCredential): Promise<void> {
  const a = ensureInit();
  if (!a) throw new Error('Firebase Auth not configured');
  const u = a.currentUser;
  if (!u) throw new Error('No signed-in user to link to.');
  await linkWithCredential(u, pendingCredential);
}

export async function signOut(): Promise<void> {
  const a = ensureInit();
  if (!a) return;
  await fbSignOut(a);
  cachedUser = null;
}

export function getCurrentUser(): AuthUser | null {
  ensureInit();
  return project(cachedUser);
}

/** Fresh ID token. Returns null if not signed in OR Firebase Auth is
 *  not configured. The SDK caches tokens internally — this call is
 *  cheap unless the cached token is near expiry. */
export async function getCurrentIdToken(): Promise<string | null> {
  const a = ensureInit();
  if (!a) return null;
  const u = a.currentUser ?? cachedUser;
  if (!u) return null;
  return await u.getIdToken();
}

/** Subscribe to auth-state changes. Fires immediately with the current
 *  value, then on every user change (sign-in, sign-out, token refresh).
 *  Returns an unsubscribe function. */
export function onAuthChanged(cb: (u: AuthUser | null) => void): () => void {
  const a = ensureInit();
  if (!a) {
    cb(null);
    return () => undefined;
  }
  return onIdTokenChanged(a, (u) => cb(project(u)));
}
