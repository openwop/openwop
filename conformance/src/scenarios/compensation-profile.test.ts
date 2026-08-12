/**
 * RFC 0151 — the compensation profile's shape contract.
 *
 * **What this proves, stated first because RFC 0147 §A.5 turns on it:** the
 * schemas admit exactly the shapes §A and §B describe and reject the ones they
 * forbid. That is *shape-only* evidence. It is **not** evidence that any host
 * orders an unwind correctly, persists a plan before the first inverse action,
 * or resumes one after a crash — and RFC 0151 cannot reach a defensible
 * `Accepted` on this alone. §A.5 requires a host executing every normative
 * behavioral path in strict mode, and none does.
 *
 * Saying that here rather than in a register keeps it next to the thing it
 * qualifies. A conformance file that verifies structure while its RFC claims
 * behavior is how "green suite" and "working protocol" come apart.
 *
 * The design constraints worth holding onto, each of which the schema encodes:
 *
 *   - **Compensation is a second effect, not an undo.** It can fail, can be
 *     partially applied, and can itself be harmful (RFC 0147 R9) — hence
 *     `requiresApproval` and the security-high tier.
 *   - **Inputs come from recorded facts.** §B forbids prompt/model regeneration
 *     from constructing a compensation input during replay, because an inverse
 *     built from a re-inferred value is not the inverse of what was done.
 *   - **`nodeTypeId` resolves at registration**, so an unwind cannot fail on a
 *     typo first discovered during a failure — the worst possible moment.
 *
 * Server-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { V1_DIR } from '../lib/paths.js';

const SCHEMAS = V1_DIR === null ? null : pathResolve(V1_DIR as string, '..', '..', 'schemas');

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS as string, name), 'utf8')) as Record<string, unknown>;
}

/**
 * Validate a candidate node against `WorkflowNode` alone.
 *
 * Every schema in the directory is registered first: `WorkflowNode` `$ref`s
 * siblings by filename, so compiling it in isolation resolves nothing and Ajv
 * throws rather than silently accepting — which is the good failure, but only
 * if the harness registers what the schema actually depends on.
 */
function nodeValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const file of readdirSync(SCHEMAS as string).filter((f) => f.endsWith('.schema.json'))) {
    const s = schema(file);
    ajv.addSchema(s, file);
  }
  const wf = schema('workflow-definition.schema.json') as { $defs: Record<string, unknown> };
  return ajv.compile({ ...(wf.$defs['WorkflowNode'] as object), $defs: wf.$defs });
}

describe.skipIf(V1_DIR === null)('RFC 0151 §A — compensation capability shape', () => {
  const caps = schema('capabilities.schema.json') as {
    properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };

  it('the capability family exists and is closed', () => {
    const c = caps.properties['compensation'];
    expect(c, 'RFC 0151 §A: `compensation` MUST be a declared capability family').toBeDefined();
    expect(c.required).toEqual(['supported']);
    expect(Object.keys(c.properties ?? {}).sort()).toEqual(
      ['manualIntervention', 'orderingModels', 'profileVersion', 'supported'].sort(),
    );
  });

  it('orderingModels is a closed enum of the two named models', () => {
    const models = (caps.properties['compensation'].properties?.['orderingModels'] as {
      items: { enum: string[] };
    }).items.enum;
    expect(
      [...models].sort(),
      'RFC 0151 §A: an advertising host MUST implement `reverse-completion` and MAY add ' +
        '`dependency-graph`. A third model would be an unadvertised ordering guarantee.',
    ).toEqual(['dependency-graph', 'reverse-completion']);
  });

  it('profileVersion participates in identity, so it is constrained', () => {
    // §C derives the inverse-action id partly from `profileVersion`. An
    // unconstrained string there would let two hosts mint colliding identities
    // under different ordering rules.
    const pv = caps.properties['compensation'].properties?.['profileVersion'] as { pattern?: string };
    expect(pv.pattern, 'RFC 0151 §C: profileVersion is part of the inverse-action id').toBe('^[1-9][0-9]*$');
  });
});

describe.skipIf(V1_DIR === null)('RFC 0151 §B — node compensation declaration', () => {
  const validate = nodeValidator();
  // A minimally VALID node — `WorkflowNode` requires `name`, `position`,
  // `config`, and `inputs` independently of this RFC. Building the fixture from
  // the real required set keeps the legs below testing `compensation` rather
  // than accidentally testing whether the base node is well-formed.
  const base = {
    id: 'reserve-inventory',
    typeId: 'vendor.shop.reserve',
    name: 'Reserve inventory',
    position: { x: 0, y: 0 },
    config: {},
    inputs: {},
  };

  it('a well-formed declaration validates', () => {
    const ok = validate({
      ...base,
      compensation: {
        nodeTypeId: 'vendor.shop.release',
        inputMapping: { reservationId: '${nodes.reserve-inventory.output.id}' },
        retry: { maxAttempts: 5, backoffMs: 1000 },
        requiresApproval: false,
      },
    });
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it('a node without compensation stays valid', () => {
    // The profile is optional. Absent MUST NOT become a validation error, or
    // every existing workflow in the corpus breaks.
    expect(validate({ ...base }), JSON.stringify(validate.errors)).toBe(true);
  });

  it('the declaration is closed — an unknown key is rejected', () => {
    expect(
      validate({ ...base, compensation: { nodeTypeId: 'x', onFailure: 'ignore' } }),
      'RFC 0151 §B: `compensation` is closed. An unrecognized key here is a silent behavioral ' +
        'assumption on the unwind path, which is the least observable place to have one.',
    ).toBe(false);
  });

  it('nodeTypeId is required and non-empty', () => {
    expect(validate({ ...base, compensation: {} }), 'nodeTypeId is required').toBe(false);
    expect(
      validate({ ...base, compensation: { nodeTypeId: '' } }),
      'RFC 0151 §B: `nodeTypeId` MUST resolve at registration — an empty id resolves to nothing, ' +
        'and the failure would surface only during an unwind.',
    ).toBe(false);
  });

  it('retry bounds are integers within sane floors', () => {
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { maxAttempts: 0 } } })).toBe(false);
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { backoffMs: -1 } } })).toBe(false);
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { maxAttempts: 1, backoffMs: 0 } } })).toBe(true);
  });
});

describe.skipIf(V1_DIR === null)('RFC 0151 — what this file does NOT establish', () => {
  it('records that behavioral conformance is absent, per RFC 0147 §A.5', () => {
    // Not decoration. RFC 0147 §A.5 forbids `Accepted` on shape-only evidence
    // for a behavioral requirement, and this scenario is shape-only by
    // construction: it compiles schemas and never contacts a host. The RFC's
    // acceptance criteria and `docs/RFC-0147-SELF-AUDIT.md` both record 0151 as
    // violating §A.5, and this leg exists so that reading the conformance suite
    // alone cannot leave a different impression.
    const rfc = readFileSync(
      join(pathResolve(V1_DIR as string, '..', '..'), 'RFCS', '0151-compensation-and-partial-failure-profile.md'),
      'utf8',
    );
    expect(
      /Reverse-unwind, retry, crash, partial\/manual, approval, replay, and isolation scenarios pass\.\s*\(/.test(rfc),
      'RFC 0151\'s behavioral acceptance item MUST remain unticked and annotated: no host executes ' +
        'an unwind, so ordering, persistence-before-first-action, and crash resumption are unproven.',
    ).toBe(true);
  });
});
