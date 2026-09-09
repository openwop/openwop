/**
 * v2-peer-dependency-declared — RFC 0177 §B.1/§B.2; `spec/v2/core/packs.md`
 * §"Peer-dependency identifiers" and §"The alias table".
 *
 * Suite 2.0.0, target major 2. A `peerDependencies` key MUST be a root key of
 * `spec/v2/declaration.json`; a host MUST refuse a key the declaration file does
 * not name with `pack_peer_dependency_undefined` (400). During the overlap a
 * host MAY resolve a v1 grammar through the generated alias table
 * (`spec/v2/peer-dependency-aliases.json`, e.g. `host.fs → fs`).
 *
 *   1. `peerDependencies: { "host.nonexistent": "required" }` → refused,
 *      pack_peer_dependency_undefined.
 *   2. an alias row whose family the host advertises (`host.fs` when `fs` is
 *      advertised, else the first facet-less row with an advertised family)
 *      installs through the overlap. §B.2 is a MAY, so a host that refuses the
 *      alias with pack_peer_dependency_undefined records `skipped`, not a
 *      failure; any other refusal fails.
 *
 * Both legs install through the seams-profile publish seam
 * (`/conformance/seams/packs-test/…`, RFC 0168 §C.2). Gated on `packs` + the
 * seams profile.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §B.1, §B.2
 * @see spec/v2/core/packs.md §"Peer-dependency identifiers", §"The alias table"
 * @see spec/v2/peer-dependency-aliases.json
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { driver } from '../lib/driver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { v2Discovery, gateFamily, familyAdvertised } from '../lib/v2.js';

const SECTION = 'packs.md §"Peer-dependency identifiers" (RFC 0177 §B.1)';
const ALIASES = join(SCHEMAS_DIR, '..', 'spec', 'v2', 'peer-dependency-aliases.json');

interface AliasRow { alias: string; family: string; facets?: string[] }

function tarEntry(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'utf8');
  h.write('0000000\0', 108, 8, 'utf8');
  h.write('0000000\0', 116, 8, 'utf8');
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  h.write('00000000000\0', 136, 12, 'utf8');
  h.write('        ', 148, 8, 'utf8');
  h.write('0', 156, 1, 'utf8');
  h.write('ustar\0', 257, 6, 'utf8');
  h.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([h, data, Buffer.alloc(pad, 0)]);
}
function packTarball(files: Record<string, string>): Buffer {
  return gzipSync(Buffer.concat([...Object.entries(files).map(([n, c]) => tarEntry(n, Buffer.from(c, 'utf8'))), Buffer.alloc(1024, 0)]));
}
const ENTRY = 'export default { execute: async (input) => input };\n';
function freshName(slug: string): string {
  return `core.openwop.v2-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function nodePack(name: string, peerDependencies: Record<string, string>): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    kind: 'node',
    engines: { openwop: '>=2.0.0 <3.0.0' },
    runtime: { language: 'javascript', entry: 'index.mjs', format: 'esm' },
    peerDependencies,
    nodes: [{ typeId: `${name}.echo`, version: '1.0.0', category: 'data', role: 'pure' }],
  };
}
async function publish(manifest: Record<string, unknown>) {
  const name = manifest['name'] as string;
  const version = manifest['version'] as string;
  const body = packTarball({ 'pack.json': JSON.stringify(manifest, null, 2), 'index.mjs': ENTRY });
  return driver.put(`/v1/packs-test/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`, body, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}
async function preflight(): Promise<{ kind: SoftSkipKind; reason: string } | null> {
  if (targetMajor() !== 2) return { kind: 'inapplicable', reason: 'suite 2.0.0 v2 scenario: OPENWOP_TARGET_MAJOR is not 2' };
  let doc: Record<string, unknown> | null;
  try {
    doc = await v2Discovery();
  } catch {
    doc = null;
  }
  if (!doc) return { kind: 'blocked', reason: 'discovery unreachable — /.well-known/openwop (OpenWOP-Version: 2.0) did not answer 200 JSON' };
  if (!(await gateFamily('packs'))) return { kind: 'inapplicable', reason: 'v2 discovery does not advertise the packs family (RFC 0169 §A.2)' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'inapplicable', reason: 'host does not advertise conformance.seamsProfile: openwop-conformance-seams-v2 — the packs-test publish seam is the only install path the suite can drive (RFC 0168 §C.1)' };
  return null;
}

describe('v2-peer-dependency-declared (RFC 0177 §B.1/§B.2)', () => {
  it('a peerDependencies key the declaration file does not name is refused with pack_peer_dependency_undefined', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(nodePack(freshName('peer-undefined'), { 'host.nonexistent': 'required' }));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect(res.status, req('openwop.requirement.0177.peer-dependency-declared.undefined-key', SECTION, 'a key absent from spec/v2/declaration.json MUST be refused with 400 pack_peer_dependency_undefined')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0177.peer-dependency-declared.undefined-key', SECTION, 'the refusal code MUST be pack_peer_dependency_undefined')).toBe('pack_peer_dependency_undefined');
  });

  it('an alias-table row (host.fs → fs) resolves through the overlap and the pack installs', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    if (!existsSync(ALIASES)) return softSkip('blocked', 'spec/v2/peer-dependency-aliases.json is not present in this layout — the alias row cannot be chosen');
    const rows = (JSON.parse(readFileSync(ALIASES, 'utf8')) as { rows: AliasRow[] }).rows.filter((r) => !r.facets || r.facets.length === 0);
    let chosen: AliasRow | null = null;
    const fs = rows.find((r) => r.alias === 'host.fs');
    if (fs && (await familyAdvertised(fs.family))) chosen = fs;
    for (const r of rows) {
      if (chosen) break;
      if (await familyAdvertised(r.family)) chosen = r;
    }
    if (!chosen) return softSkip('inapplicable', 'no facet-less alias row names a family this host advertises — the overlap alias cannot be exercised');
    const res = await publish(nodePack(freshName('peer-alias'), { [chosen.alias]: 'required' }));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    const code = readErrorCode(res.json);
    if (res.status === 400 && code === 'pack_peer_dependency_undefined') return softSkip('skipped', `host does not resolve the overlap alias ${chosen.alias} (RFC 0177 §B.2 is a MAY during the overlap; MUST NOT after v1 end-of-support)`);
    expect([200, 201].includes(res.status), req('openwop.requirement.0177.peer-dependency-declared.alias-overlap', 'packs.md §"The alias table" (RFC 0177 §B.2)', `alias ${chosen.alias} → ${chosen.family} (advertised) MUST install through the overlap or be refused only with pack_peer_dependency_undefined (got ${res.status} ${code ?? ''})`)).toBe(true);
  });
});
