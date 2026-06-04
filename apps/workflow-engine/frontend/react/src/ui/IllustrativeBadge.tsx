/**
 * "Illustrative" badge — the demo-honesty primitive (white-label PRD §9).
 *
 * Pin this on any panel whose numbers are SAMPLE data rather than derived
 * from the live stores (a trend chart the store can't produce, a mocked
 * integration tile), so a demo never lets fabricated data masquerade as real.
 * The stock app derives its surfaces from live stores and ships zero of
 * these; white-label forks add them wherever they stage sample content.
 */
export function IllustrativeBadge({ detail }: {
  /** Optional hover explanation, e.g. "Sample trend — not derived from your runs". */
  detail?: string;
}): JSX.Element {
  return (
    <span
      className="chip chip--muted illustrative-badge"
      title={detail ?? 'Illustrative sample data — not derived from live records'}
    >
      Illustrative
    </span>
  );
}
