/**
 * MessageRenderer — splits message content into text + code-block
 * segments and renders each appropriately.
 *
 * Parser is intentionally simple: regex on triple-backtick fences with
 * an optional language hint. Matches the MyndHyve ChatPanel pattern.
 * Skips syntax highlighting deliberately (regex-based highlighters are
 * brittle on partial streamed content).
 */

import { useState } from 'react';

interface Segment {
  kind: 'text' | 'code';
  content: string;
  language?: string;
}

/** Greedy match — captures language + code body between triple backticks. */
const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;

export function parseSegments(content: string): readonly Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: 'code',
      content: match[2] ?? '',
      language: match[1] && match[1].length > 0 ? match[1] : undefined,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', content: content.slice(lastIndex) });
  }
  return segments;
}

interface RendererProps {
  content: string;
}

export function MessageRenderer({ content }: RendererProps): JSX.Element {
  const segments = parseSegments(content);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{seg.content}</span>
        ) : (
          <CodeBlock key={i} source={seg.content} language={seg.language} />
        ),
      )}
    </>
  );
}

interface CodeBlockProps {
  source: string;
  language?: string;
}

function CodeBlock({ source, language }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; silently ignore */
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        margin: '8px 0',
        borderRadius: 8,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          className="secondary"
          onClick={copy}
          style={{
            padding: '0 8px',
            fontSize: 10,
            minHeight: 0,
            height: 22,
          }}
          aria-label="Copy code"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'transparent',
          color: 'var(--color-text)',
          overflowX: 'auto',
          whiteSpace: 'pre',
          wordBreak: 'normal',
        }}
      >
        <code>{source}</code>
      </pre>
    </div>
  );
}
