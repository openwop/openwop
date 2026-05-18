/**
 * Header sign-in / account UI.
 *
 * Three states:
 *   1. Firebase not configured → render nothing
 *   2. Configured, no user     → "Sign in" button → modal with Google + GitHub
 *   3. Signed in               → avatar + dropdown (display name, "Sign out",
 *                                "Delete account" placeholder for P3.6.5)
 *
 * Provider buttons use the official brand colors and SVG marks; tone-
 * matched to the existing dark builder palette.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './useAuth.js';
import { migrateAnonToUser } from './migrateTenant.js';
import {
  ExistingProviderSignInError,
  getCurrentIdToken,
  getRedirectState,
  signInWithGithub,
  signInWithGoogle,
} from './firebase.js';
import { setCurrentIdToken } from '../client/config.js';
import { deleteAccount, RequiresRecentLoginError } from './deleteAccount.js';

function describeSignInError(err: unknown): string {
  if (err instanceof ExistingProviderSignInError) return err.message;
  if (err instanceof Error) {
    // Strip the `Firebase: Error (auth/...)` wrapper so the modal
    // doesn't surface a code that means nothing to the visitor.
    const m = err.message.match(/^Firebase: Error \(auth\/([a-z-]+)\)\.?$/);
    if (m) {
      switch (m[1]) {
        case 'popup-closed-by-user':
        case 'cancelled-popup-request':
          return 'Sign-in was cancelled.';
        case 'popup-blocked':
          return 'Your browser blocked the sign-in popup. Allow popups for app.openwop.dev and try again.';
        case 'operation-not-allowed':
          return 'This provider isn\'t enabled for the deployment. The maintainer needs to turn it on in the Firebase Console.';
        case 'network-request-failed':
          return 'Network error reaching the identity provider. Check your connection and try again.';
        default:
          return `Sign-in failed: ${m[1]}.`;
      }
    }
    return err.message;
  }
  return String(err);
}

/**
 * Portal the modal out of the SignInButton's render tree. The button
 * lives inside `<header className="app-header">`, which is
 * `position: sticky` + `backdrop-filter` — both create stacking
 * contexts that cap any descendant's z-index. Without the portal the
 * modal renders behind `<main>` even with z-index: 1000.
 */
function ModalPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

interface PendingLink {
  email: string;
  existingProviders: readonly string[];
  attemptedProvider: 'google.com' | 'github.com';
}

function providerLabel(id: string): string {
  if (id === 'google.com') return 'Google';
  if (id === 'github.com') return 'GitHub';
  return id;
}

/**
 * Body shown after Firebase rejects sign-in with
 * `auth/account-exists-with-different-credential`. Explains the
 * collision in plain language and offers a single-click flow to:
 *   1. Sign in with the existing provider.
 *   2. Link the rejected credential to the same Firebase user.
 *
 * When `existingProviders` is empty (email-enumeration protection
 * stripped the list), both buttons are offered.
 */
function LinkAccountBody(props: {
  pendingLink: PendingLink;
  busy: boolean;
  error: string | null;
  onContinue: (which: 'google' | 'github') => Promise<void>;
  onCancel: () => void;
}) {
  const { pendingLink, busy, error, onContinue, onCancel } = props;
  const attempted = providerLabel(pendingLink.attemptedProvider);
  const known = pendingLink.existingProviders.length > 0;
  // Render only the existing provider's button when we know it.
  // Otherwise fall back to both, the user picks the one they
  // remember signing up with.
  const choices = known
    ? pendingLink.existingProviders
    : ['google.com', 'github.com'].filter((p) => p !== pendingLink.attemptedProvider);
  return (
    <>
      <h3 className="signin-modal-title">Link your {attempted} account</h3>
      <p className="signin-modal-lede muted">
        <strong>{pendingLink.email}</strong> is already signed up
        {known ? ` with ${pendingLink.existingProviders.map(providerLabel).join(' or ')}` : ''}.
        Sign in with that provider once and we'll attach {attempted} so
        you can use either next time.
      </p>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {choices.map((id) => {
        const which = id === 'google.com' ? 'google' : 'github';
        const cls = id === 'google.com' ? 'signin-provider signin-google' : 'signin-provider signin-github';
        return (
          <button
            key={id}
            className={cls}
            disabled={busy}
            type="button"
            onClick={() => onContinue(which)}
          >
            Continue with {providerLabel(id)}
          </button>
        );
      })}
      <button
        className="signin-modal-cancel"
        type="button"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </button>
    </>
  );
}

export function SignInButton() {
  const { user, loading, isConfigured, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * Subscribe to the boot-time redirect-result promise exactly once.
   * MUST run before any conditional return so the hook count stays
   * stable across renders (Rules of Hooks).
   *
   * If we landed on this page coming back from a sign-in redirect,
   * the result is reported here and we either:
   *   - open the modal in link-mode (cross-provider collision), OR
   *   - run the post-sign-in migration (success), OR
   *   - surface a friendly error (other auth failure).
   */
  useEffect(() => {
    let cancelled = false;
    void getRedirectState().then(async (state) => {
      if (cancelled) return;
      if (state.kind === 'link-required') {
        const err = state.error;
        setPendingLink({
          email: err.email,
          existingProviders: err.existingProviders,
          attemptedProvider: err.attemptedProvider,
        });
        setModalOpen(true);
      } else if (state.kind === 'success') {
        const token = await getCurrentIdToken();
        if (token) setCurrentIdToken(token);
        const result = await migrateAnonToUser();
        if (result?.migrated) console.info('openwop: anon → user migration', result);
        setModalOpen(false);
        setPendingLink(null);
      } else if (state.kind === 'error') {
        setError(describeSignInError(state.error));
        setModalOpen(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (!isConfigured || loading) return null;

  /**
   * Kick off a redirect-based sign-in. The page navigates away to
   * Firebase's auth handler; control returns via a fresh page load,
   * where `processRedirectResult()` (called at boot) reports the
   * outcome via the `getRedirectState()` promise that the mount
   * effect above subscribes to. This function only initiates the
   * redirect; the browser handles the rest.
   */
  async function attemptSignIn(which: 'google' | 'github'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await (which === 'google' ? signInWithGoogle() : signInWithGithub());
      // signInWithRedirect resolves AFTER initiating the redirect.
      // The browser navigates within a tick; the modal stays open
      // until then.
    } catch (err) {
      setError(describeSignInError(err));
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <>
        <button
          className="signin-trigger"
          onClick={() => setModalOpen(true)}
          type="button"
        >
          Sign in
        </button>
        {modalOpen ? (
          <ModalPortal>
          <div
            className="signin-modal-backdrop"
            onClick={() => setModalOpen(false)}
          >
            <div
              className="signin-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Sign in"
            >
              {pendingLink ? (
                <LinkAccountBody
                  pendingLink={pendingLink}
                  busy={busy}
                  error={error}
                  onContinue={attemptSignIn}
                  onCancel={() => { setPendingLink(null); setError(null); }}
                />
              ) : (
                <>
                  <h3 className="signin-modal-title">Sign in to save your work</h3>
                  <p className="signin-modal-lede muted">
                    Workflows + BYOK keys you add after signing in persist across
                    sessions. Anonymous demo state is wiped every 24h.
                  </p>
                  {error ? <div className="alert error" role="alert">{error}</div> : null}
                  <button
                    className="signin-provider signin-google"
                    disabled={busy}
                    type="button"
                    onClick={() => { void attemptSignIn('google'); }}
                  >
                    Continue with Google
                  </button>
                  <button
                    className="signin-provider signin-github"
                    disabled={busy}
                    type="button"
                    onClick={() => { void attemptSignIn('github'); }}
                  >
                    Continue with GitHub
                  </button>
                  <button
                    className="signin-modal-cancel"
                    type="button"
                    onClick={() => setModalOpen(false)}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
          </ModalPortal>
        ) : null}
      </>
    );
  }

  // Signed-in: avatar + dropdown
  const initials = (user.displayName ?? user.email ?? user.uid)
    .split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="account-menu">
      <button
        className="account-menu-trigger"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        type="button"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="account-menu-avatar" />
        ) : (
          <span className="account-menu-initials">{initials}</span>
        )}
        <span className="account-menu-name">
          {user.displayName ?? user.email ?? 'Account'}
        </span>
      </button>
      {menuOpen ? (
        <div className="account-menu-popover" role="menu">
          <div className="account-menu-header">
            <div className="account-menu-displayname">{user.displayName ?? '—'}</div>
            <div className="account-menu-email muted">{user.email ?? user.uid}</div>
          </div>
          <button
            className="account-menu-item"
            role="menuitem"
            onClick={async () => {
              await signOut();
              setMenuOpen(false);
            }}
            type="button"
          >
            Sign out
          </button>
          <button
            className="account-menu-item account-menu-danger"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmingDelete(true);
              setDeleteError(null);
            }}
            type="button"
          >
            Delete account…
          </button>
        </div>
      ) : null}
      {confirmingDelete ? (
        <ModalPortal>
        <div
          className="signin-modal-backdrop"
          onClick={() => !deleting && setConfirmingDelete(false)}
        >
          <div
            className="signin-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Confirm account deletion"
          >
            <h3 className="signin-modal-title">Delete your account?</h3>
            <p>
              This permanently removes every workflow, run, event,
              interrupt, and BYOK credential you've stored under{' '}
              <strong>{user.email ?? user.displayName ?? user.uid}</strong>.
              Your Firebase identity record is revoked too. There is
              no undo.
            </p>
            {deleteError ? <div className="alert error">{deleteError}</div> : null}
            <div className="button-row">
              <button
                type="button"
                className="signin-modal-cancel"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="signin-provider signin-danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    const result = await deleteAccount();
                    console.info('openwop: account deleted', result);
                    setConfirmingDelete(false);
                    // Force reload — the SPA's caches reference a
                    // tenant id that no longer exists.
                    window.location.href = '/';
                  } catch (err) {
                    if (err instanceof RequiresRecentLoginError) {
                      setDeleteError(err.message);
                    } else {
                      setDeleteError(err instanceof Error ? err.message : String(err));
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Deleting…' : 'Yes, delete everything'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
