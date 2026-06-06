/**
 * Structured error card for a failed assistant turn.
 *
 * Replaces the raw `<strong>code:</strong> message` line with a
 * red-bordered card carrying a friendly headline, the underlying code +
 * provider context (when known), and a primary suggested action.
 *
 * Two layers of classification:
 *
 *  1. **BE-attached** — when `error.userMessage` / `error.action` are
 *     present on the envelope (a BE that has wired
 *     `classifyDispatchError()` into its error pipeline), we render
 *     those directly. The BE wins ties because it's seen the raw
 *     `Error` instance with its full stack + provider context.
 *
 *  2. **FE fallback** — otherwise we run the `{code, message}` pair
 *     through `chat/lib/errorClassify.ts:classifyChatError()` which
 *     produces a renderable `{title, detail, action?}` triple.
 *
 * role="alert" so screen readers announce the failure on first paint.
 */

import { classifyChatError, type KnownError } from './lib/errorClassify.js';
import type { ChatMessage } from './types.js';

type ErrorEnvelope = NonNullable<NonNullable<ChatMessage['meta']>['error']>;

interface Props {
  error: ErrorEnvelope;
  /** Open the BYOK wizard. Wired from ChatSidebar / ChatTab. When absent
   *  the `reconfigure-byok` action falls back to descriptive text only. */
  onReconfigure?: () => void;
  /** Re-run the prior user message that produced this error. */
  onRetry?: () => void;
}

/** Map a BE-attached `RecoveryAction` to the FE button-action vocabulary
 *  ErrorCard can wire callbacks to. Unmapped actions surface as a plain
 *  card without a button. */
function actionFromBE(envelope: ErrorEnvelope): KnownError['action'] {
  if (envelope.action === 'reconfigure') return { kind: 'reconfigure-byok', label: 'Open BYOK settings' };
  if (envelope.action === 'retry' || envelope.action === 'wait') return { kind: 'retry', label: 'Retry' };
  // 'regenerate' / 'abort' have no FE button affordance in this card.
  return undefined;
}

function classify(error: ErrorEnvelope): KnownError {
  // Prefer BE-attached fields when present.
  if (error.userMessage) {
    return {
      title: error.userMessage,
      ...(actionFromBE(error) ? { action: actionFromBE(error)! } : {}),
    };
  }
  return classifyChatError(error);
}

export function ErrorCard({ error, onReconfigure, onRetry }: Props): JSX.Element {
  const k = classify(error);
  return (
    <div
      role="alert"
      style={{
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--color-danger)',
        background: 'color-mix(in oklch, var(--color-danger) 6%, transparent)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--color-danger-text)' }}>{k.title}</div>
      {k.detail && <div style={{ marginTop: 4, color: 'var(--ink)' }}>{k.detail}</div>}
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7, color: 'var(--color-text-muted)' }}>
        {error.code}
      </div>
      {k.action && (
        <div style={{ marginTop: 8 }}>
          {k.action.kind === 'reconfigure-byok' && onReconfigure && (
            <button
              type="button"
              className="secondary"
              onClick={onReconfigure}
              style={{ fontSize: 11, padding: '3px 10px', minHeight: 0, height: 24 }}
            >
              {k.action.label}
            </button>
          )}
          {k.action.kind === 'retry' && onRetry && (
            <button
              type="button"
              className="secondary"
              onClick={onRetry}
              style={{ fontSize: 11, padding: '3px 10px', minHeight: 0, height: 24 }}
            >
              {k.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
