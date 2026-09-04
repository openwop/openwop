/**
 * v2-manifest-hatch-carried — RFC 0177 §C.2; `spec/v2/core/packs.md`
 * §"The manifest schema family".
 *
 * Suite 2.0.0, target major 2. Every pack-authored document MUST admit the
 * vendor hatch `^(openwop-|x-|vendor\.)` — including the two nested documents
 * RFC 0138 deferred, `agent-manifest` (inside `node-pack-manifest.agents[]`)
 * and `prompt-template` (inside `prompt-pack-manifest.prompts[]`). A consumer
 * that does not recognise a hatch property MUST ignore it and MUST NOT reject
 * the document.
 *
 *   1. a node pack whose `agents[0]` carries `x-vendor-note` installs.
 *   2. a prompt pack whose `prompts[0]` (a PromptTemplate) carries
 *      `x-vendor-note` installs; a host that does not install `kind: prompt`
 *      packs at all (`pack_kind_invalid`) records `skipped` for that leg.
 *
 * Installs through the seams-profile publish seam
 * (`/conformance/seams/packs-test/…`, RFC 0168 §C.2). Gated on `packs` + the
 * seams profile.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §C.2
 * @see spec/v2/core/packs.md §"The manifest schema family"
 * @see schemas/v2/agent-manifest.schema.json, schemas/v2/prompt-template.schema.json
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { driver } from '../lib/driver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';

const SECTION = 'packs.md §"The manifest schema family" (RFC 0177 §C.2)';

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
async function publish(manifest: Record<string, unknown>, files: Record<string, string>) {
  const name = manifest['name'] as string;
  const version = manifest['version'] as string;
  const body = packTarball({ 'pack.json': JSON.stringify(manifest, null, 2), ...files });
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
  if (!seamsProfileAdvertised(doc)) return { kind: 'blocked', reason: 'host does not advertise conformance.seamsProfile: openwop-conformance-seams-v2 — the packs-test publish seam is the only install path the suite can drive (RFC 0168 §C.1)' };
  return null;
}

describe('v2-manifest-hatch-carried (RFC 0177 §C.2)', () => {
  it('an x- field inside agents[0] of a node pack is ignored, not rejected — the pack installs', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const name = freshName('hatch-agent');
    const manifest = {
      name,
      version: '1.0.0',
      kind: 'node',
      engines: { openwop: '>=2.0.0 <3.0.0' },
      runtime: { language: 'javascript', entry: 'index.mjs', format: 'esm' },
      nodes: [{ typeId: `${name}.echo`, version: '1.0.0', category: 'data', role: 'pure' }],
      agents: [{ agentId: `${name}.helper`, persona: 'Hatch Helper', modelClass: 'general', 'x-vendor-note': 'a hatch property the host MUST ignore' }],
    };
    const res = await publish(manifest, { 'index.mjs': ENTRY });
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect([200, 201].includes(res.status), req('openwop.requirement.0177.manifest-hatch-carried.agents-x-field', SECTION, `agent-manifest admits ^(openwop-|x-|vendor\\.) — a pack whose agents[0] carries x-vendor-note MUST install (got ${res.status} ${readErrorCode(res.json) ?? ''})`)).toBe(true);
  });

  it('an x- field inside a prompt template of a prompt pack is ignored, not rejected — the pack installs', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const name = freshName('hatch-prompt');
    const manifest = {
      name,
      version: '1.0.0',
      kind: 'prompt',
      engines: { openwop: '>=2.0.0 <3.0.0' },
      prompts: [{ templateId: `${name}.system`, version: '1.0.0', kind: 'system', text: 'You are a conformance fixture.', 'x-vendor-note': 'a hatch property the host MUST ignore' }],
    };
    const res = await publish(manifest, {});
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    const code = readErrorCode(res.json);
    if (res.status >= 400 && code === 'pack_kind_invalid') return softSkip('skipped', 'host does not install kind: prompt packs (pack_kind_invalid) — the prompt-template hatch cannot be observed on this host');
    expect([200, 201].includes(res.status), req('openwop.requirement.0177.manifest-hatch-carried.prompt-template-x-field', SECTION, `prompt-template admits ^(openwop-|x-|vendor\\.) — a prompt pack whose prompts[0] carries x-vendor-note MUST install (got ${res.status} ${code ?? ''})`)).toBe(true);
  });
});
