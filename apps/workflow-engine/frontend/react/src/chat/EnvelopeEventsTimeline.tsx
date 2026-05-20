/**
 * EnvelopeEventsTimeline — RFC 0030 / 0031 / 0032 / 0033 surfacing.
 *
 * Renders the 8 envelope-reliability + capability-substitution event
 * families grouped on a `ChatMessage` as a stack of inline chips inside
 * the assistant bubble. The intent is to make the messy middle of an
 * LLM round-trip visible — retries, refusals, truncations, model
 * substitutions, prose-to-JSON coercions, partial-envelope recoveries.
 *
 * Card order is fixed (not strictly chronological per-event) so the
 * narrative reads top-to-bottom: capability decisions → retries →
 * refusals → truncations → coercions → recoveries → exhaustion.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md
 * @see RFCS/0032-envelope-reliability-events.md
 * @see RFCS/0033-envelope-completion-contract.md
 */

import type { ChatMessage } from './types.js';
import { RetryAttemptCard } from './cards/RetryAttemptCard.js';
import { RetryExhaustedCard } from './cards/RetryExhaustedCard.js';
import { RefusalCard } from './cards/RefusalCard.js';
import { TruncationCard } from './cards/TruncationCard.js';
import { NLCoercionCard } from './cards/NLCoercionCard.js';
import { RecoveryCard } from './cards/RecoveryCard.js';
import { CapabilitySubstitutionCard } from './cards/CapabilitySubstitutionCard.js';
import { CapabilityInsufficientCard } from './cards/CapabilityInsufficientCard.js';

interface Props {
  envelopeEvents: NonNullable<ChatMessage['envelopeEvents']>;
}

/** Quick "is this group empty?" check — if every array is empty, the
 *  timeline renders nothing (the bubble looks like a normal turn). */
export function hasEnvelopeEvents(events: ChatMessage['envelopeEvents']): boolean {
  if (!events) return false;
  return (
    events.retries.length +
      events.retriesExhausted.length +
      events.refusals.length +
      events.truncations.length +
      events.nlCoercions.length +
      events.recoveries.length +
      events.capabilitySubstitutions.length +
      events.capabilitiesInsufficient.length >
    0
  );
}

export function EnvelopeEventsTimeline({ envelopeEvents }: Props): JSX.Element | null {
  if (!hasEnvelopeEvents(envelopeEvents)) return null;
  return (
    <div className="envelope-events" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {envelopeEvents.capabilitySubstitutions.map((s, i) => (
        <CapabilitySubstitutionCard key={`cs-${i}-${s.at}`} sub={s} />
      ))}
      {envelopeEvents.capabilitiesInsufficient.map((c, i) => (
        <CapabilityInsufficientCard key={`ci-${i}-${c.at}`} ci={c} />
      ))}
      {envelopeEvents.retries.map((r, i) => (
        <RetryAttemptCard key={`r-${i}-${r.at}`} retry={r} />
      ))}
      {envelopeEvents.refusals.map((r, i) => (
        <RefusalCard key={`rf-${i}-${r.at}`} refusal={r} />
      ))}
      {envelopeEvents.truncations.map((t, i) => (
        <TruncationCard key={`t-${i}-${t.at}`} truncation={t} />
      ))}
      {envelopeEvents.nlCoercions.map((n, i) => (
        <NLCoercionCard key={`nl-${i}-${n.at}`} coercion={n} />
      ))}
      {envelopeEvents.recoveries.map((rec, i) => (
        <RecoveryCard key={`rec-${i}-${rec.at}`} recovery={rec} />
      ))}
      {envelopeEvents.retriesExhausted.map((rx, i) => (
        <RetryExhaustedCard key={`rx-${i}-${rx.at}`} exhausted={rx} />
      ))}
    </div>
  );
}
