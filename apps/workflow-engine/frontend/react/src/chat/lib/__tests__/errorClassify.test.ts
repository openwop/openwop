import { describe, it, expect } from 'vitest';
import { classifyChatError } from '../errorClassify.js';

describe('classifyChatError', () => {
  it('maps BYOK credential codes to the reconfigure action', () => {
    for (const code of ['credential_required', 'byok_required', 'byok_required_but_unresolved']) {
      const k = classifyChatError({ code, message: '' });
      expect(k.action?.kind).toBe('reconfigure-byok');
    }
  });

  it('maps provider rate-limit / unavailable / timeout to a retry action', () => {
    for (const code of ['provider_rate_limited', 'provider_unavailable', 'provider_timed_out']) {
      expect(classifyChatError({ code, message: '' }).action?.kind).toBe('retry');
    }
  });

  it('extracts the provider HTTP status from an internal_error preamble', () => {
    expect(classifyChatError({ code: 'internal_error', message: 'anthropic_429: slow down' }).title).toBe('Rate limited');
    expect(classifyChatError({ code: 'internal_error', message: 'openai_401: bad key' }).action?.kind).toBe('reconfigure-byok');
    expect(classifyChatError({ code: 'internal_error', message: 'openai_503: oops' }).action?.kind).toBe('retry');
  });

  it('falls back to a generic card for an unknown code', () => {
    const k = classifyChatError({ code: 'totally_new', message: 'boom' });
    expect(k.title).toBe('Something went wrong');
    expect(k.detail).toContain('totally_new');
  });
});
