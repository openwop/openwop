/**
 * feedbackClient — RFC 0056 (`capabilities.feedback` + run.annotated). Client
 * for the run annotation surface. RFC 0056 is `Active` and the reference host
 * advertises `capabilities.feedback.supported`, so the affordances light up
 * when the connected host does; `getFeedbackCapability()` returns null (and
 * every affordance stays inert) against a host that doesn't. See
 * plans/app-ux-enhancements.md Track C — gated on the capability handshake.
 */
import { WopError } from '@openwop/openwop';
import { client, getCapabilities } from './runsClient.js';

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
 *  `note` are secret-scrubbed server-side (SR-1) before they reach us.
 *
 *  Structurally identical to the SDK's `Annotation` (which the package does
 *  not re-export by name), so the values returned by `client.runs.*` below
 *  flow into this shape without a cast. Kept local so callers keep importing
 *  it from here. */
export interface Annotation {
  annotationId: string;
  target: { runId: string; eventId?: string; nodeId?: string };
  signal: AnnotationSignal;
  actor: { principalRef: string };
  note?: string;
  createdAt: string;
}

/** GET /v1/runs/{runId}/annotations (RFC 0056 §C) via `client.runs.listAnnotations`.
 *  Resolves to `[]` when the host doesn't advertise feedback (the SDK maps
 *  404/501 to `null`) so callers can aggregate across runs without a per-run
 *  try/catch. Throws only on unexpected failures. */
export async function listAnnotations(runId: string): Promise<Annotation[]> {
  try {
    const res = await client.runs.listAnnotations(runId);
    return res ? [...res] : []; // SDK returns a readonly array or null
  } catch {
    return []; // network/discovery unreachable — treat as no annotations
  }
}

/** POST /v1/runs/{runId}/annotations (RFC 0056 §C) via `client.runs.createAnnotation`.
 *  `runId` rides the path, so it's dropped from the request-body `target`. */
export async function recordAnnotation(runId: string, input: AnnotationInput): Promise<void> {
  try {
    await client.runs.createAnnotation(runId, {
      target: { eventId: input.target.eventId, nodeId: input.target.nodeId },
      signal: input.signal,
      note: input.note,
    });
  } catch (err) {
    // 501 capability_not_provided is the spec'd honest response when a host
    // doesn't advertise host.feedback; surface a readable message either way.
    if (err instanceof WopError && err.status === 501) {
      throw new Error('This host does not support feedback yet.');
    }
    const status = err instanceof WopError ? err.status : undefined;
    throw new Error(status ? `Feedback failed (${status})` : 'Feedback failed.');
  }
}
