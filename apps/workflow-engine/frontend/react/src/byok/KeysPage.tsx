/**
 * `/keys` route — API key management.
 *
 * Lists every credentialRef the user has stored on the host, lets
 * them rename/relabel via add-new-then-delete, and add new
 * credentials per-provider without going through the full BYOK
 * first-run wizard.
 *
 * Workflow nodes (chat, mock-ai) reference a credential by its
 * `credentialRef` string. Users who want different keys per node
 * (e.g., "anthropic-prod" vs "anthropic-test", or different OpenAI
 * tenants) manage that catalog here.
 *
 * The key VALUES are stored server-side (AES-256-GCM at rest in the
 * sample BE); the FE only ever sees a masked rendering after the
 * value is submitted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteKey, listStoredRefs, storeKey } from './lib/byokClient.js';
import { PROVIDERS, type ProviderConfig } from './lib/providers.js';

interface CredentialEntry {
  ref: string;
  providerId: string | null;
  /** Trailing label after `<providerId>:` if present (e.g., "prod"). */
  label: string | null;
}

/** Split a credentialRef like `anthropic:prod` into provider+label.
 *  Refs without a colon are treated as legacy: provider unknown. */
function parseRef(ref: string): CredentialEntry {
  const colon = ref.indexOf(':');
  if (colon < 0) return { ref, providerId: null, label: null };
  return {
    ref,
    providerId: ref.slice(0, colon),
    label: ref.slice(colon + 1) || null,
  };
}

export function KeysPage(): JSX.Element {
  const [refs, setRefs] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  // Most-recently-stored masked view, keyed by credentialRef. The BE's
  // POST /v1/host/sample/byok/secrets returns `{ credentialRef, masked }`
  // but the LIST endpoint only returns refs. Persisting the masked
  // value in component state lets the user visually confirm "this is
  // the sk-ant-...e4f7 I just added" until they reload the page.
  const [maskedByRef, setMaskedByRef] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await listStoredRefs();
      setRefs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRefs([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const entries = useMemo<CredentialEntry[]>(() => {
    return (refs ?? []).map(parseRef);
  }, [refs]);

  // Group by provider for a clean per-provider section layout.
  const grouped = useMemo(() => {
    const byProvider = new Map<string, CredentialEntry[]>();
    for (const e of entries) {
      const key = e.providerId ?? '__legacy__';
      const arr = byProvider.get(key) ?? [];
      arr.push(e);
      byProvider.set(key, arr);
    }
    return byProvider;
  }, [entries]);

  // BYOK-only providers (the managed Try-it-free entry doesn't take
  // a user-supplied key; MiniMax is hidden — its key is server-side).
  const byokProviders = PROVIDERS.filter((p) => !p.managed && !p.hidden);

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>API keys</h2>
          <button className="secondary" onClick={() => { void refresh(); }}>Refresh</button>
        </div>
        <p className="muted">
          Manage the API keys your workflows use. Each key is stored
          server-side (encrypted at rest); the chat and workflow-node
          dispatchers reference a key by its label. Add multiple keys
          per provider (e.g., separate prod/test keys) and pick which
          one a specific workflow node uses from the builder.
        </p>

        {error && <div className="alert error">{error}</div>}

        {refs === null && <p className="muted">Loading…</p>}

        {refs !== null && byokProviders.map((p) => {
          const list = grouped.get(p.id) ?? [];
          const isAdding = adding === p.id;
          return (
            <div key={p.id} className="keys-provider-section">
              <div className="keys-provider-head">
                <div className="keys-provider-name">
                  <span className="keys-provider-badge" style={{ background: p.badgeColor }} aria-hidden="true">
                    {p.label.charAt(0)}
                  </span>
                  <strong>{p.label}</strong>
                  <span className="muted">· {list.length} key{list.length === 1 ? '' : 's'}</span>
                </div>
                {!isAdding && (
                  <button className="secondary" onClick={() => setAdding(p.id)}>+ Add key</button>
                )}
              </div>

              {isAdding && (
                <AddKeyForm
                  provider={p}
                  existingLabels={list.map((e) => e.label ?? e.ref)}
                  onCancel={() => setAdding(null)}
                  onSaved={async (storedRef, masked) => {
                    setAdding(null);
                    setMaskedByRef((prev) => ({ ...prev, [storedRef]: masked }));
                    await refresh();
                  }}
                />
              )}

              {list.length === 0 ? (
                <p className="muted keys-empty">No keys stored for {p.label} yet.</p>
              ) : (
                <ul className="keys-list">
                  {list.map((e) => (
                    <li key={e.ref} className="keys-list-item">
                      <div className="keys-list-item-main">
                        <code className="keys-list-item-ref">{e.ref}</code>
                        {maskedByRef[e.ref] && (
                          <span className="keys-list-item-masked" title="Masked rendering returned by the BE on store">
                            {maskedByRef[e.ref]}
                          </span>
                        )}
                      </div>
                      <button
                        className="secondary keys-list-item-delete"
                        onClick={async () => {
                          if (!window.confirm(`Delete key "${e.ref}"? Nodes referencing it will fail until you re-add it.`)) return;
                          try {
                            await deleteKey(e.ref);
                            setMaskedByRef((prev) => {
                              const next = { ...prev };
                              delete next[e.ref];
                              return next;
                            });
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* Legacy refs (no `<provider>:` prefix) — surfaced separately
            so the user can clean them up. */}
        {(() => {
          const legacy = refs !== null ? grouped.get('__legacy__') : undefined;
          if (!legacy || legacy.length === 0) return null;
          return (
            <div className="keys-provider-section">
              <div className="keys-provider-head">
                <div className="keys-provider-name">
                  <strong>Unscoped keys</strong>
                  <span className="muted">· {legacy.length}</span>
                </div>
              </div>
              <p className="muted">
                These credentials don&apos;t carry a <code>provider:</code>{' '}
                prefix. They still work, but the per-node picker can&apos;t
                filter them by provider. Delete and re-add to scope them.
              </p>
              <ul className="keys-list">
                {legacy.map((e) => (
                  <li key={e.ref} className="keys-list-item">
                    <code className="keys-list-item-ref">{e.ref}</code>
                    <button
                      className="secondary keys-list-item-delete"
                      onClick={async () => {
                        if (!window.confirm(`Delete key "${e.ref}"?`)) return;
                        try {
                          await deleteKey(e.ref);
                          await refresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>
    </section>
  );
}

function AddKeyForm({
  provider,
  existingLabels,
  onCancel,
  onSaved,
}: {
  provider: ProviderConfig;
  existingLabels: readonly string[];
  onCancel: () => void;
  /** Called after a successful store with the persisted credentialRef
   *  + the masked rendering the BE returned, so the page can surface
   *  the masked view on the corresponding list row. */
  onSaved: (storedRef: string, masked: string) => Promise<void>;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const credentialRef = useMemo(() => {
    const slug = label.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug ? `${provider.id}:${slug}` : '';
  }, [label, provider.id]);

  const labelTaken = existingLabels.includes(label.trim()) || existingLabels.includes(credentialRef);

  // Soft validation against the provider's apiKeyPrefix hint. The
  // wizard's first-run flow already does this; mirroring here so a
  // user adding a key from the manage page gets the same nudge when
  // they paste something that doesn't start with the expected prefix.
  // Warning only — submit isn't blocked because users with fine-tune
  // keys / org-prefixed keys are still valid.
  const prefixWarning = useMemo(() => {
    if (!provider.apiKeyPrefix) return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith(provider.apiKeyPrefix)) return null;
    return `${provider.label} keys usually start with \`${provider.apiKeyPrefix}\`. Double-check this is the right provider.`;
  }, [provider.apiKeyPrefix, provider.label, value]);

  async function onSubmit() {
    setErr(null);
    if (!label.trim()) {
      setErr('Label is required.');
      return;
    }
    if (!value.trim()) {
      setErr('Key value is required.');
      return;
    }
    if (labelTaken) {
      setErr('A key with this label already exists. Pick a different label.');
      return;
    }
    setSaving(true);
    try {
      const stored = await storeKey(credentialRef, value.trim());
      await onSaved(stored.credentialRef, stored.masked);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="keys-add-form">
      {err && <div className="alert error">{err}</div>}
      <div className="form-row">
        <label>Label <span className="muted">(used to identify the key in workflow nodes)</span></label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="prod, test, personal, …"
          autoFocus
        />
        {credentialRef && (
          <div className="muted builder-inspector-help">
            Will be stored as <code>{credentialRef}</code>
          </div>
        )}
      </div>
      <div className="form-row">
        <label>API key</label>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={provider.apiKeyPlaceholder ?? 'paste your key here'}
          autoComplete="off"
        />
        {provider.apiKeyHelpText && (
          <div className="muted builder-inspector-help">{provider.apiKeyHelpText}</div>
        )}
        {prefixWarning && (
          <div className="alert warning" style={{ marginTop: 6, fontSize: 12, padding: '6px 10px' }}>
            {prefixWarning}
          </div>
        )}
        {provider.apiKeyConsoleUrl && (
          <div className="muted builder-inspector-help">
            <a href={provider.apiKeyConsoleUrl} target="_blank" rel="noopener noreferrer">
              Get a key from {provider.label}
            </a>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button onClick={() => { void onSubmit(); }} disabled={saving}>
          {saving ? 'Saving…' : 'Save key'}
        </button>
      </div>
    </div>
  );
}
