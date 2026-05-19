/**
 * Capability-toggle harness primitive — driver helper for the
 * env-gated test-seam endpoint at
 * `POST /v1/host/sample/test/capability-toggle`.
 *
 * Lets refusal-case scenarios (RFC 0022 §C HVMAP-1a-refusal,
 * HVMAP-2-refusal, etc.) flip a capability flag off temporarily,
 * exercise the host's refusal path, then restore the default.
 *
 * All operations soft-skip on HTTP 404 — hosts that don't expose the
 * seam keep the existing advertisement-shape coverage intact.
 *
 * Reset semantics: callers MUST `resetHostCapabilities()` in their
 * test's `afterEach` (or equivalent) to keep state from leaking
 * across scenarios.
 */

import { driver } from './driver.js';

export type ToggleOutcome =
  | { ok: true; overlay: Record<string, boolean> }
  | { ok: false; reason: 'seam_unavailable' }
  | { ok: false; reason: 'http_error'; status: number };

/** Set a capability flag's overlay value. `value: null` removes the
 *  overlay entry (restoring the host's hard-coded default). */
export async function setHostCapability(
  name: string,
  value: boolean | null,
): Promise<ToggleOutcome> {
  const res = await driver.post('/v1/host/sample/test/capability-toggle', { name, value });
  if (res.status === 404) return { ok: false, reason: 'seam_unavailable' };
  if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };
  const body = res.json as { overlay?: Record<string, boolean> };
  return { ok: true, overlay: body.overlay ?? {} };
}

/** Clear ALL capability overlay entries on the host. */
export async function resetHostCapabilities(): Promise<ToggleOutcome> {
  const res = await driver.post('/v1/host/sample/test/capability-toggle', { reset: true });
  if (res.status === 404) return { ok: false, reason: 'seam_unavailable' };
  if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };
  const body = res.json as { overlay?: Record<string, boolean> };
  return { ok: true, overlay: body.overlay ?? {} };
}

/** Probe whether the host exposes the capability-toggle seam at all.
 *  Use this to soft-skip a scenario early when the host lacks the
 *  toggle (the refusal contract is still spec-normative; the test just
 *  can't drive it from outside). */
export async function isToggleAvailable(): Promise<boolean> {
  const probe = await setHostCapability('__probe__', null);
  return probe.ok;
}
