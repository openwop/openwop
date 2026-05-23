/**
 * Per-node credential picker. Renders a dropdown of stored credentialRefs
 * (filtered by an optional `<provider>:` prefix) plus a "Manage keys" link
 * that opens the /keys page in a new tab.
 *
 * The empty/no-keys state surfaces a clear CTA so the user understands
 * they need to register a key first — better than rendering a disabled
 * dropdown with no hint why.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listStoredRefs } from '../../byok/lib/byokClient.js';

interface Props {
  value: string | undefined;
  onChange(next: string | undefined): void;
  /** When set, filters the picker to refs starting with `<providerFilter>:`. */
  providerFilter?: string;
  required?: boolean;
}

export function CredentialPickerInput({ value, onChange, providerFilter, required }: Props): JSX.Element {
  const [refs, setRefs] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStoredRefs()
      .then((list) => { if (!cancelled) setRefs(list); })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRefs([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const visible = (refs ?? []).filter((r) => {
    if (!providerFilter) return true;
    return r.startsWith(`${providerFilter}:`) || r === providerFilter;
  });

  if (refs === null) {
    return <div className="muted" style={{ fontSize: 12 }}>Loading credentials…</div>;
  }
  if (visible.length === 0) {
    return (
      <div>
        <div className="alert info" style={{ fontSize: 12, padding: '6px 10px' }}>
          No {providerFilter ? `${providerFilter} ` : ''}keys stored yet.{' '}
          <Link to="/keys" target="_blank" rel="noopener noreferrer">Manage keys</Link> to add one.
        </div>
        {error && <div className="muted" style={{ fontSize: 11 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select
        value={value ?? ''}
        required={required}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{ flex: 1 }}
      >
        <option value="">{required ? 'Pick a key…' : '(none)'}</option>
        {visible.map((ref) => (
          <option key={ref} value={ref}>{ref}</option>
        ))}
      </select>
      <Link
        to="/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="muted"
        style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        title="Open the Keys management page in a new tab"
      >
        Manage
      </Link>
    </div>
  );
}
