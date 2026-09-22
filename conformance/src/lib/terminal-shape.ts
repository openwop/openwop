/**
 * RFC 0194 §A — the shape a run's log must have around its terminal event.
 *
 * Exactly one terminal run event, and after it no forward execution: no second
 * terminal event, no run.started / run.resumed / run.resume-started /
 * run.paused / run.restored-from-snapshot, no node.* and no interrupt.*.
 * `compensation.*` and `run.dead-lettered` MAY follow (a compensating host
 * unwinds after a cancelled parent — compensation.md §"Cancellation of the
 * parent"); vendor-prefixed types are not constrained.
 *
 * Pure, so a scenario can add a leg under RFC 0194's ids cheaply, and so the
 * rule is pinned without a host.
 */
export const TERMINAL_RUN_EVENTS: ReadonlySet<string> = new Set(['run.completed', 'run.failed', 'run.cancelled']);
const FORWARD_RUN_EVENTS: ReadonlySet<string> = new Set(['run.started', 'run.resumed', 'run.resume-started', 'run.paused', 'run.restored-from-snapshot']);

/** The first violation of §A.1–§A.2 in `types` (log order), or null when the shape holds. */
export function terminalShapeViolation(types: readonly string[]): string | null {
  const terminals = types.map((t, i) => [t, i] as const).filter(([t]) => TERMINAL_RUN_EVENTS.has(t));
  if (terminals.length === 0) return 'the log carries no terminal run event (run.completed / run.failed / run.cancelled)';
  if (terminals.length > 1) return `the log carries ${terminals.length} terminal run events (${terminals.map(([t, i]) => `${t}@${i}`).join(', ')}) — exactly one is allowed`;
  const at = terminals[0]![1];
  for (let i = at + 1; i < types.length; i++) {
    const t = types[i]!;
    if (FORWARD_RUN_EVENTS.has(t) || t.startsWith('node.') || t.startsWith('interrupt.')) {
      return `${t} at index ${i} follows the terminal event ${types[at]} at index ${at} — only compensation.* and run.dead-lettered may`;
    }
  }
  return null;
}
