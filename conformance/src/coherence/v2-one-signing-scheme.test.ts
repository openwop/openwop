/**
 * v2-one-signing-scheme — RFC 0177 §C.3 (corpus wrapper, inline).
 *
 * One signing scheme for registry version manifests: a detached 64-byte Ed25519
 * signature over the canonical-JSON `pack.json` inside a deterministic tarball,
 * named `ed25519-canonical-json`; `method` and `publicKeyRef` are gone, the key
 * is addressed by `keyId` alone. This wrapper reads
 * `schemas/v2/registry-version-manifest.schema.json` and asserts
 * `signing.properties.scheme.const === 'ed25519-canonical-json'`, that `signing`
 * is closed, and that neither `method` nor `publicKeyRef` survives anywhere in
 * the `signing` object.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle, under `openwop.requirement.0177.one-signing-scheme`.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §C.3
 * @see schemas/v2/registry-version-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0177.one-signing-scheme';
const SECTION = 'RFC 0177 §C.3';
/** openwop#1367 — a distinct id: two `it`s in one file may not share one (check-req-only). */
const CONFIG_ID = 'openwop.requirement.0177.chain-fragment-config-open';
const CONFIG_SECTION = 'spec/v2/core/workflow-chain-packs.md §Parameter substitution';
interface ConfigSchema { additionalProperties?: unknown; properties?: Record<string, unknown> }
const BARE_ID = 'openwop.requirement.0177.one-signing-scheme.bare-manifests';

interface SigningSchema {
  additionalProperties?: unknown;
  required?: string[];
  properties?: Record<string, { const?: unknown }>;
}

describe('v2-one-signing-scheme (RFC 0177 §C.3)', () => {
  it('registry-version-manifest signing has exactly one scheme, ed25519-canonical-json, and no method / publicKeyRef', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'registry-version-manifest.schema.json'), 'utf8')) as { properties?: { signing?: SigningSchema } };
    const signing = schema.properties?.signing;
    expect(signing, req(ID, SECTION, 'registry-version-manifest.schema.json MUST define a `signing` object')).toBeDefined();
    const props = signing?.properties ?? {};
    expect(props['scheme']?.const, req(ID, SECTION, 'signing.scheme MUST be the single const `ed25519-canonical-json` — one scheme, not a menu')).toBe('ed25519-canonical-json');
    expect(signing?.required ?? [], req(ID, SECTION, 'signing MUST require `keyId` and `scheme`')).toEqual(expect.arrayContaining(['keyId', 'scheme']));
    expect(signing?.additionalProperties, req(ID, SECTION, 'signing MUST be closed (additionalProperties: false) so a second scheme cannot be smuggled in')).toBe(false);
    const text = JSON.stringify(signing);
    expect(/"method"/.test(text), req(ID, SECTION, 'signing.method is gone in v2 — it MUST NOT appear in the signing object')).toBe(false);
    expect(/"publicKeyRef"/.test(text), req(ID, SECTION, 'signing.publicKeyRef is gone in v2 — the key is addressed by keyId alone')).toBe(false);
  });

  // openwop#1367: the wrapper above pinned ONE file. The six bare manifests
  // kept the v1 `{ publicKeyRef, signatureRef, method }` block, closed, and
  // `connection-pack-manifest` had no `signing` seat at all — so all 190
  // published v2 `pack.json` documents (which carry `{ keyId, scheme }`, per
  // migration row C10.1) failed the corpus schema. Enumerated, not listed: a
  // seventh manifest kind cannot reintroduce the v1 block.
  it('every bare *-pack-manifest carries the same closed { keyId, scheme } signing block, and none keeps the v1 one', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = join(SCHEMAS_DIR, 'v2');
    const files = readdirSync(dir).filter((f) => f.endsWith('-pack-manifest.schema.json'));
    expect(files.length, req(BARE_ID, SECTION, 'schemas/v2/ MUST hold the bare pack-manifest schemas this rule covers')).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const schema = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { properties?: { signing?: SigningSchema & { $ref?: string } }; $defs?: Record<string, SigningSchema>; required?: string[] };
      const seat = schema.properties?.signing;
      expect(seat, req(BARE_ID, SECTION, `${f} MUST offer a \`signing\` seat — a signed pack.json is the document the signature covers`)).toBeDefined();
      const signing = seat?.$ref ? schema.$defs?.[seat.$ref.split('/').pop() as string] : seat;
      expect(signing?.properties?.['scheme']?.const, req(BARE_ID, SECTION, `${f} signing.scheme MUST be the single const \`ed25519-canonical-json\``)).toBe('ed25519-canonical-json');
      expect(signing?.required ?? [], req(BARE_ID, SECTION, `${f} signing MUST require \`keyId\` and \`scheme\` when present`)).toEqual(expect.arrayContaining(['keyId', 'scheme']));
      expect(signing?.additionalProperties, req(BARE_ID, SECTION, `${f} signing MUST be closed`)).toBe(false);
      expect(schema.required ?? [], req(BARE_ID, SECTION, `${f}: \`signing\` is OPTIONAL on a bare manifest — an authoring-time pack.json exists before it is signed`)).not.toContain('signing');
      const text = JSON.stringify(schema);
      expect(/"publicKeyRef"|"signatureRef"/.test(text), req(BARE_ID, SECTION, `${f} MUST NOT keep the v1 publicKeyRef / signatureRef block`)).toBe(false);
    }
  });

  // Same defect class, same measurement, so it lives beside the signing rule
  // rather than in a file of its own (a new coherence FILE changes the
  // certification-bundle id pattern — a wire schema — for a corpus-only check).
  // `derive-v2-schemas.mjs` closes "an explicit open object with declared
  // properties"; `FragmentNode.config` documents ONE key (`subChainRef`, RFC
  // 0133) on a free-form map "host-validated against the referenced typeId's
  // config schema", so the seed closed it and 73 of 81 published v2 chain packs
  // failed on `/chains/N/dag/nodes/M/config must NOT have additional properties`.
  // `WorkflowNode.config` — the node a fragment EXPANDS INTO — was open throughout.
  it('FragmentNode.config is open exactly as the WorkflowNode.config it expands into, and keeps its documented subChainRef key', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const chain = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'workflow-chain-pack-manifest.schema.json'), 'utf8')) as { $defs?: { FragmentNode?: { properties?: { config?: ConfigSchema } } } };
    const wf = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'workflow-definition.schema.json'), 'utf8')) as { $defs?: { WorkflowNode?: { properties?: { config?: ConfigSchema } } } };
    const fragment = chain.$defs?.FragmentNode?.properties?.config;
    const node = wf.$defs?.WorkflowNode?.properties?.config;
    expect(node?.additionalProperties, req(CONFIG_ID, CONFIG_SECTION, 'WorkflowNode.config is a free-form map validated against the typeId\'s own config schema — the premise this rule compares against')).toBe(true);
    expect(fragment?.additionalProperties, req(CONFIG_ID, CONFIG_SECTION, 'FragmentNode.config MUST be open: a fragment node expands into a WorkflowNode, so a config the expanded node may carry MUST be expressible in the fragment')).toBe(true);
    expect(Object.keys(fragment?.properties ?? {}), req(CONFIG_ID, CONFIG_SECTION, 'opening the map MUST NOT drop the documented `subChainRef` key (RFC 0133)')).toContain('subChainRef');
  });
});
