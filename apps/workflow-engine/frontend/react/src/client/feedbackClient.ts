/**
 * feedbackClient — RFC 0056 (`host.feedback` + run.annotated). Client for
 * the proposed annotation surface. The reference host does NOT implement
 * RFC 0056 yet (it's Draft), so `getFeedbackCapability()` returns null and
 * every feedback affordance stays inert until a host advertises
 * `capabilities.feedback.supported`. See plans/app-ux-enhancements.md
 * Track C — built behind a capability gate against the proposed shape.
 */
import { authedHeaders, config } from './config.js';
import { getCapabilities } from './runsClient.js';

export interface FeedbackCapability {
  supported: boolean;
  targets?: readonly string[];
  signals?: readonly string[];
}

/** Returns the advertised `host.feedback` block, or null when the host
 *  doesn't support it (the common case until RFC 0056 lands). */
export async function getFeedbackCapability(): Promise<FeedbackCapability | null> {
  try {
    const caps = await getCapabilities();
    const fb = (caps as Record<string, unknown>).feedback;
    if (fb && typeof fb === 'object' && (fb as { supported?: unknown }).supported === true) {
      return fb as FeedbackCapability;
    }
  } catch {
    /* discovery unreachable — treat as unsupported */
  }
  return null;
}

export type AnnotationSignal =
  | { kind: 'rating'; rating: number }
  | { kind: 'flag' }
  | { kind: 'label'; label: string }
  | { kind: 'correction'; correction: string };

export interface AnnotationInput {
  target: { runId: string; eventId?: string; nodeId?: string };
  signal: AnnotationSignal;
  note?: string;
}

/** POST /v1/runs/{runId}/annotations (RFC 0056 §C). */
export async function recordAnnotation(runId: string, input: AnnotationInput): Promise<void> {
  const res = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authedHeaders() },
    credentials: config.authMode === 'cookie' ? 'include' : 'same-origin',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // 501 capability_not_provided is the spec'd honest response when a host
    // doesn't advertise host.feedback; surface a readable message either way.
    throw new Error(res.status === 501 ? 'Host does not support feedback (RFC 0056)' : `Feedback failed (${res.status})`);
  }
}
