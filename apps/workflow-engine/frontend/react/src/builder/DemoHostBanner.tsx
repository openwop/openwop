/**
 * One-line dismissible banner at the top of the builder shell. Reads
 * `/.well-known/openwop` once, counts in-memory surfaces, and warns
 * the user that state is ephemeral. Hidden once the user clicks the
 * close button (persisted in localStorage so it stays dismissed
 * across reloads).
 *
 * If the host advertises every surface with a non-in-memory
 * implementation, the banner stays hidden — the demo affordance is
 * only useful for the example builder's default host.
 */

import { useEffect, useState } from 'react';
import { config } from '../client/config.js';

const DISMISS_KEY = 'openwop:builder:demo-banner:dismissed';
const PHASE6_DOCS = 'examples/hosts/postgres';

interface HostSurfaceAd {
  name: string;
  supported: boolean;
  implementation?: string;
}

export function DemoHostBanner() {
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; }
    catch { return false; }
  });
  const [inMemoryCount, setInMemoryCount] = useState<number | null>(null);

  useEffect(() => {
    if (hidden) return;
    let aborted = false;
    void (async () => {
      try {
        const res = await fetch(`${config.baseUrl}/.well-known/openwop`);
        if (!res.ok) return;
        const body = (await res.json()) as { capabilities?: { hostSurfaces?: HostSurfaceAd[] } };
        const surfaces = body.capabilities?.hostSurfaces ?? [];
        const inmem = surfaces.filter((s) => s.supported && /in-memory|sqlite-in-memory|brute-force/.test(s.implementation ?? '')).length;
        if (!aborted) setInMemoryCount(inmem);
      } catch {
        // network issues — keep banner hidden, don't surface noise
      }
    })();
    return () => { aborted = true; };
  }, [hidden]);

  if (hidden || inMemoryCount == null || inMemoryCount === 0) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* private mode */ }
  };

  return (
    <div className="demo-host-banner" role="status" aria-live="polite">
      <span className="demo-host-banner-icon" aria-hidden>ⓘ</span>
      <span className="demo-host-banner-text">
        <strong>Demo host:</strong> {inMemoryCount} surface{inMemoryCount === 1 ? '' : 's'} are in-memory
        (storage, db, queue, blob, fs). State is process-local — restarts wipe it. For a host
        that wires real backends, see <code>{PHASE6_DOCS}</code>.
      </span>
      <button
        className="demo-host-banner-close"
        type="button"
        onClick={dismiss}
        aria-label="Dismiss demo notice"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
