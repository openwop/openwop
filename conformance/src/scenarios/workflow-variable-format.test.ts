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
 *        B2 is seam-free: it registers a workflow whose variable declares `format:"email"`
 *        with an off-format `defaultValue`, runs it, and asserts the run COMPLETES — a
 *        value mismatch MUST NOT fail the run (requirement 3, `format` advisory not
 *        validating). A format-validating host reds.
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
import { SCHEMAS_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { driver } from '../lib/driver.js';

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
    if (!(await deferredParamsGateOpen())) return;

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
    if (res.status === 404) return;
    expect(res.status, cite('§Deferred-parameter expansion', 'the deferred-expand seam returns 200')).toBe(200);
    const variables = (res.json as { variables?: Array<{ name: string; type?: string; format?: string }> }).variables;
    if (!Array.isArray(variables)) return; // seam present but not returning variables[] yet — soft-skip
    const fmt = (n: string): string | undefined => variables.find((v) => v.name === n)?.format;

    expect(fmt('email'), cite('§WorkflowVariable', 'req 7: a string param\'s recognised `format` is minted verbatim')).toBe('email');
    expect(fmt('note'), cite('§WorkflowVariable', 'req 2: an UNRECOGNISED `format` is minted verbatim, never dropped')).toBe('vendor.acme.freeform');
    expect(fmt('count'), cite('§WorkflowVariable', 'req 1: a NON-STRING param mints no `format`')).toBeUndefined();
  });

  it('B2 — a run whose variable value does not match its declared `format` is accepted and completes (req 3: `format` is advisory, not validating)', async () => {
    if (!(await deferredParamsGateOpen())) return;

    // Seam-free: a fully-valid workflow whose variable declares `format: "email"` but carries
    // an off-format `defaultValue`. `format` is advisory (open string, RFC 0136 req 3) — the
    // host MUST NOT reject the definition or fail the run on the mismatch. A format-validating
    // host reds here.
    const wf = {
      id: 'conformance-0136-format-advisory',
      name: 'RFC 0136 format-advisory witness',
      version: '1.0',
      nodes: [{ id: 'n1', typeId: 'core.identity', name: 'noop', position: { x: 0, y: 0 }, config: {}, inputs: {} }],
      edges: [],
      triggers: [{ id: 'manual', type: 'manual', enabled: true }],
      variables: [{ name: 'recipientEmail', type: 'string', format: 'email', defaultValue: 'not-an-email' }],
      metadata: { tags: ['conformance', 'rfc-0136'] },
      settings: { timeout: 5000 },
    };
    const create = await driver.post('/v1/workflows', wf);
    if (create.status === 404) return; // host exposes no workflow-registration surface — soft-skip
    expect(
      [200, 201],
      cite('POST /v1/workflows', 'req 3: a definition whose variable value violates its advisory `format` is accepted, not rejected'),
    ).toContain(create.status);
    const created = create.json as { workflowId?: string; id?: string };
    const workflowId = created.workflowId ?? created.id ?? wf.id;

    const run = await driver.post('/v1/runs', { workflowId });
    if (run.status === 404) return;
    expect([200, 201], cite('POST /v1/runs', 'the run is accepted despite the off-format variable value')).toContain(run.status);
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
      cite('§WorkflowVariable', 'req 3: the run COMPLETES — `format` is advisory, a value mismatch MUST NOT fail the run'),
    ).toBe('completed');
  });
});
