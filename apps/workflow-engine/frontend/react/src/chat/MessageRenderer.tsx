/**
 * MessageRenderer — splits message content into text + code-block +
 * audio segments and renders each appropriately.
 *
 * Text parser is intentionally simple: regex on triple-backtick fences
 * with an optional language hint. Matches the MyndHyve ChatPanel
 * pattern. Skips syntax highlighting deliberately (regex-based
 * highlighters are brittle on partial streamed content).
 *
 * Multi-modal content (audio for now; image + file are trivial
 * extensions when needed) renders as inline players / thumbnails.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentPart } from './hooks/useChatSession.js';

interface TextSegment { kind: 'text'; content: string }
interface CodeSegment { kind: 'code'; content: string; language?: string }
type Segment = TextSegment | CodeSegment;

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
  content: string | readonly ContentPart[];
}

export function MessageRenderer({ content }: RendererProps): JSX.Element {
  if (typeof content === 'string') {
    return <TextWithCodeBlocks content={content} />;
  }
  // ContentPart[] — multi-modal user (or future assistant) message.
  return (
    <>
      {content.map((part, i) => {
        if (part.type === 'text') return <TextWithCodeBlocks key={i} content={part.text} />;
        if (part.type === 'audio') {
          return (
            <AudioAttachment
              key={i}
              mimeType={part.mimeType}
              dataBase64={part.dataBase64}
              durationSeconds={part.durationSeconds}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function TextWithCodeBlocks({ content }: { content: string }): JSX.Element {
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

interface CodeBlockProps { source: string; language?: string }

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
          style={{ padding: '0 8px', fontSize: 10, minHeight: 0, height: 22 }}
          aria-label="Copy code"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0, padding: 10,
          fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
          background: 'transparent', color: 'var(--color-text)',
          overflowX: 'auto', whiteSpace: 'pre', wordBreak: 'normal',
        }}
      >
        <code>{source}</code>
      </pre>
    </div>
  );
}

interface AudioProps {
  mimeType: string;
  dataBase64: string;
  durationSeconds?: number;
}

function AudioAttachment({ mimeType, dataBase64, durationSeconds }: AudioProps): JSX.Element {
  const url = useMemo(() => `data:${mimeType};base64,${dataBase64}`, [mimeType, dataBase64]);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '6px 0',
        padding: '6px 10px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <span aria-hidden>🎤</span>
      <span style={{ flexShrink: 0 }}>
        Voice{durationSeconds != null ? ` (${durationSeconds.toFixed(1)}s)` : ''}
      </span>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={url}
        style={{ flex: 1, minWidth: 0, height: 28 }}
      />
    </div>
  );
}
