/**
 * v2 — `lane-issuer-advertised` (suite 2.0.0; RFC 0170 §B.2–§B.4;
 * `spec/v2/core/identity.md` §2.1–§2.3; facet `spec/v2/facets/auth.schema.json`).
 *
 * Witness class: witnessable — unaided. Every member of `auth.lanes[]` MUST
 * name `lane`, `issuers[]` (min 1, the realm), `revocation` and
 * `minimumAssurance`; `revocationWindowSeconds` MUST accompany a rule that
 * names a window (`exp-and-recheck`, `short-lived`, `rebind`). A host that does
 * not advertise the `auth` family records `inapplicable`.
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §2.1';
const LANES = new Set(['api-key', 'oauth2', 'oidc', 'mtls', 'saml', 'scim', 'ldap', 'workload', 'session', 'anonymous']);
const REVOCATION = new Set(['next-request', 'exp-and-recheck', 'crl', 'ocsp', 'short-lived', 'not-on-or-after', 'bound-connection', 'rebind', 'delegation-expiry']);
const WINDOWED = new Set(['exp-and-recheck', 'short-lived', 'rebind']);
const ASSURANCE = new Set(['bearer', 'sender-constrained', 'key-bound']);
const PROOFS = new Set(['mtls-key-binding', 'dpop', 'svid-chain']);

async function lanes(): Promise<Array<Record<string, unknown>> | { reason: string }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const auth = await familyAdvertised('auth');
  if (auth === null) return { reason: 'the host does not advertise the `auth` family at the v2 root' };
  const arr = auth['lanes'];
  if (!Array.isArray(arr) || arr.length === 0) return { reason: 'FAIL-SHAPED: `auth` is advertised but `auth.lanes[]` is absent or empty (REQUIRED, minItems 1) — the capabilities-root-closed scenario fails the document' };
  return arr.filter((l): l is Record<string, unknown> => l !== null && typeof l === 'object');
}

describe('v2 lane-issuer-advertised (RFC 0170 §B.2–§B.4)', () => {
  it('every auth.lanes[] member names lane, issuers[], revocation and minimumAssurance', async () => {
    const ls = await lanes();
    if (!Array.isArray(ls)) return softSkip(ls.reason.startsWith('FAIL-SHAPED') ? 'blocked' : 'inapplicable', ls.reason);
    for (const l of ls) {
      const name = String(l['lane']);
      expect(LANES.has(name), req('openwop.requirement.0170.lane-issuer-advertised.members', DOC, `auth.lanes[].lane MUST be one of the ten lanes (got ${name})`)).toBe(true);
      const issuers = l['issuers'];
      expect(Array.isArray(issuers) && issuers.length > 0 && issuers.every((i) => typeof i === 'string' && i.length > 0), req('openwop.requirement.0170.lane-issuer-advertised.members', 'spec/v2/core/identity.md §2.2', `lane ${name} MUST advertise its trust root in issuers[] (min 1, non-empty strings)`)).toBe(true);
      expect(REVOCATION.has(String(l['revocation'])), req('openwop.requirement.0170.lane-issuer-advertised.members', 'spec/v2/core/identity.md §2.2', `lane ${name} MUST name its revocation rule`)).toBe(true);
      expect(ASSURANCE.has(String(l['minimumAssurance'])), req('openwop.requirement.0170.lane-issuer-advertised.members', 'spec/v2/core/identity.md §2.3', `lane ${name} MUST advertise minimumAssurance: bearer | sender-constrained | key-bound`)).toBe(true);
      if (l['delegationProofs'] !== undefined) {
        expect(Array.isArray(l['delegationProofs']) && (l['delegationProofs'] as unknown[]).every((p) => PROOFS.has(String(p))), req('openwop.requirement.0170.lane-issuer-advertised.members', 'spec/v2/core/identity.md §2.4', `lane ${name}: delegationProofs[] MUST be drawn from mtls-key-binding | dpop | svid-chain`)).toBe(true);
      }
    }
  });

  it('a windowed revocation rule advertises revocationWindowSeconds', async () => {
    const ls = await lanes();
    if (!Array.isArray(ls)) return softSkip(ls.reason.startsWith('FAIL-SHAPED') ? 'blocked' : 'inapplicable', ls.reason);
    const windowed = ls.filter((l) => WINDOWED.has(String(l['revocation'])));
    if (windowed.length === 0) return softSkip('inapplicable', 'no advertised lane uses a windowed revocation rule (exp-and-recheck | short-lived | rebind)');
    for (const l of windowed) {
      const w = l['revocationWindowSeconds'];
      expect(Number.isInteger(w) && (w as number) >= 1, req('openwop.requirement.0170.lane-issuer-advertised.window', 'spec/v2/core/identity.md §2.2', `lane ${String(l['lane'])} (revocation ${String(l['revocation'])}) MUST advertise revocationWindowSeconds (integer ≥ 1)`)).toBe(true);
    }
  });
});
