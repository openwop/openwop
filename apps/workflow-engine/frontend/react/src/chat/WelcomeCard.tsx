/**
 * Empty-state welcome card (inner-content redesign 2026-06-05). Pivots from
 * "ask the LLM about OpenWOP" to the actual differentiator: run a multi-step
 * workflow with `/`, or hand a task to a named agent with `@`.
 *
 * All four cards are REAL slash invocations of the seeded premade templates —
 * clicking pre-fills the composer with `/slug` + a representative input so
 * Send dispatches a real run. Below them, the agent pills hand the chat to a
 * named roster persona (`@nora `). No fabricated badges: there is no usage
 * telemetry, so nothing claims "most used".
 */

import { useMemo, type ReactNode } from 'react';
import { ClockIcon, ColumnsIcon, SparklesIcon, ZapIcon } from '../ui/icons/index.js';
import { listWorkflowMentions } from './lib/workflowMentions.js';
import { useAgentMentions } from './lib/agentMentions.js';
import { topUpSeededWorkflows } from '../builder/persistence/localStore.js';
import { PREMADE_WORKFLOWS, cloneTemplateToUserWorkflow } from '../builder/templates/premadeWorkflows.js';

interface Props {
  onPickSuggestion: (text: string) => void;
}

interface WorkflowCardSpec {
  /** Small visual anchor — an icon component, or an emoji (for glyphs
   *  with no icon-set equivalent, e.g. the traffic light). */
  glyph: ReactNode;
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
    glyph: <ColumnsIcon size={16} />,
    title: 'Multi-channel content review',
    templateName: 'Multi-channel content review',
    description: 'One draft is reviewed in parallel by legal, brand, compliance and risk — and only publishes once all four approve.',
    trailing: 'Draft a Q3 product launch announcement',
  },
  {
    glyph: <ClockIcon size={16} />,
    title: 'Approval with timeout fallback',
    templateName: 'Approval escalation with timeout fallback',
    description: "The primary approver races a 5-second timer. If they don't respond, a backup approver takes over so work never stalls.",
    trailing: 'Approve the new pricing change',
  },
  {
    glyph: <SparklesIcon size={16} />,
    title: 'Triple-AI review board',
    // Match the EXACT premadeWorkflows.ts template name (hyphenated).
    // Welcome-card resolution does a case-insensitive prefix match
    // against listWorkflowMentions(); the hyphen has to be present
    // for the match to fire.
    templateName: 'Triple-AI review board',
    description: 'Three AI critics review one draft at the same time; an arbiter merges their notes into a single verdict.',
    // The three critic system prompts say "Read the text below" — so
    // trailing MUST be real prose, not a meta-instruction. Earlier
    // versions sent "Critique this paragraph for clarity and concision"
    // which the LLM correctly identified as an instruction with no
    // actual paragraph attached.
    trailing:
      'Our new pricing is simple: $19/month gets you the Starter plan with unlimited workflows, 10,000 runs, and email support. Teams that need more can upgrade to Pro at $49/month for 50,000 runs and priority support. Both plans include a 14-day free trial — no credit card required. Cancel anytime.',
  },
  {
    glyph: <ZapIcon size={16} />,
    title: 'Race-to-respond with audit trail',
    templateName: 'Race-to-respond with audit trail',
    description: 'A fast first response races a slower audit log; whichever finishes first moves work forward — and both always complete.',
    trailing: 'Customer reports checkout is failing on mobile — draft the first response',
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
  // The named roster personas — the `@` hand-off pills under the cards.
  const { entries: agentEntries } = useAgentMentions();
  const personas = agentEntries.filter((e) => e.agentId.startsWith('user.')).slice(0, 5);

  // Resolve each card's live slug once per render. This binds the
  // welcome card to the user's actual workflow inventory rather than
  // hard-coded slugs that go stale when slugify rules / template
  // names change. Cards whose template isn't in the user's saved
  // workflows render disabled with a tooltip explaining why.
  const resolvedCards = useMemo(
    () => {
      // PRE-SEED: chat is most visitors' FIRST page, but the premade
      // templates these cards point at were only seeded on the workflow
      // dashboard's first visit — so the cards rendered "(not available)"
      // until the user happened to open /builder. Run the SAME first-visit
      // seed here (same persisted flag → first surface visited wins, and a
      // user who deleted their workflows is still never re-seeded).
      topUpSeededWorkflows(
        PREMADE_WORKFLOWS
          .filter((tpl) => !tpl.requiresTypeIds)
          .map((tpl) => cloneTemplateToUserWorkflow(tpl)),
      );
      return WORKFLOW_CARD_SPECS.map((spec) => ({
        ...spec,
        slug: resolveSlug(spec.templateName),
      }));
    },
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
        fontFamily: 'var(--sans)',
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: '-0.01em',
        color: 'var(--ink)',
      }}>
        Run workflows by name. Chat when you need to.
      </h2>
      <p className="muted" style={{ marginTop: 8, fontSize: 13.5, maxWidth: 560, lineHeight: 1.6 }}>
        Type <code className="welcome-key">/</code> to run a multi-step workflow,
        or <code className="welcome-key">@</code> to hand a task to one of your
        agents. Pick one to see it run live.
      </p>
      <div className="page-enter welcome-grid">
        {resolvedCards.map((c) => {
          const available = c.slug !== null;
          return (
            <button
              key={c.templateName}
              type="button"
              className="welcome-card"
              disabled={!available}
              onClick={() => {
                if (c.slug) onPickSuggestion(`/${c.slug} ${c.trailing}`);
              }}
              title={available
                ? `Pre-fill the composer with /${c.slug}`
                : `Workflow "${c.title}" isn't in your saved workflows. Open the builder to create or import it.`}
              aria-label={available
                ? `Run workflow ${c.title} (/${c.slug})`
                : `${c.title} — workflow not available`}
            >
              <span className="welcome-card-head">
                <span className="welcome-card-icon" aria-hidden>{c.glyph}</span>
                <span className="welcome-card-title">{c.title}</span>
              </span>
              <span className="welcome-card-desc">{c.description}</span>
              <code className="welcome-slug">{c.slug ? `/${c.slug}` : '(not available)'}</code>
            </button>
          );
        })}
      </div>

      {personas.length > 0 ? (
        <>
          <div className="welcome-agents-label">Or hand it to an agent</div>
          <div className="welcome-agents">
            {personas.map((a) => (
              <button
                key={a.agentId}
                type="button"
                className="welcome-agent-pill"
                onClick={() => onPickSuggestion(`@${a.slug} `)}
                title={`Hand the task to ${a.persona}${a.displayName !== a.persona ? ` — ${a.displayName}` : ''} (@${a.slug})`}
              >
                <span className="welcome-agent-avatar" aria-hidden>{a.persona.slice(0, 1).toUpperCase()}</span>
                <span className="welcome-agent-at" aria-hidden>@</span> {a.persona}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="muted" style={{ marginTop: 20, fontSize: 11.5, maxWidth: 520, lineHeight: 1.5 }}>
        Just want to chat? Type below — the LLM passthrough is a single-step workflow with one chat node.
      </p>
    </div>
  );
}
