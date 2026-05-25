/**
 * feedbackClient — RFC 0056 (`capabilities.feedback` + run.annotated). Client
 * for the run annotation surface. RFC 0056 is `Active` and the reference host
 * advertises `capabilities.feedback.supported`, so the affordances light up
 * when the connected host does; `getFeedbackCapability()` returns null (and
 * every affordance stays inert) against a host that doesn't. See
 * plans/app-ux-enhancements.md Track C — gated on the capability handshake.
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
    const fb: unknown = caps.feedback;
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

/** Full annotation as returned by GET /v1/runs/{runId}/annotations (RFC 0056).
 *  The host assigns annotationId/actor/createdAt; `signal.correction` and
 *  `note` are secret-scrubbed server-side (SR-1) before they reach us. */
export interface Annotation {
  annotationId: string;
  target: { runId: string; eventId?: string; nodeId?: string };
  signal: AnnotationSignal;
  actor: { principalRef: string };
  note?: string;
  createdAt: string;
}

/** GET /v1/runs/{runId}/annotations (RFC 0056 §C). Resolves to `[]` when the
 *  host doesn't advertise feedback (404/501) so callers can aggregate across
 *  runs without a per-run try/catch. Throws only on unexpected failures. */
export async function listAnnotations(runId: string): Promise<Annotation[]> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/annotations`, {
      headers: { ...authedHeaders() },
      credentials: config.authMode === 'cookie' ? 'include' : 'same-origin',
    });
  } catch {
    return []; // network/discovery unreachable — treat as no annotations
  }
  if (res.status === 404 || res.status === 501) return [];
  if (!res.ok) throw new Error(`Failed to list annotations (${res.status})`);
  const body = (await res.json()) as { annotations?: Annotation[] };
  return Array.isArray(body.annotations) ? body.annotations : [];
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
    throw new Error(res.status === 501 ? 'This host does not support feedback yet.' : `Feedback failed (${res.status})`);
  }
}
