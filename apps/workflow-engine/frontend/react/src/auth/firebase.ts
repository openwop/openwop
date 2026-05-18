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
  signInWithPopup,
  signOut as fbSignOut,
  onIdTokenChanged,
  type AuthProvider,
  type User,
  type Auth,
} from 'firebase/auth';
import { setCurrentIdToken } from '../client/config.js';

/**
 * Raised when sign-in fails because the email is already registered
 * via a different provider. Carries the email + the providers the
 * email IS registered with so the UI can tell the user which button
 * to click instead. Matches the `auth/account-exists-with-different-
 * credential` Firebase error code.
 */
export class ExistingProviderSignInError extends Error {
  constructor(
    public readonly email: string,
    public readonly existingProviders: readonly string[],
  ) {
    const friendly = existingProviders.map(friendlyProviderName).join(' or ');
    super(
      `${email} is already signed up with ${friendly || 'another provider'}. ` +
        `Click "${friendly ? `Continue with ${friendly}` : 'the other provider'}" to sign in instead.`,
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

/**
 * Run the popup-sign-in flow against `provider` and translate the
 * `auth/account-exists-with-different-credential` Firebase error code
 * into a typed `ExistingProviderSignInError` carrying the email +
 * existing providers — the UI uses both to render a useful message
 * (e.g., "alice@example.com is already signed up with Google.").
 */
async function signInWith(provider: AuthProvider): Promise<AuthUser> {
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
      let providers: readonly string[] = [];
      try {
        providers = await fetchSignInMethodsForEmail(a, email);
      } catch {
        // fetchSignInMethodsForEmail can fail under email-enumeration
        // protection. We still raise the typed error; the UI just
        // shows the "another provider" fallback message.
      }
      throw new ExistingProviderSignInError(email, providers);
    }
    throw err;
  }
}

export async function signInWithGoogle(): Promise<AuthUser> {
  return signInWith(new GoogleAuthProvider());
}

export async function signInWithGithub(): Promise<AuthUser> {
  return signInWith(new GithubAuthProvider());
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
