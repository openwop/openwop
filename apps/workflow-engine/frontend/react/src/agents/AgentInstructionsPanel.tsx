/**
 * Agent instructions panel (PRD §9 Instructions tab) — edit how the agent
 * behaves. Always editable: the human-friendly role description (roster
 * metadata). When the agent is backed by a user-authored agent (agentRef
 * `user.*`), the editable system prompt is shown too; saving replaces it.
 *
 * Security posture: the current system prompt is NOT read back (the
 * `GET /v1/agents` projection omits it — same credential-adjacency reasoning as
 * the fork flow's SR-1). The editor sets a new prompt; the PATCH response
 * confirms what was saved.
 *
 * For pack-installed agents the instructions are read-only with a
 * "Fork to customize" CTA.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateRosterEntry, type RosterEntry } from './rosterClient.js';
import { updateUserAgent } from '../client/agentsClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentInstructionsPanel({ entry, onChanged }: { entry: RosterEntry; onChanged: () => void }): JSX.Element {
  const navigate = useNavigate();
  const agentId = entry.agentRef.agentId;
  const isUserAuthored = agentId.startsWith('user.');
  // A `host:*` agentRef is a synthetic/built-in demo template — it does NOT
  // resolve to a forkable manifest agent (GET /v1/agents 404s), so a "Fork"
  // CTA would dead-end on an empty form. Only genuinely-installed pack agents
  // are forkable.
  const isForkable = !isUserAuthored && !agentId.startsWith('host:');

  const [description, setDescription] = useState(entry.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSaveDescription = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateRosterEntry(entry.rosterId, { description });
      setNotice('Saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onSavePrompt = async () => {
    if (!systemPrompt.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateUserAgent(agentId, { systemPrompt });
      setSavedPrompt(updated.systemPrompt);
      setSystemPrompt('');
      setNotice('Instructions updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 700 }}>
      {error ? <div style={{ color: 'var(--color-danger)', marginBottom: '0.5rem' }}>⚠ {error}</div> : null}
      {notice ? <div style={{ background: '#e6f7ee', color: '#1f7a4d', padding: '0.4rem 0.6rem', borderRadius: 8, marginBottom: '0.5rem', fontSize: '0.82rem' }}>{notice}</div> : null}

      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>What this agent does</label>
      <p style={{ ...muted, fontSize: '0.8rem', marginTop: 0 }}>
        A short description of {entry.persona}'s role — shown on the dashboard and overview.
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{ width: '100%', fontFamily: 'inherit' }}
        placeholder={`e.g. ${entry.persona} routes leads and follows up on opportunities.`}
      />
      <div style={{ marginTop: '0.4rem', marginBottom: '1.2rem' }}>
        <button type="button" className="primary" onClick={() => void onSaveDescription()} disabled={saving}>Save</button>
      </div>

      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Instructions</label>
      <p style={{ ...muted, fontSize: '0.8rem', marginTop: 0 }}>
        These instructions shape how {entry.persona} behaves when running workflows or replying in chat.
      </p>

      {isUserAuthored ? (
        <>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}
            placeholder="Enter new instructions for this agent. (For security, the current instructions are not shown — saving replaces them.)"
          />
          <div style={{ marginTop: '0.4rem' }}>
            <button type="button" className="primary" onClick={() => void onSavePrompt()} disabled={saving || !systemPrompt.trim()}>Save instructions</button>
          </div>
          {savedPrompt ? (
            <div style={{ marginTop: '0.6rem' }}>
              <div style={{ ...muted, fontSize: '0.78rem' }}>Saved instructions:</div>
              <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface-alt, #f4f6f9)', padding: '0.5rem', borderRadius: 8, fontSize: '0.8rem' }}>{savedPrompt}</pre>
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.7rem', background: 'var(--color-surface-alt, #f4f6f9)' }}>
          {isForkable ? (
            <>
              <p style={{ marginTop: 0, fontSize: '0.85rem' }}>
                {entry.persona} runs an installed agent template (<code>{agentId}</code>). Its instructions are read-only here.
              </p>
              <button type="button" className="secondary" onClick={() => navigate(`/agents/fork?fork=${encodeURIComponent(agentId)}`)}>
                Fork to customize
              </button>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, fontSize: '0.85rem' }}>
                {entry.persona} is a built-in demo agent — its underlying instructions aren't editable here. Create your
                own agent to write custom instructions from scratch.
              </p>
              <button type="button" className="secondary" onClick={() => navigate('/agents/new')}>
                Create your own agent
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
