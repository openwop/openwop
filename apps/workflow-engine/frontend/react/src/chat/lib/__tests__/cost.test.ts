import { describe, it, expect } from 'vitest';
import { formatUsd } from '../cost.js';

describe('formatUsd', () => {
  it('renders exact zero as $0', () => {
    expect(formatUsd(0)).toBe('$0');
  });

  it('gives tiny amounts six decimals', () => {
    // The cost.ts doc example: (200*0.003 + 80*0.015)/1000 = 0.0018.
    expect(formatUsd(0.0000123)).toBe('$0.000012');
  });

  it('gives sub-dollar amounts four decimals', () => {
    expect(formatUsd(0.0018)).toBe('$0.0018');
  });

  it('rounds dollar+ amounts to two decimals', () => {
    expect(formatUsd(12.3456)).toBe('$12.35');
  });
});
