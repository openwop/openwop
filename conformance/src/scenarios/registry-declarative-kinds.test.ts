/**
 * Publishable declarative pack kinds (RFC 0107, `Active`).
 *
 * OpenWOP defines declarative pack kinds at the SOURCE level — artifact-type
 * (RFC 0075, `kind: "artifact-type"`) and connection (RFC 0095,
 * `kind: "connection"`). RFC 0107 extends the PUBLISHED contract,
 * `registry-version-manifest.schema.json`, so those kinds can be published to a
 * registry: it adds a `kind` discriminator (absent ≡ `node`), the per-kind
 * declarative payload (`artifactTypes[]` / `provider` / `chains[]` / …), and
 * makes `runtime` required only for executable kinds.
 *
 * Always-on + server-free. Two parts (mirrors the project's other
 * schema-contract scenarios):
 *
 *   PART 1 — contract present. `registry-operations.md` §"Validation flow"
 *   carries the kind-aware manifest-schema selection (#3) and the
 *   skip-runtime-check-for-declarative-kinds rule (#7); the version-manifest
 *   schema carries the `kind` enum + declarative payload + conditional runtime.
 *   Guards against the requirement being silently dropped.
 *
 *   PART 2 — schema admits declarative kinds and still rejects malformed ones.
 *   A published artifact-type and a published connection version manifest
 *   validate; a node manifest is unchanged; a declarative manifest carrying
 *   `runtime` (forbidden) and a node manifest missing `runtime` are rejected.
 *
 * @see spec/v1/registry-operations.md §"Validation flow"
 * @see schemas/registry-version-manifest.schema.json
 * @see RFCS/0107-publishable-declarative-pack-kinds.md
 * @see RFCS/0075-artifact-type-packs-realworld-amendment.md, RFCS/0095-connection-packs-portable-provider-definitions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

describe('registry-declarative-kinds: contract present in the corpus (RFC 0107, server-free)', () => {
  const registryDoc = V1_DIR ? readFileSync(join(V1_DIR, 'registry-operations.md'), 'utf8') : '';
  const versionManifestSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'registry-version-manifest.schema.json'), 'utf8'),
  );

  it.skipIf(V1_DIR === null)('registry-operations.md §Validation flow selects the manifest schema by `kind`', () => {
    expect(
      /kind[\s\S]{0,120}artifact-type-pack-manifest\.schema\.json/.test(registryDoc),
      why('registry-operations.md §Validation flow #3', 'pack.json validates against the per-`kind` source schema (RFC 0107)'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('registry-operations.md §Validation flow skips the runtime check for declarative kinds', () => {
    expect(
      /declarative[\s\S]{0,160}(skipped|MUST NOT)/i.test(registryDoc) && /runtime/i.test(registryDoc),
      why('registry-operations.md §Validation flow #7', 'runtime-support check is skipped for declarative kinds (RFC 0107)'),
    ).toBe(true);
  });

  it('registry-version-manifest.schema.json carries the `kind` discriminator + declarative payload + conditional runtime', () => {
    const props = versionManifestSchema.properties ?? {};
    expect(props.kind?.enum, why('registry-version-manifest.schema.json', '`kind` enum present')).toEqual(
      expect.arrayContaining(['node', 'artifact-type', 'connection']),
    );
    expect(!!props.artifactTypes && !!props.provider, why('registry-version-manifest.schema.json', 'declarative payload props present')).toBe(true);
    expect(
      (versionManifestSchema.required ?? []).includes('runtime'),
      why('registry-version-manifest.schema.json', '`runtime` is NOT top-level required (conditional on kind)'),
    ).toBe(false);
    expect(
      JSON.stringify(versionManifestSchema.allOf ?? []).includes('runtime'),
      why('registry-version-manifest.schema.json', '`allOf` if/then/else makes runtime conditional on kind'),
    ).toBe(true);
  });
});

describe('registry-declarative-kinds: version-manifest schema admits declarative kinds (RFC 0107, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(readFileSync(join(SCHEMAS_DIR, 'registry-version-manifest.schema.json'), 'utf8')),
  );

  const base = { name: 'core.openwop.x', version: '1.0.0', engines: { openwop: '>=1.0.0' }, integrity: 'sha256-abc=' };

  it('a published artifact-type version manifest validates (kind + artifactTypes, no runtime)', () => {
    const ok = validate({ ...base, kind: 'artifact-type', artifactTypes: [{ artifactTypeId: 'doc.one-pager', title: 'One-Pager', schema: { type: 'object' } }] });
    expect(ok, why('registry-operations.md §Validation flow', 'artifact-type manifest publishes (RFC 0107)')).toBe(true);
  });

  it('a published connection version manifest validates (kind + provider, no runtime)', () => {
    const ok = validate({ ...base, kind: 'connection', provider: { id: 'github', category: 'dev' } });
    expect(ok, why('registry-operations.md §Validation flow', 'connection manifest publishes (RFC 0107)')).toBe(true);
  });

  it('an unchanged node version manifest still validates (no kind, runtime + nodes)', () => {
    const ok = validate({ ...base, runtime: { language: 'javascript' }, nodes: [{ typeId: 'core.openwop.x.n', version: '1.0.0', category: 'data', role: 'pure' }] });
    expect(ok, why('COMPATIBILITY.md §2.1', 'RFC 0107 is additive — node manifests validate unchanged')).toBe(true);
  });

  it('a declarative manifest carrying `runtime` is REJECTED (declarative kinds carry no runtime)', () => {
    const ok = validate({ ...base, kind: 'artifact-type', artifactTypes: [{ artifactTypeId: 'doc.x' }], runtime: { language: 'javascript' } });
    expect(ok, why('registry-version-manifest.schema.json', 'declarative kind MUST NOT carry runtime')).toBe(false);
  });

  it('a node manifest MISSING `runtime` is still REJECTED (executable kinds require runtime)', () => {
    const ok = validate({ ...base, nodes: [{ typeId: 'core.openwop.x.n', version: '1.0.0', category: 'data', role: 'pure' }] });
    expect(ok, why('registry-version-manifest.schema.json', 'executable kind (node/absent) still requires runtime')).toBe(false);
  });
});
