import { useState } from 'react';
import { ByokPolicyExplainer } from './PolicyExplainer.js';

const SCOPES = ['tenant', 'user', 'run'] as const;
type Scope = (typeof SCOPES)[number];

export function ByokKeyEntryForm() {
  const [credentialRef, setCredentialRef] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [scope, setScope] = useState<Scope>('tenant');
  const [stored, setStored] = useState<{ ref: string; scope: Scope }[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  function onStore(e: React.FormEvent) {
    e.preventDefault();
    if (!credentialRef.trim() || !keyValue.trim()) {
      setInfo('Both credentialRef and key value are required.');
      return;
    }
    // Sample-grade UX: in a real deployment, the FE POSTs the key to a
    // host endpoint that vaults it; the FE never holds plaintext secrets.
    // For this sample, we just keep an in-memory list of *what was stored*
    // and tell the user what to set as OPENWOP_SAMPLE_SECRETS.
    setStored((prev) => [...prev, { ref: credentialRef, scope }]);
    setInfo(
      `Stored locally. To make this resolvable on the BE, add to OPENWOP_SAMPLE_SECRETS: ` +
        `{"${credentialRef}": "<your-secret>"}.`,
    );
    setKeyValue('');
  }

  return (
    <section>
      <div className="card">
        <h2>Bring your own key</h2>
        <p className="muted">
          Sample-grade key entry. In production, this form POSTs the key to a host endpoint
          that wraps it with KMS and never returns it to the browser. The sample's
          BE resolver reads from <code>OPENWOP_SAMPLE_SECRETS</code> at boot — paste the
          key into your shell when starting the BE.
        </p>
        <form onSubmit={onStore}>
          <div className="form-row">
            <label>credentialRef</label>
            <input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="e.g. openai-api-key-prod" />
          </div>
          <div className="form-row">
            <label>Key value</label>
            <input
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="never persisted in the browser; sample-only echo"
            />
          </div>
          <div className="form-row">
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {info && <div className="alert info">{info}</div>}
          <div className="button-row">
            <button type="submit">Store reference</button>
          </div>
        </form>
      </div>

      {stored.length > 0 && (
        <div className="card">
          <h2>Stored references (this session)</h2>
          <pre>{JSON.stringify(stored, null, 2)}</pre>
        </div>
      )}

      <ByokPolicyExplainer />
    </section>
  );
}
