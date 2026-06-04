/**
 * Autonomy meter (agents-workforce redesign PR 3) — the prototype's 3-bar
 * Supervised / Guided / Autonomous scale, mapped onto the REAL backend field
 * (architect delta): `autonomyLevel` is the host-extension binary
 * `'review' | 'auto'`, so today only two positions are reachable —
 *   review → level 1 · Supervised ("agents propose, humans dispose")
 *   auto   → level 3 · Autonomous (heartbeat picks start runs immediately)
 * The middle bar (Guided) is RESERVED until a backend level with defined
 * semantics exists; this component never fabricates it.
 */

const LEVELS = {
  review: {
    level: 1,
    label: 'Supervised',
    help: 'Proposes for review — heartbeat picks queue as proposals for human sign-off (agents propose, humans dispose).',
  },
  auto: {
    level: 3,
    label: 'Autonomous',
    help: 'Heartbeat picks start runs immediately.',
  },
} as const;

export function AutonomyMeter({ autonomyLevel, showLabel = true }: {
  /** The roster entry's host-ext field; absent ⇒ `auto`. */
  autonomyLevel: 'auto' | 'review' | undefined;
  showLabel?: boolean;
}): JSX.Element {
  const meta = LEVELS[autonomyLevel === 'review' ? 'review' : 'auto'];
  return (
    <span
      className="auto-meter"
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
