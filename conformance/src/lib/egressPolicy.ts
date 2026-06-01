/**
 * Shared helpers for the RFC 0079 `httpClient.egressPolicy` conformance
 * scenarios. Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/egressPolicy.js`.
 *
 * Egress policy is a BEHAVIOR layered over the RFC 0076 `safeFetch` — there is
 * no new normative read endpoint. The behavior is driven through the
 * host-sample egress-decision seam (`POST /v1/host/sample/egress/decide`): a
 * host-issued credential carries `audiences[]` (RFC 0079 §A provenance), and an
 * egress whose destination is OUTSIDE those audiences MUST emit
 * `egress.decided { decision: "denied"|"downgraded", reason: "out-of-audience" }`
 * and MUST NOT attach the credential (the §C confused-deputy MUST, backing the
 * `egress-credential-audience-bound` invariant). A provenance-unevaluable egress
 * MUST be `denied { reason: "provenance-unevaluable" }` — fail-closed. The seam
 * is OPTIONAL — scenarios soft-skip on 404/405.
 *
 * Gating uses the `httpClient.egressPolicy.supported` capability flag from the
 * live discovery doc (root-first per RFC 0073).
 *
 * @see RFCS/0079-credential-provenance-and-egress-policy.md
 * @see spec/v1/host-capabilities.md (§"Credential provenance + egress policy")
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `httpClient.egressPolicy` from discovery (root-first per RFC 0073);
 *  null when unadvertised. */
export async function readEgressPolicyCap(): Promise<Record<string, unknown> | null> {
  const http = await readCapabilityFamily<{ egressPolicy?: unknown }>('httpClient');
  const ep = http?.egressPolicy;
  return ep && typeof ep === 'object' ? (ep as Record<string, unknown>) : null;
}

export interface EgressDecision {
  decision?: string;
  reason?: string;
  destination?: string;
  /** Whether the host-issued credential was attached to the egress (§C — MUST
   *  be false for an out-of-audience / unevaluable decision). */
  credentialAttached?: boolean;
  /** Set when the seam ran a canary credential and the canary leaked into any
   *  observable surface (the SR-1 negative — MUST stay false/absent). */
  canaryLeaked?: boolean;
  runId?: string;
  [k: string]: unknown;
}

/**
 * Drive one egress decision through the host-sample seam (RFC 0079 §C).
 * `scenario`:
 *   - `out-of-audience`        — credential bound to audience A, egress to B;
 *                                MUST deny/downgrade + NOT attach the credential.
 *   - `provenance-unevaluable` — egress whose provenance can't be evaluated;
 *                                MUST deny fail-closed.
 *   - `in-audience`            — control: egress within audience; MAY allow.
 *   - `canary`                 — seed a credential whose value is a known canary
 *                                and assert it never appears on the wire (SR-1).
 * Returns null when the seam is unwired (404/405).
 */
export async function driveEgress(
  body: { scenario: 'out-of-audience' | 'provenance-unevaluable' | 'in-audience' | 'canary' },
): Promise<EgressDecision | null> {
  const res = await driver.post('/v1/host/sample/egress/decide', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as EgressDecision | undefined) ?? {};
}

/** The closed egress-decision vocabulary (RFC 0079 §B). */
export const EGRESS_DECISIONS = ['allowed', 'denied', 'downgraded', 'approval-required'];
/** The closed egress-reason vocabulary (RFC 0079 §B — a CLOSED enum so a host
 *  cannot spill a blocked URL/host/header into a free-form reason). */
export const EGRESS_REASONS = ['ok', 'out-of-audience', 'expired', 'ssrf-blocked', 'provenance-unevaluable', 'scope-denied', 'policy-denied'];
/** Content keys an `egress.decided` payload / provenance descriptor MUST NEVER
 *  carry (SR-1 / `egress-decision-no-secret-leak`): no secret value, no blocked
 *  URL/header spill. */
export const EGRESS_CONTENT_FORBIDDEN = ['secret', 'credential', 'credentials', 'token', 'apiKey', 'password', 'url', 'header', 'headers', 'body'];
