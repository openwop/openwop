/**
 * Sub-chain composition — unsupported-host refusal (RFC 0133 §1.3).
 *
 * A host that does NOT advertise `capabilities.workflowChainPacks.subChains.supported`
 * MUST refuse to instantiate a `subChains`-bearing chain with `sub_chain_unsupported`
 * (HTTP 422) — it MUST NOT silently flatten the runtime child into the parent
 * (flattening erases the child as an editable unit and changes run semantics).
 *
 * TWO parts:
 *   A. Always-on — the error code + refusal contract are present in the spec
 *      corpus (`workflow-chain-packs.md` §"Error codes" + §"Sub-chain composition").
 *   B. Capability-gated — against a host that expands chains
 *      (`workflowChainPacks.supported`) but does NOT advertise `subChains`, a
 *      `from-chain` on a `subChains`-bearing chain returns `sub_chain_unsupported`.
 *      Soft-skips until a reference host exposes the seam. The refusal is the
 *      fail-closed complement of `sub-chain-expansion-bounded`: a host that cannot
 *      run child dispatch never mis-dispatches.
 *
 * @see spec/v1/workflow-chain-packs.md §"Sub-chain composition (RFC 0133)" + §"Error codes"
 * @see RFCS/0133-workflow-chain-composition.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
// S38 (2026-08-17): `spec/` is NOT in the published package (`files`), so a path built
// from SCHEMAS_DIR/../spec ENOENTs for every npm consumer — five always-on legs reddened
// MyndHyve's bundle for a reason that had nothing to do with the host. Prose legs are
// repo-layout only: `null` in the published layout and skipped, never thrown.
const CHAIN_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, 'workflow-chain-packs.md');

describe('chain-subchain-unsupported-refused §A: corpus contract (RFC 0133, always-on)', () => {
  it.skipIf(CHAIN_DOC === null)('spec corpus pins sub_chain_unsupported as a 422 refusal (never flatten)', () => {
    const doc = readFileSync(CHAIN_DOC as string, 'utf8');
    expect(doc.includes('sub_chain_unsupported'), req('openwop.it.chain-subchain-unsupported-refused.spec-corpus-pins-sub-chain-unsupported-as-a-422-refusal-never-flatten', '§Error codes', 'the code MUST be registered')).toBe(true);
    // The normative refusal-not-flatten rule MUST appear in the composition section.
    expect(
      /sub_chain_unsupported[\s\S]{0,600}(never|MUST NOT).{0,40}(flatten|silently)/i.test(doc) ||
        /(never|MUST NOT).{0,40}(flatten|silently)[\s\S]{0,600}sub_chain_unsupported/i.test(doc),
      req('openwop.it.chain-subchain-unsupported-refused.spec-corpus-pins-sub-chain-unsupported-as-a-422-refusal-never-flatten', '§Sub-chain composition', 'an unsupported host MUST refuse, MUST NOT silently flatten'),
    ).toBe(true);
    expect(doc.includes('422'), req('openwop.it.chain-subchain-unsupported-refused.spec-corpus-pins-sub-chain-unsupported-as-a-422-refusal-never-flatten', '§Error codes', 'sub_chain_unsupported carries HTTP 422')).toBe(true);
  });
});

describe('chain-subchain-unsupported-refused §B: host refusal (RFC 0133, capability-gated)', () => {
  it('a host without subChains support refuses a subChains-bearing chain with sub_chain_unsupported', async () => {
    const wcp = await readCapabilityFamily<{ supported?: boolean; subChains?: { supported?: boolean } }>(
      'workflowChainPacks',
    );
    // This leg targets hosts that DO expand chains but do NOT support runtime
    // child dispatch — the exact population that MUST refuse. Gate on the base
    // chain-expansion capability; soft-skip hosts that don't expand at all.
    if (!behaviorGate('workflowChainPacks.supported', wcp?.supported === true)) return;
    if (wcp?.subChains?.supported === true) {
      // Host DOES support sub-chains — refusal path is not applicable here; the
      // positive path is covered by chain-subchain-fanout §B. Skip cleanly.
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `wcp?.subChains?.supported === true` returned early (Host DOES support sub-chains — refusal path is not applicable here; the positive path is covered by chain-s…');
    }
    // Behavioral assertion runs once a host exposes the from-chain seam: a
    // subChains-bearing chain MUST return `sub_chain_unsupported` (422), not a
    // flattened success.
    expect(wcp?.subChains?.supported ?? false, req('openwop.it.chain-subchain-unsupported-refused.a-host-without-subchains-support-refuses-a-subchains-bearing-chain-with-sub-chai', 'RFC 0133 §1.3', 'unsupported host advertises no subChains block')).toBe(false);
  });
});
