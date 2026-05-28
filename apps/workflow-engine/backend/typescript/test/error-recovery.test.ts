/**
 * `classifyDispatchError` — chat improvements plan §2B.2. Pure-function
 * classifier mapping dispatch errors to {category, action, userMessage}.
 */

import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/aiProviders/aiProvidersHost.js';
import { classifyDispatchError } from '../src/observability/errorRecovery.js';

describe('classifyDispatchError — AiProviderError codes', () => {
  it('byok_required → auth / reconfigure', () => {
    const r = classifyDispatchError(new AiProviderError('byok_required', 'No credential'));
    expect(r.category).toBe('auth');
    expect(r.action).toBe('reconfigure');
    expect(r.userMessage).toMatch(/BYOK/i);
  });

  // Managed-provider codes flow through the same classifier via the
  // deliberate cast in executor.ts:emitTerminalFailure. Without explicit
  // cases they would render as the generic "Something went wrong"
  // default — which is wrong for user-actionable errors like
  // sign-in-required and daily-cap.
  it('sign_in_required → auth / reconfigure with sign-in message', () => {
    const r = classifyDispatchError(
      new AiProviderError('sign_in_required' as never, 'Sign in to use the free tier.'),
    );
    expect(r.category).toBe('auth');
    expect(r.action).toBe('reconfigure');
    expect(r.userMessage).toMatch(/sign in/i);
    expect(r.userMessage).not.toMatch(/something went wrong/i);
  });

  it('daily_limit_reached → rate_limit / wait with cap-explanation', () => {
    const r = classifyDispatchError(
      new AiProviderError('daily_limit_reached' as never, 'cap hit'),
    );
    expect(r.category).toBe('rate_limit');
    expect(r.action).toBe('wait');
    expect(r.userMessage).toMatch(/daily limit/i);
  });

  it('managed_unavailable → network / retry', () => {
    const r = classifyDispatchError(
      new AiProviderError('managed_unavailable' as never, 'no key'),
    );
    expect(r.category).toBe('network');
    expect(r.action).toBe('retry');
    expect(r.userMessage).toMatch(/temporarily unavailable/i);
  });

  it('provider_rate_limited → rate_limit / wait + retryAfterMs', () => {
    const r = classifyDispatchError(new AiProviderError('provider_rate_limited', '429'));
    expect(r.category).toBe('rate_limit');
    expect(r.action).toBe('wait');
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('provider_timed_out → timeout / retry', () => {
    const r = classifyDispatchError(new AiProviderError('provider_timed_out', 'timed out'));
    expect(r.category).toBe('timeout');
    expect(r.action).toBe('retry');
  });

  it('safety_filter → safety / regenerate', () => {
    const r = classifyDispatchError(new AiProviderError('safety_filter', 'blocked'));
    expect(r.category).toBe('safety');
    expect(r.action).toBe('regenerate');
  });

  it('host_capability_missing → config / reconfigure', () => {
    const r = classifyDispatchError(new AiProviderError('host_capability_missing', 'no embeddings'));
    expect(r.category).toBe('config');
    expect(r.action).toBe('reconfigure');
  });

  it('internal_error with anthropic_429 preamble → rate_limit / wait', () => {
    const r = classifyDispatchError(new AiProviderError('internal_error', 'anthropic_429: too many'));
    expect(r.category).toBe('rate_limit');
    expect(r.action).toBe('wait');
    expect(r.userMessage).toMatch(/anthropic/);
  });

  it('internal_error with openai_401 preamble → auth / reconfigure', () => {
    const r = classifyDispatchError(new AiProviderError('internal_error', 'openai_401: invalid api key'));
    expect(r.category).toBe('auth');
    expect(r.action).toBe('reconfigure');
  });

  it('internal_error with google_500 preamble → network / retry', () => {
    const r = classifyDispatchError(new AiProviderError('internal_error', 'google_500: server error'));
    expect(r.category).toBe('network');
    expect(r.action).toBe('retry');
  });
});

describe('classifyDispatchError — raw Error fallbacks', () => {
  it('raw <provider>_<status>: preamble — no AiProviderError wrap', () => {
    const r = classifyDispatchError(new Error('anthropic_429: Too many'));
    expect(r.category).toBe('rate_limit');
    expect(r.action).toBe('wait');
  });

  it('AbortError → timeout / abort', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const r = classifyDispatchError(err);
    expect(r.category).toBe('timeout');
    expect(r.action).toBe('abort');
  });

  it('network failure message → network / retry', () => {
    const r = classifyDispatchError(new Error('fetch failed: ECONNREFUSED'));
    expect(r.category).toBe('network');
    expect(r.action).toBe('retry');
  });

  it('unknown error → unknown / abort', () => {
    const r = classifyDispatchError(new Error('something weird happened'));
    expect(r.category).toBe('unknown');
    expect(r.action).toBe('abort');
  });

  it('non-Error throwable → unknown / abort', () => {
    const r = classifyDispatchError('string error');
    expect(r.category).toBe('unknown');
    expect(r.action).toBe('abort');
  });
});

describe('classifyDispatchError — provider-status status table', () => {
  it.each([
    ['400', 'config', 'reconfigure'],
    ['402', 'quota', 'reconfigure'],
    ['403', 'auth', 'reconfigure'],
    ['408', 'timeout', 'retry'],
    ['422', 'config', 'reconfigure'],
    ['500', 'network', 'retry'],
    ['502', 'network', 'retry'],
    ['503', 'network', 'retry'],
  ])('HTTP %s → category=%s action=%s', (status, category, action) => {
    const r = classifyDispatchError(new Error(`anthropic_${status}: msg`));
    expect(r.category).toBe(category);
    expect(r.action).toBe(action);
  });
});
