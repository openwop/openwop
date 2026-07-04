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
      `orchestrator-decision.schema.json §NextWorkerDecision — a well-formed nextWorkerInputs MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('still accepts a next-worker decision that omits nextWorkerInputs (additive / back-compat)', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['pack.child'] }),
      'a pre-RFC-0126 next-worker decision MUST stay valid — the field is OPTIONAL',
    ).toBe(true);
  });

  it('rejects a non-object nextWorkerInputs item', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], nextWorkerInputs: ['not-an-object'] }),
      'each nextWorkerInputs entry MUST be a per-child input object',
    ).toBe(false);
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], nextWorkerInputs: 'nope' }),
      'nextWorkerInputs MUST be an array',
    ).toBe(false);
  });

  it('still rejects an unknown property (additionalProperties:false) — the fail-closed gate', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a'], perItemInputs: [{ x: 1 }] }),
      'NextWorkerDecision is additionalProperties:false — a mis-named field MUST be rejected, so old strict validators fail closed on unknown per-item shapes',
    ).toBe(false);
  });

  it('ADMITS a length-mismatch — array-length equality is a runtime MUST, not schema-expressible', () => {
    expect(
      validate({ kind: 'next-worker', nextWorkerIds: ['a', 'b'], nextWorkerInputs: [{ x: 1 }] }),
      'the wire schema cannot express nextWorkerInputs.length == nextWorkerIds.length; the host enforces it at decision time (layer B)',
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
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const body = res.json as { children?: Array<{ inputs?: Record<string, unknown> }> } | undefined;
    expect(
      body?.children?.length,
      driver.describe('node-packs.md §core.dispatch per-item input', 'one child dispatched per nextWorkerIds entry'),
    ).toBe(2);
    expect(
      body?.children?.map((c) => c.inputs?.contactId),
      driver.describe('node-packs.md §core.dispatch per-item input', 'each child receives its own nextWorkerInputs[i] (per-item value wins over inputMapping)'),
    ).toEqual(['c-1', 'c-2']);
  });

  it('a length-mismatched nextWorkerInputs fails with a validation_error and dispatches no child', async () => {
    const dispatch = await readCapabilityFamily<{ perItemInput?: boolean }>('dispatch');
    if (!behaviorGate('dispatch.perItemInput', dispatch?.perItemInput === true)) return;

    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }],
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    expect(
      res.status >= 400 && res.status < 500,
      driver.describe('node-packs.md §core.dispatch per-item input', 'nextWorkerInputs.length != nextWorkerIds.length MUST fail the dispatch node (4xx validation_error), dispatching no child'),
    ).toBe(true);
  });

  it('a host NOT advertising perItemInput MUST fail closed on a non-empty nextWorkerInputs', async () => {
    const dispatch = await readCapabilityFamily<{ supported?: boolean; perItemInput?: boolean }>('dispatch');
    if (!dispatch?.supported) return; // no dispatch surface → out of scope
    if (dispatch.perItemInput === true) return; // this leg targets non-supporting hosts

    const res = await driver.post('/v1/host/sample/dispatch/per-item', {
      nextWorkerIds: ['conformance.child', 'conformance.child'],
      nextWorkerInputs: [{ contactId: 'c-1' }, { contactId: 'c-2' }],
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    expect(
      res.status >= 400 && res.status < 500,
      driver.describe('node-packs.md §core.dispatch per-item input', 'a host not advertising perItemInput MUST fail closed (4xx) on a non-empty nextWorkerInputs — never silently drop it and dispatch N identical children'),
    ).toBe(true);
  });
});
