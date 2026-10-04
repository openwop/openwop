/**
 * v2 — the `uiPlugins` advertisement (`spec/v2/core/packs.md` §Front-end plugin packs): the front-end plugin pack claim. The v1 twin is
 * `frontend-plugin-packs`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   isolation-model uiPlugins.isolation is a closed mechanism or an x-host value;
 *   surfaces-closed uiPlugins.surfaces are unique members of the closed surface set;
 *   host-api-closed uiPlugins.hostApi are unique members of the ui-plugin/1 method set;
 *   max-entry-bytes uiPlugins.maxEntryBytes is a positive integer;
 *
 * Not here: isolation, egress, the RPC allow-list and the no-BYOK rule are seam-gated and v2 mounts no plugin seam; they need a normative observation path (TODO §8).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `uiPlugins` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/packs.md §Front-end plugin packs
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg, uiPluginsHostApiLeg, uiPluginsIsolationLeg, uiPluginsMaxEntryBytesLeg, uiPluginsSurfacesLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'packs.md §Front-end plugin packs';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.ui-plugins.advert-record-schema';
const ID_ISOLATION_MODEL = 'openwop.requirement.ui-plugins.isolation-model';
const ID_SURFACES_CLOSED = 'openwop.requirement.ui-plugins.surfaces-closed';
const ID_HOST_API_CLOSED = 'openwop.requirement.ui-plugins.host-api-closed';
const ID_MAX_ENTRY_BYTES = 'openwop.requirement.ui-plugins.max-entry-bytes';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 uiPlugins advertisement (packs.md §Front-end plugin packs)', () => {
  it('the uiPlugins record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('uiPlugins'))) return softSkip('inapplicable', 'the host does not advertise uiPlugins');
    const out = recordSchemaLeg(PROFILE, doc, 'uiPlugins', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('uiPlugins.isolation is a closed mechanism or an x-host value', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('uiPlugins'))) return softSkip('inapplicable', 'the host does not advertise uiPlugins');
    const out = uiPluginsIsolationLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ISOLATION_MODEL, x.doc, x.message)).toBe(true);
  });

  it('uiPlugins.surfaces are unique members of the closed surface set', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('uiPlugins'))) return softSkip('inapplicable', 'the host does not advertise uiPlugins');
    const out = uiPluginsSurfacesLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SURFACES_CLOSED, x.doc, x.message)).toBe(true);
  });

  it('uiPlugins.hostApi are unique members of the ui-plugin/1 method set', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('uiPlugins'))) return softSkip('inapplicable', 'the host does not advertise uiPlugins');
    const out = uiPluginsHostApiLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_HOST_API_CLOSED, x.doc, x.message)).toBe(true);
  });

  it('uiPlugins.maxEntryBytes is a positive integer', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('uiPlugins'))) return softSkip('inapplicable', 'the host does not advertise uiPlugins');
    const out = uiPluginsMaxEntryBytesLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_MAX_ENTRY_BYTES, x.doc, x.message)).toBe(true);
  });
});
