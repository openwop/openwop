/**
 * Structured error card for a failed assistant turn.
 *
 * Replaces the raw `<strong>code:</strong> message` line with a
 * red-bordered card carrying a friendly headline, the underlying code +
 * provider context (when known), and a primary suggested action.
 *
 * Known mappings:
 *   empty_completion        → "No response"            (rephrase or swap model)
 *   credential_unavailable  → "API key missing"        (open BYOK wizard)
 *   credential_required     → "BYOK required"          (open BYOK wizard)
 *   internal_error <prov>_<status>:
 *       _429                → "Rate limited"           (wait + retry)
 *       _401                → "Authentication failed"  (reconfigure key)
 *       _5xx                → "Upstream error"         (retry)
 *       _4xx (other)        → "Request rejected"       (raw provider line)
 *   *                       → "Something went wrong"   (raw code + message)
 *
 * role="alert" so screen readers announce the failure on first paint.
 */

interface KnownError {
  title: string;
  detail?: string;
  action?: { kind: 'reconfigure-byok' | 'retry'; label: string };
}

interface Props {
  error: { code: string; message: string };
  /** Open the BYOK wizard. Wired from ChatSidebar / ChatTab. When absent
   *  the `reconfigure-byok` action falls back to descriptive text only. */
  onReconfigure?: () => void;
  /** Re-run the prior user message that produced this error. */
  onRetry?: () => void;
}

/** Match `<provider>_<status>:` preamble like `anthropic_429: ...`. */
const PROVIDER_STATUS_RE = /^([a-z][a-z0-9-]+)_(\d{3}):/;

function classify(error: { code: string; message: string }): KnownError {
  switch (error.code) {
    case 'empty_completion':
      return {
        title: 'No response from the model',
        detail: 'The model returned an empty completion. Try rephrasing the prompt or switching to a different model.',
      };
    case 'credential_unavailable':
    case 'credential_required':
    case 'byok_required':
    case 'byok_required_but_unresolved':
      return {
        title: 'API key missing',
        detail: 'This provider requires a BYOK credential. Open the settings to add or update your key.',
        action: { kind: 'reconfigure-byok', label: 'Open BYOK settings' },
      };
    case 'provider_rate_limited':
      return {
        title: 'Rate limited',
        detail: 'The upstream provider returned 429 (Too Many Requests). Wait a few seconds and retry.',
        action: { kind: 'retry', label: 'Retry' },
      };
    case 'provider_unavailable':
      return {
        title: 'Provider unavailable',
        detail: 'The upstream provider is temporarily unavailable. Retrying in a few seconds usually works.',
        action: { kind: 'retry', label: 'Retry' },
      };
    case 'provider_timed_out':
      return {
        title: 'Provider timed out',
        detail: 'The request to the upstream provider exceeded the per-call timeout. Retry, or try a shorter prompt.',
        action: { kind: 'retry', label: 'Retry' },
      };
    case 'safety_filter':
    case 'content_filtered':
      return {
        title: 'Filtered by safety policy',
        detail: 'The provider declined the request under its content policy. Try rephrasing the prompt.',
      };
    case 'structured_output_invalid':
      return {
        title: 'Invalid structured output',
        detail: 'The model could not produce JSON matching the required schema. Try a different model or simplify the schema.',
      };
    case 'internal_error': {
      const m = PROVIDER_STATUS_RE.exec(error.message);
      if (!m) {
        return { title: 'Something went wrong', detail: error.message };
      }
      const provider = m[1] ?? 'provider';
      const status = m[2] ?? '';
      if (status === '429') {
        return {
          title: 'Rate limited',
          detail: `${provider} returned HTTP 429. Wait a few seconds and retry.`,
          action: { kind: 'retry', label: 'Retry' },
        };
      }
      if (status === '401' || status === '403') {
        return {
          title: 'Authentication failed',
          detail: `${provider} rejected the credential (HTTP ${status}). Reconfigure your BYOK key.`,
          action: { kind: 'reconfigure-byok', label: 'Open BYOK settings' },
        };
      }
      if (status.startsWith('5')) {
        return {
          title: 'Upstream error',
          detail: `${provider} returned HTTP ${status}. This is usually transient — retry should clear it.`,
          action: { kind: 'retry', label: 'Retry' },
        };
      }
      return {
        title: 'Request rejected',
        detail: `${provider} returned HTTP ${status}. ${error.message.slice(error.message.indexOf(':') + 1).trim()}`,
      };
    }
    default:
      return { title: 'Something went wrong', detail: `${error.code}: ${error.message}` };
  }
}

export function ErrorCard({ error, onReconfigure, onRetry }: Props): JSX.Element {
  const k = classify(error);
  return (
    <div
      role="alert"
      style={{
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--color-danger)',
        background: 'color-mix(in oklch, var(--color-danger) 6%, transparent)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--color-danger)' }}>{k.title}</div>
      {k.detail && <div style={{ marginTop: 4, color: 'var(--ink)' }}>{k.detail}</div>}
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7, color: 'var(--color-text-muted)' }}>
        {error.code}
      </div>
      {k.action && (
        <div style={{ marginTop: 8 }}>
          {k.action.kind === 'reconfigure-byok' && onReconfigure && (
            <button
              type="button"
              className="secondary"
              onClick={onReconfigure}
              style={{ fontSize: 11, padding: '3px 10px', minHeight: 0, height: 24 }}
            >
              {k.action.label}
            </button>
          )}
          {k.action.kind === 'retry' && onRetry && (
            <button
              type="button"
              className="secondary"
              onClick={onRetry}
              style={{ fontSize: 11, padding: '3px 10px', minHeight: 0, height: 24 }}
            >
              {k.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
