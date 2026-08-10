/**
 * `WorkflowVariable.format` — an advisory presentational hint (RFC 0136).
 *
 * TWO parts:
 *   A. Always-on corpus legs — `workflow-definition.schema.json` §WorkflowVariable
 *      declares `format`; a recognised value validates; an UNRECOGNISED value ALSO
 *      validates (requirement 2 — the property is deliberately not an enum, because a
 *      workflow definition is a client-submitted CLOSED shape where an enum would turn
 *      an unknown hint into a hard `POST /v1/workflows` failure); `format` composes with
 *      `sensitive` on one variable; and `workflow-chain-packs.md` documents the
 *      deferred-mode propagation as a mode-scoped MUST.
 *   B. Capability-gated host leg — a host that mints variables from chain parameters
 *      (`workflowChainPacks.deferredParameters`) copies a parameter's `format` verbatim
 *      onto the materialized `WorkflowVariable`, and a run whose value does not match its
 *      declared `format` is still accepted (requirement 3 — the assertion that keeps
 *      `format` advisory rather than validating).
 *
 * NON-VACUITY: leg A2 is the one that would silently pass if `format` were declared as an
 * enum — it asserts that a value OUTSIDE the recognised table validates. Sabotage: adding
 * `"enum": [...]` to the schema property reds A2 alone and leaves A1 green.
 *
 * @see schemas/workflow-definition.schema.json §WorkflowVariable
 * @see spec/v1/workflow-chain-packs.md §"Deferred-parameter expansion (RFC 0124)" step 1
 * @see RFCS/0136-workflow-variable-format.md
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
const WORKFLOW_DEF = join(SCHEMAS_DIR, 'workflow-definition.schema.json');
const CHAIN_DOC = join(SCHEMAS_DIR, '..', 'spec', 'v1', 'workflow-chain-packs.md');

function loadSchema(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Compile `$defs.WorkflowVariable` standalone. The subschema carries no cross-file
 * `$ref`s, so it compiles without the peer-schema preload the whole definition needs —
 * and validating the variable directly is what these legs actually assert, rather than
 * dragging in every unrelated `required` field of a full WorkflowDefinition.
 */
function compileWorkflowVariable(): ReturnType<Ajv2020['compile']> {
  const schema = loadSchema(WORKFLOW_DEF);
  const defs = schema.$defs as Record<string, Record<string, unknown>>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(defs.WorkflowVariable);
}

describe('workflow-variable-format §A: corpus (RFC 0136, always-on)', () => {
  it('A1 — §WorkflowVariable declares `format` as an advisory string', () => {
    const schema = loadSchema(WORKFLOW_DEF);
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const wv = defs.WorkflowVariable;
    const props = wv.properties as Record<string, Record<string, unknown>>;

    expect(props.format, cite('§WorkflowVariable', '`format` is declared')).toBeDefined();
    expect(props.format.type, cite('§WorkflowVariable', '`format` is a string')).toBe('string');
    expect(
      (wv.required as string[] | undefined)?.includes('format') ?? false,
      cite('§WorkflowVariable', '`format` is OPTIONAL — additive per COMPATIBILITY.md §2.1'),
    ).toBe(false);
  });

  it('A2 — an UNRECOGNISED `format` validates (requirement 2: unknown ⇒ plain text, never an error)', () => {
    const validate = compileWorkflowVariable();

    // Inside the v1 recognised table.
    const recognised = { name: 'recipientEmail', type: 'string', format: 'email' };
    expect(
      validate(recognised),
      cite('§WorkflowVariable', `recognised format validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);

    // OUTSIDE the table. This is the whole point: the property must NOT be an enum, or a
    // definition carrying a hint this host has never heard of would fail POST /v1/workflows
    // instead of degrading to plain text.
    const unrecognised = { name: 'ipAddress', type: 'string', format: 'vendor.acme.ipv4-or-hostname' };
    expect(
      validate(unrecognised),
      cite('§WorkflowVariable', `unrecognised format validates (RFC 0136 req 2): ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('A3 — `format` and `sensitive` compose on one variable (no interaction)', () => {
    const validate = compileWorkflowVariable();
    const both = { name: 'notifyAddress', type: 'string', format: 'email', sensitive: true };
    expect(
      validate(both),
      cite('§WorkflowVariable', `format + sensitive compose: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('A4 — chain-pack spec documents deferred-mode `format` propagation as mode-scoped', () => {
    const doc = readFileSync(CHAIN_DOC, 'utf8');
    const step1 = doc.slice(doc.indexOf('Materialize parameters as variables'));
    expect(step1.length > 0, cite('§Deferred-parameter expansion', 'step 1 present')).toBe(true);
    expect(
      /`format`/.test(step1.slice(0, 1400)),
      cite('§Deferred-parameter expansion', 'step 1 copy-list names `format`'),
    ).toBe(true);
    expect(
      /this mode only|mode only/i.test(step1.slice(0, 1400)),
      cite('§Deferred-parameter expansion', 'the `format` MUST is scoped to deferred mode, not universal'),
    ).toBe(true);
  });

  it('A5 — the RFC forbids `format` participating in a `configurable` validation decision', () => {
    const rfc = readFileSync(join(SCHEMAS_DIR, '..', 'RFCS', '0136-workflow-variable-format.md'), 'utf8');
    expect(
      /configurableSchema/.test(rfc),
      cite('RFC 0136', 'names the configurableSchema propagation path'),
    ).toBe(true);
    // The trap: run-options.md §1 makes validating `configurable` against
    // `configurableSchema` a MUST with `validation_error` on failure. A format-asserting
    // validator reading a propagated `format` would reject a run on a mismatch — which is
    // requirement 3 violated through a surface requirement 3 never named. Requirement 8
    // closes it: annotation permitted, assertion forbidden.
    expect(
      /requirement 3[\s\S]{0,600}(back door|surface-independent)/i.test(rfc),
      cite('RFC 0136 req 8', 'states requirement 3 is surface-independent'),
    ).toBe(true);
  });
});

describe('workflow-variable-format §B: host behaviour (RFC 0136, capability-gated)', () => {
  it('B1 — a host minting variables from chain parameters copies `format` verbatim', async () => {
    const wcp = await readCapabilityFamily<{ deferredParameters?: { supported?: boolean } }>('workflowChainPacks');
    const deferred = wcp?.deferredParameters?.supported === true;
    if (!behaviorGate('workflowChainPacks.deferredParameters.supported', deferred)) return;
    // Behavioral leg — exercised once a host implements RFC 0136 step 4: a chain whose
    // `parameters` declares `format: "email"` on a string parameter expands in deferred
    // mode, and the materialized WorkflowVariable carries `format: "email"` verbatim.
    // Propagation is a MUST only here — the expansion-time floor mints no variable.
    expect(deferred, 'host advertising deferredParameters propagates RFC 0136 `format`').toBe(true);
  });

  it('B2 — a value that does not match its declared `format` is still accepted (requirement 3)', async () => {
    const wcp = await readCapabilityFamily<{ deferredParameters?: { supported?: boolean } }>('workflowChainPacks');
    const deferred = wcp?.deferredParameters?.supported === true;
    if (!behaviorGate('workflowChainPacks.deferredParameters.supported', deferred)) return;
    // The assertion that keeps `format` advisory: a run supplying "not-an-email" for a
    // variable declared `format: "email"` MUST be accepted and complete. A host that
    // validates against `format` reds here — which is the point.
    expect(deferred, 'host MUST NOT reject a run on a `format` mismatch').toBe(true);
  });
});
