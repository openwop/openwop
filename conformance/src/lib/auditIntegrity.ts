/**
 * The audit-log-integrity advertisement, resolved for the target major.
 *
 *   major 1  `capabilities.auth.profiles[]` names `openwop-audit-log-integrity`
 *            and `capabilities.auth.auditLogIntegrity` carries the facets
 *            (spec/v1/auth-profiles.md §"Audit-log integrity").
 *   major 2  the `auditLogIntegrity` family record is present at the v2 root
 *            (RFC 0224; spec/v2/core/security-defaults.md §Audit-log integrity).
 *            Presence is the claim, so there is no `hashChain` seat.
 *
 * `auditVerifyPath()` is `/v1/audit/verify` at major 1 and `/audit/verify` at
 * major 2, so a scenario never reports a suite 404 as a host defect.
 */
import { driver } from './driver.js';
import { capabilityFamily } from './discovery-capabilities.js';
import { targetMajor } from './seams.js';
import { familyAdvertised } from './v2.js';

export const AUDIT_PROFILE = 'openwop-audit-log-integrity';

export interface AuditIntegrityCaps {
  hashChain?: boolean;
  checkpointSignatureAlgorithm?: string;
  checkpointPublicKey?: string;
  checkpointIntervalEntries?: number;
  checkpointIntervalSeconds?: number;
}

/** The advertised facets, or null when the host makes no audit-log-integrity claim at the target major. */
export async function auditIntegrityAdvert(): Promise<AuditIntegrityCaps | null> {
  if (targetMajor() === 2) return (await familyAdvertised('auditLogIntegrity')) as AuditIntegrityCaps | null;
  const disco = await driver.get('/.well-known/openwop');
  const auth = capabilityFamily<{ profiles?: string[]; auditLogIntegrity?: AuditIntegrityCaps }>(disco.json, 'auth') ?? {};
  if (!(Array.isArray(auth.profiles) && auth.profiles.includes(AUDIT_PROFILE))) return null;
  return auth.auditLogIntegrity ?? {};
}

/** Where the claim lives at the target major, for skip reasons and failure messages. */
export function auditClaimName(): string {
  return targetMajor() === 2 ? 'the auditLogIntegrity family' : AUDIT_PROFILE;
}

export function auditVerifyPath(fromSeq: number, toSeq: number): string {
  return `${targetMajor() === 2 ? '' : '/v1'}/audit/verify?fromSeq=${fromSeq}&toSeq=${toSeq}`;
}
