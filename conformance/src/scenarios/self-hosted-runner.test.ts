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
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const GATE = 'openwop-self-hosted-runner';

// S40 (2026-08-18): every registration / dispatch id carries a per-run nonce. The
// seam drives the host's REAL runner registry + `{runId, stepId}` result store
// (host-sample-test-seams.md §19), so fixed ids (`runner_a_1`, `run_idem`/`step_1`)
// collide with the previous certification run on any host whose store outlives
// the process: the second run's FIRST dispatch is already `deduped:true` and the
// at-most-once leg no longer proves anything, and re-registering a fixed runnerId
// may be refused. Fresh ids per run keep both legs non-vacuous on a durable host.
const NONCE = randomUUID().slice(0, 8);
const SUBJECT_A = `subject_A_${NONCE}`;
const SUBJECT_B = `subject_B_${NONCE}`;

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
    expect(shr, req('openwop.it.self-hosted-runner.capabilities-schema-json-declares-selfhostedrunner-supported-with-required-suppo', 'RFC 0122', 'capabilities.md §selfHostedRunner — the block MUST be declared')).toBeDefined();
    expect(
      shr?.required,
      req('openwop.it.self-hosted-runner.capabilities-schema-json-declares-selfhostedrunner-supported-with-required-suppo', 'RFC 0122', 'RFC 0122 — selfHostedRunner.supported is REQUIRED when the block is present'),
    ).toContain('supported');
    expect(
      shr?.properties?.supported?.type,
      req('openwop.it.self-hosted-runner.capabilities-schema-json-declares-selfhostedrunner-supported-with-required-suppo', 'RFC 0122', 'selfHostedRunner.supported MUST be a boolean'),
    ).toBe('boolean');
    expect(
      shr?.additionalProperties,
      req('openwop.it.self-hosted-runner.capabilities-schema-json-declares-selfhostedrunner-supported-with-required-suppo', 'RFC 0122', 'selfHostedRunner MUST be a closed object'),
    ).toBe(false);
  });

  it('the dispatch frame schema pins {runId, stepId, seq, kind, inputs} with an integer cursor', () => {
    const s = readSchema('self-hosted-runner-dispatch-frame.schema.json');
    for (const f of ['runId', 'stepId', 'seq', 'kind', 'inputs']) {
      expect(s.required, req('openwop.it.self-hosted-runner.the-dispatch-frame-schema-pins-runid-stepid-seq-kind-inputs-with-an-integer-curs', 'RFC 0122', `dispatch frame MUST require '${f}'`)).toContain(f);
    }
    expect(s.additionalProperties, req('openwop.it.self-hosted-runner.the-dispatch-frame-schema-pins-runid-stepid-seq-kind-inputs-with-an-integer-curs', 'RFC 0122', 'dispatch frame MUST be a closed object')).toBe(false);
    expect(
      s.properties?.seq?.type,
      req('openwop.it.self-hosted-runner.the-dispatch-frame-schema-pins-runid-stepid-seq-kind-inputs-with-an-integer-curs', 'RFC 0122', 'RFC 0122 §Channel — the dispatch cursor `seq` MUST be an integer (distinct from the event-log sequence)'),
    ).toBe('integer');
    expect(s.properties?.kind?.enum, req('openwop.it.self-hosted-runner.the-dispatch-frame-schema-pins-runid-stepid-seq-kind-inputs-with-an-integer-curs', 'RFC 0122', "dispatch kind MUST be one of {model, tool}")).toEqual(
      expect.arrayContaining(['model', 'tool']),
    );
  });

  it('the result frame schema pins {runId, stepId, seq, output} and is closed', () => {
    const s = readSchema('self-hosted-runner-result-frame.schema.json');
    for (const f of ['runId', 'stepId', 'seq', 'output']) {
      expect(s.required, req('openwop.it.self-hosted-runner.the-result-frame-schema-pins-runid-stepid-seq-output-and-is-closed', 'RFC 0122', `result frame MUST require '${f}'`)).toContain(f);
    }
    // additionalProperties:false is the schema-level runner-credential-non-transit rail —
    // a runner cannot smuggle a credential field onto a result frame.
    expect(
      s.additionalProperties,
      req('openwop.it.self-hosted-runner.the-result-frame-schema-pins-runid-stepid-seq-output-and-is-closed', 'RFC 0122', 'result frame MUST be a closed object (runner-credential-non-transit)'),
    ).toBe(false);
  });

  it('the registration schema pins {runnerId, subject, capabilities} and is closed', () => {
    const s = readSchema('self-hosted-runner-registration.schema.json');
    for (const f of ['runnerId', 'subject', 'capabilities']) {
      expect(s.required, req('openwop.it.self-hosted-runner.the-registration-schema-pins-runnerid-subject-capabilities-and-is-closed', 'RFC 0122', `registration MUST require '${f}'`)).toContain(f);
    }
    expect(s.additionalProperties, req('openwop.it.self-hosted-runner.the-registration-schema-pins-runnerid-subject-capabilities-and-is-closed', 'RFC 0122', 'registration MUST be a closed object')).toBe(false);
    expect(
      s.properties?.capabilities?.additionalProperties,
      req('openwop.it.self-hosted-runner.the-registration-schema-pins-runnerid-subject-capabilities-and-is-closed', 'RFC 0122', 'registration.capabilities MUST be a closed object'),
    ).toBe(false);
  });
});

describe('self-hosted-runner: advertisement shape (gated)', () => {
  it('an advertised selfHostedRunner block is well-formed', async () => {
    const shr = await readCapabilityFamily<SelfHostedRunner>('selfHostedRunner');
    if (!behaviorGate(GATE, shr?.supported === true)) return;

    expect(
      typeof shr?.supported,
      req('openwop.it.self-hosted-runner.an-advertised-selfhostedrunner-block-is-well-formed', 'capabilities.md §selfHostedRunner', 'supported MUST be a boolean'),
    ).toBe('boolean');
    if (shr?.dispatchKinds !== undefined) {
      for (const k of shr.dispatchKinds) {
        expect(
          ['model', 'tool'],
          req('openwop.it.self-hosted-runner.an-advertised-selfhostedrunner-block-is-well-formed', 'capabilities.md §selfHostedRunner', `dispatchKinds entry '${k}' MUST be model|tool`),
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
      runnerId: `runner_b_${NONCE}`,
      subject: SUBJECT_B,
      capabilities: { providers: ['anthropic'] },
    });
    if (reg.status === 404) return softSkip('blocked', 'precondition not met — `reg.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const res = await driver.post(DISPATCH, {
      subject: SUBJECT_A,
      runId: `run_iso_${NONCE}`,
      stepId: 'step_0',
      seq: 0,
      kind: 'model',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      inputs: { messages: [] },
    });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');

    expect(
      res.status >= 400,
      req('openwop.it.self-hosted-runner.a-dispatch-for-a-subject-with-no-runner-fails-retriably-with-runner-unavailable', 'self-hosted-runner.md §Behavior#1', 'a subject-A dispatch MUST NOT route to a subject-B runner'),
    ).toBe(true);
    expect(
      errCode(res.json),
      req('openwop.it.self-hosted-runner.a-dispatch-for-a-subject-with-no-runner-fails-retriably-with-runner-unavailable', 'RFC 0122 §Behavior#5', 'a dispatch with no owning-subject runner MUST fail `runner_unavailable`'),
    ).toBe('runner_unavailable');
    expect(
      retriable(res.json),
      req('openwop.it.self-hosted-runner.a-dispatch-for-a-subject-with-no-runner-fails-retriably-with-runner-unavailable', 'RFC 0122 §Behavior#5', '`runner_unavailable` MUST be retriable'),
    ).toBe(true);
  });

  it('a redelivered {runId, stepId} dispatch is dropped, not re-executed (at-most-once)', async () => {
    const reg = await driver.post(REGISTER, {
      runnerId: `runner_a_${NONCE}`,
      subject: SUBJECT_A,
      capabilities: { providers: ['anthropic'] },
    });
    if (reg.status === 404) return softSkip('blocked', 'precondition not met — `reg.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const frame = {
      subject: SUBJECT_A,
      runId: `run_idem_${NONCE}`,
      stepId: 'step_1',
      seq: 0,
      kind: 'model',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      inputs: { messages: [] },
    };
    const first = await driver.post(DISPATCH, frame);
    if (first.status === 404) return softSkip('blocked', 'precondition not met — `first.status === 404` returned early (seam, prior step, or fixture unavailable)');
    // A host without a live runner backing the seam MAY answer runner_unavailable;
    // the at-most-once property is only observable when the first dispatch resolved.
    if (errCode(first.json) === 'runner_unavailable') return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `errCode(first.json) === \'runner_unavailable\'` returned early (A host without a live runner backing the seam MAY answer runner_unavailable; the at-most-once pro…');

    const second = await driver.post(DISPATCH, frame);
    const body = second.json as { deduped?: unknown };
    expect(
      body?.deduped,
      req('openwop.it.self-hosted-runner.a-redelivered-runid-stepid-dispatch-is-dropped-not-re-executed-at-most-once', 
        'self-hosted-runner.md §At-most-once dispatch',
        'a redelivered {runId, stepId} with a persisted result MUST be dropped (deduped:true), not re-dispatched',
      ),
    ).toBe(true);
  });
});
