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
import { useAuth } from './useAuth.js';

export function SignInButton() {
  const { user, loading, isConfigured, signIn, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isConfigured || loading) return null;

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
                    setModalOpen(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
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
                    setModalOpen(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
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
          {/* Account deletion lands in P3.6.5 */}
        </div>
      ) : null}
    </div>
  );
}
