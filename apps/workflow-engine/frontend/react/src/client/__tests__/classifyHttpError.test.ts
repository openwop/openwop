import { describe, it, expect } from 'vitest';
import { classifyHttpError } from '../classifyHttpError.js';

describe('classifyHttpError', () => {
  it('maps a 429 (status property) to rate-limited + retryable', () => {
    const c = classifyHttpError(Object.assign(new Error('nope'), { status: 429 }));
    expect(c.kind).toBe('rate-limited');
    expect(c.retryable).toBe(true);
  });

  it('extracts a 429 from the "listX failed: 429" message convention', () => {
    const c = classifyHttpError(new Error('listMyRuns failed: 429 Too Many Requests'));
    expect(c.kind).toBe('rate-limited');
  });

  it('treats a fetch TypeError as offline', () => {
    const c = classifyHttpError(new TypeError('Failed to fetch'));
    expect(c.kind).toBe('offline');
    expect(c.retryable).toBe(true);
  });

  it('maps 401/403 to a non-retryable auth error', () => {
    expect(classifyHttpError(Object.assign(new Error('x'), { status: 401 })).kind).toBe('auth');
    expect(classifyHttpError(Object.assign(new Error('x'), { statusCode: 403 })).retryable).toBe(false);
  });

  it('maps 404 to not-found and 5xx to a retryable server error', () => {
    expect(classifyHttpError(Object.assign(new Error('x'), { status: 404 })).kind).toBe('not-found');
    const s = classifyHttpError(Object.assign(new Error('x'), { status: 503 }));
    expect(s.kind).toBe('server');
    expect(s.retryable).toBe(true);
  });

  it('falls back to unknown with the original message', () => {
    const c = classifyHttpError(new Error('weird boom'));
    expect(c.kind).toBe('unknown');
    expect(c.detail).toContain('weird boom');
  });
});
