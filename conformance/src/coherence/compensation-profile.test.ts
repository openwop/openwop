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
import { FIXTURES_DIR, SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

/**
 * Schemas ship inside the package; RFC prose does not. The old form derived
 * BOTH from `V1_DIR` — null in the published tarball — and cast the null away,
 * so this file threw at import for every consumer installing from npm.
 */
const RFCS_DIR = V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'RFCS');

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
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
  for (const file of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) {
    const s = schema(file);
    ajv.addSchema(s, file);
  }
  const wf = schema('workflow-definition.schema.json') as { $defs: Record<string, unknown> };
  return ajv.compile({ ...(wf.$defs['WorkflowNode'] as object), $defs: wf.$defs });
}

describe('RFC 0151 §A — compensation capability shape', () => {
  const caps = schema('capabilities.schema.json') as {
    properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };

  it('the capability family exists and is closed', () => {
    const c = caps.properties['compensation'];
    expect(c, req('openwop.it.compensation-profile.the-capability-family-exists-and-is-closed', 'RFC 0151', 'RFC 0151 §A: `compensation` MUST be a declared capability family')).toBeDefined();
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
      req('openwop.it.compensation-profile.orderingmodels-is-a-closed-enum-of-the-two-named-models', 'RFC 0151', 'RFC 0151 §A: an advertising host MUST implement `reverse-completion` and MAY add ' +
        '`dependency-graph`. A third model would be an unadvertised ordering guarantee.'),
    ).toEqual(['dependency-graph', 'reverse-completion']);
  });

  it('profileVersion participates in identity, so it is constrained', () => {
    // §C derives the inverse-action id partly from `profileVersion`. An
    // unconstrained string there would let two hosts mint colliding identities
    // under different ordering rules.
    const pv = caps.properties['compensation'].properties?.['profileVersion'] as { pattern?: string };
    expect(pv.pattern, req('openwop.it.compensation-profile.profileversion-participates-in-identity-so-it-is-constrained', 'RFC 0151', 'RFC 0151 §C: profileVersion is part of the inverse-action id')).toBe('^[1-9][0-9]*$');
  });
});

describe('RFC 0151 §B — node compensation declaration', () => {
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
    expect(ok, req('openwop.it.compensation-profile.a-well-formed-declaration-validates', 'RFC 0151', JSON.stringify(validate.errors))).toBe(true);
  });

  it('waiveRequiresApproval (S36) is an OPTIONAL boolean in the closed §B block — absent is valid (default = effective requiresApproval), non-boolean is refused', () => {
    const decl = { nodeTypeId: 'vendor.shop.release', requiresApproval: true };
    expect(validate({ ...base, compensation: { ...decl, waiveRequiresApproval: false } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...base, compensation: { ...decl, waiveRequiresApproval: true } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...base, compensation: { ...decl } }), req('openwop.it.compensation-profile.waiverequiresapproval-s36-is-an-optional-boolean-in-the-closed-b-block-absent-is', 'RFC 0151', 'absent MUST validate — the default is the obligation\'s effective requiresApproval, so no existing document changes meaning')).toBe(true);
    expect(validate({ ...base, compensation: { ...decl, waiveRequiresApproval: 'yes' } }), req('openwop.it.compensation-profile.waiverequiresapproval-s36-is-an-optional-boolean-in-the-closed-b-block-absent-is', 'RFC 0151', 'compensation.md §B: a plain boolean, not a policy language')).toBe(false);
  });

  it('a node without compensation stays valid', () => {
    // The profile is optional. Absent MUST NOT become a validation error, or
    // every existing workflow in the corpus breaks.
    expect(validate({ ...base }), req('openwop.it.compensation-profile.a-node-without-compensation-stays-valid', 'RFC 0151', JSON.stringify(validate.errors))).toBe(true);
  });

  it('irreversibleEffect (RFC 0151 UQ4) is a sibling boolean, mutually exclusive with a compensation declaration', () => {
    // A statement that the effect HAS NO INVERSE. Sibling of `compensation`, so
    // `nodeTypeId` stays required and COMPATIBILITY §2.2 is not engaged.
    expect(validate({ ...base, irreversibleEffect: true }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...base, irreversibleEffect: false, compensation: { nodeTypeId: 'vendor.shop.release' } }), JSON.stringify(validate.errors)).toBe(true);
    // Both = an effect that both has and lacks an inverse. The schema rejects it
    // (`if irreversibleEffect === true then not required compensation`).
    expect(
      validate({ ...base, irreversibleEffect: true, compensation: { nodeTypeId: 'vendor.shop.release' } }),
      req('openwop.it.compensation-profile.irreversibleeffect-rfc-0151-uq4-is-a-sibling-boolean-mutually-exclusive-with-a-c', 'RFC 0151', 'compensation.md §B: a node declaring both irreversibleEffect: true and compensation is contradictory and MUST be rejected'),
    ).toBe(false);
    expect(validate({ ...base, irreversibleEffect: 'yes' }), req('openwop.it.compensation-profile.irreversibleeffect-rfc-0151-uq4-is-a-sibling-boolean-mutually-exclusive-with-a-c', 'RFC 0151', 'irreversibleEffect is a boolean')).toBe(false);
  });

  it('the declaration is closed — an unknown key is rejected', () => {
    expect(
      validate({ ...base, compensation: { nodeTypeId: 'x', onFailure: 'ignore' } }),
      req('openwop.it.compensation-profile.the-declaration-is-closed-an-unknown-key-is-rejected', 'RFC 0151', 'RFC 0151 §B: `compensation` is closed. An unrecognized key here is a silent behavioral ' +
        'assumption on the unwind path, which is the least observable place to have one.'),
    ).toBe(false);
  });

  it('nodeTypeId is required and non-empty', () => {
    expect(validate({ ...base, compensation: {} }), req('openwop.it.compensation-profile.nodetypeid-is-required-and-non-empty', 'RFC 0151', 'nodeTypeId is required')).toBe(false);
    expect(
      validate({ ...base, compensation: { nodeTypeId: '' } }),
      'RFC 0151 §B: `nodeTypeId` MUST resolve at registration — an empty id resolves to nothing, ' +
        'and the failure would surface only during an unwind.',
    ).toBe(false);
  });

  it('retry bounds are integers within sane floors', () => {
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { maxAttempts: 0 } } }), req('openwop.it.compensation-profile.retry-bounds-are-integers-within-sane-floors', 'RFC 0151', 'retry bounds are integers within sane floors')).toBe(false);
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { backoffMs: -1 } } })).toBe(false);
    expect(validate({ ...base, compensation: { nodeTypeId: 'x', retry: { maxAttempts: 1, backoffMs: 0 } } })).toBe(true);
  });
});

describe('RFC 0151 §B — the workflow-level compensation policy (`settings.compensation`)', () => {
  // `compensation-policy.schema.json` was the last `Affects` artifact of the whole
  // RFC 0147 program that did not exist. It says WHEN an unwind starts and HOW it
  // runs; the node-level declaration only says WHAT the inverse action is.
  const POLICY_SCHEMA = 'compensation-policy.schema.json';

  function ajvAll() {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const file of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) {
      ajv.addSchema(schema(file), file);
    }
    return ajv;
  }
  const policyValidator = () => {
    const ajv = ajvAll();
    return ajv.getSchema(POLICY_SCHEMA) ?? ajv.compile(schema(POLICY_SCHEMA));
  };
  const workflowValidator = () => {
    const ajv = ajvAll();
    return ajv.getSchema('workflow-definition.schema.json') ?? ajv.compile(schema('workflow-definition.schema.json'));
  };

  const minimalPolicy = { triggers: ['node-failure'] };
  const fullPolicy = {
    profileVersion: '1',
    orderingModel: 'reverse-completion',
    triggers: ['node-failure', 'run-cancel', 'cap-breach', 'operator-request'],
    retry: { maxAttempts: 3, backoffMs: 500 },
    timeoutMs: 30_000,
    exhaustedDisposition: 'manual-intervention',
    approvalScope: 'all',
    onParentCancel: 'pause',
  };

  it('the schema exists, is closed, and requires triggers', () => {
    const p = schema(POLICY_SCHEMA) as { additionalProperties?: boolean; required?: string[]; $id?: string };
    expect(p.$id).toBe('https://openwop.dev/spec/v1/compensation-policy.schema.json');
    expect(p.additionalProperties, req('openwop.it.compensation-profile.the-schema-exists-is-closed-and-requires-triggers', 'RFC 0151', 'closed — a host and an author must not be able to disagree about a key')).toBe(false);
    expect(p.required, req('openwop.it.compensation-profile.the-schema-exists-is-closed-and-requires-triggers', 'RFC 0151', 'a policy that names no trigger is not a policy')).toEqual(['triggers']);
  });

  it('a minimal and a full policy validate', () => {
    const validate = policyValidator();
    expect(validate(minimalPolicy), req('openwop.it.compensation-profile.a-minimal-and-a-full-policy-validate', 'RFC 0151', JSON.stringify(validate.errors))).toBe(true);
    expect(validate(fullPolicy), JSON.stringify(validate.errors)).toBe(true);
  });

  it('closed vocabularies: an unknown key, trigger, ordering model, or disposition is rejected', () => {
    const validate = policyValidator();
    for (const bad of [
      { ...minimalPolicy, rollback: true },
      { triggers: [] },
      { triggers: ['on-error'] },
      { triggers: ['node-failure', 'node-failure'] },
      { ...minimalPolicy, orderingModel: 'forward' },
      { ...minimalPolicy, exhaustedDisposition: 'ignore' },
      { ...minimalPolicy, approvalScope: 'none' },
      { ...minimalPolicy, onParentCancel: 'abandon' },
      { ...minimalPolicy, profileVersion: '0' },
      { ...minimalPolicy, retry: { maxAttempts: 0 } },
    ]) {
      expect(validate(bad), req('openwop.it.compensation-profile.closed-vocabularies-an-unknown-key-trigger-ordering-model-or-disposition-is-reje', 'RFC 0151', `MUST be rejected: ${JSON.stringify(bad)}`)).toBe(false);
    }
  });

  it('there is no `none` approval scope — a policy can only escalate approval, never strip it', () => {
    const p = schema(POLICY_SCHEMA) as { properties: { approvalScope: { enum: string[] } } };
    expect(p.properties.approvalScope.enum, req('openwop.it.compensation-profile.there-is-no-none-approval-scope-a-policy-can-only-escalate-approval-never-strip', 'RFC 0151', 'there is no `none` approval scope — a policy can only escalate approval, never strip it')).toEqual(['declared', 'all']);
  });

  it('attaches to WorkflowDefinition as `settings.compensation` and validates through the workflow schema', () => {
    const wf = schema('workflow-definition.schema.json') as {
      $defs: { WorkflowSettings: { properties: Record<string, { $ref?: string }> } };
    };
    expect(wf.$defs.WorkflowSettings.properties['compensation']?.$ref).toBe(POLICY_SCHEMA);
    const validate = workflowValidator();
    // A real, valid workflow fixture — so the leg proves the $ref is enforced
    // through the workflow schema rather than that a hand-built object happens
    // to satisfy WorkflowDefinition's required set.
    const base = JSON.parse(
      readFileSync(join(FIXTURES_DIR, 'conformance-subworkflow-child.json'), 'utf8'),
    ) as { settings?: Record<string, unknown> };
    expect(validate(base), req('openwop.it.compensation-profile.attaches-to-workflowdefinition-as-settings-compensation-and-validates-through-th', 'RFC 0151', `fixture must be valid on its own: ${JSON.stringify(validate.errors)}`)).toBe(true);
    const ok = validate({ ...base, settings: { ...(base.settings ?? {}), compensation: fullPolicy } });
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
    const bad = validate({ ...base, settings: { ...(base.settings ?? {}), compensation: { triggers: [] } } });
    expect(bad, req('openwop.it.compensation-profile.attaches-to-workflowdefinition-as-settings-compensation-and-validates-through-th', 'RFC 0151', 'the $ref must actually be enforced through the workflow schema')).toBe(false);
  });
});

describe('RFC 0151 §D — the run rollup `compensationStatus` (RunSnapshot)', () => {
  // Resolves RFC 0151 UQ3: `RunSnapshot` is the sole owner. Debug bundles and the
  // AsyncAPI `run.snapshot` reuse the snapshot by $ref, so one property covers all
  // three surfaces — and one enum keeps them from drifting apart.
  const RUN_SNAPSHOT_SCHEMA = 'run-snapshot.schema.json';
  const STATUSES = ['none', 'pending', 'running', 'completed', 'partial', 'failed', 'manual'] as const;

  function snapshotValidator() {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const file of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) {
      ajv.addSchema(schema(file), file);
    }
    return ajv.getSchema(RUN_SNAPSHOT_SCHEMA) ?? ajv.compile(schema(RUN_SNAPSHOT_SCHEMA));
  }

  it('is declared on RunSnapshot as a closed enum of the seven §D values', () => {
    const snap = schema(RUN_SNAPSHOT_SCHEMA) as {
      properties: Record<string, { type?: string; enum?: string[] }>;
      required: string[];
    };
    const field = snap.properties['compensationStatus'];
    expect(field, req('openwop.it.compensation-profile.is-declared-on-runsnapshot-as-a-closed-enum-of-the-seven-d-values', 'RFC 0151', 'RunSnapshot MUST declare `compensationStatus` (RFC 0151 §D, UQ3)')).toBeDefined();
    expect(field?.enum, req('openwop.it.compensation-profile.is-declared-on-runsnapshot-as-a-closed-enum-of-the-seven-d-values', 'RFC 0151', 'the value set is closed and exactly the seven §D values')).toEqual([...STATUSES]);
    expect(
      snap.required.includes('compensationStatus'),
      'OPTIONAL on the schema — presence is governed by the capability gate in prose, not by `required`, ' +
        'so a host that does not advertise `compensation` still validates',
    ).toBe(false);
  });

  it('every §D value validates and a foreign value is rejected', () => {
    const validate = snapshotValidator();
    for (const value of STATUSES) {
      const ok = validate({ runId: 'r1', workflowId: 'w1', status: 'failed', compensationStatus: value });
      expect(ok, req('openwop.it.compensation-profile.every-d-value-validates-and-a-foreign-value-is-rejected', 'RFC 0151', `compensationStatus=${value} MUST validate: ${JSON.stringify(validate.errors)}`)).toBe(true);
    }
    for (const bad of ['compensating', 'COMPLETED', 'done', 'skipped', 'paused', 1, null, true]) {
      const ok = validate({ runId: 'r1', workflowId: 'w1', status: 'failed', compensationStatus: bad });
      expect(ok, req('openwop.it.compensation-profile.every-d-value-validates-and-a-foreign-value-is-rejected', 'RFC 0151', `compensationStatus=${JSON.stringify(bad)} MUST be rejected — the fold is closed`)).toBe(false);
    }
  });

  it('a snapshot without the field still validates — the gate lives in prose', () => {
    const validate = snapshotValidator();
    expect(validate({ runId: 'r1', workflowId: 'w1', status: 'completed' }), req('openwop.it.compensation-profile.a-snapshot-without-the-field-still-validates-the-gate-lives-in-prose', 'RFC 0151', 'a snapshot without the field still validates — the gate lives in prose')).toBe(true);
  });

  it('the forward `status` enum gained no `compensating` value — §D forbids reinterpreting it', () => {
    const snap = schema(RUN_SNAPSHOT_SCHEMA) as { properties: { status: { enum: string[] } } };
    expect(snap.properties.status.enum, req('openwop.it.compensation-profile.the-forward-status-enum-gained-no-compensating-value-d-forbids-reinterpreting-it', 'RFC 0151', 'the forward `status` enum gained no `compensating` value — §D forbids reinterpreting it')).not.toContain('compensating');
  });
});

describe.skipIf(RFCS_DIR === null)('RFC 0151 — what this file does NOT establish', () => {
  it('records that behavioral conformance is absent, per RFC 0147 §A.5', () => {
    // Not decoration. RFC 0147 §A.5 forbids `Accepted` on shape-only evidence
    // for a behavioral requirement, and this scenario is shape-only by
    // construction: it compiles schemas and never contacts a host. The RFC's
    // acceptance criteria and `docs/RFC-0147-SELF-AUDIT.md` both record 0151 as
    // violating §A.5, and this leg exists so that reading the conformance suite
    // alone cannot leave a different impression.
    const rfc = readFileSync(
      join(RFCS_DIR as string, '0151-compensation-and-partial-failure-profile.md'),
      'utf8',
    );
    expect(
      /Reverse-unwind, retry, crash, partial\/manual, approval, replay, and isolation scenarios pass\.\s*\(/.test(rfc),
      req('openwop.it.compensation-profile.records-that-behavioral-conformance-is-absent-per-rfc-0147-a-5', 'RFC 0147 §A.5', 'RFC 0151\'s behavioral acceptance item MUST remain unticked and annotated: no host executes ' +
        'an unwind, so ordering, persistence-before-first-action, and crash resumption are unproven.'),
    ).toBe(true);
  });
});
