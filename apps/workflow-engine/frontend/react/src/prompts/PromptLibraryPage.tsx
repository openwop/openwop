/**
 * `/prompts` route. Lists prompt templates with kind/tag filters.
 *
 * Read-only in this iteration. Mutating endpoints (POST/PUT/DELETE) per
 * RFC 0028 §A land alongside `capabilities.prompts.mutableLibrary: true`
 * once a host advertises it; the UI for "Create" lives behind that gate.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { listPrompts, renderLocal } from './promptsClient.js';
import type { PromptKind, PromptTemplate } from './types.js';
import { refToString } from './types.js';

const KINDS: { value: PromptKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'few-shot', label: 'Few-shot' },
  { value: 'schema-hint', label: 'Schema hint' },
];

export function PromptLibraryPage() {
  const [prompts, setPrompts] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<PromptKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PromptTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPrompts({})
      .then((items) => {
        if (!cancelled) setPrompts(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!prompts) return [];
    const q = search.trim().toLowerCase();
    return prompts.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false;
      if (!q) return true;
      const haystack = `${p.templateId} ${p.name ?? ''} ${p.description ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [prompts, kindFilter, search]);

  return (
    <section>
      <div className="card">
        <h2>Prompt library</h2>
        <p className="muted">
          Templates a workflow node or agent can reference via{' '}
          <code>config.systemPromptRef</code> / <code>config.userPromptRef</code> per RFC 0027.
          Falls back to a local sample list when the host doesn't advertise{' '}
          <code>capabilities.prompts.supported</code>.
        </p>

        {error && <div className="alert error">{error}</div>}

        <div className="form-row" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto' }}>
            <label>Kind</label>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as PromptKind | 'all')}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="templateId, name, description, tag…"
            />
          </div>
        </div>

        {prompts === null ? (
          <p className="muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted">No prompts match the current filter.</p>
        ) : (
          <ul className="prompt-list">
            {filtered.map((p) => (
              <li key={`${p.templateId}@${p.version}`}>
                <button className="prompt-list-item" onClick={() => setSelected(p)}>
                  <div className="prompt-list-item-header">
                    <code className="prompt-list-item-id">{refToString(p)}</code>
                    <span className={`prompt-kind prompt-kind-${p.kind}`}>{p.kind}</span>
                  </div>
                  {p.name && <div className="prompt-list-item-name">{p.name}</div>}
                  {p.description && <div className="muted prompt-list-item-desc">{p.description}</div>}
                  {p.tags && p.tags.length > 0 && (
                    <div className="prompt-list-item-tags">
                      {p.tags.map((t) => (
                        <span key={t} className="prompt-tag">{t}</span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && <PromptDetailModal prompt={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function PromptDetailModal({ prompt, onClose }: { prompt: PromptTemplate; onClose: () => void }) {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // a11y: Escape dismisses; autofocus on the close button so keyboard
  // users have a clear initial focus target inside the dialog.
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rendered, missingRequired } = useMemo(() => {
    const typed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const decl = (prompt.variables ?? []).find((d) => d.name === k);
      if (decl?.type === 'number') {
        const n = Number(v);
        typed[k] = Number.isFinite(n) ? n : v;
      } else if (decl?.type === 'boolean') {
        typed[k] = v === 'true';
      } else {
        typed[k] = v;
      }
    }
    return renderLocal(prompt, typed);
  }, [prompt, bindings]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={prompt.name ?? prompt.templateId}
      >
        <div className="modal-header">
          <h3>{prompt.name ?? prompt.templateId}</h3>
          <button ref={closeButtonRef} className="secondary" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Ref</label>
            <code className="builder-inspector-typeid">{refToString(prompt)}</code>
          </div>
          <div className="form-row">
            <label>Kind</label>
            <code className="builder-inspector-typeid">{prompt.kind}</code>
          </div>
          {prompt.description && (
            <div className="form-row">
              <label>Description</label>
              <p className="muted">{prompt.description}</p>
            </div>
          )}
          {prompt.variables && prompt.variables.length > 0 && (
            <>
              <div className="builder-inspector-divider" />
              <div className="builder-inspector-section-label">Variables</div>
              {prompt.variables.map((v) => (
                <div className="form-row" key={v.name}>
                  <label>
                    {v.name}
                    {v.required && <span className="builder-inspector-required" aria-hidden> *</span>}
                    {' '}
                    <span className="muted">({v.type}{v.source ? ` from ${v.source}` : ''})</span>
                  </label>
                  <input
                    value={bindings[v.name] ?? ''}
                    placeholder={v.defaultValue !== undefined ? `default: ${String(v.defaultValue)}` : ''}
                    onChange={(e) => setBindings((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  />
                  {v.description && <div className="muted builder-inspector-help">{v.description}</div>}
                </div>
              ))}
            </>
          )}
          <div className="builder-inspector-divider" />
          <div className="builder-inspector-section-label">Preview (local render)</div>
          {missingRequired.length > 0 && (
            <div className="alert warning">
              Missing required: {missingRequired.join(', ')}
            </div>
          )}
          <pre className="prompt-preview">{rendered}</pre>
          <p className="muted">
            This is a local Mustache-style render. Once the host advertises{' '}
            <code>capabilities.prompts.supported</code>, the preview will route through{' '}
            <code>POST /v1/prompts:render</code> for the deterministic-hash invariant per RFC 0028 §A.
          </p>
        </div>
      </div>
    </div>
  );
}
