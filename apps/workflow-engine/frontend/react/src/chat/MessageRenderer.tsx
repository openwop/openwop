/**
 * MessageRenderer — splits message content into text + code-block +
 * audio segments and renders each appropriately.
 *
 * Fence parser is intentionally simple: regex on triple-backtick fences
 * with an optional language hint, matching the MyndHyve ChatPanel
 * pattern. Syntax highlighting skipped deliberately (regex-based
 * highlighters are brittle on partial streamed content).
 *
 * The text segments between code fences render through `react-markdown`
 * + `remark-gfm` when the `markdown` prop is true (assistant turns).
 * User turns render as plain whitespace-pre-wrap so the user's
 * literal text doesn't get reformatted (typing `**foo**` in a question
 * shouldn't render bold). Partial / streaming markdown renders as
 * plain text until the closing delimiter arrives — incomplete `**bold`
 * stays visible verbatim rather than disappearing.
 *
 * Multi-modal content (audio for now; image + file are trivial
 * extensions when needed) renders as inline players / thumbnails.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentPart } from './hooks/useChatSession.js';
import { config } from '../client/config.js';
import { MicIcon } from '../ui/icons/MicIcon.js';
import { CheckIcon, PaperclipIcon } from '../ui/icons/index.js';

/** Overrides applied to ReactMarkdown's element renderers. Two
 *  behaviors we want different from the defaults:
 *
 *  - `a` — always open assistant-output links in a new tab with
 *    `rel="noopener noreferrer"`. The chat surface is the long-lived
 *    workspace; clicking a link should NOT navigate it away from the
 *    in-flight conversation. URL sanitization (defaultUrlTransform)
 *    already strips `javascript:` + other unsafe protocols upstream.
 *
 *  - `input` — GFM task-list checkboxes (`- [ ]` / `- [x]`) render
 *    interactive by default but have no handler wired, so clicks
 *    toggle visually then snap back on re-render. Force `disabled`
 *    so the checkbox reads as read-only state. */
const CHAT_MD_COMPONENTS: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
  input: (props) => (
    props.type === 'checkbox'
      ? <input {...props} disabled style={{ cursor: 'default' }} />
      : <input {...props} />
  ),
};

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

/** RFC 0055 §B rendering hint (carried on the assistant turn's meta). */
interface RenderingHint {
  display: 'markdown' | 'code' | 'card' | 'image' | 'audio' | 'file';
  mimeType?: string;
  lang?: string;
  alt?: string;
  title?: string;
}

interface RendererProps {
  content: string | readonly ContentPart[];
  /** Render text segments through `react-markdown` + `remark-gfm`.
   *  Default `false` keeps user turns rendering as literal text so a
   *  user's `**hello**` doesn't suddenly render bold. Assistant turns
   *  pass `true` from MessageBubble. */
  markdown?: boolean;
  /** RFC 0055 §B hint for how to render string content. Advisory — an
   *  unrecognized `display` falls back to the default text rendering.
   *  Only consulted for string content; `image`/`audio`/`file` payloads
   *  arrive as `ContentPart[]` and render via their own branches. */
  rendering?: RenderingHint;
}

export function MessageRenderer({ content, markdown = false, rendering }: RendererProps): JSX.Element {
  if (typeof content === 'string') {
    // RFC 0055 §B: honor the producer's rendering hint for string content.
    // Unrecognized / media families degrade gracefully to default text.
    switch (rendering?.display) {
      case 'code':
        return <CodeBlock source={content} language={rendering.lang} />;
      case 'card':
        return <RenderingCard title={rendering.title}>{content}</RenderingCard>;
      case 'markdown':
        return <TextWithCodeBlocks content={content} markdown />;
      default:
        return <TextWithCodeBlocks content={content} markdown={markdown} />;
    }
  }
  // ContentPart[] — multi-modal user (or future assistant) message.
  return (
    <>
      {content.map((part, i) => {
        if (part.type === 'text') return <TextWithCodeBlocks key={i} content={part.text} markdown={markdown} />;
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
        if (part.type === 'image') {
          return <ImageAttachment key={i} mimeType={part.mimeType} url={part.url} dataBase64={part.dataBase64} alt={part.alt} />;
        }
        if (part.type === 'file') {
          return <FileAttachment key={i} mimeType={part.mimeType} url={part.url} dataBase64={part.dataBase64} name={part.name} />;
        }
        return null;
      })}
    </>
  );
}

function TextWithCodeBlocks({ content, markdown }: { content: string; markdown: boolean }): JSX.Element {
  const segments = parseSegments(content);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          markdown
            ? <MarkdownText key={i} content={seg.content} />
            : <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{seg.content}</span>
        ) : (
          <CodeBlock key={i} source={seg.content} language={seg.language} />
        ),
      )}
    </>
  );
}

/** Render a plain-text segment as GFM markdown using openwop's theme
 *  tokens. Headings / lists / emphasis / links / tables / blockquotes /
 *  inline-code all wired to `var(--ink)` / `var(--color-clay)` /
 *  `var(--color-border)` / `var(--mono)` so dark-mode + reduced-motion
 *  pick up the same overrides as the rest of the chat. Block-level
 *  triple-backtick fences never reach this component (handled by the
 *  fence parser above as `CodeBlock`); inline-code (`single backticks`)
 *  is the only code surface here. */
function MarkdownText({ content }: { content: string }): JSX.Element {
  return (
    <div className="chat-md" style={{ wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHAT_MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** RFC 0055 §B `display: card` — a titled container around the (markdown)
 *  body, for structured/summary payloads the producer wants set apart. */
function RenderingCard({ title, children }: { title?: string; children: string }): JSX.Element {
  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--color-border)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink)',
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding: 10 }}>
        <MarkdownText content={children} />
      </div>
    </div>
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
          {copied ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckIcon size={12} /> Copied
            </span>
          ) : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0, padding: 10,
          fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.5,
          background: 'transparent', color: 'var(--ink)',
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
      <MicIcon size={14} />
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

/** Resolve a media part to a renderable src: host-served URL (RFC 0055 §C
 *  preferred) or an inline data URI. Returns null when neither is present.
 *
 *  The untrusted `url` field is restricted to http(s)/blob OR the host's own
 *  media-asset serve path — media content is LLM-influenced, and an
 *  unsanitized `javascript:` URL in the file-chip anchor would be a DOM-XSS
 *  vector (the app's other links are sanitized by react-markdown; this raw
 *  element is not). The relative host path (`/v1/host/sample/assets/<token>`,
 *  where the unguessable token IS the capability) is resolved against the API
 *  base so an `<img>`/`<a>` can fetch it cross-origin in the public deploy;
 *  any other relative or non-allowlisted scheme is rejected. Inline `data:`
 *  is only ever produced from our own base64 below, never accepted from `url`. */
function mediaSrc(mimeType: string, url?: string, dataBase64?: string): string | null {
  if (url) {
    const u = url.trim();
    if (/^(https?|blob):/i.test(u)) return u;
    // Same-origin host media-asset path. Match the exact token shape (32 random
    // bytes, base64url — no `/` or `.`) so a crafted LLM-emitted `url` can't
    // smuggle a traversal segment past the prefix check.
    if (/^\/v1\/host\/sample\/assets\/[A-Za-z0-9_-]+$/.test(u)) return `${config.baseUrl}${u}`;
    return null;
  }
  if (dataBase64) return `data:${mimeType};base64,${dataBase64}`;
  return null;
}

/** RFC 0055 media.image — inline image with `alt` wired for screen readers. */
function ImageAttachment({ mimeType, url, dataBase64, alt }: { mimeType: string; url?: string; dataBase64?: string; alt?: string }): JSX.Element | null {
  const src = useMemo(() => mediaSrc(mimeType, url, dataBase64), [mimeType, url, dataBase64]);
  if (!src) return null;
  return (
    <figure style={{ margin: '6px 0' }}>
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, border: '1px solid var(--color-border)', display: 'block' }}
      />
      {/* aria-hidden: the same text is the img's accessible name (alt); the
          visible caption would otherwise double-announce to screen readers. */}
      {alt && <figcaption aria-hidden="true" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{alt}</figcaption>}
    </figure>
  );
}

/** RFC 0055 media.file — download chip for non-renderable assets. */
function FileAttachment({ mimeType, url, dataBase64, name }: { mimeType: string; url?: string; dataBase64?: string; name?: string }): JSX.Element | null {
  const href = useMemo(() => mediaSrc(mimeType, url, dataBase64), [mimeType, url, dataBase64]);
  if (!href) return null;
  return (
    <a
      href={href}
      download={name ?? ''}
      target="_blank"
      rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '6px 0', padding: '6px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, textDecoration: 'none', color: 'var(--color-text)' }}
    >
      <PaperclipIcon size={14} />
      <span>{name ?? mimeType}</span>
    </a>
  );
}
