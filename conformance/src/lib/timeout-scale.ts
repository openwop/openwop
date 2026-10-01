/**
 * The `OPENWOP_POLL_TIMEOUT_SCALE` knob, in its own module so `driver.ts` can
 * scale its request bound without importing `polling.ts` (which imports the
 * driver). `polling.ts` re-exports `scaledTimeoutMs`; its docstring explains
 * the knob.
 */

/**
 * Multiplier applied to every poll bound (see the module docstring). Invalid,
 * non-positive, or non-finite values fall back to `1` rather than silently
 * producing a zero or negative deadline — a mis-set knob must not turn every
 * poll into an instant failure that looks like a host defect.
 */
function pollTimeoutScale(): number {
  const raw = process.env.OPENWOP_POLL_TIMEOUT_SCALE;
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Apply the scale to a bound, rounding up so a scale of 1 is exactly a no-op. */
export function scaledTimeoutMs(timeoutMs: number): number {
  const scale = pollTimeoutScale();
  return scale === 1 ? timeoutMs : Math.ceil(timeoutMs * scale);
}
