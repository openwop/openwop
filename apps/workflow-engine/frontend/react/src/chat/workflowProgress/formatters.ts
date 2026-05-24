/**
 * Shared formatters for workflow_run UI. Single source so the chat
 * bubble and the right-side progress panel render identical strings.
 */

/** "<n>s" under a minute, "<m>m <s>s" beyond. Returns '' when the
 *  start time is in the future / malformed. */
export function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '';
  const secs = Math.floor(elapsedMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}
