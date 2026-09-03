/**
 * RFC 0157 (RFC 0013 revision × RFC 0151 §B) — a chain fragment can carry a
 * compensator, and the chain-level policy survives expansion.
 *
 * Measured before this landed: `workflow-chain-pack-manifest.schema.json`
 * `$defs.FragmentNode` carried exactly `id/typeId/name/position/config/inputs`
 * and the manifest mentioned `compensation` nowhere — so on the workflow shape a
 * chain-first host actually ships, no node could own an inverse action and no
 * unwind could occur; RFC 0151 §B was reachable only through a hand-authored
 * `POST /v1/workflows`. The `FragmentNode` description even carried a
 * maintenance note saying new `WorkflowNode` fields must be mirrored here, and
 * `compensation` (b4796755) was not.
 *
 * What this file pins:
 *
 *   - schema: `FragmentNode.compensation` is a byte-mirror of
 *     `WorkflowNode.compensation` (apart from its own description) and
 *     `WorkflowChain.compensation` is a byte-mirror of
 *     `compensation-policy.schema.json` — mirrors, not `$ref`s, so the manifest
 *     stays self-contained (the S14 lesson: a new cross-file `$ref` breaks every
 *     fixed-list validator downstream);
 *   - a manifest with both surfaces validates; a foreign key inside either is
 *     rejected;
 *   - expansion (`carryCompensation`, the spec-authoritative reference below the
 *     mirrored core): the declaration survives verbatim onto the expanded node,
 *     `{{params.*}}` inside `inputMapping` are substituted, fragment node-id
 *     references inside `inputMapping` are rewritten with the expansion prefix
 *     exactly as edge refs are, an unresolvable `compensation.nodeTypeId` fails
 *     with `chain_unresolvable_typeid` BEFORE any node is emitted, and the
 *     chain-level policy is copied when the parent has none / accepted when
 *     equal / refused with `chain_compensation_policy_conflict` otherwise.
 *
 * Server-free. The host half (a host's own expander honouring the same rules)
 * is witnessed by the live `workflow-chain-host-expansion` path once a host
 * adopts RFC 0157.
 *
 * @see spec/v1/workflow-chain-packs.md §"Compensation (RFC 0157)"
 * @see RFCS/0157-chain-fragments-carry-compensation.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import {
  expandChain,
  carryCompensation,
  expandChainWithCompensation,
  ChainUnresolvableTypeIdError,
  ChainCompensationPolicyConflictError,
  ChainIrreversibleWithCompensationError,
  type WorkflowChainWithCompensation,
  type ChainCompensationPolicy,
  type FragmentNodeCompensation,
} from '../lib/workflow-chain-expansion.js';
import { req } from '../lib/requirement-ids.js';

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}
function stripDescription(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripDescription);
  if (o !== null && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'description' || k === '$schema' || k === '$id' || k === 'title') continue;
      out[k] = stripDescription(v);
    }
    return out;
  }
  return o;
}
function manifestValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) ajv.addSchema(schema(f), f);
  return ajv.getSchema('workflow-chain-pack-manifest.schema.json') ?? ajv.compile(schema('workflow-chain-pack-manifest.schema.json'));
}

const POLICY: ChainCompensationPolicy = { triggers: ['node-failure', 'run-cancel'], approvalScope: 'declared' };

const CHAIN: WorkflowChainWithCompensation = {
  chainId: 'vendor.shop.reserveAndCharge',
  version: '1.0.0',
  label: 'Reserve + charge',
  description: 'reserve inventory, then charge; both compensable',
  parameters: { type: 'object', properties: { sku: { type: 'string' } } },
  dag: {
    nodes: [
      {
        id: 'reserve',
        typeId: 'vendor.shop.reserve',
        config: { sku: '{{params.sku}}' },
        compensation: {
          nodeTypeId: 'vendor.shop.release',
          inputMapping: { reservationId: '${nodes.reserve.output.id}', sku: '{{params.sku}}' },
          retry: { maxAttempts: 3, backoffMs: 250 },
        },
      },
      {
        id: 'charge',
        typeId: 'vendor.pay.charge',
        compensation: { nodeTypeId: 'vendor.pay.refund', inputMapping: { chargeId: 'nodes.charge.output.chargeId' }, requiresApproval: true },
      },
      { id: 'notify', typeId: 'core.noop' },
    ],
    edges: [
      { from: 'reserve', to: 'charge' },
      { from: 'charge', to: 'notify' },
    ],
  },
  compensation: POLICY,
};

const RESOLVE_ALL = () => true;
const CTX = { expansionId: 'e1', params: { sku: 'SKU-9' }, isTypeIdResolvable: RESOLVE_ALL };

function manifestWith(chain: unknown) {
  return {
    name: 'vendor.shop.chains',
    version: '1.0.0',
    kind: 'workflow-chain',
    description: 'test',
    engines: { openwop: '>=1.0' },
    chains: [chain],
  };
}

describe('RFC 0157 — schema: the chain manifest mirrors the compensation shapes (self-contained, no cross-file $ref)', () => {
  it('FragmentNode.compensation is a byte-mirror of WorkflowNode.compensation', () => {
    const chainSchema = schema('workflow-chain-pack-manifest.schema.json') as {
      $defs: { FragmentNode: { properties: Record<string, unknown> }; WorkflowChain: { properties: Record<string, unknown> } };
    };
    const wd = schema('workflow-definition.schema.json') as { $defs: { WorkflowNode: { properties: Record<string, unknown> } } };
    expect(chainSchema.$defs.FragmentNode.properties['compensation'], req('openwop.it.chain-compensation-expansion.fragmentnode-compensation-is-a-byte-mirror-of-workflownode-compensation', 'RFC 0157', 'FragmentNode MUST carry `compensation`')).toBeDefined();
    expect(stripDescription(chainSchema.$defs.FragmentNode.properties['compensation'])).toEqual(
      stripDescription(wd.$defs.WorkflowNode.properties['compensation']),
    );
  });

  it('WorkflowChain.compensation is a byte-mirror of compensation-policy.schema.json', () => {
    const chainSchema = schema('workflow-chain-pack-manifest.schema.json') as { $defs: { WorkflowChain: { properties: Record<string, unknown> } } };
    const policy = schema('compensation-policy.schema.json');
    expect(chainSchema.$defs.WorkflowChain.properties['compensation'], req('openwop.it.chain-compensation-expansion.workflowchain-compensation-is-a-byte-mirror-of-compensation-policy-schema-json', 'RFC 0157', 'WorkflowChain MUST carry the policy')).toBeDefined();
    expect(stripDescription(chainSchema.$defs.WorkflowChain.properties['compensation'])).toEqual(stripDescription(policy));
  });

  it('the manifest stays self-contained — no cross-file $ref was introduced', () => {
    const raw = readFileSync(join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json'), 'utf8');
    const refs = [...raw.matchAll(/"\$ref":\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const r of refs) expect(r.startsWith('#/'), req('openwop.it.chain-compensation-expansion.the-manifest-stays-self-contained-no-cross-file-ref-was-introduced', 'RFC 0157', `cross-file $ref ${r} would break fixed-list validators downstream`)).toBe(true);
  });

  it('a manifest declaring both surfaces validates; a foreign key inside either is rejected', () => {
    const validate = manifestValidator();
    expect(validate(manifestWith(CHAIN)), JSON.stringify(validate.errors)).toBe(true);
    const badNode = structuredClone(CHAIN) as unknown as { dag: { nodes: Array<Record<string, unknown>> } };
    (badNode.dag.nodes[0]!['compensation'] as Record<string, unknown>)['rollback'] = true;
    expect(validate(manifestWith(badNode)), req('openwop.it.chain-compensation-expansion.a-manifest-declaring-both-surfaces-validates-a-foreign-key-inside-either-is-reje', 'RFC 0157', 'the mirrored node declaration MUST stay closed')).toBe(false);
    const badPolicy = structuredClone(CHAIN) as unknown as { compensation: Record<string, unknown> };
    badPolicy.compensation['approvalScope'] = 'none';
    expect(validate(manifestWith(badPolicy)), req('openwop.it.chain-compensation-expansion.a-manifest-declaring-both-surfaces-validates-a-foreign-key-inside-either-is-reje', 'RFC 0157', 'the mirrored policy keeps the escalate-only approval scope')).toBe(false);
    const noTriggers = structuredClone(CHAIN) as unknown as { compensation: Record<string, unknown> };
    noTriggers.compensation = {};
    expect(validate(manifestWith(noTriggers)), req('openwop.it.chain-compensation-expansion.a-manifest-declaring-both-surfaces-validates-a-foreign-key-inside-either-is-reje', 'RFC 0157', 'a policy without triggers is not a policy')).toBe(false);
  });

  it('FragmentNode.irreversibleEffect (RFC 0151 UQ4) is a sibling boolean, mutually exclusive with compensation — in the manifest and in expansion', () => {
    const validate = manifestValidator();
    // The `notify` node declares no compensation; stating its effect is irreversible is valid.
    const irreversible = structuredClone(CHAIN) as unknown as { dag: { nodes: Array<Record<string, unknown>> } };
    const notifyIdx = irreversible.dag.nodes.findIndex((n) => n['id'] === 'notify');
    expect(notifyIdx).toBeGreaterThanOrEqual(0);
    irreversible.dag.nodes[notifyIdx]!['irreversibleEffect'] = true;
    expect(validate(manifestWith(irreversible)), JSON.stringify(validate.errors)).toBe(true);
    // Expansion copies it verbatim onto the expanded node (6c) and touches nothing else.
    const out = expandChainWithCompensation(irreversible as unknown as typeof CHAIN, CTX);
    const notify = out.nodes.find((n) => n.id.endsWith('_notify')) as { irreversibleEffect?: boolean; compensation?: unknown } | undefined;
    expect(notify?.irreversibleEffect).toBe(true);
    expect(notify?.compensation).toBeUndefined();
    // Both on one node: the schema rejects it AND expansion refuses fail-closed before emitting.
    const both = structuredClone(CHAIN) as unknown as { dag: { nodes: Array<Record<string, unknown>> } };
    both.dag.nodes[0]!['irreversibleEffect'] = true; // node 0 (`reserve`) declares a compensation
    expect(validate(manifestWith(both)), req('openwop.it.chain-compensation-expansion.fragmentnode-irreversibleeffect-rfc-0151-uq4-is-a-sibling-boolean-mutually-exclu', 'RFC 0151', 'compensation.md §B: irreversibleEffect: true + compensation is contradictory')).toBe(false);
    let thrown: unknown;
    try {
      expandChainWithCompensation(both as unknown as typeof CHAIN, CTX);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ChainIrreversibleWithCompensationError);
    expect((thrown as ChainIrreversibleWithCompensationError).code).toBe('chain_irreversible_with_compensation');
  });
});

describe('RFC 0157 — expansion carries the declaration and the policy', () => {
  it('the declaration survives verbatim onto the expanded node, params substituted, node-id refs rewritten', () => {
    const out = expandChainWithCompensation(CHAIN, CTX);
    const nodes = out.nodes as ReadonlyArray<(typeof out.nodes)[number] & { compensation?: FragmentNodeCompensation }>;
    const reserve = nodes.find((n) => n.id.endsWith('_reserve'));
    const charge = nodes.find((n) => n.id.endsWith('_charge'));
    const notify = nodes.find((n) => n.id.endsWith('_notify'));
    expect(reserve?.compensation?.nodeTypeId).toBe('vendor.shop.release');
    expect(reserve?.compensation?.retry).toEqual({ maxAttempts: 3, backoffMs: 250 });
    // {{params.sku}} substituted (5b); ${nodes.reserve…} rewritten with the prefix (6b)
    expect(reserve?.compensation?.inputMapping?.['sku']).toBe('SKU-9');
    expect(reserve?.compensation?.inputMapping?.['reservationId']).toBe(`\${nodes.${reserve?.id}.output.id}`);
    expect(charge?.compensation?.inputMapping?.['chargeId']).toBe(`nodes.${charge?.id}.output.chargeId`);
    expect(charge?.compensation?.requiresApproval).toBe(true);
    expect(notify?.compensation, req('openwop.it.chain-compensation-expansion.the-declaration-survives-verbatim-onto-the-expanded-node-params-substituted-node', 'RFC 0157', 'a node that declared none gains none')).toBeUndefined();
    // the mirrored core is untouched: plain expandChain still knows nothing of it
    const plain = expandChain(CHAIN, CTX);
    expect((plain.nodes[0] as { compensation?: unknown }).compensation).toBeUndefined();
  });

  it('a reference to a NON-fragment node id inside inputMapping passes through unchanged', () => {
    const chain = structuredClone(CHAIN);
    (chain.dag.nodes[0]!.compensation as { inputMapping: Record<string, unknown> }).inputMapping = {
      parentRef: '${nodes.upstream-in-parent.output.x}',
    };
    const out = expandChainWithCompensation(chain, CTX);
    const nodes = out.nodes as ReadonlyArray<(typeof out.nodes)[number] & { compensation?: FragmentNodeCompensation }>;
    const reserve = nodes.find((n) => n.id.endsWith('_reserve'));
    expect(reserve?.compensation?.inputMapping?.['parentRef'], req('openwop.it.chain-compensation-expansion.a-reference-to-a-non-fragment-node-id-inside-inputmapping-passes-through-unchang', 'RFC 0157', 'a reference to a NON-fragment node id inside inputMapping passes through unchanged')).toBe('${nodes.upstream-in-parent.output.x}');
  });

  it('an unresolvable compensation.nodeTypeId fails with chain_unresolvable_typeid before any node is emitted', () => {
    const resolvable = (t: string) => t !== 'vendor.pay.refund';
    let thrown: unknown;
    try {
      expandChainWithCompensation(CHAIN, { ...CTX, isTypeIdResolvable: resolvable });
    } catch (e) {
      thrown = e;
    }
    expect(thrown, req('openwop.it.chain-compensation-expansion.an-unresolvable-compensation-nodetypeid-fails-with-chain-unresolvable-typeid-bef', 'RFC 0157', 'an unresolvable compensation.nodeTypeId fails with chain_unresolvable_typeid before any node is emitted')).toBeInstanceOf(ChainUnresolvableTypeIdError);
    expect((thrown as ChainUnresolvableTypeIdError).typeId).toBe('vendor.pay.refund');
    expect(String((thrown as Error).message)).toContain('chain_unresolvable_typeid');
  });

  it('the chain policy becomes settings.compensation when the parent has none', () => {
    const out = expandChainWithCompensation(CHAIN, CTX);
    expect(out.settingsCompensation).toEqual(POLICY);
    expect(out.settingsCompensation, req('openwop.it.chain-compensation-expansion.the-chain-policy-becomes-settings-compensation-when-the-parent-has-none', 'RFC 0157', 'a copy, not the same object')).not.toBe(POLICY);
  });

  it('a parent policy that is deep-equal (any key order) is accepted; a differing one is refused, never merged', () => {
    const sameOtherOrder: ChainCompensationPolicy = { approvalScope: 'declared', triggers: ['node-failure', 'run-cancel'] };
    expect(expandChainWithCompensation(CHAIN, CTX, sameOtherOrder).settingsCompensation, req('openwop.it.chain-compensation-expansion.a-parent-policy-that-is-deep-equal-any-key-order-is-accepted-a-differing-one-is', 'RFC 0157', 'a parent policy that is deep-equal (any key order) is accepted; a differing one is refused, never merged')).toEqual(sameOtherOrder);
    const differs: ChainCompensationPolicy = { triggers: ['node-failure'] };
    let thrown: unknown;
    try {
      expandChainWithCompensation(CHAIN, CTX, differs);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ChainCompensationPolicyConflictError);
    expect((thrown as ChainCompensationPolicyConflictError).code).toBe('chain_compensation_policy_conflict');
  });

  it('a chain with no policy inherits the parent policy (or none) and carries no declaration it did not make', () => {
    const chain = structuredClone(CHAIN);
    delete (chain as { compensation?: unknown }).compensation;
    for (const n of chain.dag.nodes as unknown as Array<{ compensation?: unknown }>) delete n.compensation;
    const parent: ChainCompensationPolicy = { triggers: ['operator-request'] };
    const withParent = expandChainWithCompensation(chain, CTX, parent);
    expect(withParent.settingsCompensation, req('openwop.it.chain-compensation-expansion.a-chain-with-no-policy-inherits-the-parent-policy-or-none-and-carries-no-declara', 'RFC 0157', 'a chain with no policy inherits the parent policy (or none) and carries no declaration it did not make')).toBe(parent);
    const nodes = withParent.nodes as ReadonlyArray<{ compensation?: unknown }>;
    expect(nodes.every((n) => n.compensation === undefined)).toBe(true);
    const withoutParent = carryCompensation(chain, expandChain(chain, CTX), CTX);
    expect(withoutParent.settingsCompensation).toBeUndefined();
  });
});
