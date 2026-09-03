/**
 * artifact-type-store-emission — RFC 0142, the witness for the corpus's ONLY
 * artifact.created emission MUST.
 *
 * `artifact-type-packs.md` §"Host capability", `store` row: "The host persists
 * artifacts of registered types and emits `artifact.created`. A host
 * advertising `store: true` MUST do so." Every other artifact-type leg gates
 * on `supported: true`, which carries NO emission obligation — so this MUST
 * was unreachable by the suite in BOTH directions: a `store: true` host that
 * never emits passed everything, and a host emitting correctly (the reference
 * host, as it turned out) was never credited either.
 *
 * LEG A (always-on, server-free) pins the payload fact the RFC 0138 replay
 * correction rests on: `artifactCreated` REQUIRES `artifactType`. Previously
 * exercised only by a leg that spent most of its life as a bare-return skip.
 *
 * LEG B (behavioral) applies ONLY to hosts advertising `store: true`:
 *   - facet absent/false → INAPPLICABLE, plain return in both modes. `store`
 *     is optional; strict mode must not coerce hosts into advertising it
 *     (the `artifact-type-store-without-render` precedent, deliberately kept
 *     a non-gate in the RFC 0139 flip).
 *   - advertised + seam absent → behaviorGate: skip default, FAIL strict.
 *   - advertised + seam present → drive a REAL run via
 *     `POST /v1/host/sample/artifacttypes/runproduce` and read the STANDARD
 *     `GET /v1/runs/{runId}/events/poll` — the wire surface any consumer
 *     uses — asserting `artifact.created` is present with the bound
 *     `artifactType` and `registered: true`. The evidence is the event log,
 *     which is the thing the MUST is about.
 *
 * The `store` facet is PER-TYPE-scoped, so both the capability object and
 * per-type entries are checked — a capability-level-only read would miss a
 * host advertising store on individual types.
 *
 * @see spec/v1/artifact-type-packs.md §"Host capability — host.artifactTypes"
 * @see RFCS/0142-store-gated-emission-witness.md
 * @see conformance/coverage.md §"Open seams"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { behaviorGate, behaviorGatePresent } from '../lib/behavior-gate.js';
import { readArtifactTypesCap } from '../lib/artifactTypes.js';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PROFILE = 'openwop-artifact-type-store';

describe('artifact-type-store-emission: the payload fact is pinned always-on (RFC 0142 leg A)', () => {
  it('artifactCreated REQUIRES artifactType — the fact the RFC 0138 replay correction rests on', () => {
    const schema = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8'),
    ) as { $defs?: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
    const ac = schema.$defs?.['artifactCreated'];
    expect(ac !== undefined, req('openwop.it.artifact-type-store-emission.artifactcreated-requires-artifacttype-the-fact-the-rfc-0138-replay-correction-re', 'RFC 0138', 'run-event-payloads.schema.json — $defs/artifactCreated exists')).toBe(true);
    expect(
      ac?.required?.includes('artifactType'),
      req('openwop.it.artifact-type-store-emission.artifactcreated-requires-artifacttype-the-fact-the-rfc-0138-replay-correction-re', 
        'run-event-payloads.schema.json §artifactCreated',
        'artifactType is REQUIRED on the artifact.created payload — artifactTypeId values ride in the fixed event log, which is why identifier migrations MUST NOT rewrite history (RFC 0141) and why this fact must be pinned by an always-on leg rather than a gated one (RFC 0138 G8)',
      ),
    ).toBe(true);
    expect(
      Object.keys(ac?.properties ?? {}).includes('registered'),
      req('openwop.it.artifact-type-store-emission.artifactcreated-requires-artifacttype-the-fact-the-rfc-0138-replay-correction-re', 'run-event-payloads.schema.json §artifactCreated', 'the registered flag the store-tier validation promise is reported through is present'),
    ).toBe(true);
  });
});

describe('artifact-type-store-emission: what `store: true` claims is stated normatively (RFC 0142 scope ruling)', () => {
  // Leg B can pass against a host on which only ONE path emits, if the seam happens to route
  // through that path. What forecloses that is not a test but the scope of the advert itself,
  // so the scope has to live in the document a host implements against — and be pinned, or a
  // later edit quietly restores the permissive reading and leg B goes back to certifying a
  // host the facet describes falsely.
  const doc = V1_DIR ? readFileSync(join(V1_DIR, 'artifact-type-packs.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('the claim is quantified over artifacts of the type, not over the host\'s paths', () => {
    expect(
      /\*\*every\*\* path by which the host persists an artifact carrying that registered `artifactTypeId` MUST emit `artifact\.created`/.test(doc),
      req('openwop.it.artifact-type-store-emission.the-claim-is-quantified-over-artifacts-of-the-type-not-over-the-host-s-paths', 
        'artifact-type-packs.md §"Sub-flags"',
        'EVERY production path emits, not at least one — the permissive reading lets a host wire the leg-B seam through its single emitting path and pass while most of its production stays silent',
      ),
    ).toBe(true);
    expect(
      /MUST NOT advertise `store: true` for that type/.test(doc),
      req('openwop.it.artifact-type-store-emission.the-claim-is-quantified-over-artifacts-of-the-type-not-over-the-host-s-paths', 'artifact-type-packs.md §"Sub-flags"', 'a host with a silent persistence path for the type is forbidden from advertising it, rather than merely discouraged'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('the obligation is scoped to REGISTERED types, so the unregistered tier does not falsify an advert', () => {
    expect(
      /a path that persists only unregistered artifacts[^.]*is outside this facet and does not falsify the advert/.test(doc),
      req('openwop.it.artifact-type-store-emission.the-obligation-is-scoped-to-registered-types-so-the-unregistered-tier-does-not-f', 
        'artifact-type-packs.md §"Sub-flags"',
        'the narrowing is normative, not a courtesy — without it a host holds back an honest advert on account of a path the facet never bound',
      ),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('per-type is named as the instrument, including the case it cannot rescue', () => {
    expect(
      /cannot be advertised `store: true` at all until one of those two facts changes/.test(doc),
      req('openwop.it.artifact-type-store-emission.per-type-is-named-as-the-instrument-including-the-case-it-cannot-rescue', 
        'artifact-type-packs.md §"Sub-flags"',
        'a single type produced through both an emitting and a non-emitting path is not advertisable — per-type resolves a heterogeneous fleet, not a heterogeneous type',
      ),
    ).toBe(true);
  });
});

/** Reads the `store` facet at BOTH scopes: capability-level and per-type. */
function storeAdvertised(cap: Record<string, unknown> | null): boolean {
  if (!cap) return false;
  if (cap['store'] === true) return true;
  const types = cap['types'];
  if (types && typeof types === 'object') {
    return Object.values(types as Record<string, unknown>).some(
      (t) => !!t && typeof t === 'object' && (t as Record<string, unknown>)['store'] === true,
    );
  }
  return false;
}

/** First per-type id advertising store:true, else null (capability-level store binds all). */
function storeTypeId(cap: Record<string, unknown> | null): string | null {
  const types = cap?.['types'];
  if (types && typeof types === 'object') {
    for (const [id, t] of Object.entries(types as Record<string, unknown>)) {
      if (!!t && typeof t === 'object' && (t as Record<string, unknown>)['store'] === true) return id;
    }
  }
  return null;
}

describe('artifact-type-store-emission: a store:true host MUST emit, witnessed from a real run (RFC 0142 leg B)', () => {
  it('artifact.created appears in the event log with the bound artifactType and registered:true', async () => {
    const cap = await readArtifactTypesCap();
    // `store` is OPTIONAL. A host that does not advertise it is INAPPLICABLE —
    // not gated: strict mode must not coerce hosts into an advertisement.
    if (!storeAdvertised(cap)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!storeAdvertised(cap)` returned early (scenario inapplicable)'); // scenario inapplicable

    const requested = storeTypeId(cap) ?? 'vendor.conformance.note';
    const started = await driver.post('/v1/host/sample/artifacttypes/runproduce', {
      artifactTypeId: requested,
    });
    const seamPresent = started.status !== 404 && started.status !== 405;
    if (!behaviorGate(PROFILE, seamPresent)) return; // advertised + no seam: skip default, FAIL strict

    expect(
      started.status >= 200 && started.status < 300,
      req('openwop.it.artifact-type-store-emission.artifact-created-appears-in-the-event-log-with-the-bound-artifacttype-and-regist', 'coverage.md §"Open seams"', 'runproduce starts a real run producing one artifact of the requested registered type'),
    ).toBe(true);
    const runId = (started.json as Record<string, unknown> | undefined)?.['runId'];
    if (!behaviorGatePresent(PROFILE, typeof runId === 'string' ? runId : null)) return;

    const events = await driver.get(`/v1/runs/${runId}/events/poll?timeout=5`);
    expect(
      events.status,
      req('openwop.it.artifact-type-store-emission.artifact-created-appears-in-the-event-log-with-the-bound-artifacttype-and-regist', 'run-events surface', 'the run event log is readable over the standard poll endpoint — the same wire any consumer uses'),
    ).toBe(200);
    const list = ((events.json as Record<string, unknown>)?.['events'] ?? []) as Array<Record<string, unknown>>;
    const created = list.filter((e) => e['type'] === 'artifact.created');

    expect(
      created.length > 0,
      req('openwop.it.artifact-type-store-emission.artifact-created-appears-in-the-event-log-with-the-bound-artifacttype-and-regist', 
        'artifact-type-packs.md §"Host capability", store row',
        'a host advertising store:true MUST emit artifact.created — persistence without emission is the exact posture the advertisement forbids',
      ),
    ).toBe(true);

    const payload = (created[0]?.['payload'] ?? created[0]?.['data'] ?? {}) as Record<string, unknown>;
    expect(
      payload['artifactType'],
      req('openwop.it.artifact-type-store-emission.artifact-created-appears-in-the-event-log-with-the-bound-artifacttype-and-regist', 
        'run-event-payloads.schema.json §artifactCreated',
        'the emitted artifactType is the bound id — an event present but carrying the wrong type would let a mis-wired emitter pass a presence-only check',
      ),
    ).toBe(requested);
    expect(
      payload['registered'],
      req('openwop.it.artifact-type-store-emission.artifact-created-appears-in-the-event-log-with-the-bound-artifacttype-and-regist', 
        'artifact-type-packs.md §"Binding the existing artifact surfaces"',
        'a store-tier host validates before emitting and reports registered:true for a registered type',
      ),
    ).toBe(true);
  });
});
