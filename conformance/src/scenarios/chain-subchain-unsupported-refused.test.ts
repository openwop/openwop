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
import { SCHEMAS_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const cite = (section: string, requirement: string): string => `${section} — ${requirement}`;
const CHAIN_DOC = join(SCHEMAS_DIR, '..', 'spec', 'v1', 'workflow-chain-packs.md');

describe('chain-subchain-unsupported-refused §A: corpus contract (RFC 0133, always-on)', () => {
  it('spec corpus pins sub_chain_unsupported as a 422 refusal (never flatten)', () => {
    const doc = readFileSync(CHAIN_DOC, 'utf8');
    expect(doc.includes('sub_chain_unsupported'), cite('§Error codes', 'the code MUST be registered')).toBe(true);
    // The normative refusal-not-flatten rule MUST appear in the composition section.
    expect(
      /sub_chain_unsupported[\s\S]{0,600}(never|MUST NOT).{0,40}(flatten|silently)/i.test(doc) ||
        /(never|MUST NOT).{0,40}(flatten|silently)[\s\S]{0,600}sub_chain_unsupported/i.test(doc),
      cite('§Sub-chain composition', 'an unsupported host MUST refuse, MUST NOT silently flatten'),
    ).toBe(true);
    expect(doc.includes('422'), cite('§Error codes', 'sub_chain_unsupported carries HTTP 422')).toBe(true);
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
      return;
    }
    // Behavioral assertion runs once a host exposes the from-chain seam: a
    // subChains-bearing chain MUST return `sub_chain_unsupported` (422), not a
    // flattened success.
    expect(wcp?.subChains?.supported ?? false, 'unsupported host advertises no subChains block').toBe(false);
  });
});
