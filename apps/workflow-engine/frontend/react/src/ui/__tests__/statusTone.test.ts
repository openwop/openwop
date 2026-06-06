import { describe, it, expect } from 'vitest';
import { statusTone } from '../StatusBadge.js';

describe('statusTone', () => {
  it('passes through the CSS-defined status classes', () => {
    for (const s of ['completed', 'failed', 'cancelled', 'running', 'paused', 'waiting-approval']) {
      expect(statusTone(s)).toBe(s);
    }
  });

  it('maps synonyms onto a colored class (not the dead status-* tones)', () => {
    expect(statusTone('succeeded')).toBe('completed');
    expect(statusTone('error')).toBe('failed');
    expect(statusTone('waiting')).toBe('waiting-approval');
    expect(statusTone('in-progress')).toBe('waiting-approval');
  });

  it('is case-insensitive', () => {
    expect(statusTone('COMPLETED')).toBe('completed');
  });

  it('returns empty (base muted) for unknown statuses', () => {
    expect(statusTone('zonk')).toBe('');
  });
});
