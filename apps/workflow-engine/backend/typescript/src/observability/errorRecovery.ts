/**
 * RFC-companion classifier: maps dispatch / aiProviders errors into a
 * small {category, action, userMessage, retryAfterMs?} tuple the
 * frontend can dispatch on without having to learn every provider's
 * vocabulary.
 *
 * Three input shapes covered:
 *   1. `AiProviderError` — canonical code from `aiProvidersHost.ts`.
 *   2. Raw `Error` with `<provider>_<status>:` preamble — thrown by
 *      `dispatchChat()` when a provider HTTP call returns non-2xx.
 *   3. Anything else (network failure, abort, structured-output parse
 *      fail) — falls through to `category: 'unknown'`.
 *
 * The classifier is pure and side-effect-free; it never logs, never
 * touches storage, never re-throws. Callers (chat responder, sample
 * dispatcher) consume the tuple to build a structured response.
 *
 * `userMessage` is the ONLY string that should be surfaced to a user-
 * facing client. Raw `Error.message` may contain provider URLs / body
 * fragments; keep it in BE logs.
 */

import { AiProviderError } from '../aiProviders/aiProvidersHost.js';

export type ErrorCategory =
  | 'network'      // fetch failed, DNS, connection reset
  | 'auth'         // 401/403, credential missing, BYOK unresolved
  | 'rate_limit'   // 429
  | 'quota'        // billing / hard-cap exceeded
  | 'timeout'      // upstream took longer than the per-call AbortController
  | 'safety'       // content-policy filter
  | 'config'       // unsupported model / provider / capability missing
  | 'unknown';

export type RecoveryAction =
  | 'retry'        // transient — try again, optionally with backoff
  | 'regenerate'   // safe to re-run the same turn
  | 'reconfigure'  // user must fix BYOK / policy / model selection
  | 'sign_in'      // anon caller on a managed-tier path — sign in to unblock
  | 'abort'        // do not retry; surface as terminal failure
  | 'wait';        // throttling — wait `retryAfterMs` before retrying

export interface ClassifiedError {
  category: ErrorCategory;
  action: RecoveryAction;
  /** Hint to the caller for `wait` / `retry` actions when the upstream
   *  carried a `Retry-After` value or a documented backoff. Omitted
   *  when no concrete duration is known. */
  retryAfterMs?: number;
  /** Short, user-safe sentence. Localizable later; today plain ASCII. */
  userMessage: string;
}

/** Match `<provider>_<status>:` preamble like `anthropic_429: ...`. */
const PROVIDER_STATUS_RE = /^([a-z][a-z0-9-]+)_(\d{3}):/;

/** Milliseconds remaining until the next UTC midnight. Used by the
 *  free-tier daily-cap classifier so callers honoring `retryAfterMs`
 *  back off for the actual remaining window (which can be anywhere
 *  from seconds to ~24h) instead of retrying in a tight loop and
 *  burning the same 401. `now` is injectable for deterministic
 *  tests; production callers omit it. */
export function msUntilNextUtcMidnight(now: Date = new Date()): number {
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return nextMidnight.getTime() - now.getTime();
}

function classifyProviderStatus(provider: string, status: number): ClassifiedError {
  if (status === 429) {
    return {
      category: 'rate_limit',
      action: 'wait',
      retryAfterMs: 2000,
      userMessage: `${provider} is rate-limiting requests. Try again in a few seconds.`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      category: 'auth',
      action: 'reconfigure',
      userMessage: `${provider} rejected the API key (HTTP ${status}). Reconfigure your BYOK key.`,
    };
  }
  if (status === 402) {
    return {
      category: 'quota',
      action: 'reconfigure',
      userMessage: `${provider} reported the account is out of credit (HTTP 402). Top up or switch providers.`,
    };
  }
  if (status === 408) {
    return {
      category: 'timeout',
      action: 'retry',
      userMessage: `${provider} timed out the request. Retrying usually works.`,
    };
  }
  if (status === 400 || status === 422) {
    return {
      category: 'config',
      action: 'reconfigure',
      userMessage: `${provider} rejected the request shape (HTTP ${status}). Check the model id or prompt size.`,
    };
  }
  if (status >= 500) {
    return {
      category: 'network',
      action: 'retry',
      userMessage: `${provider} returned a server error (HTTP ${status}). This is usually transient.`,
    };
  }
  return {
    category: 'unknown',
    action: 'abort',
    userMessage: `${provider} rejected the request (HTTP ${status}).`,
  };
}

/** Map an `AiProviderError` code to a classification. */
function classifyAiProviderError(err: AiProviderError): ClassifiedError {
  // Managed-provider codes (`providers/managedProvider.ts`) reach this
  // classifier via the deliberate `as AiProviderErrorCode` cast in
  // `executor.ts:emitTerminalFailure` — the executor wraps the
  // terminal `{code, message}` into an AiProviderError so all run-
  // failed events get the same classifier output. The codes are not
  // in the `AiProviderErrorCode` union (they originate outside the
  // aiProviders host), so handle them explicitly here before the
  // typed switch; without this, every free-tier sign-in failure
  // renders as the generic "Something went wrong" default arm.
  const codeString = err.code as string;
  if (codeString === 'sign_in_required') {
    return {
      category: 'auth',
      action: 'sign_in',
      userMessage: 'Sign in to use the free tier.',
    };
  }
  if (codeString === 'daily_limit_reached') {
    // The free-tier cap resets at 00:00 UTC, which could be anywhere
    // from a few seconds to ~24 hours away. Compute the actual
    // remaining window so callers that honor `retryAfterMs` (the
    // FE chat recovery surface, automated retry policies) back off
    // for the right duration instead of retrying in seconds and
    // burning the same 401. Same telemetry shape as
    // `provider_rate_limited` above, just with a much larger window.
    return {
      category: 'rate_limit',
      action: 'wait',
      retryAfterMs: msUntilNextUtcMidnight(),
      userMessage: 'You have hit the free-tier daily limit. It resets at 00:00 UTC, or add your own API key to keep going.',
    };
  }
  if (codeString === 'managed_unavailable') {
    return {
      category: 'network',
      action: 'retry',
      userMessage: 'The free tier is temporarily unavailable. Retry, or add your own API key to keep going.',
    };
  }
  switch (err.code) {
    case 'provider_not_supported':
    case 'model_not_supported':
    case 'model_not_allowed':
    case 'host_capability_missing':
    case 'invalid_request':
      return {
        category: 'config',
        action: 'reconfigure',
        userMessage: 'The selected provider, model, or feature is not available on this host. Pick a different one.',
      };
    case 'provider_policy_denied':
      return {
        category: 'config',
        action: 'reconfigure',
        userMessage: 'The host policy denies this provider for the current tenant or scope.',
      };
    case 'byok_required':
    case 'byok_required_but_unresolved':
      return {
        category: 'auth',
        action: 'reconfigure',
        userMessage: 'This provider needs a BYOK credential. Add or update your key in the settings.',
      };
    case 'provider_rate_limited':
      return {
        category: 'rate_limit',
        action: 'wait',
        retryAfterMs: 2000,
        userMessage: 'The upstream provider is rate-limiting. Try again in a few seconds.',
      };
    case 'provider_unavailable':
      return {
        category: 'network',
        action: 'retry',
        userMessage: 'The upstream provider is temporarily unavailable. Retry should clear it.',
      };
    case 'provider_timed_out':
      return {
        category: 'timeout',
        action: 'retry',
        userMessage: 'The provider request exceeded the per-call timeout. Retry, or try a shorter prompt.',
      };
    case 'safety_filter':
    case 'content_filtered':
      return {
        category: 'safety',
        action: 'regenerate',
        userMessage: 'The provider declined the request under its content policy. Try rephrasing the prompt.',
      };
    case 'structured_output_invalid':
      return {
        category: 'config',
        action: 'regenerate',
        userMessage: 'The model could not produce JSON matching the required schema. Try a different model or simplify the schema.',
      };
    case 'internal_error':
    default: {
      const m = PROVIDER_STATUS_RE.exec(err.message);
      if (m && m[1] && m[2]) {
        const status = Number(m[2]);
        if (Number.isFinite(status)) return classifyProviderStatus(m[1], status);
      }
      return { category: 'unknown', action: 'abort', userMessage: 'Something went wrong. Check the server logs.' };
    }
  }
}

/** Heuristic for raw `fetch` failures (AbortError, network refused, etc.). */
function classifyNativeError(err: Error): ClassifiedError | null {
  const msg = err.message ?? '';
  if (err.name === 'AbortError' || /aborted|cancelled/i.test(msg)) {
    return { category: 'timeout', action: 'abort', userMessage: 'Request was cancelled.' };
  }
  if (/timed?[ -]out|etimedout|deadline/i.test(msg)) {
    return { category: 'timeout', action: 'retry', userMessage: 'The request timed out. Retry usually works.' };
  }
  if (/econnrefused|enotfound|network|fetch failed|getaddrinfo/i.test(msg)) {
    return { category: 'network', action: 'retry', userMessage: 'Network error reaching the upstream provider. Check connectivity.' };
  }
  return null;
}

/**
 * Classify any error thrown from the dispatch path into a structured
 * recovery hint. Pure function: no logging, no I/O.
 */
export function classifyDispatchError(err: unknown): ClassifiedError {
  if (err instanceof AiProviderError) {
    return classifyAiProviderError(err);
  }
  if (err instanceof Error) {
    const m = PROVIDER_STATUS_RE.exec(err.message);
    if (m && m[1] && m[2]) {
      const status = Number(m[2]);
      if (Number.isFinite(status)) return classifyProviderStatus(m[1], status);
    }
    const native = classifyNativeError(err);
    if (native) return native;
    return { category: 'unknown', action: 'abort', userMessage: 'Something went wrong. Check the server logs.' };
  }
  return { category: 'unknown', action: 'abort', userMessage: 'Something went wrong. Check the server logs.' };
}
