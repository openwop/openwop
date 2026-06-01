/**
 * Privacy + cookies disclosure for the public app.openwop.dev demo.
 * Plain-prose page — no marketing copy, just an honest accounting of
 * what gets stored, where, for how long, and how to delete it.
 *
 * Linked from the DemoHostBanner. If/when Phase 3 (Firebase Auth +
 * persistent Cloud SQL backend) lands, this page expands with the
 * signed-in retention rules.
 *
 * White-label note: the brand-bound tokens (domain, home/repo URLs) read
 * from `brand` so a re-deploy reflects them automatically. The legal/
 * operational specifics below (cookie name, Cloud Run, retention windows,
 * the steward contact) are deployment-specific — adopters should review
 * and rewrite this page for their own service. See WHITE-LABEL.md.
 */
import { brand } from './brand/brand.js';

export function PrivacyPage() {
  return (
    <section className="privacy-page">
      <div className="card">
        <h2>Privacy &amp; cookies</h2>
        <p className="muted">
          Last updated 2026-05-17 · Applies to <code>{brand.primaryDomain}</code> only
        </p>

        <h3>The one cookie we set</h3>
        <p>
          On your first request without a session, the backend mints a single
          cookie:
        </p>
        <pre>
{`Name:    openwop.session
Domain:  ${brand.primaryDomain}
Path:    /
Max-Age: 86400 seconds (24 hours)
Flags:   HttpOnly; Secure; SameSite=Lax`}
        </pre>
        <p>
          The cookie contains a base64url-encoded JSON payload
          <code> {`{ sid, tenantId: "anon:<sid>", tier: "anon", iat, exp }`} </code>
          and an HMAC-SHA256 signature. No personally identifying information.
          The <code>sid</code> is a 144-bit random value scoped to this browser;
          your workflows + BYOK keys are isolated by it.
        </p>

        <h3>What we store about you</h3>
        <table className="cap-table">
          <thead>
            <tr><th>Data</th><th>Where</th><th>Retention</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Workflows you build</td>
              <td>In-memory on the Cloud Run instance, scoped to your session's tenant</td>
              <td>Until 24h cleanup OR cold-start (whichever comes first)</td>
            </tr>
            <tr>
              <td>BYOK keys (LLM API keys you paste)</td>
              <td>In-memory, scoped to your session's tenant</td>
              <td>Until 24h cleanup OR cold-start. NEVER written to disk.</td>
            </tr>
            <tr>
              <td>Run records + event logs</td>
              <td>In-memory on the Cloud Run instance, scoped to your session's tenant</td>
              <td>Until 24h cleanup OR cold-start. Wiped via the daily cleanup endpoint when the session goes idle.</td>
            </tr>
            <tr>
              <td>Cookie ID (<code>sid</code>)</td>
              <td>Your browser only</td>
              <td>24 hours (cookie expires)</td>
            </tr>
          </tbody>
        </table>

        <h3>What we do NOT do</h3>
        <ul>
          <li>No third-party trackers, analytics, or ad scripts.</li>
          <li>No social-media pixels.</li>
          <li>No fingerprinting beyond the session cookie above.</li>
          <li>No persistent storage of anything you type — restart wipes it.</li>
          <li>No sale or sharing of any visitor data.</li>
          <li>
            Your BYOK API keys are sent ONLY to the provider you target
            (e.g., Anthropic / OpenAI / Google) at execution time. They never
            land in event logs, audit records, or third-party services.
          </li>
        </ul>

        <h3>Outbound traffic</h3>
        <p>
          When you run a workflow node that calls an external service
          (an LLM provider, an HTTP endpoint, etc.), the backend reaches that
          service directly using the BYOK credential you supplied for the run.
          The backend will refuse to fetch from private IP ranges
          (<code>127.0.0.0/8</code>, RFC 1918, <code>169.254.0.0/16</code> / cloud
          metadata, IPv6 link-local + ULA, multicast) per the SSRF defense in
          <code> core.openwop.http@1.1.1</code> and <code>core.openwop.rag@1.0.1</code>.
        </p>

        <h3>Server logs</h3>
        <p>
          Google Cloud Run records request metadata (method, path, status, IP,
          user-agent) for operational debugging. Request bodies and response
          bodies are NOT captured. The application's structured logs strip BYOK
          secrets via the <code>stripSecretsFromPersisted</code> harness on
          every event-log + interrupt boundary; the protocol invariants
          <code>secret-leakage-eventlog-payload</code> and{' '}
          <code>secret-leakage-error-envelope</code> (tracked in{' '}
          <code>SECURITY/invariants.yaml</code>) gate this with public
          conformance tests. No API-key plaintext appears in any log line,
          event payload, error envelope, or audit record.
        </p>

        <h3>How to delete your data immediately</h3>
        <ol>
          <li>Clear cookies for <code>{brand.primaryDomain}</code> in your browser.</li>
          <li>Your session ID is gone, and the backend's in-memory state for it becomes
              unreachable; the daily cleanup endpoint will wipe it within 24h.</li>
        </ol>

        <h3>What's coming</h3>
        <p>
          Signup with persistent storage (Firebase Auth + a real SQL backend +
          KMS-encrypted BYOK at rest) is on the roadmap as Phase 3 of the
          deploy plan. This page will be updated with the signed-in
          retention rules when that lands.
        </p>

        <h3>Contact</h3>
        <p>
          The protocol's single steward is reachable via the contact email on
          <a href={brand.homeUrl} target="_blank" rel="noopener">{brand.homeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>.
          For security disclosures see <code>SECURITY.md</code> in the
          <a href={brand.repoUrl} target="_blank" rel="noopener">{brand.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '')}</a> repo.
        </p>
      </div>
    </section>
  );
}
