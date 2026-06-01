/**
 * Top-of-page dismissible banner for the public app.openwop.dev demo.
 * Stay-quiet defaults:
 *   - Hidden when the host has no in-memory surfaces (i.e., a real
 *     production host — banner copy doesn't apply).
 *   - Hidden once the visitor dismisses it (localStorage flag, ~30d).
 *
 * Copy is tuned for an anonymous-session demo:
 *   - "Anonymous demo" because every visitor lands as `anon:<sid>`
 *     via the session cookie minted by the backend auth middleware
 *     (P0.2). No signup yet.
 *   - "Workflows + BYOK keys reset every 24h" because the cleanup
 *     endpoint (P0.5) wipes the session's ephemeral state on a
 *     daily cron, AND because the session cookie itself expires at
 *     24h so even without cleanup the user effectively gets a fresh
 *     start.
 *   - Links to /privacy for the cookie + retention disclosure.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCapabilities } from '../client/runsClient.js';
import { useAuth } from '../auth/useAuth.js';
import { InfoIcon, XIcon } from '../ui/icons/index.js';

const DISMISS_KEY = 'openwop:demo-banner:dismissed';

interface HostSurfaceAd {
  name: string;
  supported: boolean;
  implementation?: string;
}

export function DemoHostBanner() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; }
    catch { return false; }
  });
  const [inMemoryCount, setInMemoryCount] = useState<number | null>(null);

  // Probe the host's capability advertisement regardless of sign-in
  // state so the hook count stays stable across renders (Rules of
  // Hooks: every hook call MUST run on every render — moving an early
  // return ABOVE this useEffect would skip it on the signed-in path
  // and trip React error #300 the next time the user signs in).
  useEffect(() => {
    if (hidden) return;
    let aborted = false;
    void (async () => {
      try {
        // Routes through the SDK's `client.discovery.capabilities()` per
        // `sdk/PARITY.md`. The SDK handles auth + cookie credentials
        // uniformly with the rest of the SPA's client layer.
        const caps = (await getCapabilities()) as {
          capabilities?: { hostSurfaces?: HostSurfaceAd[] };
        };
        const surfaces = caps?.capabilities?.hostSurfaces ?? [];
        const inmem = surfaces.filter((s) => s.supported && /in-memory|sqlite-in-memory|brute-force/.test(s.implementation ?? '')).length;
        if (!aborted) setInMemoryCount(inmem);
      } catch {
        // network issues — keep banner hidden, don't surface noise
      }
    })();
    return () => { aborted = true; };
  }, [hidden]);

  // Signed-in users get persistent storage — the demo-host disclosure
  // doesn't apply to them. Hide the banner AFTER all hooks have run.
  if (user) return null;
  if (hidden || inMemoryCount == null || inMemoryCount === 0) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* private mode */ }
  };

  return (
    <div className="demo-host-banner" role="status" aria-live="polite">
      <span className="demo-host-banner-icon" aria-hidden><InfoIcon size={16} /></span>
      <span className="demo-host-banner-text">
        <strong>Anonymous demo.</strong>{' '}
        Your workflows + any BYOK keys you add are scoped to this browser
        session and reset after 24&nbsp;hours. Nothing is shared with other
        visitors. Signup with persistent storage is coming soon.{' '}
        <Link to="/privacy">Privacy & cookies →</Link>
      </span>
      <button
        className="demo-host-banner-close"
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        title="Dismiss"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
