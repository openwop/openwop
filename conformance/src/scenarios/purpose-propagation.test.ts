/**
 * Purpose-propagation — permitted-use labels (RFC 0128) —
 * `capabilities.md` §purposePropagation + `a2a-integration.md`
 * §"Purpose-propagation labels".
 *
 * The conformance-testable core of RFC 0128 §3: a host advertising
 * `capabilities.purposePropagation` MUST re-emit a received
 * `permittedPurposes` label on onward OpenWOP-envelope hops (MAY narrow,
 * MUST NOT widen), a derived output MUST NOT carry a purpose absent from any
 * contributing labelled input, and `[]`-labelled data MUST NOT be forwarded
 * onward at all. The internal-use restriction (§4) is deliberately NOT tested
 * — it is not observable over the wire.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probes:
 *      - a labelled TriggerEvent validates; a non-array label fails;
 *      - absent vs `[]` are distinct wire states (both validate — the
 *        semantic difference is behavioral, asserted in layer B);
 *      - the `capabilities.purposePropagation` family shape: `supported`
 *        REQUIRED, `additionalProperties:false`.
 *
 *   B. SEAM-gated behavioral legs via the two-hop seam
 *      `POST /v1/host/sample/purpose-propagation/forward` (the suite plays
 *      hop A — the labelled sender — and hop C — the onward receiver — around
 *      the host at B). Soft-skips ONLY when the seam is unwired (404/405) —
 *      deliberately NOT gated on `capabilities.purposePropagation.supported`,
 *      so the graduation witness runs on a host that is honest-OFF (advert
 *      prohibited until RFC 0128 is `Accepted`) yet serves the seam behind its
 *      feature flag. This mirrors RFC 0122's `self-hosted-runner` seam-gated
 *      legs (witnessed non-vacuously with `selfHostedRunner.supported:false`).
 *      Non-vacuity is proven by the seam being live + assertions running, and
 *      by the steward's independent curl — not by the advert:
 *      1. survive/narrow — a forwarded label arrives ⊆ what B received;
 *      2. never-widen — strictly no purpose beyond the input set;
 *      3. derived output — a merge of two labelled inputs arrives ⊆ their
 *         intersection (multi-input never-widen — transformation does not
 *         launder a grant);
 *      4. unlabelled inputs add no constraint to a merge;
 *      5. `[]` fail-closed — a `[]`-labelled record is dropped from onward
 *         emission, with an unlabelled twin as the positive control
 *         (non-arrival is evidence, not a timeout artifact).
 *
 * @see RFCS/0128-purpose-propagation-permitted-use-labels.md §3
 * @see spec/v1/capabilities.md §purposePropagation
 * @see spec/v1/a2a-integration.md §"Purpose-propagation labels"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const SEAM = '/v1/host/sample/purpose-propagation/forward';

interface OnwardEmission {
  recordId?: string;
  surface?: string;
  permittedPurposes?: string[];
}
interface ForwardResponse {
  onward?: OnwardEmission[];
  dropped?: string[];
}

function subsetOf(actual: string[] | undefined, allowed: string[]): boolean {
  return (actual ?? []).every((p) => allowed.includes(p));
}

describe('purpose-propagation: label schema (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'trigger-event.schema.json'), 'utf8')));
  const FIXTURE = join(FIXTURES_DIR, 'trigger-events', 'trigger-event-change.json');

  it('a labelled TriggerEvent validates; a non-array label fails', () => {
    const ev = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(validate(ev), req('openwop.it.purpose-propagation.a-labelled-triggerevent-validates-a-non-array-label-fails', 'RFC 0128', `a labelled TriggerEvent MUST validate (RFC 0128 §1). Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);

    ev.permittedPurposes = 'analytics';
    expect(validate(ev), req('openwop.it.purpose-propagation.a-labelled-triggerevent-validates-a-non-array-label-fails', 'RFC 0128', 'RFC 0128 §1 — permittedPurposes MUST be string[]')).toBe(false);
  });

  it('absent and [] are BOTH wire-valid — distinct states (unlabelled vs no-onward-use)', () => {
    const ev = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    delete ev.permittedPurposes;
    expect(validate(ev), req('openwop.it.purpose-propagation.absent-and-are-both-wire-valid-distinct-states-unlabelled-vs-no-onward-use', 'RFC 0128', 'RFC 0128 §1 — an unlabelled event (absent label) MUST validate')).toBe(true);
    ev.permittedPurposes = [];
    expect(validate(ev), req('openwop.it.purpose-propagation.absent-and-are-both-wire-valid-distinct-states-unlabelled-vs-no-onward-use', 'RFC 0128', 'RFC 0128 §1 — a []-labelled event MUST validate (behavioral meaning: no onward use)')).toBe(true);
  });

  it('the capabilities.purposePropagation family requires `supported` and closes its shape', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'));
    const fam = caps.properties?.purposePropagation;
    expect(fam, req('openwop.it.purpose-propagation.the-capabilities-purposepropagation-family-requires-supported-and-closes-its-sha', 'RFC 0128', 'capabilities.schema.json MUST define the purposePropagation family (RFC 0128 §2)')).toBeDefined();
    expect(fam.required, req('openwop.it.purpose-propagation.the-capabilities-purposepropagation-family-requires-supported-and-closes-its-sha', 'RFC 0128', 'purposePropagation MUST require `supported`')).toContain('supported');
    expect(fam.additionalProperties, req('openwop.it.purpose-propagation.the-capabilities-purposepropagation-family-requires-supported-and-closes-its-sha', 'RFC 0128', 'purposePropagation MUST close its shape')).toBe(false);
    const ajvFam = new Ajv2020({ allErrors: true, strict: false });
    const vf = ajvFam.compile(fam);
    expect(vf({ supported: true, propagatesOnward: true }), req('openwop.it.purpose-propagation.the-capabilities-purposepropagation-family-requires-supported-and-closes-its-sha', 'RFC 0128', 'the canonical advert MUST validate')).toBe(true);
    expect(vf({ propagatesOnward: true }), req('openwop.it.purpose-propagation.the-capabilities-purposepropagation-family-requires-supported-and-closes-its-sha', 'RFC 0128', 'an advert without `supported` MUST fail')).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('purpose-propagation: two-hop onward behavior (seam-gated)', () => {
  async function seamPost(body: Record<string, unknown>): Promise<ForwardResponse | null> {
    const res = await driver.post(SEAM, body);
    if (res.status === 404 || res.status === 405) return null; // seam unwired — soft-skip
    return (res.json as ForwardResponse | undefined) ?? {};
  }

  // SEAM-gated, NOT advertisement-gated (matches self-hosted-runner.test.ts). The
  // behavioral legs drive the `purpose-propagation/forward` seam and soft-skip on a
  // 404 (seam unwired). They deliberately do NOT gate on
  // `capabilities.purposePropagation.supported`, because the graduation witness runs
  // on a host that is honest-OFF (the advert is prohibited until RFC 0128 is
  // `Accepted`, `capabilities.md` §purposePropagation) yet serves the seam behind its
  // feature flag — exactly how RFC 0122's `self-hosted-runner` scenario witnessed
  // non-vacuously with `selfHostedRunner.supported:false`. Non-vacuity is proven by
  // the seam being live (assertions run against real onward/dropped output), verified
  // by the steward's independent curl, NOT by an advertised capability.

  it('a forwarded label survives ⊆ the received set (re-emit; MAY narrow, MUST NOT widen)', async () => {
    const input = ['analytics', 'marketing-email'];
    const res = await seamPost({ mode: 'forward', records: [{ id: 'r1', permittedPurposes: input, data: { k: 1 } }] });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');

    const onward = res.onward ?? [];
    expect(
      onward.length > 0,
      req('openwop.it.purpose-propagation.a-forwarded-label-survives-the-received-set-re-emit-may-narrow-must-not-widen', 'RFC 0128 §3', 'an advertising host MUST re-emit a received label on the onward hop — silent loss fails (the promise is propagation)'),
    ).toBe(true);
    for (const o of onward) {
      expect(
        Array.isArray(o.permittedPurposes) && subsetOf(o.permittedPurposes, input),
        req('openwop.it.purpose-propagation.a-forwarded-label-survives-the-received-set-re-emit-may-narrow-must-not-widen', 'RFC 0128 §3', `the onward label MUST be a subset of what the host received — got ${JSON.stringify(o.permittedPurposes)} vs input ${JSON.stringify(input)} (widening is the testable violation)`),
      ).toBe(true);
    }
  });

  it('a derived (merged) output arrives ⊆ the intersection of contributing labelled inputs', async () => {
    const res = await seamPost({
      mode: 'merge',
      records: [
        { id: 'a', permittedPurposes: ['analytics', 'marketing-email'], data: { k: 1 } },
        { id: 'b', permittedPurposes: ['analytics'], data: { k: 2 } },
      ],
    });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    const onward = res.onward ?? [];
    expect(onward.length > 0, req('openwop.it.purpose-propagation.a-derived-merged-output-arrives-the-intersection-of-contributing-labelled-inputs', 'RFC 0128 §3', 'a merge of forwardable labelled inputs MUST produce an onward emission')).toBe(true);
    for (const o of onward) {
      expect(
        subsetOf(o.permittedPurposes, ['analytics']),
        req('openwop.it.purpose-propagation.a-derived-merged-output-arrives-the-intersection-of-contributing-labelled-inputs', 'RFC 0128 §3', `a derived output MUST NOT carry a purpose absent from any contributing labelled input — transformation does not launder a grant; got ${JSON.stringify(o.permittedPurposes)}, allowed ⊆ ["analytics"]`),
      ).toBe(true);
    }
  });

  it('an unlabelled input adds no constraint to a merge', async () => {
    const res = await seamPost({
      mode: 'merge',
      records: [
        { id: 'a', permittedPurposes: ['analytics'], data: { k: 1 } },
        { id: 'b', data: { k: 2 } },
      ],
    });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    for (const o of res.onward ?? []) {
      expect(
        subsetOf(o.permittedPurposes, ['analytics']),
        req('openwop.it.purpose-propagation.an-unlabelled-input-adds-no-constraint-to-a-merge', 'RFC 0128 §3', 'an unlabelled input asserts no constraint — the derived label is still bounded by the labelled input(s)'),
      ).toBe(true);
    }
  });

  it('[]-labelled data is fail-closed dropped from onward emission (positive control: unlabelled twin forwards)', async () => {
    const res = await seamPost({
      mode: 'forward',
      records: [
        { id: 'blocked', permittedPurposes: [], data: { k: 1 } },
        { id: 'control', data: { k: 1 } },
      ],
    });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');

    const onwardIds = (res.onward ?? []).map((o) => o.recordId);
    expect(
      !onwardIds.includes('blocked'),
      req('openwop.it.purpose-propagation.labelled-data-is-fail-closed-dropped-from-onward-emission-positive-control-unlab', 'RFC 0128 §3', 'permittedPurposes: [] means no onward use — a conformant host MUST NOT forward []-labelled data to a further sink at all'),
    ).toBe(true);
    expect(
      (res.dropped ?? []).includes('blocked'),
      req('openwop.it.purpose-propagation.labelled-data-is-fail-closed-dropped-from-onward-emission-positive-control-unlab', 'RFC 0128 §3', 'the []-labelled record MUST be reported dropped (fail-closed, observable)'),
    ).toBe(true);
    expect(
      onwardIds.includes('control'),
      req('openwop.it.purpose-propagation.labelled-data-is-fail-closed-dropped-from-onward-emission-positive-control-unlab', 'RFC 0128 §3', 'the unlabelled twin (positive control) MUST forward — proving the non-arrival of the []-labelled record is the rule firing, not a dead seam'),
    ).toBe(true);
  });
});
