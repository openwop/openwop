/**
 * Data-parallel dispatch — per-item child inputs. `node-packs.md` §"`core.dispatch`
 * per-item input — data-parallel fan-out" (RFC 0126). Validates the additive, OPTIONAL
 * `nextWorkerInputs` array on `NextWorkerDecision` (`orchestrator-decision.schema.json`)
 * and the `capabilities.dispatch.perItemInput` fail-closed gate.
 *
 * `nextWorkerInputs[i]` is a per-child input object, index-aligned with `nextWorkerIds`,
 * projected into the child dispatched for `nextWorkerIds[i]` — fanning ONE childWorkflowId
 * over N runtime items with distinct inputs (the map-over-collection pattern). It rides the
 * recorded `runOrchestrator.decided` event, so `:fork`/replay reproduces byte-identical
 * children.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probe — `NextWorkerDecision` accepts a well-formed
 *      `nextWorkerInputs`, still accepts a decision that omits it (additive/back-compat),
 *      rejects a non-object item, and — because `additionalProperties:false` — rejects the
 *      field on a pre-RFC-0126 strict validator only when the property name differs (the
 *      point of the fail-closed gate). Array-length equality with `nextWorkerIds` is NOT
 *      JSON-Schema-expressible, so the schema ADMITS a length-mismatch; that MUST is a
 *      HOST runtime check, driven in layer B.
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.dispatch.perItemInput: true` that exposes the dispatch test seam, a
 *      length-mismatched decision fails with a validation_error and dispatches no child,
 *      and each child receives its own `nextWorkerInputs[i]`. On a host NOT advertising the
 *      capability, a non-empty `nextWorkerInputs` MUST fail closed (validation_error), never
 *      silently drop-and-dispatch N identical children. No conformant host advertises
 *      perItemInput yet — these legs soft-skip until a reference host wires it (the first
 *      witness toward `Active → Accepted`).
 *
 * @see spec/v1/node-packs.md §"core.dispatch per-item input — data-parallel fan-out (RFC 0126)"
 * @see spec/v1/capabilities.md §dispatch
 * @see schemas/orchestrator-decision.schema.json
 * @see RFCS/0126-data-parallel-dispatch-per-item-input.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const DECISION = join(SCHEMAS_DIR, 'orchestrator-decision.schema.json');

describe('dispatch-per-item: NextWorkerDecision.nextWorkerInputs schema (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(DECISION, 'utf8')));

  it('accepts a next-worker decision carrying a well-formed, index-aligned nextWorkerInputs', () => {
    const decision = {
      kind: 'next-worker',
      nextWorkerIds: ['pack.re-engage-contact', 'pack.re-engage-contact', 'pack.re-engage-contact'],
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }, { contactId: 'c-3' }],
    };
    expect(
      validate(decision),
      req('openwop.it.dispatch-per-item-input.accepts-a-next-worker-decision-carrying-a-well-formed-index-aligned-nextworkerin', 'node-packs.md', `orchestrator-decision.schema.json §NextWorkerDecision — a well-formed nextWorkerInputs MUST validate. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('still accepts a next-worker decision that omits nextWorkerInputs (additive / back-compat)', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['pack.child'] }),
      req('openwop.it.dispatch-per-item-input.still-accepts-a-next-worker-decision-that-omits-nextworkerinputs-additive-back-c', 'node-packs.md', 'a pre-RFC-0126 next-worker decision MUST stay valid — the field is OPTIONAL'),
    ).toBe(true);
  });

  it('rejects a non-object nextWorkerInputs item', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], nextWorkerInputs: ['not-an-object'] }),
      req('openwop.it.dispatch-per-item-input.rejects-a-non-object-nextworkerinputs-item', 'node-packs.md', 'each nextWorkerInputs entry MUST be a per-child input object'),
    ).toBe(false);
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], nextWorkerInputs: 'nope' }),
      req('openwop.it.dispatch-per-item-input.rejects-a-non-object-nextworkerinputs-item', 'node-packs.md', 'nextWorkerInputs MUST be an array'),
    ).toBe(false);
  });

  it('still rejects an unknown property (additionalProperties:false) — the fail-closed gate', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], perItemInputs: [{ x: 1 }] }),
      req('openwop.it.dispatch-per-item-input.still-rejects-an-unknown-property-additionalproperties-false-the-fail-closed-gat', 'node-packs.md', 'NextWorkerDecision is additionalProperties:false — a mis-named field MUST be rejected, so old strict validators fail closed on unknown per-item shapes'),
    ).toBe(false);
  });

  it('ADMITS a length-mismatch — array-length equality is a runtime MUST, not schema-expressible', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a', 'b'], nextWorkerInputs: [{ x: 1 }] }),
      req('openwop.it.dispatch-per-item-input.admits-a-length-mismatch-array-length-equality-is-a-runtime-must-not-schema-expr', 'node-packs.md', 'the wire schema cannot express nextWorkerInputs.length == nextWorkerIds.length; the host enforces it at decision time (layer B)'),
    ).toBe(true);
  });
});

describe('dispatch-per-item: per-item input behavior (capability-gated, RFC 0126)', () => {
  it('a host advertising perItemInput projects nextWorkerInputs[i] into child i', async () => {
    const dispatch = await readCapabilityFamily<{ perItemInput?: boolean }>('dispatch');
    if (!behaviorGate('dispatch.perItemInput', dispatch?.perItemInput === true)) return;

    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }],
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { children?: Array<{ inputs?: Record<string, unknown> }> } | undefined;
    expect(
      body?.children?.length,
      req('openwop.it.dispatch-per-item-input.a-host-advertising-periteminput-projects-nextworkerinputs-i-into-child-i', 'node-packs.md §core.dispatch per-item input', 'one child dispatched per nextWorkerIds entry'),
    ).toBe(2);
    expect(
      body?.children?.map((c) => c.inputs?.contactId),
      req('openwop.it.dispatch-per-item-input.a-host-advertising-periteminput-projects-nextworkerinputs-i-into-child-i', 'node-packs.md §core.dispatch per-item input', 'each child receives its own nextWorkerInputs[i] (per-item value wins over inputMapping)'),
    ).toEqual(['c-1', 'c-2']);
  });

  it('a length-mismatched nextWorkerInputs fails with a validation_error and dispatches no child', async () => {
    const dispatch = await readCapabilityFamily<{ perItemInput?: boolean }>('dispatch');
    if (!behaviorGate('dispatch.perItemInput', dispatch?.perItemInput === true)) return;

    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }],
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    expect(
      res.status >= 400 && res.status < 500,
      req('openwop.it.dispatch-per-item-input.a-length-mismatched-nextworkerinputs-fails-with-a-validation-error-and-dispatche', 'node-packs.md §core.dispatch per-item input', 'nextWorkerInputs.length != nextWorkerIds.length MUST fail the dispatch node (4xx validation_error), dispatching no child'),
    ).toBe(true);
  });

  it('nextWorkerInputs[i] OVERRIDES the inputMapping projection on key collision (G1 precedence)', async () => {
    const dispatch = await readCapabilityFamily<{ perItemInput?: boolean }>('dispatch');
    if (!behaviorGate('dispatch.perItemInput', dispatch?.perItemInput === true)) return;

    // The seam applies `inputMapping` first (parent-variable projection, RFC 0022), then overlays
    // nextWorkerInputs[i]. A key present in BOTH MUST resolve to the per-item value (most-specific wins).
    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      inputMapping: { contactId: 'from-mapping', region: 'us' },
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }],
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { children?: Array<{ inputs?: Record<string, unknown> }> } | undefined;
    expect(
      body?.children?.map((c) => c.inputs?.contactId),
      req('openwop.it.dispatch-per-item-input.nextworkerinputs-i-overrides-the-inputmapping-projection-on-key-collision-g1-pre', 'node-packs.md §core.dispatch per-item input', 'on key collision the per-item value wins over inputMapping (G1)'),
    ).toEqual(['c-1', 'c-2']);
    expect(
      body?.children?.every((c) => c.inputs?.region === 'us'),
      req('openwop.it.dispatch-per-item-input.nextworkerinputs-i-overrides-the-inputmapping-projection-on-key-collision-g1-pre', 'node-packs.md §core.dispatch per-item input', 'non-colliding inputMapping keys still project (per-item merges OVER, does not replace)'),
    ).toBe(true);
  });

  it('replay re-reads the recorded nextWorkerInputs verbatim — no recomputation (R5 replay-freeze)', async () => {
    const dispatch = await readCapabilityFamily<{ perItemInput?: boolean }>('dispatch');
    if (!behaviorGate('dispatch.perItemInput', dispatch?.perItemInput === true)) return;

    // A :fork/replay MUST re-read the per-item inputs frozen in the recorded runOrchestrator.decided
    // decision and reproduce byte-identical children (CP-2), never re-derive them at replay time.
    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }],
      replay: true,
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { children?: Array<{ inputs?: Record<string, unknown> }>; replayed?: boolean } | undefined;
    expect(
      body?.children?.map((c) => c.inputs?.contactId),
      req('openwop.it.dispatch-per-item-input.replay-re-reads-the-recorded-nextworkerinputs-verbatim-no-recomputation-r5-repla', 'node-packs.md §core.dispatch per-item input', 'replay/:fork reproduces the recorded per-item children verbatim (frozen at decision time)'),
    ).toEqual(['c-1', 'c-2']);
  });

  it('a host NOT advertising perItemInput MUST fail closed on a non-empty nextWorkerInputs', async () => {
    const dispatch = await readCapabilityFamily<{ supported?: boolean; perItemInput?: boolean }>('dispatch');
    if (!dispatch?.supported) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!dispatch?.supported` returned early (no dispatch surface → out of scope)'); // no dispatch surface → out of scope
    if (dispatch.perItemInput === true) return softSkip('blocked', 'precondition not met — `dispatch.perItemInput === true` returned early (this leg targets non-supporting hosts) (seam, prior step, or fixture unavailable)'); // this leg targets non-supporting hosts

    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }],
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    expect(
      res.status >= 400 && res.status < 500,
      req('openwop.it.dispatch-per-item-input.a-host-not-advertising-periteminput-must-fail-closed-on-a-non-empty-nextworkerin', 'node-packs.md §core.dispatch per-item input', 'a host not advertising perItemInput MUST fail closed (4xx) on a non-empty nextWorkerInputs — never silently drop it and dispatch N identical children'),
    ).toBe(true);
  });
});
