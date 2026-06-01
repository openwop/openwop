/**
 * Claude / o1-style "Thoughts" disclosure rendered above an assistant
 * bubble when the turn produced an `agent.reasoned` event (RFC 0002).
 *
 * Three visual states:
 *   1. **In-flight** (`finishedAt` unset): subtle "Thinking…" with an
 *      animated three-dot pulse. Disclosure is closed; clicking it
 *      reveals the partial reasoning streamed so far (Phase 2).
 *   2. **Finalized, collapsed** (default): single line "Thought for 3s",
 *      muted, click-to-expand affordance.
 *   3. **Finalized, expanded**: full reasoning text in a muted panel,
 *      with a copy-to-clipboard button.
 *
 * All animations gate on `prefers-reduced-motion: no-preference`. The
 * pulse uses CSS keyframes (defined inline once via `useEffect`) so
 * no animation library is needed.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChatMessageThoughts } from './hooks/useChatSession.js';
import { useElapsedMs } from './hooks/useElapsedMs.js';
import { ChevronRightIcon, ChevronDownIcon } from '../ui/icons/index.js';

interface Props {
  thoughts: ChatMessageThoughts;
}

const ANIM_STYLE_ID = 'openwop-thoughts-anim';
const ANIM_STYLE = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes openwop-thoughts-dot {
    0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
    40%           { opacity: 1;    transform: translateY(-2px); }
  }
  @keyframes openwop-thoughts-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .openwop-thoughts-dot { animation: openwop-thoughts-dot 1.2s ease-in-out infinite; display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: currentColor; margin: 0 1px; }
  .openwop-thoughts-dot:nth-child(1) { animation-delay: 0s; }
  .openwop-thoughts-dot:nth-child(2) { animation-delay: 0.15s; }
  .openwop-thoughts-dot:nth-child(3) { animation-delay: 0.3s; }
  .openwop-thoughts-panel { animation: openwop-thoughts-fade-in 0.18s ease-out; }
  .openwop-thoughts-chevron { transition: transform 0.18s ease-out; display: inline-block; }
  .openwop-thoughts-chevron.open { transform: rotate(90deg); }
}
@media (prefers-reduced-motion: reduce) {
  .openwop-thoughts-dot { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: currentColor; margin: 0 1px; opacity: 0.5; }
  .openwop-thoughts-chevron { display: inline-block; }
  .openwop-thoughts-chevron.open { transform: rotate(90deg); }
}
`;

function ensureAnimStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ANIM_STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = ANIM_STYLE_ID;
  tag.textContent = ANIM_STYLE;
  document.head.appendChild(tag);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function ThoughtsDisclosure({ thoughts }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInFlight = thoughts.finishedAt == null;
  const elapsedLive = useElapsedMs(thoughts.startedAt, isInFlight);
  const elapsedFinal = thoughts.durationMs ?? 0;

  useEffect(() => {
    ensureAnimStyles();
  }, []);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  async function onCopy(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(thoughts.content);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — silently ignore */
    }
  }

  const summaryLine = isInFlight ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span>Thinking</span>
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'baseline' }}>
        <span className="openwop-thoughts-dot" />
        <span className="openwop-thoughts-dot" />
        <span className="openwop-thoughts-dot" />
      </span>
      {elapsedLive > 1000 && (
        <span style={{ marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>
          · {formatDuration(elapsedLive)}
        </span>
      )}
    </span>
  ) : (
    <span>Thought for {formatDuration(elapsedFinal)}</span>
  );

  // While in-flight with no buffered content, the disclosure is not
  // toggleable — there's nothing to show inside yet.
  const canToggle = !isInFlight || thoughts.content.length > 0;
  const showChevron = canToggle;

  return (
    <div
      style={{
        marginBottom: 6,
        fontSize: 12,
        color: 'var(--color-text-muted)',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={canToggle ? () => setOpen((v) => !v) : undefined}
        disabled={!canToggle}
        aria-expanded={open}
        aria-label={open ? 'Hide reasoning' : 'Show reasoning'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: canToggle ? 'pointer' : 'default',
          minHeight: 0,
        }}
      >
        {showChevron && (
          <span
            className="openwop-thoughts-chevron"
            aria-hidden
            style={{ opacity: 0.7, display: 'inline-flex' }}
          >
            {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        )}
        {summaryLine}
      </button>

      {open && thoughts.content.length > 0 && (
        <div
          className="openwop-thoughts-panel"
          style={{
            marginTop: 6,
            padding: '8px 10px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            position: 'relative',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          <button
            type="button"
            onClick={(e) => { void onCopy(e); }}
            aria-label="Copy reasoning"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              padding: '2px 8px',
              fontSize: 10,
              minHeight: 0,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <div style={{ paddingRight: 56 }}>{thoughts.content}</div>
          {isInFlight && (
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 6,
                height: 11,
                background: 'currentColor',
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                opacity: 0.5,
                animation: 'openwop-pulse 1s steps(2, end) infinite',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
