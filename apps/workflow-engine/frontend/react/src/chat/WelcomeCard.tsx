/**
 * Empty-state welcome card. Pivots from "ask the LLM about OpenWOP"
 * (the prior chatbot framing) to "run a workflow with @-mention" —
 * the actual differentiator the demo is built around.
 *
 * Three of the four cards are real `@-mention` invocations of the
 * seeded templates: clicking pre-fills the chat input with the
 * mention + a representative input string so the user can hit Send
 * to actually dispatch a multi-step workflow. The fourth card is
 * a navigation pivot to the builder so users see where the workflows
 * came from + can build their own.
 */

import { useNavigate } from 'react-router-dom';
import { SparklesIcon } from './icons/index.js';

interface Props {
  onPickSuggestion: (text: string) => void;
}

interface WorkflowCard {
  /** Emoji shown as a small visual anchor. Compact + brand-tone. */
  glyph: string;
  /** Card headline. Should read like a workflow name, not a prose
   *  question — these are actions the user takes, not topics they
   *  ask about. */
  title: string;
  /** The `@-mention` slug. Must match a seeded template's slug. */
  slug: string;
  /** One-line description of what the workflow does. */
  description: string;
  /** Trailing text appended after the slug. Becomes `inputs.<firstKey>`
   *  via the workflowMentions trailing-text fix shipped earlier. */
  trailing: string;
}

// NOTE: slugs MUST match what `listWorkflowMentions()` produces. The
// slugify in `chat/lib/workflowMentions.ts:60` explicitly strips the
// "(from template)" suffix BEFORE slugifying, so cloned-template
// workflows resolve under their bare template name — NOT the
// "from-template" form. Don't append "-from-template" here.
const WORKFLOW_CARDS: readonly WorkflowCard[] = [
  {
    glyph: '📋',
    title: 'Multi-channel content review',
    slug: 'multi-channel-content-review',
    description: 'One draft, four parallel reviewers (legal, brand, compliance, risk), fan-in with all_success, publish. 12 nodes, 4 HITL gates, 1 click.',
    trailing: 'Draft a Q3 product launch announcement',
  },
  {
    glyph: '🚦',
    title: 'Approval with timeout fallback',
    slug: 'approval-escalation-with-timeout-fallback',
    description: 'Primary approver races a 5s timeout to a backup approver. Whichever resolves first drives publication. The canonical HITL escalation pattern.',
    trailing: 'Approve the new pricing change',
  },
  {
    glyph: '🧠',
    title: 'Triple AI review board',
    slug: 'triple-ai-review-board',
    description: 'Three concurrent critics fan out from one draft. An arbiter merges their notes into a single verdict. Multi-agent orchestration in one turn.',
    trailing: 'Critique this paragraph for clarity and concision',
  },
];

export function WelcomeCard({ onPickSuggestion }: Props): JSX.Element {
  const nav = useNavigate();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 48, textAlign: 'center', minHeight: 320,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--color-surface-2)',
        color: 'var(--color-accent)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }} aria-hidden>
        <SparklesIcon size={28} />
      </div>
      <h2 style={{
        margin: 0,
        fontFamily: 'var(--serif)',
        fontStyle: 'italic',
        fontWeight: 400,
        fontSize: 30,
        letterSpacing: '-0.01em',
        color: 'var(--ink)',
      }}>
        Run workflows by name. Chat when you need to.
      </h2>
      <p className="muted" style={{ marginTop: 8, fontSize: 13, maxWidth: 560, lineHeight: 1.5 }}>
        OpenWOP makes multi-agent orchestration as easy as @-mentioning a workflow.
        Click one below — each is a real multi-step workflow on the live sample backend.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
        maxWidth: 720, width: '100%', marginTop: 24,
      }}>
        {WORKFLOW_CARDS.map((c) => (
          <button
            key={c.slug}
            type="button"
            className="secondary"
            onClick={() => onPickSuggestion(`@${c.slug} ${c.trailing}`)}
            title={`Pre-fill chat input with @${c.slug}`}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              padding: 14, textAlign: 'left',
              gap: 6, border: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden>{c.glyph}</span> {c.title}
            </span>
            <code style={{ fontSize: 10.5, color: 'var(--clay)', fontFamily: 'var(--mono)' }}>
              @{c.slug}
            </code>
            <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{c.description}</span>
          </button>
        ))}
        {/* Fourth card: pivot to the builder. Not a workflow invocation —
            a navigation hand-off so users see where workflows come from
            + can build their own. */}
        <button
          type="button"
          className="secondary"
          onClick={() => nav('/builder')}
          title="Open the visual workflow builder"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            padding: 14, textAlign: 'left',
            gap: 6, border: '1px solid var(--clay-rule, var(--color-border))',
            background: 'var(--paper-2, transparent)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden>🛠️</span> Build your own →
          </span>
          <code style={{ fontSize: 10.5, color: 'var(--clay)', fontFamily: 'var(--mono)' }}>
            /builder
          </code>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Open the visual workflow builder. Drag nodes, pick provider + key + prompts per node, watch the wire-shape in the envelope inspector.
          </span>
        </button>
      </div>
      <p className="muted" style={{ marginTop: 20, fontSize: 11.5, maxWidth: 520, lineHeight: 1.5 }}>
        Just want to chat? Type below — the LLM passthrough is a single-step workflow with one chat node.
        Type <code>@</code> any time to switch into orchestration mode.
      </p>
    </div>
  );
}
