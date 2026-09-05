/**
 * v2-manifest-ceiling-refused — RFC 0177 §A.1; `spec/v2/core/packs.md` §"The engine range".
 *
 * Suite 2.0.0, target major 2. A v2 host MUST read an `engines.openwop` range
 * with no upper bound as bounded by `<2.0.0` and MUST refuse, at install and on
 * every publication path, a version whose range does not admit its protocol
 * major — with `pack_engine_unsupported` (`spec/v2/errors.json`, 400), never
 * `pack_runtime_requirement_unmet`. Three tiny node packs are built in the test
 * and PUT through the seams-profile publish seam
 * (`/conformance/seams/packs-test/{name}/-/{version}.tgz`, RFC 0168 §C.2; the
 * driver rewrites the v1 seam path under target major 2):
 *
 *   1. `>=1.0.0`          (no ceiling)      → refused, pack_engine_unsupported
 *   2. `>=1.0.0 <2.0.0`   (v1 ceiling)      → refused, pack_engine_unsupported
 *   3. `>=2.0.0 <3.0.0`   (admits major 2)  → installs (200/201)
 *
 * Gated on the `packs` family (RFC 0169 §A.2: presence is the claim) and on
 * the seams profile (`conformance.seamsProfile: openwop-conformance-seams-v2`);
 * a host without the profile records `blocked` — the write API is the only
 * install path the suite can drive.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §A.1
 * @see spec/v2/core/packs.md §"The engine range"
 * @see api/seams-v2.yaml `putTestPackTarball`
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { driver } from '../lib/driver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';

const SECTION = 'packs.md §"The engine range" (RFC 0177 §A.1)';

/** One ustar entry: 512-byte header + content padded to a 512 boundary. */
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

/** A gzipped tarball with `pack.json` at the root (node-packs.md §"Tarball extraction"). */
function packTarball(files: Record<string, string>): Buffer {
  return gzipSync(Buffer.concat([...Object.entries(files).map(([n, c]) => tarEntry(n, Buffer.from(c, 'utf8'))), Buffer.alloc(1024, 0)]));
}

const ENTRY = 'export default { execute: async (input) => input };\n';

function freshName(slug: string): string {
  return `core.openwop.v2-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nodePack(name: string, engines: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    kind: 'node',
    engines: { openwop: engines },
    runtime: { language: 'javascript', entry: 'index.mjs', format: 'esm' },
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

/** The reason this leg cannot run, or null when the seam is reachable. */
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

describe('v2-manifest-ceiling-refused (RFC 0177 §A.1)', () => {
  it('an engines.openwop range with no upper bound (>=1.0.0) reads <2.0.0 and is refused at install with pack_engine_unsupported', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(nodePack(freshName('unbounded'), '>=1.0.0'));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect(res.status, req('openwop.requirement.0177.manifest-ceiling-refused.unbounded', SECTION, 'an unbounded range does not admit protocol major 2 and MUST be refused with 400 pack_engine_unsupported')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0177.manifest-ceiling-refused.unbounded', SECTION, 'the refusal code MUST be pack_engine_unsupported (not pack_runtime_requirement_unmet)')).toBe('pack_engine_unsupported');
  });

  it('a v1 ceiling (>=1.0.0 <2.0.0) is refused at install with pack_engine_unsupported', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(nodePack(freshName('v1-ceiling'), '>=1.0.0 <2.0.0'));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect(res.status, req('openwop.requirement.0177.manifest-ceiling-refused.v1-ceiling', SECTION, 'a <2.0.0 ceiling does not admit protocol major 2 and MUST be refused with 400 pack_engine_unsupported')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0177.manifest-ceiling-refused.v1-ceiling', SECTION, 'the refusal code MUST be pack_engine_unsupported')).toBe('pack_engine_unsupported');
  });

  it('a range admitting the host major (>=2.0.0 <3.0.0) installs', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(nodePack(freshName('v2-installs'), '>=2.0.0 <3.0.0'));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect([200, 201].includes(res.status), req('openwop.requirement.0177.manifest-ceiling-refused.v2-installs', SECTION, `a manifest whose range admits major 2 MUST install (got ${res.status} ${readErrorCode(res.json) ?? ''})`)).toBe(true);
  });
});
