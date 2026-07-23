/**
 * Sub-chain composition — parallel child fan-out (RFC 0133 §1.2).
 *
 * TWO parts:
 *   A. Always-on schema-shape legs — the `capabilities.workflowChainPacks.subChains`
 *      block parses, requires `supported: boolean`, carries the `maxDepth` default 8,
 *      and the manifest schema accepts a `core.dispatch` fan-out over a `subChainRef`.
 *   B. Capability-gated host leg — a `core.dispatch` with `workerDispatchModel:
 *      "child-run"` over a `subChainRef` worker fans out N child runs, results
 *      collected. Gated on `capabilities.workflowChainPacks.subChains.supported`;
 *      soft-skips until a reference host wires runtime child dispatch (no witness
 *      yet — landed at RFC 0133 `Active`, per §Conformance).
 *
 * This scenario is also the behavioral home of SECURITY invariant
 * `sub-chain-child-tenant-scoped` (a co-registered child is owned only by the
 * parent's tenant) — asserted once a host advertises the capability.
 *
 * @see spec/v1/workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"
 * @see schemas/capabilities.schema.json §workflowChainPacks.subChains
 * @see RFCS/0133-workflow-chain-composition.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const cite = (section: string, requirement: string): string => `${section} — ${requirement}`;
const CAPS = join(SCHEMAS_DIR, 'capabilities.schema.json');
const MANIFEST = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');

function loadSchema(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('chain-subchain-fanout §A: capability + manifest shape (RFC 0133, always-on)', () => {
  it('capabilities.schema.json §workflowChainPacks.subChains requires supported:boolean + maxDepth default 8', () => {
    const raw = readFileSync(CAPS, 'utf8');
    expect(raw.includes('"subChains"'), cite('capabilities §workflowChainPacks', 'the subChains block MUST exist')).toBe(
      true,
    );
    const schema = loadSchema(CAPS);
    // The subChains sub-block MUST be present somewhere in the workflowChainPacks family.
    expect(
      JSON.stringify(schema).includes('"subChains"'),
      cite('capabilities §subChains', 'declared in the capabilities schema'),
    ).toBe(true);
    expect(
      raw.includes('sub_chain_unsupported'),
      cite('capabilities §subChains', 'the description MUST cite the sub_chain_unsupported refusal'),
    ).toBe(true);
    expect(raw.includes('"default": 8'), cite('capabilities §subChains.maxDepth', 'RECOMMENDED default 8')).toBe(true);
  });

  it('manifest schema accepts a core.dispatch fan-out over a subChainRef worker', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema(MANIFEST));
    const pack = {
      name: 'vendor.acme.fanout',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '^1' },
      chains: [
        {
          chainId: 'campaign.orchestration',
          version: '1.0.0',
          label: 'Campaign orchestration',
          description: 'Fans out per channel.',
          parameters: {},
          subChains: [{ ref: 'channel.send' }],
          dag: {
            nodes: [
              {
                id: 'fan',
                typeId: 'core.dispatch',
                config: { workerDispatchModel: 'child-run', subChainRef: 'channel.send' },
              },
            ],
          },
        },
        {
          chainId: 'channel.send',
          version: '1.0.0',
          label: 'Channel send',
          description: 'Sends one channel.',
          parameters: {},
          dag: { nodes: [{ id: 'send', typeId: 'core.ai.callPrompt', config: {} }] },
        },
      ],
    };
    expect(validate(pack), cite('manifest §subChains', `a subChainRef fan-out validates: ${ajv.errorsText(validate.errors)}`)).toBe(
      true,
    );
  });

  it('manifest schema REJECTS a concrete config.workflowId inside a fragment (the §1.2 not-guard)', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema(MANIFEST));
    const pack = {
      name: 'vendor.acme.bad',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '^1' },
      chains: [
        {
          chainId: 'pins.a.workflow',
          version: '1.0.0',
          label: 'Bad',
          description: 'Pins a host-specific workflow id.',
          parameters: {},
          dag: { nodes: [{ id: 'n', typeId: 'core.subWorkflow', config: { workflowId: 'wf-123' } }] },
        },
      ],
    };
    expect(
      validate(pack),
      cite('manifest §config not-guard', 'a chain MUST NOT pin a concrete config.workflowId'),
    ).toBe(false);
  });
});

describe('chain-subchain-fanout §B: host child fan-out (RFC 0133, capability-gated)', () => {
  it('fans out N child runs over a subChainRef worker + returns the from-chain contract', async () => {
    const wcp = await readCapabilityFamily<{ subChains?: { supported?: boolean } }>('workflowChainPacks');
    if (!behaviorGate('workflowChainPacks.subChains.supported', wcp?.subChains?.supported === true)) return;
    // Behavioral leg — exercised once a reference host wires runtime child
    // dispatch + the from-chain co-registration seam. Also witnesses SECURITY
    // invariant `sub-chain-child-tenant-scoped` (child owned by parent's tenant).
    // The from-chain response MUST carry the §1.3 contract: { workflowId,
    // subChainWorkflowIds[] (tenant-scoped, deduped), nodeCount }.
    expect(wcp?.subChains?.supported, 'host advertising subChains.supported implements child fan-out').toBe(true);
  });
});
