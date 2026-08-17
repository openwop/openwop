/**
 * Self-hosted runner — remote-driven local execution (RFC 0122, `Active`).
 *
 * A host routes a run's per-step model/tool DISPATCH to a user-controlled runner
 * that dials OUT to the host (SSE receive + POST result) and holds local
 * credentials the host cannot reach. The host stays the sole orchestration/
 * persistence/replay authority; the runner is a stateless dispatch executor.
 *
 * Three assertion tiers (mirroring RFC 0108/0121 shape/behavior split):
 *   1. Schema shape (always-on, server-free) — the `selfHostedRunner` capability
 *      block + the dispatch-frame / result-frame / registration schema shapes.
 *   2. Advertisement-gated — the live `selfHostedRunner` block is well-formed
 *      (`supported` boolean; `dispatchKinds` ⊂ {model,tool}). Gated on
 *      `behaviorGate('openwop-self-hosted-runner', supported)`.
 *   3. Seam-gated behavioral — drives the `POST /v1/host/sample/runner/*` seams
 *      (`host-sample-test-seams.md` §19), soft-skipping on 404, to assert
 *      subject-first match (no cross-subject routing), at-most-once dispatch
 *      dedup, credential non-transit, and retriable `runner_unavailable` on
 *      liveness loss.
 *
 * RFC 0122 is `Active` (not `Accepted`): no reference host advertises
 * `selfHostedRunner.supported: true` yet, so tiers 2/3 soft-skip today; the
 * shape tier is the always-on floor.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/self-hosted-runner.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md §"selfHostedRunner"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0122-self-hosted-runner-remote-execution.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';

const GATE = 'openwop-self-hosted-runner';

interface JsonSchema {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  type?: string;
  enum?: string[];
  items?: JsonSchema;
}

function readSchema(name: string): JsonSchema {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as JsonSchema;
}

// S28 (2026-08-17): the HTTP error envelope is READ through lib/error-envelope.ts —
// flat `{ error: "<code>", message, details.retriable }` per error-envelope.schema.json
// (S22), with the pre-S22 nested `{ error: { code, retriable } }` tolerated only through
// the deprecation window. The local readers this replaced accepted top-level `retriable`
// or nested `error.retriable` and never `details.retriable`, so a schema-valid host could
// not pass the retriable-flag leg at all (openwop-app H27 → S28).
const errCode = readErrorCode;
const retriable = readRetriable;

interface SelfHostedRunner {
  supported?: boolean;
  dispatchKinds?: string[];
}

const REGISTER = '/v1/host/sample/runner/register';
const DISPATCH = '/v1/host/sample/runner/dispatch';

describe('self-hosted-runner: schema shape (RFC 0122, server-free)', () => {
  it('capabilities.schema.json declares selfHostedRunner {supported} with required supported', () => {
    const caps = readSchema('capabilities.schema.json');
    const shr = caps.properties?.selfHostedRunner;
    expect(shr, 'capabilities.md §selfHostedRunner — the block MUST be declared').toBeDefined();
    expect(
      shr?.required,
      'RFC 0122 — selfHostedRunner.supported is REQUIRED when the block is present',
    ).toContain('supported');
    expect(
      shr?.properties?.supported?.type,
      'selfHostedRunner.supported MUST be a boolean',
    ).toBe('boolean');
    expect(
      shr?.additionalProperties,
      'selfHostedRunner MUST be a closed object',
    ).toBe(false);
  });

  it('the dispatch frame schema pins {runId, stepId, seq, kind, inputs} with an integer cursor', () => {
    const s = readSchema('self-hosted-runner-dispatch-frame.schema.json');
    for (const f of ['runId', 'stepId', 'seq', 'kind', 'inputs']) {
      expect(s.required, `dispatch frame MUST require '${f}'`).toContain(f);
    }
    expect(s.additionalProperties, 'dispatch frame MUST be a closed object').toBe(false);
    expect(
      s.properties?.seq?.type,
      'RFC 0122 §Channel — the dispatch cursor `seq` MUST be an integer (distinct from the event-log sequence)',
    ).toBe('integer');
    expect(s.properties?.kind?.enum, "dispatch kind MUST be one of {model, tool}").toEqual(
      expect.arrayContaining(['model', 'tool']),
    );
  });

  it('the result frame schema pins {runId, stepId, seq, output} and is closed', () => {
    const s = readSchema('self-hosted-runner-result-frame.schema.json');
    for (const f of ['runId', 'stepId', 'seq', 'output']) {
      expect(s.required, `result frame MUST require '${f}'`).toContain(f);
    }
    // additionalProperties:false is the schema-level runner-credential-non-transit rail —
    // a runner cannot smuggle a credential field onto a result frame.
    expect(
      s.additionalProperties,
      'result frame MUST be a closed object (runner-credential-non-transit)',
    ).toBe(false);
  });

  it('the registration schema pins {runnerId, subject, capabilities} and is closed', () => {
    const s = readSchema('self-hosted-runner-registration.schema.json');
    for (const f of ['runnerId', 'subject', 'capabilities']) {
      expect(s.required, `registration MUST require '${f}'`).toContain(f);
    }
    expect(s.additionalProperties, 'registration MUST be a closed object').toBe(false);
    expect(
      s.properties?.capabilities?.additionalProperties,
      'registration.capabilities MUST be a closed object',
    ).toBe(false);
  });
});

describe('self-hosted-runner: advertisement shape (gated)', () => {
  it('an advertised selfHostedRunner block is well-formed', async () => {
    const shr = await readCapabilityFamily<SelfHostedRunner>('selfHostedRunner');
    if (!behaviorGate(GATE, shr?.supported === true)) return;

    expect(
      typeof shr?.supported,
      driver.describe('capabilities.md §selfHostedRunner', 'supported MUST be a boolean'),
    ).toBe('boolean');
    if (shr?.dispatchKinds !== undefined) {
      for (const k of shr.dispatchKinds) {
        expect(
          ['model', 'tool'],
          driver.describe('capabilities.md §selfHostedRunner', `dispatchKinds entry '${k}' MUST be model|tool`),
        ).toContain(k);
      }
    }
  });
});

describe('self-hosted-runner: behavioral (seam-gated, soft-skip 404)', () => {
  it('a dispatch for a subject with no runner fails retriably with runner_unavailable', async () => {
    // Register a runner for subject B only, then dispatch for subject A. The host
    // MUST NOT fall back to B's runner (subject-first isolation); with no runner
    // for A the dispatch MUST fail with the retriable `runner_unavailable`.
    const reg = await driver.post(REGISTER, {
      runnerId: 'runner_b_1',
      subject: 'subject_B',
      capabilities: { providers: ['anthropic'] },
    });
    if (reg.status === 404) return; // seam unwired — soft-skip

    const res = await driver.post(DISPATCH, {
      subject: 'subject_A',
      runId: 'run_iso',
      stepId: 'step_0',
      seq: 0,
      kind: 'model',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      inputs: { messages: [] },
    });
    if (res.status === 404) return;

    expect(
      res.status >= 400,
      driver.describe('self-hosted-runner.md §Behavior#1', 'a subject-A dispatch MUST NOT route to a subject-B runner'),
    ).toBe(true);
    expect(
      errCode(res.json),
      driver.describe('RFC 0122 §Behavior#5', 'a dispatch with no owning-subject runner MUST fail `runner_unavailable`'),
    ).toBe('runner_unavailable');
    expect(
      retriable(res.json),
      driver.describe('RFC 0122 §Behavior#5', '`runner_unavailable` MUST be retriable'),
    ).toBe(true);
  });

  it('a redelivered {runId, stepId} dispatch is dropped, not re-executed (at-most-once)', async () => {
    const reg = await driver.post(REGISTER, {
      runnerId: 'runner_a_1',
      subject: 'subject_A',
      capabilities: { providers: ['anthropic'] },
    });
    if (reg.status === 404) return;

    const frame = {
      subject: 'subject_A',
      runId: 'run_idem',
      stepId: 'step_1',
      seq: 0,
      kind: 'model',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      inputs: { messages: [] },
    };
    const first = await driver.post(DISPATCH, frame);
    if (first.status === 404) return;
    // A host without a live runner backing the seam MAY answer runner_unavailable;
    // the at-most-once property is only observable when the first dispatch resolved.
    if (errCode(first.json) === 'runner_unavailable') return;

    const second = await driver.post(DISPATCH, frame);
    const body = second.json as { deduped?: unknown };
    expect(
      body?.deduped,
      driver.describe(
        'self-hosted-runner.md §At-most-once dispatch',
        'a redelivered {runId, stepId} with a persisted result MUST be dropped (deduped:true), not re-dispatched',
      ),
    ).toBe(true);
  });
});
