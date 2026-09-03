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
 *   B. Capability-gated host legs (`workflowChainPacks.deferredParameters.supported`) —
 *      real behavioral drives, not advert re-checks:
 *        B1 drives the RFC 0124 deferred-expand seam
 *        (`POST /v1/host/sample/chain/deferred-expand`) and asserts the minted
 *        `variables[]` carry `format` per the "present iff minted" contract — a string
 *        param's `format` copied verbatim (req 7), an unrecognised value copied too
 *        (req 2), a non-string param minting no `format` (req 1). Soft-skips (404 /
 *        absent `variables`) on a host that advertises the flag but hasn't wired the
 *        seam's `variables[]` extension.
 *        B2 runs the vendored fixture `conformance-workflow-variable-format-advisory`
 *        (a workflow whose variable declares `format:"email"` with an off-format
 *        `defaultValue`) via `POST /v1/runs` — the portable pre-registered pattern, NOT a
 *        `POST /v1/workflows` create (registration is "POST /v1/workflows or equivalent",
 *        capabilities.md, so the create path is not a mandated portable surface). It asserts
 *        the run COMPLETES — a value/format mismatch MUST NOT fail the run (requirement 3,
 *        `format` advisory not validating). Gated on fixture advertisement; a
 *        format-validating host reds.
 *
 * NON-VACUITY: leg A2 is the one that would silently pass if `format` were declared as an
 * enum — it asserts that a value OUTSIDE the recognised table validates. Sabotage: adding
 * `"enum": [...]` to the schema property reds A2 alone and leaves A1 green. B1 reds on a
 * host that mints the variable but drops `format` (step-4-unwired); B2 reds on a host that
 * validates a variable value against its advisory `format`.
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
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
const WORKFLOW_DEF = join(SCHEMAS_DIR, 'workflow-definition.schema.json');
// S38 (2026-08-17): `spec/` is NOT in the published package (`files`), so a path built
// from SCHEMAS_DIR/../spec ENOENTs for every npm consumer — five always-on legs reddened
// MyndHyve's bundle for a reason that had nothing to do with the host. Prose legs are
// repo-layout only: `null` in the published layout and skipped, never thrown.
const CHAIN_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, 'workflow-chain-packs.md');
const RFC_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, '..', '..', 'RFCS', '0136-workflow-variable-format.md');

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

    expect(props.format, req('openwop.it.workflow-variable-format.a1-workflowvariable-declares-format-as-an-advisory-string', '§WorkflowVariable', '`format` is declared')).toBeDefined();
    expect(props.format.type, req('openwop.it.workflow-variable-format.a1-workflowvariable-declares-format-as-an-advisory-string', '§WorkflowVariable', '`format` is a string')).toBe('string');
    expect(
      (wv.required as string[] | undefined)?.includes('format') ?? false,
      req('openwop.it.workflow-variable-format.a1-workflowvariable-declares-format-as-an-advisory-string', '§WorkflowVariable', '`format` is OPTIONAL — additive per COMPATIBILITY.md §2.1'),
    ).toBe(false);
  });

  it('A2 — an UNRECOGNISED `format` validates (requirement 2: unknown ⇒ plain text, never an error)', () => {
    const validate = compileWorkflowVariable();

    // Inside the v1 recognised table.
    const recognised = { name: 'recipientEmail', type: 'string', format: 'email' };
    expect(
      validate(recognised),
      req('openwop.it.workflow-variable-format.a2-an-unrecognised-format-validates-requirement-2-unknown-plain-text-never-an-er', '§WorkflowVariable', `recognised format validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);

    // OUTSIDE the table. This is the whole point: the property must NOT be an enum, or a
    // definition carrying a hint this host has never heard of would fail POST /v1/workflows
    // instead of degrading to plain text.
    const unrecognised = { name: 'ipAddress', type: 'string', format: 'vendor.acme.ipv4-or-hostname' };
    expect(
      validate(unrecognised),
      req('openwop.it.workflow-variable-format.a2-an-unrecognised-format-validates-requirement-2-unknown-plain-text-never-an-er', '§WorkflowVariable', `unrecognised format validates (RFC 0136 req 2): ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('A3 — `format` and `sensitive` compose on one variable (no interaction)', () => {
    const validate = compileWorkflowVariable();
    const both = { name: 'notifyAddress', type: 'string', format: 'email', sensitive: true };
    expect(
      validate(both),
      req('openwop.it.workflow-variable-format.a3-format-and-sensitive-compose-on-one-variable-no-interaction', '§WorkflowVariable', `format + sensitive compose: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it.skipIf(CHAIN_DOC === null)('A4 — chain-pack spec documents deferred-mode `format` propagation as mode-scoped', () => {
    const doc = readFileSync(CHAIN_DOC as string, 'utf8');
    const step1 = doc.slice(doc.indexOf('Materialize parameters as variables'));
    expect(step1.length > 0, req('openwop.it.workflow-variable-format.a4-chain-pack-spec-documents-deferred-mode-format-propagation-as-mode-scoped', '§Deferred-parameter expansion', 'step 1 present')).toBe(true);
    expect(
      /`format`/.test(step1.slice(0, 1400)),
      req('openwop.it.workflow-variable-format.a4-chain-pack-spec-documents-deferred-mode-format-propagation-as-mode-scoped', '§Deferred-parameter expansion', 'step 1 copy-list names `format`'),
    ).toBe(true);
    expect(
      /this mode only|mode only/i.test(step1.slice(0, 1400)),
      req('openwop.it.workflow-variable-format.a4-chain-pack-spec-documents-deferred-mode-format-propagation-as-mode-scoped', '§Deferred-parameter expansion', 'the `format` MUST is scoped to deferred mode, not universal'),
    ).toBe(true);
  });

  it.skipIf(RFC_DOC === null)('A5 — the RFC forbids `format` participating in a `configurable` validation decision', () => {
    const rfc = readFileSync(RFC_DOC as string, 'utf8');
    expect(
      /configurableSchema/.test(rfc),
      req('openwop.it.workflow-variable-format.a5-the-rfc-forbids-format-participating-in-a-configurable-validation-decision', 'RFC 0136', 'names the configurableSchema propagation path'),
    ).toBe(true);
    // The trap: run-options.md §1 makes validating `configurable` against
    // `configurableSchema` a MUST with `validation_error` on failure. A format-asserting
    // validator reading a propagated `format` would reject a run on a mismatch — which is
    // requirement 3 violated through a surface requirement 3 never named. Requirement 8
    // closes it: annotation permitted, assertion forbidden.
    expect(
      /requirement 3[\s\S]{0,600}(back door|surface-independent)/i.test(rfc),
      req('openwop.it.workflow-variable-format.a5-the-rfc-forbids-format-participating-in-a-configurable-validation-decision', 'RFC 0136 req 8', 'states requirement 3 is surface-independent'),
    ).toBe(true);
  });
});

describe('workflow-variable-format §B: host behaviour (RFC 0136, capability-gated)', () => {
  // RFC 0124's deferred-expand witness seam (referenced from capabilities.md §deferredParameters).
  const DEFERRED_EXPAND_SEAM = '/v1/host/sample/chain/deferred-expand';

  // Gate open only when a reachable host advertises deferredParameters. A missing base URL
  // (server-free) makes the discovery fetch throw — treat that as "no host" and skip, so
  // these host legs never error the full-suite run; the server-free gate covers §A.
  async function deferredParamsGateOpen(): Promise<boolean> {
    let wcp: { deferredParameters?: { supported?: boolean } } | undefined;
    try {
      wcp = await readCapabilityFamily<{ deferredParameters?: { supported?: boolean } }>('workflowChainPacks');
    } catch {
      return false;
    }
    const deferred = wcp?.deferredParameters?.supported === true;
    return behaviorGate('workflowChainPacks.deferredParameters.supported', deferred);
  }

  it('B1 — deferred expansion mints `format` onto the WorkflowVariable: string copied (req 7), unknown copied (req 2), non-string omits it (req 1)', async () => {
    if (!(await deferredParamsGateOpen())) return softSkip('blocked', 'precondition not met — `!(await deferredParamsGateOpen())` returned early (seam, prior step, or fixture unavailable)');

    // Drive the RFC 0124 deferred-expand seam with a chain whose parameters exercise all
    // three propagation rules in one expansion; assert the minted variables[] carry (or omit)
    // `format` per the "present iff minted" contract.
    const res = await driver.post(DEFERRED_EXPAND_SEAM, {
      chain: {
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            note: { type: 'string', format: 'vendor.acme.freeform' },
            count: { type: 'number' },
          },
        },
      },
    });
    // A host advertising deferredParameters but not yet serving the variables[]-returning
    // seam extension soft-skips (404), as does a host with the seam disabled in this boot.
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (A host advertising deferredParameters but not yet serving the variables[]-returning seam extension soft-skips (404), as does a host with the seam disabled in…');
    expect(res.status, req('openwop.it.workflow-variable-format.b1-deferred-expansion-mints-format-onto-the-workflowvariable-string-copied-req-7', '§Deferred-parameter expansion', 'the deferred-expand seam returns 200')).toBe(200);
    const variables = (res.json as { variables?: Array<{ name: string; type?: string; format?: string }> }).variables;
    if (!Array.isArray(variables)) return softSkip('blocked', 'precondition not met — `!Array.isArray(variables)` returned early (seam present but not returning variables[] yet — soft-skip) (seam, prior step, or fixture unavailable)'); // seam present but not returning variables[] yet — soft-skip
    const fmt = (n: string): string | undefined => variables.find((v) => v.name === n)?.format;

    expect(fmt('email'), req('openwop.it.workflow-variable-format.b1-deferred-expansion-mints-format-onto-the-workflowvariable-string-copied-req-7', '§WorkflowVariable', 'req 7: a string param\'s recognised `format` is minted verbatim')).toBe('email');
    expect(fmt('note'), req('openwop.it.workflow-variable-format.b1-deferred-expansion-mints-format-onto-the-workflowvariable-string-copied-req-7', '§WorkflowVariable', 'req 2: an UNRECOGNISED `format` is minted verbatim, never dropped')).toBe('vendor.acme.freeform');
    expect(fmt('count'), req('openwop.it.workflow-variable-format.b1-deferred-expansion-mints-format-onto-the-workflowvariable-string-copied-req-7', '§WorkflowVariable', 'req 1: a NON-STRING param mints no `format`')).toBeUndefined();
  });

  const B2_FIXTURE = 'conformance-workflow-variable-format-advisory';

  it('B2 — a run whose variable value does not match its declared `format` is accepted and completes (req 3: `format` is advisory, not validating)', async () => {
    // Portable pre-registered-workflow pattern (cf. agentPackHandoffSchemaValidation): the
    // fixture `conformance-workflow-variable-format-advisory` carries a variable declaring
    // `format:"email"` with an off-format `defaultValue`, run via POST /v1/runs — NO create
    // endpoint, since registration is "POST /v1/workflows or equivalent" (capabilities.md)
    // and the create path is not a mandated portable surface. Gate on fixture advertisement:
    // req 3 is universal (not deferred-mode-specific), so it rides the host loading the fixture.
    if (!isFixtureAdvertised(B2_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(B2_FIXTURE)` returned early (Portable pre-registered-workflow pattern (cf. agentPackHandoffSchemaValidation): the fixture `conformance-wor…');

    const run = await driver.post('/v1/runs', { workflowId: B2_FIXTURE });
    if (run.status === 404) return softSkip('blocked', 'precondition not met — `run.status === 404` returned early (no run surface — soft-skip) (seam, prior step, or fixture unavailable)'); // no run surface — soft-skip
    expect(
      [200, 201],
      req('openwop.it.workflow-variable-format.b2-a-run-whose-variable-value-does-not-match-its-declared-format-is-accepted-and', 'POST /v1/runs', 'req 3: a run whose variable value violates its advisory `format` is accepted, not rejected'),
    ).toContain(run.status);
    const runId = (run.json as { runId: string }).runId;

    let snap: { status: string } | undefined;
    for (let i = 0; i < 40; i++) {
      const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = r.json as { status: string };
      if (['completed', 'failed', 'waiting-approval'].includes(body.status)) {
        snap = body;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(
      snap?.status,
      req('openwop.it.workflow-variable-format.b2-a-run-whose-variable-value-does-not-match-its-declared-format-is-accepted-and', '§WorkflowVariable', 'req 3: the run COMPLETES — `format` is advisory, a value mismatch MUST NOT fail the run'),
    ).toBe('completed');
  });
});
