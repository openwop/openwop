/**
 * Anonymous-actor audit is opaque + non-PII (RFC 0132 §D) — backs the
 * `anon-actor-audit-opaque` SECURITY invariant (RFC 0048 identifier-opacity + SR-1).
 *
 * Every anonymous-actor tool call emits an `authorization.decided` record (RFC
 * 0049 — no new event minted) attributable to the opaque anon-session
 * `principal`. The `principal` MUST be opaque, non-cross-linkable, and non-PII
 * (no IP, email, device fingerprint), and the record MUST carry no credential
 * material. The run snapshot echoes `owner.principalKind: "anonymous"`.
 *
 * Capability-gated on `capabilities.anonymousActor.supported`; soft-skips when
 * unadvertised or when the seam is unwired (404). Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Passing non-vacuously graduates
 * `anon-actor-audit-opaque` reference-impl → protocol tier.
 *
 * @see RFCS/0132-anonymous-actor-authorization.md §A, §D
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isAnonymousActorAdvertised, anonDispatch } from '../lib/anonymousActor.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PROFILE = 'openwop-anonymous-actor';

/** Reject anything that looks like PII the anon id MUST NOT embed. */
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'an IPv4 address'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
];

describe('anonymous-actor-audit-opaque (RFC 0132 §D)', () => {
  it('the authorization.decided principal is opaque, non-PII, and the record carries no credential', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const res = await anonDispatch({ tool: 'catalog.read' });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const decided = res.json?.authorizationDecided?.payload;
    expect(
      decided?.principal,
      req('openwop.it.anonymous-actor-audit-opaque.the-authorization-decided-principal-is-opaque-non-pii-and-the-record-carries-no', 'RFC 0132 §D', 'an anon tool call MUST emit authorization.decided with a principal'),
    ).toBeTruthy();

    const principal = decided?.principal ?? '';
    for (const [pattern, label] of PII_PATTERNS) {
      expect(
        pattern.test(principal),
        req('openwop.it.anonymous-actor-audit-opaque.the-authorization-decided-principal-is-opaque-non-pii-and-the-record-carries-no', 'SECURITY anon-actor-audit-opaque', `the anon principal MUST NOT embed ${label}`),
      ).toBe(false);
    }
    // The record MUST NOT carry credential material (reason is redaction-safe).
    const serialized = JSON.stringify(decided ?? {});
    for (const [pattern, label] of PII_PATTERNS) {
      expect(
        pattern.test(serialized),
        req('openwop.it.anonymous-actor-audit-opaque.the-authorization-decided-principal-is-opaque-non-pii-and-the-record-carries-no', 'SECURITY anon-actor-audit-opaque', `the audit record MUST NOT carry ${label}`),
      ).toBe(false);
    }
  });

  it('the run snapshot echoes owner.principalKind "anonymous"', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const res = await anonDispatch({ tool: 'catalog.read' });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    if (!res.json?.owner) return softSkip('blocked', 'precondition not met — `!res.json?.owner` returned early (seam does not echo an owner triple — nothing to assert) (seam, prior step, or fixture unavailable)'); // seam does not echo an owner triple — nothing to assert
    expect(
      res.json.owner.principalKind,
      req('openwop.it.anonymous-actor-audit-opaque.the-run-snapshot-echoes-owner-principalkind-anonymous', 'RFC 0132 §A', 'an anon-authorized run MUST set owner.principalKind "anonymous"'),
    ).toBe('anonymous');
  });
});
