/**
 * Pack-manifest vendor extensions — RFC 0138.
 *
 * `host-extensions.md` §"Vendor-prefixed namespaces" carries a normative MUST:
 * *"A client receiving an unknown vendor-prefixed field MUST treat it as
 * opaque."* Every pack manifest, however, set `additionalProperties: false`
 * with no pattern escape — so a vendor-prefixed field could not legally exist
 * on a pack manifest at all. **The corpus mandated a behavior for a case it
 * structurally forbade**, and a host with a working extension had to choose
 * between shipping it and publishing a conformant pack. RFC 0138 adds an
 * `^(x-|vendor\.)` escape hatch on each manifest root and each kind's per-item
 * entry object.
 *
 * Always-on + server-free. Three parts:
 *
 *   PART 1 — every pack manifest admits the hatch, INCLUDING the registry
 *   publication contract. Without the hatch on `registry-version-manifest`, a
 *   pack carrying a root-level extension validates against its source manifest
 *   and is then rejected at registry `PUT` — the same split-brain, one layer
 *   down. Enumerated by an explicit in-scope count, not a naming glob, so a new
 *   pack kind that forgets the hatch fails rather than being skipped.
 *
 *   PART 2 — the hatch is NARROW. A misspelled canonical field
 *   (`dispalyName`) is still rejected. This is the regression guard that keeps
 *   `additionalProperties: false` doing its real job: the hatch admits
 *   DECLARED extensions, not arbitrary keys. A change that widened the pattern
 *   to `^.*` would pass PART 1 and fail here.
 *
 *   PART 3 — the corpus states the opacity + trust rules normatively. The
 *   schema alone cannot express "MUST ignore"; without the prose the hatch is
 *   just a hole. Guards the `pack-manifest-extension-opaque` invariant text.
 *
 * @see spec/v1/node-packs.md §"Vendor extensions on pack manifests"
 * @see spec/v1/host-extensions.md §"Vendor-prefixed namespaces"
 * @see RFCS/0138-pack-manifest-vendor-extensions.md
 * @see SECURITY/invariants.yaml `pack-manifest-extension-opaque`
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

/** The canonical hatch pattern. Kept as a literal so a drift in any schema is caught. */
const HATCH = '^(x-|vendor\\.)';

/**
 * Manifest schemas RFC 0138 deliberately does NOT cover. Anything else matching
 * `*manifest*.schema.json` MUST carry the hatch — so a new pack kind is caught
 * rather than silently omitted.
 *
 * The first draft of this file globbed `*-pack-manifest.schema.json`, which
 * silently skipped `frontend-plugin-manifest.schema.json` (RFC 0117,
 * `kind: "frontend-plugin"`) purely because it does not carry `-pack-` in its
 * name. Enumerating by naming convention is how a coverage hole hides; the
 * exclusions below are a stated list, not an accident of a glob.
 */
const OUT_OF_SCOPE: Record<string, string> = {
  // Not pack-manifest structure — their own contracts with their own
  // compatibility surface. Stated in node-packs.md §Vendor extensions.
  'agent-manifest.schema.json': "a node pack's agents[] entries — separate contract",
};

const manifestFiles = readdirSync(SCHEMAS_DIR)
  .filter((f) => f.includes('manifest') && f.endsWith('.schema.json'))
  .filter((f) => !(f in OUT_OF_SCOPE))
  .sort();

const load = (f: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8'));

/** Walks a schema and returns every object node that declares `additionalProperties: false`. */
function closedObjects(root: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  (function walk(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o['additionalProperties'] === false) out.push(o);
    for (const k of Object.keys(o)) walk(o[k]);
  })(root);
  return out;
}

describe('pack-manifest-extensions: every manifest admits the hatch (RFC 0138, server-free)', () => {
  it('every pack kind is covered — the enumeration is not a naming-convention glob', () => {
    // 8 source manifests (node, workflow-chain, prompt, artifact-type, card,
    // connection, form-content, frontend-plugin) + the registry publication contract.
    expect(
      manifestFiles.length,
      why('RFC 0138', `expected 9 in-scope manifests, found ${manifestFiles.length}: ${manifestFiles.join(', ')}. A new pack kind MUST be added here, or listed in OUT_OF_SCOPE with a reason.`),
    ).toBe(9);
  });

  for (const f of manifestFiles) {
    it(`${f.replace(/-?(pack-)?manifest\.schema\.json$/, '')} — manifest ROOT carries the extension hatch`, () => {
      const s = load(f);
      const pp = s['patternProperties'] as Record<string, unknown> | undefined;
      expect(
        pp !== undefined && Object.keys(pp).includes(HATCH),
        why('node-packs.md §Vendor extensions on pack manifests', `${f} root MUST admit ^(x-|vendor\\.) so the host-extensions.md opacity MUST is satisfiable`),
      ).toBe(true);
    });
  }
});

describe('pack-manifest-extensions: the hatch is NARROW — typos still rejected (RFC 0138)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  // artifact-type is the motivating kind (a real host carried `x-openwop-app.canvas`
  // on an artifactTypes[] entry and could not publish the pack).
  const validate = ajv.compile(load('artifact-type-pack-manifest.schema.json'));
  const pack = (extra: Record<string, unknown>): Record<string, unknown> => ({
    name: 'community.openwop.canvas-checklist',
    version: '1.0.0',
    kind: 'artifact-type',
    engines: { openwop: '>=1.1.0 <2.0.0' },
    artifactTypes: [
      { artifactTypeId: 'community.openwop.doc.checklist', schemaRef: 'schemas/checklist.json', ...extra },
    ],
  });

  it('an `x-` extension on an entry VALIDATES (the motivating case)', () => {
    expect(
      validate(pack({ 'x-openwop-app.canvas': { components: ['checklist'] } })),
      why('node-packs.md §Vendor extensions on pack manifests', 'a host extension MUST NOT make the pack unpublishable'),
    ).toBe(true);
  });

  it('a `vendor.` extension on an entry VALIDATES', () => {
    expect(
      validate(pack({ 'vendor.acme.rating': 5 })),
      why('host-extensions.md §Vendor-prefixed namespaces', 'vendor-prefixed fields are legitimate'),
    ).toBe(true);
  });

  it('a MISSPELLED canonical field is STILL REJECTED', () => {
    expect(
      validate(pack({ dispalyName: 'Checklist' })),
      why(
        'node-packs.md §Vendor extensions on pack manifests',
        'the hatch admits DECLARED extensions, not arbitrary keys — additionalProperties:false still catches typos. A pattern widened to ^.* would pass the other legs and fail here.',
      ),
    ).toBe(false);
  });

  it('an unextended pack still validates (RFC 0138 is additive)', () => {
    expect(validate(pack({})), why('COMPATIBILITY.md §2.1', 'existing manifests validate unchanged')).toBe(true);
  });

  it('the hatch pattern is not accidentally permissive', () => {
    for (const f of manifestFiles) {
      for (const node of closedObjects(load(f))) {
        for (const pat of Object.keys((node['patternProperties'] as Record<string, unknown>) ?? {})) {
          const re = new RegExp(pat);
          expect(re.test('dispalyName'), why('RFC 0138', `${f}: pattern ${pat} MUST NOT match a bare canonical-looking key`)).toBe(false);
          expect(re.test('x-anything'), why('RFC 0138', `${f}: pattern ${pat} admits x- extensions`)).toBe(true);
        }
      }
    }
  });
});

describe('pack-manifest-extensions: the corpus states opacity + trust normatively (RFC 0138)', () => {
  const packsDoc = V1_DIR ? readFileSync(join(V1_DIR, 'node-packs.md'), 'utf8') : '';
  const extDoc = V1_DIR ? readFileSync(join(V1_DIR, 'host-extensions.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('an unrecognized extension MUST be ignored, not rejected', () => {
    expect(
      /MUST ignore it\W{0,4}\s*and\W{0,4}\s*MUST NOT\W{0,4}\s*reject the pack/i.test(packsDoc),
      why('node-packs.md §Vendor extensions on pack manifests', 'unrecognized extensions MUST be ignored, never a rejection reason'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('"ignore" is defined — not render, execute, interpret, or persist-for-later', () => {
    expect(
      /MUST NOT render it, execute it, interpret it as markup/i.test(packsDoc),
      why('node-packs.md §Vendor extensions on pack manifests', '"ignore" means ignore — the hatch MUST NOT become a rendering or execution channel'),
    ).toBe(true);
    expect(
      /pack-authored content/i.test(packsDoc) && /untrusted/i.test(packsDoc),
      why('node-packs.md §Vendor extensions on pack manifests', 'an extension value is pack-authored, therefore untrusted'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('extensions are NOT a capability-negotiation channel', () => {
    expect(
      /NOT\W{0,4}\s*a versioning or capability-negotiation channel/i.test(packsDoc),
      why('node-packs.md §Vendor extensions on pack manifests', 'a host MUST NOT infer support from an extension property'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('host-extensions.md still carries the opacity MUST the hatch exists to satisfy', () => {
    expect(
      /unknown vendor-prefixed field MUST treat it as opaque/i.test(extDoc),
      why('host-extensions.md §Vendor-prefixed namespaces', 'the MUST that motivated RFC 0138 is still present'),
    ).toBe(true);
  });
});
