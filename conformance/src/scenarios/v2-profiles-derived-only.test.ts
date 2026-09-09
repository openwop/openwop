/**
 * v2 — `profiles-derived-only` (suite 2.0.0; RFC 0169 §C.1, §C.3;
 * `spec/v2/core/capabilities.md` §7 "Profiles").
 *
 * Witness class: witnessable — unaided. A profile is a predicate over the
 * declaration file, published in `spec/v2/profiles.json`; it is never a wire
 * field. The host's v2 document MUST NOT carry a root `profiles[]`, and every
 * profile in the registry MUST be derivable from the document alone: every
 * listed family present as a record and every listed metadata key present.
 * `profiles.json` is read from the spec tree beside `SCHEMAS_DIR`; under a
 * layout that does not ship it the derivation leg records `blocked`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2Discovery } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §7';
const PROFILES_PATH = join(SCHEMAS_DIR, '..', 'spec', 'v2', 'profiles.json');

interface ProfileRow { readonly id: string; readonly predicate: { readonly families?: readonly string[]; readonly metadata?: readonly string[] } }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>)['status'] === 'string';
}

/** RFC 0169 §C.1 — the predicate, evaluated over the document alone. */
function derive(doc: Record<string, unknown>, p: ProfileRow): boolean {
  const families = p.predicate.families ?? [];
  const metadata = p.predicate.metadata ?? [];
  return families.every((f) => isRecord(doc[f])) && metadata.every((m) => doc[m] !== undefined);
}

describe('v2 profiles-derived-only (RFC 0169 §C.1, §C.3)', () => {
  it('the v2 document carries no root `profiles[]`', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    expect('profiles' in doc, req('openwop.requirement.0169.profiles-derived-only.no-root-profiles', DOC, 'no `profiles[]` exists at the v2 root; a profile is a derived predicate, never a wire field (row C2.10)')).toBe(false);
  });

  it('every registry profile is derivable from the document; the discovery-core predicate holds on a valid document', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    if (!existsSync(PROFILES_PATH)) return softSkip('blocked', `spec/v2/profiles.json is not shipped in this layout (${PROFILES_PATH}) — the profile registry cannot be read`);
    const rows = (JSON.parse(readFileSync(PROFILES_PATH, 'utf8')) as { profiles?: ProfileRow[] }).profiles ?? [];
    expect(rows.length, req('openwop.requirement.0169.profiles-derived-only.derivable', DOC, 'spec/v2/profiles.json MUST list at least one profile')).toBeGreaterThan(0);
    for (const p of rows) {
      // Every listed family the host advertises MUST be a record — a profile
      // predicate over a non-record value (a boolean, a bare object) is not derivable.
      for (const f of p.predicate.families ?? []) {
        if (doc[f] !== undefined) {
          expect(isRecord(doc[f]), req('openwop.requirement.0169.profiles-derived-only.derivable', DOC, `profile ${p.id} lists family ${f}; the host advertises it, so it MUST be one capability record {status, since, witness, …}`)).toBe(true);
        }
      }
      expect(typeof derive(doc, p), req('openwop.requirement.0169.profiles-derived-only.derivable', DOC, `profile ${p.id} MUST be decidable from the document alone`)).toBe('boolean');
    }
    const core = rows.find((p) => p.id === 'openwop-discovery-core');
    if (core !== undefined) {
      expect(derive(doc, core), req('openwop.requirement.0169.profiles-derived-only.derivable', DOC, 'openwop-discovery-core (metadata protocolVersions + preferredVersion, both REQUIRED at the root) MUST derive true from every valid v2 document')).toBe(true);
    }
  });
});
