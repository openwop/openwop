/**
 * Streaming splitter that separates `<think>...</think>` reasoning
 * blocks from a provider's SSE token stream. Reasoning models
 * (MiniMax-M2.7, DeepSeek-R1, qwen3-think, etc.) emit chain-of-thought
 * inline; this splitter routes the reasoning to a distinct channel
 * (typically `agent.reasoned` events) while letting the visible
 * answer flow normally to `onDelta` / `node.message`.
 *
 * State machine: tracks whether the cursor is inside a think block,
 * holds a tail slice large enough to recognize a complete tag
 * straddling a chunk boundary, and accumulates an internal per-block
 * buffer so callers can emit one `agent.reasoned` per closed block
 * without doing their own boundary tracking.
 *
 * Single-instance, single-stream — construct one per provider call.
 *
 * Multi-block-per-chunk: if a single `push()` contains multiple full
 * `<think>...</think>` blocks (model "re-thinks" mid-answer), each
 * closed block appears as a separate entry in `closedBlocks`. Visible
 * fragments between blocks land in `visible` in order.
 */

const OPEN = '<think>';
const CLOSE = '</think>';

export interface SplitDelta {
  /** Visible answer chunk safe to forward to the user. */
  visible: string;
  /** Reasoning content streamed this delta — the new chunk of the
   *  currently-open block. Useful for live "typewriter" reasoning UX
   *  (Phase 2 streaming). Empty when nothing arrived. */
  reasoningDelta: string;
  /** Reasoning blocks that closed during this push. Each entry is the
   *  COMPLETE content of one closed block (concatenation of all its
   *  prior `reasoningDelta`s). Callers emit one `agent.reasoned` per
   *  entry. Usually 0 or 1; multi-block-per-push only on unusual
   *  streams. */
  closedBlocks: readonly string[];
}

const EMPTY: SplitDelta = { visible: '', reasoningDelta: '', closedBlocks: [] };

export class ThinkBlockSplitter {
  private buf = '';
  private inThink = false;
  /** Accumulator for the currently-open think block, cleared on close. */
  private currentBlock = '';

  push(chunk: string): SplitDelta {
    if (chunk.length === 0) return EMPTY;
    this.buf += chunk;
    let visible = '';
    let reasoningDelta = '';
    const closedBlocks: string[] = [];

    while (true) {
      if (this.inThink) {
        const idx = this.buf.indexOf(CLOSE);
        if (idx === -1) {
          // No close tag yet. Emit safe reasoning content; hold tail.
          const lastLt = this.buf.lastIndexOf('<');
          let emit: string;
          if (lastLt !== -1 && this.buf.length - lastLt < CLOSE.length) {
            emit = this.buf.slice(0, lastLt);
            this.buf = this.buf.slice(lastLt);
          } else {
            emit = this.buf;
            this.buf = '';
          }
          reasoningDelta += emit;
          this.currentBlock += emit;
          return { visible, reasoningDelta, closedBlocks };
        }
        // Found `</think>`: emit pre-close as reasoning, finalize block.
        const tail = this.buf.slice(0, idx);
        reasoningDelta += tail;
        this.currentBlock += tail;
        closedBlocks.push(this.currentBlock);
        this.currentBlock = '';
        this.buf = this.buf.slice(idx + CLOSE.length);
        this.inThink = false;
      } else {
        const idx = this.buf.indexOf(OPEN);
        if (idx === -1) {
          // No full open tag in buffer. Hold partial-tag candidates.
          const lastLt = this.buf.lastIndexOf('<');
          if (lastLt !== -1 && this.buf.length - lastLt < OPEN.length) {
            visible += this.buf.slice(0, lastLt);
            this.buf = this.buf.slice(lastLt);
          } else {
            visible += this.buf;
            this.buf = '';
          }
          return { visible, reasoningDelta, closedBlocks };
        }
        visible += this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + OPEN.length);
        this.inThink = true;
      }
    }
  }

  /** End-of-stream flush. Emits any safe trailing visible content; drops
   *  any unclosed reasoning content (no entry in `closedBlocks`) since a
   *  truncated reasoning trace is more misleading than absent. */
  flush(): SplitDelta {
    if (this.inThink) {
      this.buf = '';
      this.currentBlock = '';
      return EMPTY;
    }
    const visible = this.buf;
    this.buf = '';
    return { visible, reasoningDelta: '', closedBlocks: [] };
  }
}
