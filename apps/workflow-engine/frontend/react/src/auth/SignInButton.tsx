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

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './useAuth.js';
import { migrateAnonToUser } from './migrateTenant.js';
import { ExistingProviderSignInError, getCurrentIdToken } from './firebase.js';
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

export function SignInButton() {
  const { user, loading, isConfigured, signIn, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isConfigured || loading) return null;

  /**
   * After a sign-in popup resolves, Firebase fires onIdTokenChanged
   * which populates the cached ID token. We force-prime it here so
   * the very next fetch (the migrate call) carries the bearer
   * immediately instead of racing the subscriber.
   */
  async function postSignInMigrate(): Promise<void> {
    const token = await getCurrentIdToken();
    if (token) setCurrentIdToken(token);
    const result = await migrateAnonToUser();
    if (result?.migrated) {
      // Best-effort console log — surfacing this as a toast is a
      // P3.6 polish item.
      console.info('openwop: anon → user migration', result);
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
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await signIn.google();
                    await postSignInMigrate();
                    setModalOpen(false);
                  } catch (err) {
                    setError(describeSignInError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Continue with Google
              </button>
              <button
                className="signin-provider signin-github"
                disabled={busy}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await signIn.github();
                    await postSignInMigrate();
                    setModalOpen(false);
                  } catch (err) {
                    setError(describeSignInError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
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
