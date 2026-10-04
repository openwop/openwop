/**
 * v2 — the `nodePackRuntimes` advertisement (`spec/v2/core/node-pack-runtimes.md` §WASM): the node-pack runtimes a host loads. The v1 twin is
 * `wasm-pack-load`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   wasm-facet-shape nodePackRuntimes.wasm lists ABI versions and a memory cap in range;
 *
 * Not here: ABI rejection at load and the memory-cap breach need an operator-installed fixture pack.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `nodePackRuntimes` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/node-pack-runtimes.md §WASM
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { nodePackRuntimesWasmLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'node-pack-runtimes.md §WASM';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.node-pack-runtimes.advert-record-schema';
const ID_WASM_FACET_SHAPE = 'openwop.requirement.node-pack-runtimes.wasm-facet-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 nodePackRuntimes advertisement (node-pack-runtimes.md §WASM)', () => {
  it('the nodePackRuntimes record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('nodePackRuntimes'))) return softSkip('inapplicable', 'the host does not advertise nodePackRuntimes');
    const out = recordSchemaLeg(PROFILE, doc, 'nodePackRuntimes', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('nodePackRuntimes.wasm lists ABI versions and a memory cap in range', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('nodePackRuntimes'))) return softSkip('inapplicable', 'the host does not advertise nodePackRuntimes');
    const out = nodePackRuntimesWasmLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_WASM_FACET_SHAPE, x.doc, x.message)).toBe(true);
  });
});
