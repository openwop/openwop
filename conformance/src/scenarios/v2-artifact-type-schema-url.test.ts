/**
 * v2 — the canonical schema URL of a host-registered artifact type
 * (`spec/v2/core/artifact-type-packs.md` §Schema distribution; RFCs 0071, 0075,
 * 0145). NEW at v2, unaided: no seam and no fixture.
 *
 * "A host advertising `artifactTypes` SHOULD serve each installed type's schema
 * there, and MUST for a host-registered type whose `schemaVersion` it
 * advertises." The MUST set is read from discovery: each
 * `artifactTypes.types[id]` with `registrationSource: "host"` and a
 * `schemaVersion`. For each, `GET /schemas/artifacts/{id}.schema.json` answers
 * `200`, `Content-Type: application/schema+json`, and a schema whose `$id` is
 * that canonical URL. Pack-backed types are a SHOULD and are not asserted.
 *
 * Dispositions: `artifactTypes` not advertised, or no host-registered type with
 * a `schemaVersion` ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/artifact-schema-url-witness.test.ts`.
 *
 * @see spec/v2/core/artifact-type-packs.md §Schema distribution
 * @see schemas/v2/capabilities.schema.json §artifactTypes.types.registrationSource
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { driveSchemaUrls, judgeSchemaUrl } from '../lib/artifact-schema-url-witness.js';

const PROFILE = majorProfile(2);
const ID_SERVED = 'openwop.requirement.artifact-types.host-registered-schema-served';

describe('v2 artifact types: the canonical schema URL (artifact-type-packs.md §Schema distribution)', () => {
  it('every host-registered type with an advertised schemaVersion has its schema served at {HostBase}/schemas/artifacts/{id}.schema.json', async () => {
    if (!process.env['OPENWOP_BASE_URL']) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('artifactTypes'))) return softSkip('inapplicable', 'the host does not advertise artifactTypes');
    const o = await driveSchemaUrls(PROFILE, doc);
    if (!Array.isArray(o)) return softSkip(o.disposition, o.reason);
    for (const x of o.flatMap(judgeSchemaUrl)) expect(x.ok, req(ID_SERVED, x.doc, x.message)).toBe(true);
  }, 120_000);
});
