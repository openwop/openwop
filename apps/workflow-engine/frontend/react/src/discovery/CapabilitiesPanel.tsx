import { useEffect, useState } from 'react';
import { getCapabilities } from '../client/runsClient.js';

export function CapabilitiesPanel() {
  const [caps, setCaps] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((c) => !cancelled && setCaps(c))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <div className="card">
        <h2>Host capabilities</h2>
        <p className="muted">
          Live render of <code>GET /.well-known/openwop</code>. Hosts evolve their advertisement
          when they swap stubs for real implementations — this panel is the public statement
          of what the connected host actually supports.
        </p>
        {error && <div className="alert error">{error}</div>}
        {caps ? (
          <pre>{JSON.stringify(caps, null, 2)}</pre>
        ) : (
          !error && <div className="muted">Loading…</div>
        )}
      </div>
    </section>
  );
}
