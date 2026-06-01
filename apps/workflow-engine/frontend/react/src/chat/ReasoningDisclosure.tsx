/**
 * ReasoningDisclosure — RFC 0030 §A `envelope.payload.reasoning` surface.
 *
 * The model ships a post-hoc explanation alongside its structured answer
 * (distinct from `agent.reasoning.delta` thinking-tokens, which are the
 * model's *internal monologue stream* — those are surfaced by
 * ThoughtsDisclosure with a "…" icon). This disclosure uses a different
 * icon ("ⓘ" — info) to signal "why this answer" rather than "what the
 * model was thinking on the way there".
 *
 * Collapsed by default. Rendered under the assistant message body when
 * the envelope payload carries `reasoning` and the string is non-empty.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §A
 * @see spec/v1/ai-envelope.md §"Reasoning field (normative)"
 */

import { InfoIcon } from '../ui/icons/index.js';

interface Props {
  reasoning: string;
}

export function ReasoningDisclosure({ reasoning }: Props): JSX.Element | null {
  const trimmed = reasoning.trim();
  if (!trimmed) return null;
  return (
    <details className="reasoning-disclosure">
      <summary>
        {/* Real-DOM icon (rather than ::before) so it renders consistently
         *  across Safari/VoiceOver, Firefox/NVDA, and Chrome/JAWS — each
         *  handles pseudo-element content differently. aria-hidden because
         *  the text label "Why this answer" already conveys meaning. */}
        <span aria-hidden="true" className="reasoning-disclosure-icon"><InfoIcon size={14} /></span>{' '}
        Why this answer
      </summary>
      <div className="reasoning-disclosure-body">{trimmed}</div>
    </details>
  );
}
