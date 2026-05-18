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
  getRedirectResult,
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithCredential,
  OAuthProvider,
  signInWithRedirect,
  signOut as fbSignOut,
  onIdTokenChanged,
  type AuthCredential,
  type User,
  type Auth,
} from 'firebase/auth';
import { setCurrentIdToken } from '../client/config.js';

// ─── redirect-flow state persistence ────────────────────────────
// We use the redirect-based sign-in flow (not popup) to dodge the
// `Cross-Origin-Opener-Policy would block window.closed` console
// warnings that Firebase's popup-poller triggers. Cost: the flow now
// spans multiple page loads, so state has to live in sessionStorage.
//
// Two keys:
//   - openwop.auth.attempted   set BEFORE signInWithRedirect so the
//                              redirect-back handler knows which
//                              provider to ask `credentialFromError`
//                              for on the cross-provider collision
//   - openwop.auth.pendingLink set when we capture a rejected
//                              credential, consumed when the user
//                              comes back from signing in with the
//                              existing provider (so we can link the
//                              rejected credential to the same user)

const ATTEMPTED_PROVIDER_KEY = 'openwop.auth.attempted';
const PENDING_LINK_KEY = 'openwop.auth.pendingLink';

type ProviderId = 'google.com' | 'github.com';

function setAttemptedProvider(id: ProviderId): void {
  try { sessionStorage.setItem(ATTEMPTED_PROVIDER_KEY, id); } catch { /* private mode */ }
}
function consumeAttemptedProvider(): ProviderId | null {
  try {
    const v = sessionStorage.getItem(ATTEMPTED_PROVIDER_KEY);
    sessionStorage.removeItem(ATTEMPTED_PROVIDER_KEY);
    return v === 'google.com' || v === 'github.com' ? v : null;
  } catch { return null; }
}

interface SerializedLink {
  cred: ReturnType<AuthCredential['toJSON']>;
  attemptedProvider: ProviderId;
}

function stashPendingLink(cred: AuthCredential, attemptedProvider: ProviderId): void {
  try {
    sessionStorage.setItem(PENDING_LINK_KEY, JSON.stringify({
      cred: cred.toJSON(),
      attemptedProvider,
    } satisfies SerializedLink));
  } catch { /* private mode */ }
}
function consumePendingLink(): { cred: AuthCredential; attemptedProvider: ProviderId } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LINK_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_LINK_KEY);
    const parsed = JSON.parse(raw) as SerializedLink;
    // OAuthProvider.credentialFromJSON resurrects either Google or
    // GitHub OAuth credentials (both extend OAuthProvider).
    const cred = OAuthProvider.credentialFromJSON(parsed.cred);
    return { cred, attemptedProvider: parsed.attemptedProvider };
  } catch { return null; }
}

/** Test affordance / sign-out cleanup. */
export function clearPendingLinkState(): void {
  try {
    sessionStorage.removeItem(ATTEMPTED_PROVIDER_KEY);
    sessionStorage.removeItem(PENDING_LINK_KEY);
  } catch { /* ignore */ }
}

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

/**
 * Kick off redirect-based sign-in with Google. Never returns — the
 * page navigates away to Firebase's auth handler and comes back on
 * a fresh page load. The redirect-back is observed by
 * `processRedirectResult()` at app boot.
 */
export async function signInWithGoogle(): Promise<void> {
  const a = ensureInit();
  if (!a) throw new Error('Firebase Auth not configured');
  setAttemptedProvider('google.com');
  console.info('openwop.auth: signInWithRedirect → google.com', {
    sessionId: sessionStorage.getItem(ATTEMPTED_PROVIDER_KEY),
  });
  await signInWithRedirect(a, new GoogleAuthProvider());
}

/** Same as `signInWithGoogle`, for GitHub. */
export async function signInWithGithub(): Promise<void> {
  const a = ensureInit();
  if (!a) throw new Error('Firebase Auth not configured');
  setAttemptedProvider('github.com');
  console.info('openwop.auth: signInWithRedirect → github.com', {
    sessionId: sessionStorage.getItem(ATTEMPTED_PROVIDER_KEY),
  });
  await signInWithRedirect(a, new GithubAuthProvider());
}

/**
 * What the redirect-back handler decided about the just-completed
 * sign-in attempt. The SignInButton subscribes to this state.
 */
export type RedirectState =
  | { kind: 'none' }
  | { kind: 'success'; linked: boolean }
  | { kind: 'link-required'; error: ExistingProviderSignInError }
  | { kind: 'error'; error: Error };

/**
 * Memoized boot-time promise. Components await this once on mount;
 * subsequent calls reuse the same promise so the redirect result is
 * processed exactly once per page load.
 */
let redirectStatePromise: Promise<RedirectState> | null = null;
export function getRedirectState(): Promise<RedirectState> {
  if (redirectStatePromise === null) {
    redirectStatePromise = processRedirectResult();
  }
  return redirectStatePromise;
}

/**
 * Process the result of the most recent redirect-based sign-in.
 *
 * Outcomes:
 *   - none           the user landed here without a sign-in redirect
 *                    in flight (normal page load or hard refresh)
 *   - success        sign-in completed; the linked flag indicates
 *                    whether we also attached a previously-stashed
 *                    pending credential (the second half of the
 *                    link-account flow)
 *   - link-required  Firebase rejected this redirect with the
 *                    cross-provider collision; carries the typed
 *                    `ExistingProviderSignInError` for the UI to
 *                    render and the pending credential has already
 *                    been stashed for the next redirect-back
 *   - error          some other auth failure; surfaced verbatim
 *
 * Must be called exactly once per page load, before the UI binds to
 * auth state (otherwise the redirect-back result is silently
 * dropped). Safe to call when the app booted without a redirect in
 * flight — returns { kind: 'none' }.
 */
export async function processRedirectResult(): Promise<RedirectState> {
  const a = ensureInit();
  if (!a) {
    console.info('openwop.auth: redirect — firebase not configured');
    return { kind: 'none' };
  }
  const attemptedProvider = consumeAttemptedProvider();
  console.info('openwop.auth: redirect — processing', {
    attemptedProvider,
    currentUserBefore: a.currentUser?.email ?? null,
  });
  try {
    const result = await getRedirectResult(a);
    console.info('openwop.auth: getRedirectResult', {
      hasResult: !!result,
      uid: result?.user?.uid,
      email: result?.user?.email,
      providerId: result?.providerId,
      currentUserAfter: a.currentUser?.email ?? null,
    });
    // If getRedirectResult returned null BUT we were expecting a
    // redirect AND auth.currentUser is set, Firebase already processed
    // the sign-in on a prior load — treat it as success so the migrate
    // hook still fires. This covers the "user opened DevTools mid-
    // redirect" / strict-mode-replay corner case.
    if (!result && attemptedProvider && a.currentUser) {
      console.info('openwop.auth: redirect — recovering from pre-processed sign-in');
      return { kind: 'success', linked: false };
    }
    if (!result) return { kind: 'none' };
    // Successfully signed in via redirect. If there's a pending
    // credential stash from the previous (rejected) redirect, link
    // it now so subsequent visits work with either provider.
    const pending = consumePendingLink();
    let linked = false;
    if (pending) {
      try {
        await linkWithCredential(result.user, pending.cred);
        linked = true;
      } catch (err) {
        console.warn('openwop.auth: provider linking failed', err);
      }
    }
    return { kind: 'success', linked };
  } catch (err) {
    console.warn('openwop.auth: getRedirectResult threw', err);
    type FbError = { code?: string; customData?: { email?: string } };
    const e = err as FbError;
    if (e.code === 'auth/account-exists-with-different-credential' && e.customData?.email && attemptedProvider) {
      const email = e.customData.email;
      const pendingCred =
        attemptedProvider === 'google.com'
          ? GoogleAuthProvider.credentialFromError(err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0])
          : GithubAuthProvider.credentialFromError(err as Parameters<typeof GithubAuthProvider.credentialFromError>[0]);
      let providers: readonly string[] = [];
      try {
        providers = await fetchSignInMethodsForEmail(a, email);
      } catch { /* email-enum protection; fall through */ }
      if (pendingCred) stashPendingLink(pendingCred, attemptedProvider);
      const typed = new ExistingProviderSignInError(email, providers, pendingCred, attemptedProvider);
      return { kind: 'link-required', error: typed };
    }
    return { kind: 'error', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function signOut(): Promise<void> {
  const a = ensureInit();
  if (!a) return;
  clearPendingLinkState();
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
