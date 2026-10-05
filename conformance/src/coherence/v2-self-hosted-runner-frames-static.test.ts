/**
 * v2 — the self-hosted-runner frame and registration shapes, statically
 * (`spec/v2/core/execution.md` §selfHostedRunner; RFC 0122). The v1 twin is
 * the schema half of `self-hosted-runner`; its live legs (subject isolation,
 * `runner_unavailable`, at-most-once) need a runner seam and are not ported.
 *
 *   compile       the three schemas compile under Ajv 2020 with the v2 tree;
 *   dispatch      a model and a tool dispatch frame validate; a frame with no
 *                 `seq`, a non-integer or negative `seq`, an unknown `kind`, a
 *                 model frame without `provider`/`model`, or a tool frame
 *                 without `tool` is rejected;
 *   result        a result frame validates; one without `output` is rejected;
 *   closed        dispatch, result and registration (and its `capabilities`)
 *                 are closed objects, so no frame or record can carry a
 *                 credential field alongside the step ("A runner credential
 *                 MUST NOT transit the host or appear in any frame");
 *   registration  a registration validates; one without `subject` is rejected
 *                 (subject-first routing keys on it).
 *
 * The shape rules these schemas state bind the host's dispatch frames and its
 * registration record; the result frame is the runner's, so its legs witness
 * the corpus shape the host's intake is written against, not the host.
 *
 * A corpus gate (`conformance.md` §Two products): it reads only the corpus, runs in
 * the spec repo's CI, and never reaches a host bundle. Moved from src/scenarios/ in 2.45.18.
 *
 * @see spec/v2/core/execution.md §selfHostedRunner
 * @see schemas/v2/self-hosted-runner-dispatch-frame.schema.json
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';
import { V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';

const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';

const DOC = 'execution.md §selfHostedRunner';
const ID_COMPILE = 'openwop.requirement.self-hosted-runner.frame-schemas-compile';
const ID_DISPATCH = 'openwop.requirement.self-hosted-runner.dispatch-frame-shape';
const ID_RESULT = 'openwop.requirement.self-hosted-runner.result-frame-shape';
const ID_CLOSED = 'openwop.requirement.self-hosted-runner.frames-closed';
const ID_REGISTRATION = 'openwop.requirement.self-hosted-runner.registration-shape';

const SCHEMAS = ['self-hosted-runner-dispatch-frame', 'self-hosted-runner-result-frame', 'self-hosted-runner-registration'] as const;

const MODEL_FRAME = { runId: 'acme/run_x-xxxxxxxxxx', stepId: 'step_3', seq: 12, kind: 'model', provider: 'anthropic', model: 'claude-x', inputs: { messages: [] } } as const;
const TOOL_FRAME = { runId: 'acme/run_y-xxxxxxxxxx', stepId: 'step_1', seq: 0, kind: 'tool', tool: 'local.shell.readFile', inputs: { path: '/tmp/x' } } as const;
const RESULT = { runId: 'acme/run_x-xxxxxxxxxx', stepId: 'step_3', seq: 12, output: { role: 'assistant', content: 'ok' } } as const;
const REGISTRATION = { runnerId: 'runner_laptop_01', subject: 'user_42', capabilities: { providers: ['anthropic'], models: ['claude-x'] } } as const;

function without(o: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> {
  const c: Record<string, unknown> = { ...o };
  delete c[field];
  return c;
}

describe('v2 self-hosted-runner frames: schemas compile', () => {
  for (const name of SCHEMAS) {
    it(`${name}.schema.json compiles under Ajv 2020`, () => {
      if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
      expect(() => v2Validator(name), req(ID_COMPILE, DOC, `schemas/v2/${name}.schema.json MUST compile`)).not.toThrow();
    });
  }
});

describe('v2 self-hosted-runner frames: dispatch frame', () => {
  const validate = v2Validator('self-hosted-runner-dispatch-frame');

  it('accepts a model frame and a tool frame', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    for (const f of [MODEL_FRAME, TOOL_FRAME]) {
      const r = validate(f);
      expect(r.ok, req(ID_DISPATCH, DOC, `a well-formed ${f.kind} dispatch frame MUST validate (${r.errors})`)).toBe(true);
    }
  });

  it.each<[string, Record<string, unknown>]>([
    ['no seq cursor', without(MODEL_FRAME, 'seq')],
    ['a fractional seq', { ...MODEL_FRAME, seq: 1.5 }],
    ['a negative seq', { ...MODEL_FRAME, seq: -1 }],
    ['an unknown kind', { ...MODEL_FRAME, kind: 'agent' }],
    ['a model frame without provider', without(MODEL_FRAME, 'provider')],
    ['a model frame without model', without(MODEL_FRAME, 'model')],
    ['a tool frame without tool', without(TOOL_FRAME, 'tool')],
    ['no stepId (the at-most-once key)', without(MODEL_FRAME, 'stepId')],
  ])('rejects %s', (_what, frame) => {
    expect(validate(frame).ok, req(ID_DISPATCH, DOC, `a dispatch frame with ${_what} MUST be rejected`)).toBe(false);
  });
});

describe('v2 self-hosted-runner frames: result frame', () => {
  const validate = v2Validator('self-hosted-runner-result-frame');

  it('accepts a result frame', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const r = validate(RESULT);
    expect(r.ok, req(ID_RESULT, DOC, `a well-formed result frame MUST validate (${r.errors})`)).toBe(true);
  });

  it('rejects a result frame without output', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(validate(without(RESULT, 'output')).ok, req(ID_RESULT, DOC, 'a result frame without output MUST be rejected')).toBe(false);
  });
});

describe('v2 self-hosted-runner frames: closed shapes carry no credential field', () => {
  it.each<[string, string, Record<string, unknown>]>([
    ['dispatch frame', 'self-hosted-runner-dispatch-frame', { ...MODEL_FRAME, apiKey: 'sk-canary' }],
    ['result frame', 'self-hosted-runner-result-frame', { ...RESULT, credential: 'sk-canary' }],
    ['registration', 'self-hosted-runner-registration', { ...REGISTRATION, bearer: 'sk-canary' }],
    ['registration capabilities', 'self-hosted-runner-registration', { ...REGISTRATION, capabilities: { providers: ['anthropic'], apiKeys: { anthropic: 'sk-canary' } } }],
  ])('a %s with an extra credential-named field is rejected', (what, schema, doc) => {
    expect(v2Validator(schema)(doc).ok, req(ID_CLOSED, DOC, `the ${what} is closed: a runner credential MUST NOT appear in any frame`)).toBe(false);
  });
});

describe('v2 self-hosted-runner frames: registration', () => {
  const validate = v2Validator('self-hosted-runner-registration');

  it('accepts a registration', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const r = validate(REGISTRATION);
    expect(r.ok, req(ID_REGISTRATION, DOC, `a well-formed registration MUST validate (${r.errors})`)).toBe(true);
  });

  it('rejects a registration without subject', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(validate(without(REGISTRATION, 'subject')).ok, req(ID_REGISTRATION, DOC, 'a registration without its owning subject MUST be rejected')).toBe(false);
  });
});
