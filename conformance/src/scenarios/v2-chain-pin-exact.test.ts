/**
 * v2-chain-pin-exact — RFC 0177 §E.1; `spec/v2/core/workflow-chain-packs.md`
 * §"Exact pins".
 *
 * Suite 2.0.0, target major 2. Every reference a chain makes to a node type
 * MUST pin an exact version per referenced `typeId` (`core.ai.callPrompt@1.0.0`);
 * a host MUST refuse to register a chain whose reference carries a range or no
 * version. Ranges are a v2.x additive follow-up.
 *
 *   1. a chain manifest referencing `core.ai.callPrompt@^1` is refused at
 *      register (4xx with an error code).
 *   2. the same chain referencing `core.ai.callPrompt@1.0.0` registers.
 *
 * Both go through the seams-profile publish seam
 * (`/conformance/seams/packs-test/…`, RFC 0168 §C.2), gated on
 * `workflowChainPacks` + the seams profile. The exact-pin manifest is first
 * validated against `schemas/v2/workflow-chain-pack-manifest.schema.json`: the
 * schema's `FragmentNode.typeId` pattern has no room for `@<version>` and no
 * sibling pin field exists, so while that gap stands the legs record `blocked`
 * naming it (RFC 0177 §E.1 schema follow-up) rather than a pass.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §E.1
 * @see spec/v2/core/workflow-chain-packs.md §"Exact pins"
 * @see schemas/v2/workflow-chain-pack-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { driver } from '../lib/driver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';

const SECTION = 'workflow-chain-packs.md §"Exact pins" (RFC 0177 §E.1)';
const SCHEMA_GAP = 'workflow-chain-pack-manifest.schema.json carries no per-typeId version pin (FragmentNode.typeId rejects `core.ai.callPrompt@1.0.0` and no pin field exists) — RFC 0177 §E.1 schema follow-up';

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
function freshName(slug: string): string {
  return `core.openwop.v2-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function chainPack(name: string, reference: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    kind: 'workflow-chain',
    engines: { openwop: '>=2.0.0 <3.0.0' },
    chains: [{
      chainId: `${name}.chain`,
      version: '1.0.0',
      label: 'Pin fixture',
      description: 'A one-node chain whose only reference is the pin under test.',
      parameters: { type: 'object', properties: {} },
      dag: { nodes: [{ id: 'n1', typeId: reference }], edges: [] },
    }],
  };
}
async function publish(manifest: Record<string, unknown>) {
  const name = manifest['name'] as string;
  const version = manifest['version'] as string;
  return driver.put(`/v1/packs-test/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`, packTarball({ 'pack.json': JSON.stringify(manifest, null, 2) }), {
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
  if (!(await gateFamily('workflowChainPacks'))) return { kind: 'inapplicable', reason: 'v2 discovery does not advertise the workflowChainPacks family (RFC 0169 §A.2)' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'blocked', reason: 'host does not advertise conformance.seamsProfile: openwop-conformance-seams-v2 — the packs-test publish seam is the only register path the suite can drive (RFC 0168 §C.1)' };
  if (!v2Validator('workflow-chain-pack-manifest')(chainPack('core.openwop.pin-probe', 'core.ai.callPrompt@1.0.0')).ok) return { kind: 'blocked', reason: SCHEMA_GAP };
  return null;
}

describe('v2-chain-pin-exact (RFC 0177 §E.1)', () => {
  it('a chain reference carrying a range (core.ai.callPrompt@^1) is refused at register', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(chainPack(freshName('chain-range'), 'core.ai.callPrompt@^1'));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect(res.status >= 400 && res.status < 500, req('openwop.requirement.0177.chain-pin-exact.range-refused', SECTION, `a ranged reference MUST be refused at register (got ${res.status})`)).toBe(true);
    expect(typeof readErrorCode(res.json), req('openwop.requirement.0177.chain-pin-exact.range-refused', SECTION, 'the refusal MUST carry an error code in the canonical envelope')).toBe('string');
  });

  it('a chain reference pinning an exact version (core.ai.callPrompt@1.0.0) registers', async () => {
    const skip = await preflight();
    if (skip) return softSkip(skip.kind, skip.reason);
    const res = await publish(chainPack(freshName('chain-exact'), 'core.ai.callPrompt@1.0.0'));
    if (res.status === 404) return softSkip('blocked', 'packs-test publish seam answered 404 — seams profile advertised but the seam is not mounted');
    expect([200, 201].includes(res.status), req('openwop.requirement.0177.chain-pin-exact.exact-accepted', SECTION, `an exact pin MUST register (got ${res.status} ${readErrorCode(res.json) ?? ''})`)).toBe(true);
  });
});
