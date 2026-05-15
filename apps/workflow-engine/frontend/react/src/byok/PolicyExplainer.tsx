export function ByokPolicyExplainer() {
  return (
    <div className="card">
      <h2>BYOK policy resolution order</h2>
      <p className="muted">
        Per <code>spec/v1/auth.md</code> + <code>run-options.md</code>, OpenWOP hosts resolve a
        node's required credentials in a defined precedence:
      </p>
      <ol>
        <li><strong>Node config</strong> — explicit <code>credentialRef</code> in the workflow definition</li>
        <li><strong>Run options</strong> — <code>RunOptions.configurable.credentialRef</code></li>
        <li><strong>Scope-level</strong> — host-extension lookup keyed by <code>scopeId</code></li>
        <li><strong>Tenant-level</strong> — host-extension lookup keyed by <code>tenantId</code></li>
        <li><strong>Platform default</strong> — host's fallback (when policy mode allows)</li>
      </ol>
      <p className="muted">
        Resolution policy is one of <code>disabled</code> / <code>optional</code> /{' '}
        <code>required</code> / <code>restricted</code>. Hosts advertise the modes they
        support under <code>capabilities.aiProviders.policies</code>; clients MUST tolerate
        any subset.
      </p>
      <p className="muted">
        The <strong>strip-on-persist invariant</strong> is non-negotiable: resolved secret
        material MUST NOT appear in events / errors / traces / persisted run docs. The sample
        BE enforces this in <code>src/byok/ephemeralRunSecrets.ts</code> with a unit-tested
        replacement that swaps secret values with <code>&lt;&lt;redacted:&lt;ref&gt;&gt;&gt;</code> placeholders
        before any storage write.
      </p>
    </div>
  );
}
