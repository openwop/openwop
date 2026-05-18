/**
 * ThinkBlockStripper — streaming filter for `<think>...</think>` blocks.
 *
 * Reasoning models (MiniMax-M2.7, etc.) emit chain-of-thought inline
 * before the final answer; the dispatcher uses this filter to drop
 * those blocks transparently. Tests cover both happy paths and the
 * tricky chunk-boundary cases (partial tags split across SSE deltas).
 */

import { describe, expect, it } from 'vitest';
import { ThinkBlockStripper } from '../src/providers/thinkBlockStripper.js';

function feed(s: ThinkBlockStripper, chunks: readonly string[]): string {
  let out = '';
  for (const c of chunks) out += s.push(c);
  out += s.flush();
  return out;
}

describe('ThinkBlockStripper', () => {
  it('passes plain text through unchanged', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['hello world'])).toBe('hello world');
  });

  it('strips a single complete think block', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['<think>reasoning</think>final answer'])).toBe('final answer');
  });

  it('strips multiple think blocks', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['<think>a</think>visible1<think>b</think>visible2'])).toBe('visible1visible2');
  });

  it('preserves text before, between, and after think blocks', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['before <think>hidden</think> after'])).toBe('before  after');
  });

  it('handles think block split across many small chunks', () => {
    const s = new ThinkBlockStripper();
    const input = '<think>step1 step2 step3</think>answer';
    // Feed one character at a time — the cruelest test for the buffer.
    const chunks = [...input].map((c) => c);
    expect(feed(s, chunks)).toBe('answer');
  });

  it('handles opening tag straddling a chunk boundary', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['pre<thi', 'nk>secret</think>post'])).toBe('prepost');
  });

  it('handles closing tag straddling a chunk boundary', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['<think>foo</thi', 'nk>visible'])).toBe('visible');
  });

  it('does not strip stray `<` characters that are not real tags', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['1 < 2 and 3 > 0'])).toBe('1 < 2 and 3 > 0');
  });

  it('does not confuse `<think>`-prefix lookalikes', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['<thinker>'])).toBe('<thinker>');
  });

  it('flushes visible buffer at stream end', () => {
    const s = new ThinkBlockStripper();
    expect(feed(s, ['tail no newline'])).toBe('tail no newline');
  });

  it('drops unclosed think content at flush time', () => {
    const s = new ThinkBlockStripper();
    // Truncated/malformed stream: open tag, no close. Better to drop
    // than leak partial reasoning to the user.
    expect(feed(s, ['visible<think>partial reasoning never closed'])).toBe('visible');
  });

  it('partial open-tag at very end of stream gets emitted on flush', () => {
    // Edge case: stream ends mid-tag. Treat as literal text — if the
    // model genuinely outputs a bare `<` at the end, we shouldn't eat it.
    const s = new ThinkBlockStripper();
    expect(feed(s, ['answer<thi'])).toBe('answer<thi');
  });

  it('returns visible deltas incrementally (not just at flush)', () => {
    const s = new ThinkBlockStripper();
    // First chunk has only visible text → should emit immediately
    // (minus the partial-tag holdback when no `<` is present, all of it).
    const visible1 = s.push('hello ');
    expect(visible1).toBe('hello ');

    // Second chunk has a think block start.
    const visible2 = s.push('<think>x</think>world');
    expect(visible2).toBe('world');

    const tail = s.flush();
    expect(tail).toBe('');
  });

  it('holds a partial open-tag tail until the next chunk resolves it', () => {
    const s = new ThinkBlockStripper();
    // Buffer ends in `<th` — could be the start of `<think>`. Should
    // hold back from the `<` until enough chars arrive to decide.
    const visible1 = s.push('text<th');
    expect(visible1).toBe('text');
    const visible2 = s.push('anks!');
    expect(visible2).toBe('<thanks!');
    expect(s.flush()).toBe('');
  });
});
