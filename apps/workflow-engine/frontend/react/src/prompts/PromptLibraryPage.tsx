/**
 * `/prompts` route. Lists prompt templates with kind/tag filters and a
 * CRUD surface for user-authored prompts (localStorage; merged with
 * bundled samples + any future BE store via listPrompts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { listPrompts, renderLocal } from './promptsClient.js';
import type { PromptKind, PromptTemplate } from './types.js';
import { PageHeader } from '../ui/PageHeader.js';
import { refToString } from './types.js';
import { lintPromptForTierOne, tierOneFindingsCount } from './tierOneLint.js';
import { getCapabilities } from '../client/runsClient.js';
import {
  deleteUserPrompt,
  isUserPromptId,
  suggestUserPromptId,
  upsertUserPrompt,
} from './userPrompts.js';

type TierOneCompliance = 'strict' | 'warn' | 'off' | undefined;

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
  // Editor modal state. When `editing` is non-null, the EditorModal
  // renders. `null` for the templateId field signals "new prompt"
  // (the editor will mint a fresh id from the name on save).
  const [editing, setEditing] = useState<PromptTemplate | 'new' | null>(null);
  // RFC 0030 §B — host's posture on the OpenAI ∩ Anthropic ∩ Gemini
  // schema subset. When `strict`, schema-hint prompts get a Tier-1 lint
  // chip; when `warn`, the lint runs but the banner copy is softer;
  // when `off` or absent, the lint stays silent.
  const [tierOneCompliance, setTierOneCompliance] = useState<TierOneCompliance>(undefined);

  // refreshNonce bumps after every CRUD mutation so the listPrompts()
  // effect below re-runs and surfaces the just-edited entries.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = () => setRefreshNonce((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    listPrompts({})
      .then((items) => {
        if (!cancelled) setPrompts(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    // Capability discovery in parallel — don't gate the prompt list on it.
    getCapabilities()
      .then((c) => {
        if (cancelled) return;
        const caps = (c as { capabilities?: { envelopes?: { tierOneSubsetCompliance?: unknown } } }).capabilities;
        const v = caps?.envelopes?.tierOneSubsetCompliance;
        if (v === 'strict' || v === 'warn' || v === 'off') setTierOneCompliance(v);
      })
      .catch(() => { /* best-effort; absence is fine */ });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  // Run the Tier-1 lint once per prompt-list change, regardless of host
  // advertisement (so we can show a banner even when off). The banner
  // copy adapts to the compliance posture; per-row chips show in both
  // strict and warn modes.
  const tierOneActive = tierOneCompliance === 'strict' || tierOneCompliance === 'warn';
  const flaggedCount = useMemo(() => {
    if (!prompts) return 0;
    return tierOneFindingsCount(prompts);
  }, [prompts]);

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
      <PageHeader
        eyebrow="Build"
        title="Prompt library"
        lede="Reusable prompts your workflow's AI nodes can pick from. Edit one in a single place and every node that uses it updates the next time it runs — no copy-paste, no drift. System prompts set the AI's role and tone; user prompts shape what you ask of it."
        actions={<button onClick={() => setEditing('new')}>+ New prompt</button>}
      />
      <div className="card">
        {error && <div className="alert error">{error}</div>}

        {tierOneActive && flaggedCount > 0 && (
          <div className={tierOneCompliance === 'strict' ? 'alert warning' : 'alert info'} style={{ marginBottom: 12 }}>
            <strong>Tier-1 subset</strong> ({tierOneCompliance}):{' '}
            <strong>{flaggedCount}</strong> schema-hint prompt{flaggedCount === 1 ? '' : 's'} flagged against{' '}
            <a href="https://github.com/openwop/openwop/blob/main/spec/v1/structured-output-subset.md" target="_blank" rel="noopener">structured-output-subset.md</a>.
            Inline chips on each offender point to the specific finding.
          </div>
        )}

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
            {filtered.map((p) => {
              const findings = tierOneActive ? lintPromptForTierOne(p) : [];
              const isUser = isUserPromptId(p.templateId);
              return (
                <li key={`${p.templateId}@${p.version}`} style={{ position: 'relative' }}>
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
                    {findings.length > 0 && (
                      <div className="prompt-list-item-lint">
                        {findings.map((f) => (
                          <span key={f.rule} className="prompt-tier-one-chip" title="Tier-1 subset finding — see structured-output-subset.md">
                            {f.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  {isUser && (
                    <div className="prompt-user-actions">
                      <button
                        type="button"
                        className="secondary prompt-user-edit"
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        aria-label={`Edit ${p.name ?? p.templateId}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary prompt-user-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete prompt "${p.name ?? p.templateId}"? This can't be undone.`)) {
                            deleteUserPrompt(p.templateId);
                            refresh();
                          }
                        }}
                        aria-label={`Delete ${p.name ?? p.templateId}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected && <PromptDetailModal prompt={selected} onClose={() => setSelected(null)} />}
      {editing && (
        <PromptEditorModal
          existing={editing === 'new' ? null : editing}
          allIds={(prompts ?? []).map((p) => p.templateId)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function PromptEditorModal({
  existing,
  allIds,
  onClose,
  onSaved,
}: {
  existing: PromptTemplate | null;
  allIds: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = existing !== null;
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<PromptKind>(existing?.kind ?? 'system');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [text, setText] = useState(existing?.text ?? '');
  const [tagsRaw, setTagsRaw] = useState((existing?.tags ?? []).join(', '));
  const [saveError, setSaveError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function onSave() {
    setSaveError(null);
    if (!name.trim()) {
      setSaveError('Name is required.');
      return;
    }
    if (!text.trim()) {
      setSaveError('Prompt text is required.');
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const templateId =
      existing?.templateId ??
      suggestUserPromptId(name, allIds);
    const prompt: PromptTemplate = {
      templateId,
      version: existing?.version ?? '1.0.0',
      kind,
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      text,
      ...(tags.length > 0 ? { tags } : {}),
      meta: { source: 'host', author: 'user' },
    };
    upsertUserPrompt(prompt);
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit prompt' : 'New prompt'}
      >
        <div className="modal-header">
          <h3>{isEdit ? 'Edit prompt' : 'New prompt'}</h3>
          <button ref={closeButtonRef} className="secondary" onClick={onClose}>Cancel</button>
        </div>
        <div className="modal-body">
          {saveError && <div className="alert error">{saveError}</div>}
          <div className="form-row">
            <label>Name <span className="builder-inspector-required" aria-hidden> *</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Tone-of-voice editor"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as PromptKind)}>
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="few-shot">Few-shot</option>
              <option value="schema-hint">Schema hint</option>
            </select>
          </div>
          <div className="form-row">
            <label>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this prompt does and when to use it."
            />
          </div>
          <div className="form-row">
            <label>Prompt text <span className="builder-inspector-required" aria-hidden> *</span></label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={
                kind === 'user'
                  ? 'Mustache-style template. Use {{variable}} for inputs.'
                  : 'The system instruction. Set role, tone, output shape.'
              }
              style={{ fontFamily: 'var(--mono, monospace)', fontSize: 13 }}
            />
          </div>
          <div className="form-row">
            <label>Tags <span className="muted">(comma-separated)</span></label>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="editorial, writing"
            />
          </div>
          {isEdit && existing && (
            <div className="form-row">
              <label>Template ID</label>
              <code className="builder-inspector-typeid">{existing.templateId}</code>
              <div className="muted builder-inspector-help">
                IDs are immutable once created so existing references don&apos;t break.
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button onClick={onSave}>{isEdit ? 'Save changes' : 'Create prompt'}</button>
          </div>
        </div>
      </div>
    </div>
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
