/**
 * Autonomy meter — the 3-bar Supervised / Guided / Autonomous scale on the
 * host-ext `autonomyLevel` field. All three positions are LIVE (architect
 * memo 2026-06-05):
 *   review → 1 · Supervised (every heartbeat pick proposes for sign-off)
 *   guided → 2 · Guided (routine picks run; HIGH-priority picks propose)
 *   auto   → 3 · Autonomous (every pick runs immediately)
 */

const LEVELS = {
  review: {
    level: 1,
    label: 'Supervised',
    help: 'Proposes for review — heartbeat picks queue as proposals for human sign-off (agents propose, humans dispose).',
  },
  guided: {
    level: 2,
    label: 'Guided',
    help: 'Routine picks run immediately; HIGH-priority picks queue as proposals for sign-off.',
  },
  auto: {
    level: 3,
    label: 'Autonomous',
    help: 'Heartbeat picks start runs immediately.',
  },
} as const;

export function AutonomyMeter({ autonomyLevel, showLabel = true }: {
  /** The roster entry's host-ext field; absent ⇒ `auto`. */
  autonomyLevel: 'auto' | 'guided' | 'review' | undefined;
  showLabel?: boolean;
}): JSX.Element {
  const meta = LEVELS[autonomyLevel === 'review' || autonomyLevel === 'guided' ? autonomyLevel : 'auto'];
  return (
    <span
      className="auto-meter"
      // role="img": this is a visual gauge (filled bars). A bare <span> may not
      // carry aria-label (aria-prohibited-attr); role=img makes it a named
      // graphic, so SRs announce "Autonomy: Autonomous" instead of the bars.
      role="img"
      title={`Autonomy: ${meta.label} — ${meta.help}`}
      aria-label={`Autonomy: ${meta.label}`}
    >
      <span className="auto-meter-bars" aria-hidden>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= meta.level ? 'is-filled' : ''} />
        ))}
      </span>
      {showLabel ? <span className="auto-meter-label" aria-hidden>{meta.label}</span> : null}
    </span>
  );
}
