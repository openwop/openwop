/**
 * v2 — `lane-issuer-advertised` (suite 2.0.0; RFC 0170 §B.2–§B.4;
 * `spec/v2/core/identity.md` §2.1–§2.3; facet `spec/v2/facets/auth.schema.json`).
 *
 * Witness class: witnessable — unaided. Every member of `auth.lanes[]` MUST
 * name `lane`, `issuers[]` (min 1, the realm), `revocation` and
 * `minimumAssurance`; `revocationWindowSeconds` MUST accompany a rule that
 * names a window (`exp-and-recheck`, `exp-only`, `short-lived`, `rebind`). A host that does
 * not advertise the `auth` family records `inapplicable`.
 *
 * Third leg (suite 2.36.0): a lane advertises only a revocation rule that
 * `identity.md` §2.2's row FOR THAT LANE lists. §2.2 has stated the per-lane
 * rule since RFC 0170 §B.3, and until now nothing measured it: the facet schema
 * relates `revocation` to `lane` nowhere, and the two legs above check only
 * enum membership and window presence. So any of the nine values passed on any
 * of the ten lanes, which is how `short-lived` — a rule §2.2 defines only for
 * `mtls`, as an obligation on the CREDENTIAL ISSUER — came to be advertised on
 * an `oidc` lane by a host that performs no revocation re-check at all.
 *
 * `LANE_RULES` below is the §2.2 table, transcribed. It is not a second
 * declaration: `scripts/check-lane-revocation-rules.mjs` parses the table out
 * of `spec/v2/core/identity.md` and fails when this map, the table and the
 * facet schema's `revocation` enum disagree. `anonymous` is `null` — its §2.2
 * row's revocation cell is `—` while the facet schema REQUIRES the field, so
 * the table names no legal value for it; the leg exempts that one lane and
 * says so in its message rather than inventing a rule (RFC 0210 register G1).
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §2.1';
const LANES = new Set(['api-key', 'oauth2', 'oidc', 'mtls', 'saml', 'scim', 'ldap', 'workload', 'session', 'anonymous']);
const REVOCATION = new Set(['next-request', 'exp-and-recheck', 'exp-only', 'crl', 'ocsp', 'short-lived', 'not-on-or-after', 'bound-connection', 'rebind', 'delegation-expiry']);
const WINDOWED = new Set(['exp-and-recheck', 'exp-only', 'short-lived', 'rebind']);
const ASSURANCE = new Set(['bearer', 'sender-constrained', 'key-bound']);
const PROOFS = new Set(['mtls-key-binding', 'dpop', 'svid-chain']);

// LANE_RULES — `spec/v2/core/identity.md` §2.2, `revocation` column, one entry
// per lane. `null` means the table names no rule for that lane. Parsed by
// scripts/check-lane-revocation-rules.mjs; keep the literal shape.
const LANE_RULES: Record<string, string[] | null> = {
  'api-key': ['next-request'],
  'oauth2': ['exp-and-recheck', 'exp-only'],
  'oidc': ['exp-and-recheck', 'exp-only'],
  'mtls': ['crl', 'ocsp', 'short-lived'],
  'saml': ['not-on-or-after'],
  'scim': ['bound-connection'],
  'ldap': ['rebind'],
  'workload': ['delegation-expiry'],
  'session': ['next-request'],
  'anonymous': null,
};

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
      // identity.md §2.2: a lane whose row reads "—" (`anonymous`) has no
      // revocation rule, so it MAY omit `revocation` — the schema made it
      // optional there in 2.38.0 (openwop#1540), and until 2.39.1 this leg
      // still demanded it, failing a host that followed the schema and the
      // prose (measured on openwop-app). If such a lane does advertise one,
      // it must still be a known member. Every other lane MUST name its rule.
      if (!(LANE_RULES[name] === null && l['revocation'] === undefined)) {
        expect(REVOCATION.has(String(l['revocation'])), req('openwop.requirement.0170.lane-issuer-advertised.members', 'spec/v2/core/identity.md §2.2', `lane ${name} MUST name its revocation rule`)).toBe(true);
      }
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

  it('a lane advertises only a revocation rule its identity.md §2.2 row lists', async () => {
    const ls = await lanes();
    if (!Array.isArray(ls)) return softSkip(ls.reason.startsWith('FAIL-SHAPED') ? 'blocked' : 'inapplicable', ls.reason);
    // Only lanes the table constrains are measured. `anonymous` is exempt
    // because §2.2 names no rule for it at all (RFC 0210 register G1), not
    // because any value is acceptable there.
    const bound = ls.filter((l) => LANE_RULES[String(l['lane'])] != null);
    if (bound.length === 0) return softSkip('inapplicable', `no advertised lane has a revocation rule stated in identity.md §2.2 (advertised: ${ls.map((l) => String(l['lane'])).join(', ') || 'none'}; the anonymous lane is exempt, its §2.2 revocation cell is "—")`);
    for (const l of bound) {
      const name = String(l['lane']);
      const rule = String(l['revocation']);
      const allowed = LANE_RULES[name] as string[];
      expect(allowed.includes(rule), req('openwop.requirement.0170.lane-issuer-advertised.lane-rule', 'spec/v2/core/identity.md §2.2', `lane ${name} advertises revocation "${rule}", which §2.2's row for that lane does not list (it lists ${allowed.map((r) => `"${r}"`).join(' | ')}) — a host MUST NOT advertise a revocation rule its lane's row does not name`)).toBe(true);
    }
  });
});
