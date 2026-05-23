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

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SparklesIcon } from './icons/index.js';
import { listWorkflowMentions } from './lib/workflowMentions.js';

interface Props {
  onPickSuggestion: (text: string) => void;
}

interface WorkflowCardSpec {
  /** Emoji shown as a small visual anchor. */
  glyph: string;
  /** Card headline (display only). */
  title: string;
  /** Template display-name pattern. Matched (case-insensitive, prefix)
   *  against `listWorkflowMentions()` entries to resolve the live slug
   *  at render time. Avoids the prior bug where hard-coded slugs went
   *  stale when the slugify rules changed. */
  templateName: string;
  /** One-line description of what the workflow does. */
  description: string;
  /** Trailing text appended after the resolved @-mention. Becomes
   *  `inputs.<firstKey>` via the workflowMentions trailing-text fix. */
  trailing: string;
}

const WORKFLOW_CARD_SPECS: readonly WorkflowCardSpec[] = [
  {
    glyph: '📋',
    title: 'Multi-channel content review',
    templateName: 'Multi-channel content review',
    description: 'One draft, four parallel reviewers (legal, brand, compliance, risk), fan-in with all_success, publish. 12 nodes, 4 HITL gates, 1 click.',
    trailing: 'Draft a Q3 product launch announcement',
  },
  {
    glyph: '🚦',
    title: 'Approval with timeout fallback',
    templateName: 'Approval escalation with timeout fallback',
    description: 'Primary approver races a 5s timeout to a backup approver. Whichever resolves first drives publication. The canonical HITL escalation pattern.',
    trailing: 'Approve the new pricing change',
  },
  {
    glyph: '🧠',
    title: 'Triple-AI review board',
    // Match the EXACT premadeWorkflows.ts template name (hyphenated).
    // Welcome-card resolution does a case-insensitive prefix match
    // against listWorkflowMentions(); the hyphen has to be present
    // for the match to fire.
    templateName: 'Triple-AI review board',
    description: 'Three concurrent critics fan out from one draft. An arbiter merges their notes into a single verdict. Multi-agent orchestration in one turn.',
    trailing: 'Critique this paragraph for clarity and concision',
  },
];

/** Resolve a card's live slug from the user's saved workflows.
 *  Matches displayName by case-insensitive prefix so " (from template)"
 *  suffixes match correctly. Returns null when the seeded template
 *  isn't in the user's localStorage (e.g., they cleared it). */
function resolveSlug(templateName: string): string | null {
  const lower = templateName.toLowerCase();
  const entry = listWorkflowMentions().find((e) =>
    e.displayName.toLowerCase().startsWith(lower),
  );
  return entry?.slug ?? null;
}

export function WelcomeCard({ onPickSuggestion }: Props): JSX.Element {
  const nav = useNavigate();

  // Resolve each card's live slug once per render. This binds the
  // welcome card to the user's actual workflow inventory rather than
  // hard-coded slugs that go stale when slugify rules / template
  // names change. Cards whose template isn't in the user's saved
  // workflows render disabled with a tooltip explaining why.
  const resolvedCards = useMemo(
    () => WORKFLOW_CARD_SPECS.map((spec) => ({
      ...spec,
      slug: resolveSlug(spec.templateName),
    })),
    // listWorkflowMentions reads localStorage synchronously; we
    // intentionally don't subscribe to it here because the welcome
    // card only renders when no chat messages exist yet, and the
    // user can't have mutated saved workflows mid-session without a
    // full page reload (no live cross-tab sync for the builder).
    [],
  );

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
        {resolvedCards.map((c) => {
          const available = c.slug !== null;
          return (
            <button
              key={c.templateName}
              type="button"
              className="secondary"
              disabled={!available}
              onClick={() => {
                if (c.slug) onPickSuggestion(`@${c.slug} ${c.trailing}`);
              }}
              title={available
                ? `Pre-fill chat input with @${c.slug}`
                : `Workflow "${c.title}" isn't in your saved workflows. Open the builder to create or import it.`}
              aria-label={available
                ? `Run workflow ${c.title} (@${c.slug})`
                : `${c.title} — workflow not available`}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: 14, textAlign: 'left',
                gap: 6, border: '1px solid var(--color-border)',
                opacity: available ? 1 : 0.55,
                cursor: available ? 'pointer' : 'not-allowed',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>{c.glyph}</span> {c.title}
              </span>
              <code style={{ fontSize: 10.5, color: 'var(--clay)', fontFamily: 'var(--mono)' }}>
                {c.slug ? `@${c.slug}` : '(not available)'}
              </code>
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{c.description}</span>
            </button>
          );
        })}
        {/* Fourth card: pivot to the builder. Not a workflow invocation —
            a navigation hand-off so users see where workflows come from
            + can build their own. */}
        <button
          type="button"
          className="secondary"
          onClick={() => nav('/builder')}
          title="Open the visual workflow builder"
          aria-label="Open the visual workflow builder"
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
