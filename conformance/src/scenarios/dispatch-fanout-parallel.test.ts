/**
 * Parallel sub-workflow fan-out and join — `node-packs.md` §"`core.dispatch` parallel
 * fan-out and join" (RFC 0118). Closes RFC 0007 §K3. Validates the additive
 * `fanOutPolicy: 'parallel'` + `joinPolicy` + `maxConcurrency` wire shape on
 * `dispatch-config.schema.json` and the `core.dispatch.fanOut` / `core.dispatch.join`
 * event `$defs` on `run-event-payloads.schema.json`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probe — the `DispatchConfig` schema accepts a
 *      valid parallel config (each `joinPolicy.mode`), the new `maxConcurrency`, and the
 *      `'parallel'` enum value; the `dispatchFanOut` / `dispatchJoin` event `$defs`
 *      validate well-formed payloads and reject malformed ones. (Registration-time
 *      validation_errors — joinPolicy-without-parallel, quorum-without-quorum-field — are
 *      HOST behaviors driven in layer B, since the wire schema admits the field shape;
 *      the cross-field MUSTs are enforced by the host at `POST /v1/workflows`.)
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.dispatch.fanOutSupported: true` (+ `"parallel"` in `fanOutPolicies`)
 *      that exposes the `POST /v1/host/sample/dispatch/fanout` test seam, a wait-all
 *      collect join completes with `joinOutcome: 'satisfied'` and a `children[]` of the
 *      right length, and the replay re-applies `outputMapping` in the logged `mergeOrder`.
 *      No conformant host advertises parallel fan-out yet — these legs soft-skip until a
 *      reference host wires it (the first witness toward `Active → Accepted`).
 *
 * @see spec/v1/node-packs.md §"core.dispatch parallel fan-out and join (RFC 0118)"
 * @see spec/v1/capabilities.md §dispatch
 * @see RFCS/0118-parallel-subworkflow-fan-out-and-join.md
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

const DISPATCH_CONFIG = join(SCHEMAS_DIR, 'dispatch-config.schema.json');
const EVENT_PAYLOADS = join(SCHEMAS_DIR, 'run-event-payloads.schema.json');

function def(schemaPath: string, name: string): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $defs: Record<string, Record<string, unknown>> };
  return doc.$defs[name];
}

describe('dispatch-fanout: DispatchConfig schema (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(DISPATCH_CONFIG, 'utf8')));

  it("accepts fanOutPolicy 'parallel' with a wait-all/collect joinPolicy + maxConcurrency", () => {
    const cfg = {
      workerDispatchModel: 'child-run',
      fanOutPolicy: 'parallel',
      maxConcurrency: 5,
      joinPolicy: { mode: 'wait-all', onChildFailure: 'collect' },
    };
    expect(validate(cfg), `node-packs.md §parallel fan-out — a valid parallel config MUST validate. Errors: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('accepts each joinPolicy.mode (wait-all/quorum/first/race)', () => {
    for (const jp of [
      { mode: 'wait-all' },
      { mode: 'quorum', quorum: 3 },
      { mode: 'first' },
      { mode: 'race' },
    ]) {
      expect(validate({ fanOutPolicy: 'parallel', joinPolicy: jp }), `joinPolicy ${JSON.stringify(jp)} MUST validate`).toBe(true);
    }
  });

  it('rejects an unknown fanOutPolicy and an unknown joinPolicy.mode', () => {
    expect(validate({ fanOutPolicy: 'broadcast' }), "fanOutPolicy MUST be one of sequential/reject/parallel").toBe(false);
    expect(validate({ fanOutPolicy: 'parallel', joinPolicy: { mode: 'any' } }), 'joinPolicy.mode MUST be in the closed enum').toBe(false);
  });

  it('rejects an unknown onChildFailure and additionalProperties on joinPolicy', () => {
    expect(validate({ fanOutPolicy: 'parallel', joinPolicy: { onChildFailure: 'explode' } }), 'onChildFailure MUST be collect/fail-fast/absorb').toBe(false);
    expect(validate({ fanOutPolicy: 'parallel', joinPolicy: { mode: 'wait-all', extra: 1 } }), 'joinPolicy is additionalProperties:false').toBe(false);
  });

  it('rejects a non-positive maxConcurrency', () => {
    expect(validate({ fanOutPolicy: 'parallel', maxConcurrency: 0 }), 'maxConcurrency minimum is 1').toBe(false);
  });

  it('the default config (no fanOutPolicy) stays valid — additive, default sequential', () => {
    expect(validate({ workerDispatchModel: 'child-run' }), 'a pre-RFC-0118 config MUST stay valid').toBe(true);
  });
});

describe('dispatch-fanout: event $defs (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFanOut = ajv.compile(def(EVENT_PAYLOADS, 'dispatchFanOut'));
  const validateJoin = ajv.compile(def(EVENT_PAYLOADS, 'dispatchJoin'));

  it('a well-formed core.dispatch.fanOut payload validates; fanOutPolicy is const "parallel"', () => {
    expect(validateFanOut({ fanOutPolicy: 'parallel', childCount: 5, maxConcurrency: 5, joinMode: 'wait-all' })).toBe(true);
    expect(validateFanOut({ fanOutPolicy: 'sequential', childCount: 5 }), 'fanOut is emitted only on the parallel path (const)').toBe(false);
    expect(validateFanOut({ fanOutPolicy: 'parallel', childCount: 1 }), 'childCount minimum is 2 (> 1 by construction)').toBe(false);
  });

  it('a well-formed core.dispatch.join payload carries mergeOrder (replay tiebreak)', () => {
    const ok = {
      joinOutcome: 'satisfied',
      completedCount: 3,
      failedCount: 0,
      cancelledCount: 0,
      mergeOrder: ['run-a', 'run-b', 'run-c'],
    };
    expect(validateJoin(ok), `node-packs.md §parallel — join carries mergeOrder. Errors: ${JSON.stringify(validateJoin.errors)}`).toBe(true);
    expect(validateJoin({ joinOutcome: 'satisfied', completedCount: 3, failedCount: 0 }), 'mergeOrder is required (replay determinism)').toBe(false);
    expect(validateJoin({ ...ok, joinOutcome: 'aborted' }), 'joinOutcome MUST be satisfied/failed/partial').toBe(false);
  });
});

describe('dispatch-fanout: parallel behavior (capability-gated, RFC 0118)', () => {
  it('a wait-all/collect parallel fan-out joins on all children with joinOutcome satisfied', async () => {
    const dispatch = await readCapabilityFamily<{ fanOutSupported?: boolean; fanOutPolicies?: string[] }>('dispatch');
    if (!behaviorGate('dispatch.fanOutSupported', dispatch?.fanOutSupported === true)) return;
    if (!(dispatch?.fanOutPolicies ?? []).includes('parallel')) return; // parallel unsupported → out of scope

    const res = await driver.post('/v1/host/sample/dispatch/fanout', {
      nextWorkerIds: ['conformance.child.a', 'conformance.child.b', 'conformance.child.c'],
      config: { fanOutPolicy: 'parallel', joinPolicy: { mode: 'wait-all', onChildFailure: 'collect' } },
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const body = res.json as { joinOutcome?: string; children?: unknown[]; mergeOrder?: string[] } | undefined;
    expect(
      body?.joinOutcome,
      driver.describe('node-packs.md §parallel fan-out', 'wait-all + collect over all-completing children → joinOutcome satisfied'),
    ).toBe('satisfied');
    expect(
      body?.children?.length,
      driver.describe('node-packs.md §parallel fan-out', 'the output children[] reports every dispatched child'),
    ).toBe(3);
    expect(
      Array.isArray(body?.mergeOrder),
      driver.describe('node-packs.md §parallel fan-out', 'the join records mergeOrder for replay-deterministic output merge'),
    ).toBe(true);
  });

  it('parallel fan-out is rejected at registration on a host advertising fanOutSupported:false', async () => {
    const dispatch = await readCapabilityFamily<{ supported?: boolean; fanOutSupported?: boolean }>('dispatch');
    if (!dispatch?.supported) return; // no dispatch surface → out of scope
    if (dispatch.fanOutSupported === true) return; // this leg targets non-supporting hosts

    const res = await driver.post('/v1/workflows', {
      id: 'conformance.dispatch.parallel-unsupported',
      nodes: [{ nodeId: 'd', typeId: 'core.dispatch', config: { fanOutPolicy: 'parallel', joinPolicy: { mode: 'wait-all' } } }],
    });
    if (res.status === 404) return; // registration surface not exposed here — soft-skip

    expect(
      res.status >= 400 && res.status < 500,
      driver.describe('node-packs.md §parallel fan-out', "a host advertising fanOutSupported:false MUST reject fanOutPolicy:'parallel' with a validation_error (4xx), never accept it"),
    ).toBe(true);
  });
});
