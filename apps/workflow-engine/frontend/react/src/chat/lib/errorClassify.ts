/**
 * FE-side error → friendly-text lookup table.
 *
 * Companion to the BE's `src/observability/errorRecovery.ts` —
 * `classifyDispatchError()` there returns a richer
 * `{category, action, userMessage, retryAfterMs?}` tuple meant for
 * server-side retry / backoff decisions. This module is the simpler
 * FE-side subset: it only maps `{code, message}` → renderable
 * `{title, detail, action?}` for the ErrorCard component.
 *
 * Why two tables (instead of one shared module)?
 *
 *   The BE classifier takes a raw `Error` (or `AiProviderError`) and
 *   classifies for retry decisions before the error is serialized.
 *   The FE table consumes the already-serialized `{code, message}`
 *   pair that lands on `ChatMessage.meta.error` after surviving the
 *   SSE run-event payload or the HTTP error-envelope round-trip.
 *
 *   When extending the BE classifier with a new code, also add the
 *   matching entry here so the FE doesn't fall through to the
 *   "Something went wrong" default. Drift will manifest as a generic
 *   error card; it won't break the UI.
 *
 * Future consolidation (deferred per the code-review §4 follow-up):
 *   have the BE attach `{category, action, userMessage}` to error
 *   envelopes and SSE error payloads; the FE prefers those when
 *   present and falls back to this table when absent. That's a
 *   payload-shape change so it lands behind a normative RFC; the
 *   FE type `ChatMessage.meta.error` is ALREADY extended (in
 *   `chat/types.ts`) to accept the optional fields so the migration
 *   is FE-side-only when the BE eventually ships them.
 */

export interface KnownError {
  title: string;
  detail?: string;
  action?: { kind: 'reconfigure-byok' | 'retry'; label: string };
}

/** Match `<provider>_<status>:` preamble like `anthropic_429: ...`. */
const PROVIDER_STATUS_RE = /^([a-z][a-z0-9-]+)_(\d{3}):/;

export function classifyChatError(error: { code: string; message: string }): KnownError {
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
