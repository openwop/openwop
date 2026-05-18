/**
 * ThinkBlockSplitter — streaming separator for `<think>...</think>`
 * reasoning blocks. Visible content flows to one channel; reasoning
 * content flows to another with a `thinkingFinalized` boundary signal.
 *
 * Tests cover both the happy paths and the chunk-boundary cases
 * (partial open / close tags split across SSE deltas).
 */

import { describe, expect, it } from 'vitest';
import { ThinkBlockSplitter, type SplitDelta } from '../src/providers/thinkBlockSplitter.js';

function feed(s: ThinkBlockSplitter, chunks: readonly string[]): {
  visible: string;
  thinking: string;
  closedBlocks: string[];
} {
  let visible = '';
  let thinking = '';
  const closedBlocks: string[] = [];
  const consume = (d: SplitDelta): void => {
    visible += d.visible;
    thinking += d.reasoningDelta;
    closedBlocks.push(...d.closedBlocks);
  };
  for (const c of chunks) consume(s.push(c));
  consume(s.flush());
  return { visible, thinking, closedBlocks };
}

describe('ThinkBlockSplitter — visible channel', () => {
  it('passes plain text through unchanged', () => {
    const r = feed(new ThinkBlockSplitter(), ['hello world']);
    expect(r.visible).toBe('hello world');
    expect(r.thinking).toBe('');
  });

  it('strips a single complete think block from visible', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>reasoning</think>final answer']);
    expect(r.visible).toBe('final answer');
  });

  it('preserves text before and after think blocks', () => {
    const r = feed(new ThinkBlockSplitter(), ['before <think>hidden</think> after']);
    expect(r.visible).toBe('before  after');
  });

  it('handles think block split across many small chunks', () => {
    const input = '<think>step1 step2 step3</think>answer';
    const chunks = [...input].map((c) => c);
    const r = feed(new ThinkBlockSplitter(), chunks);
    expect(r.visible).toBe('answer');
  });

  it('handles opening tag straddling a chunk boundary', () => {
    const r = feed(new ThinkBlockSplitter(), ['pre<thi', 'nk>secret</think>post']);
    expect(r.visible).toBe('prepost');
  });

  it('handles closing tag straddling a chunk boundary', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>foo</thi', 'nk>visible']);
    expect(r.visible).toBe('visible');
  });

  it('does not strip stray `<` characters that are not real tags', () => {
    const r = feed(new ThinkBlockSplitter(), ['1 < 2 and 3 > 0']);
    expect(r.visible).toBe('1 < 2 and 3 > 0');
  });

  it('does not confuse `<thinker>` for `<think>`', () => {
    const r = feed(new ThinkBlockSplitter(), ['<thinker>']);
    expect(r.visible).toBe('<thinker>');
  });

  it('emits trailing visible content on flush', () => {
    const r = feed(new ThinkBlockSplitter(), ['tail no newline']);
    expect(r.visible).toBe('tail no newline');
  });

  it('drops unclosed think content on flush (visible empty for that block)', () => {
    const r = feed(new ThinkBlockSplitter(), ['visible<think>partial reasoning never closed']);
    expect(r.visible).toBe('visible');
    expect(r.closedBlocks.length).toBe(0);
  });
});

describe('ThinkBlockSplitter — reasoning channel', () => {
  it('emits thinking content from a complete block', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>my reasoning</think>answer']);
    expect(r.thinking).toBe('my reasoning');
    expect(r.closedBlocks.length).toBe(1);
  });

  it('emits thinking content streamed across chunks', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>step 1', ' step 2', ' step 3</think>done']);
    expect(r.thinking).toBe('step 1 step 2 step 3');
    expect(r.closedBlocks.length).toBe(1);
  });

  it('emits one closedBlock entry per complete reasoning block', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>a</think>mid<think>b</think>end']);
    expect(r.closedBlocks).toEqual(['a', 'b']);
    expect(r.visible).toBe('midend');
  });

  it('emits incremental reasoning deltas BEFORE the block closes', () => {
    // Critical for streaming reasoning UX: caller must see deltas as
    // they arrive, not buffered until the close tag.
    const s = new ThinkBlockSplitter();
    const d1 = s.push('<think>step 1');
    expect(d1.reasoningDelta).toBe('step 1');
    expect(d1.closedBlocks).toEqual([]);
    const d2 = s.push(' step 2');
    expect(d2.reasoningDelta).toBe(' step 2');
    expect(d2.closedBlocks).toEqual([]);
    const d3 = s.push('</think>final');
    // Block closes; closedBlocks contains the concatenation.
    expect(d3.closedBlocks).toEqual(['step 1 step 2']);
    expect(d3.visible).toBe('final');
  });

  it('does NOT close a block on flush for an unclosed reasoning block', () => {
    const r = feed(new ThinkBlockSplitter(), ['<think>incomplete']);
    expect(r.closedBlocks.length).toBe(0);
  });

  it('holds partial close tag until the next chunk resolves it', () => {
    const s = new ThinkBlockSplitter();
    const d1 = s.push('<think>content</thi');
    // Last 5 chars look like a partial close tag — must be held back.
    expect(d1.reasoningDelta).toBe('content');
    expect(d1.closedBlocks).toEqual([]);
    const d2 = s.push('nk>after');
    expect(d2.closedBlocks).toEqual(['content']);
    expect(d2.visible).toBe('after');
  });

  it('partial open tag at the very end of the stream emits as visible (no false trigger)', () => {
    const r = feed(new ThinkBlockSplitter(), ['answer<thi']);
    expect(r.visible).toBe('answer<thi');
    expect(r.thinking).toBe('');
    expect(r.closedBlocks.length).toBe(0);
  });

  it('handles `<` inside thinking content correctly', () => {
    // Reasoning that contains literal `<` characters (e.g. code in
    // thinking) must not trigger false close-tag detection.
    const r = feed(new ThinkBlockSplitter(), ['<think>if a < b: pass</think>done']);
    expect(r.thinking).toBe('if a < b: pass');
    expect(r.visible).toBe('done');
  });
});
