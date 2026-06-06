/**
 * Modal that previews a terminal-node output blob when the user
 * clicks "View" on a `WorkflowCompletionCard`.
 *
 * The output's shape varies by workflow: Triple-AI's `publish` node
 * emits `{published: string}` with the formatted artifact, the
 * uppercase sample emits `{output: 'WORD'}`, a markdown summarizer
 * emits `{markdown: '# ...'}`, and a generic chat node emits
 * `{response: '...'}`. We pick a "primary" string field for the body
 * preview via a small heuristic + show the raw JSON below it so users
 * can grab structured data verbatim.
 *
 * Dialog shell (scrim + Escape + role/aria-modal + focus-trap-and-restore)
 * is the shared ui/Modal primitive (GAP-ANALYSIS E7); this file owns only
 * the artifact-specific header + body. `.artifact-modal` widens the box and
 * lets the body scroll internally.
 *
 * No deep-link to /runs/:runId#node-:nodeId yet — that's a follow-up.
 * For now "Open run" remains a sibling link on the completion card.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Modal } from '../ui/Modal.js';
import { XIcon } from '../ui/icons/index.js';
import { isRecord } from './lib/typeGuards.js';

interface Props {
  open: boolean;
  nodeId: string;
  label: string;
  output: unknown;
  onClose: () => void;
}

export function ArtifactPreviewModal({ open, nodeId, label, output, onClose }: Props): JSX.Element | null {
  if (!open) return null;

  const { body, format } = pickPrimaryView(output);
  const rawJson = JSON.stringify(output, null, 2);

  return (
    <Modal label={label} onClose={onClose} className="surface-card artifact-modal">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>{label}</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          node <code>{nodeId}</code>
        </span>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          aria-label="Close preview"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}
        >
          <XIcon size={14} />
        </button>
      </header>
      <div style={{ padding: '14px 18px', overflow: 'auto', flex: 1 }}>
        {body && format === 'markdown' && (
          <div style={{ marginBottom: 16 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        )}
        {body && format === 'text' && (
          <pre
            style={{
              marginBottom: 16,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--color-surface-2)',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            {body}
          </pre>
        )}
        <details>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>
            Raw output JSON
          </summary>
          <pre
            tabIndex={0}
            aria-label="Raw output JSON"
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--color-surface-2)',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              maxHeight: 360,
              overflow: 'auto',
            }}
          >
            {rawJson}
          </pre>
        </details>
      </div>
    </Modal>
  );
}

/**
 * Pull a "primary view" string out of an arbitrary output blob.
 *
 * Heuristic in priority order:
 *   1. `{markdown: string}` or `{md: string}` → markdown
 *   2. `{published: string}` (Triple-AI's terminal node) → markdown
 *   3. `{response: string}` (chat-responder output) → text
 *   4. `{output: string}` (uppercase sample, generic) → text
 *   5. `{text: string}` → text
 *   6. Plain string → text
 *   7. Otherwise → no body (the raw-JSON details block carries it)
 *
 * Lots of workflows fall through to the raw-JSON view, which is fine —
 * users with structured outputs prefer that anyway.
 */
function pickPrimaryView(output: unknown): { body: string | null; format: 'markdown' | 'text' } {
  if (typeof output === 'string') return { body: output, format: 'text' };
  if (!isRecord(output)) return { body: null, format: 'text' };
  // The convention is informal — node authors emit their primary
  // artifact under one of these well-known keys. A future RFC may
  // formalize this via a "primary output" annotation on the node
  // schema; until then the FE walks priority order and degrades to
  // the raw-JSON details block when nothing matches.
  if (typeof output.markdown === 'string') return { body: output.markdown, format: 'markdown' };
  if (typeof output.md === 'string') return { body: output.md, format: 'markdown' };
  if (typeof output.published === 'string') return { body: output.published, format: 'markdown' };
  if (typeof output.response === 'string') return { body: output.response, format: 'text' };
  if (typeof output.output === 'string') return { body: output.output, format: 'text' };
  if (typeof output.text === 'string') return { body: output.text, format: 'text' };
  return { body: null, format: 'text' };
}
