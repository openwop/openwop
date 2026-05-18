/**
 * Streaming filter that removes `<think>...</think>` blocks from a
 * provider's SSE token stream. Reasoning models (MiniMax-M2.7,
 * DeepSeek-R1, qwen3-think, etc.) emit their chain-of-thought inline
 * before the final answer; without this filter, users see the model's
 * scratchpad as part of the chat bubble.
 *
 * The filter is a small state machine: it tracks whether the current
 * position is inside a think block and buffers a tail-slice large
 * enough to recognize a complete opening tag straddling a chunk
 * boundary. Inside a think block, every byte is discarded (the
 * closing tag is also discarded). Outside, content is forwarded.
 *
 * Single-instance, single-stream — construct one per request.
 */

const OPEN = '<think>';
const CLOSE = '</think>';

export class ThinkBlockStripper {
  private buf = '';
  private inThink = false;

  /** Feed an SSE delta; returns the visible text that can be emitted now.
   *  May return an empty string while holding partial-tag candidates. */
  push(chunk: string): string {
    if (chunk.length === 0) return '';
    this.buf += chunk;
    let out = '';
    while (true) {
      if (this.inThink) {
        const idx = this.buf.indexOf(CLOSE);
        if (idx === -1) {
          // No close tag yet — discard buffered think content, but hold
          // a tail in case `</think>` is split across this chunk + next.
          if (this.buf.length > CLOSE.length) {
            this.buf = this.buf.slice(this.buf.length - CLOSE.length);
          }
          return out;
        }
        // Found close: drop think content + the close tag itself.
        this.buf = this.buf.slice(idx + CLOSE.length);
        this.inThink = false;
      } else {
        const idx = this.buf.indexOf(OPEN);
        if (idx === -1) {
          // No full open tag in buffer. If the buffer ends in something
          // that COULD be the start of `<think>`, hold from the last
          // `<` onward; otherwise emit the whole buffer.
          const lastLt = this.buf.lastIndexOf('<');
          if (lastLt !== -1 && this.buf.length - lastLt < OPEN.length) {
            out += this.buf.slice(0, lastLt);
            this.buf = this.buf.slice(lastLt);
          } else {
            out += this.buf;
            this.buf = '';
          }
          return out;
        }
        // Emit pre-tag visible content, then enter think mode.
        out += this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + OPEN.length);
        this.inThink = true;
      }
    }
  }

  /** End-of-stream flush. Emits any visible buffer; drops any unclosed
   *  think content. Safe to call once after the SSE stream ends. */
  flush(): string {
    const out = this.inThink ? '' : this.buf;
    this.buf = '';
    return out;
  }
}
