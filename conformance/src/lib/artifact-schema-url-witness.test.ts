/**
 * The artifact canonical schema-URL witness at major 2, proven in both
 * directions against a run-graph double that serves (or fails to serve) the
 * schema of each advertised host-registered type. Each case turns on ONE defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { RunGraphDouble, type RawAnswer } from './run-graph-double.js';
import { driveSchemaUrls, hostRegisteredTypes, judgeSchemaUrl } from './artifact-schema-url-witness.js';

const V2 = majorProfile(2);
const ID = 'vendor.example.note';
const advert = (types: Record<string, unknown>): Record<string, unknown> => ({
  artifactTypes: { status: 'stable', since: '2.0', witness: 'witnessable-gated', store: true, types },
});
const HOST_TYPE = { [ID]: { validated: true, schemaVersion: 1, registrationSource: 'host' } };

type Defect = 'none' | 'not-served' | 'json-media' | 'no-id' | 'wrong-id';
let base = '';
function serve(defect: Defect): (path: string) => RawAnswer | undefined {
  return (path) => {
    if (path !== `/schemas/artifacts/${ID}.schema.json` || defect === 'not-served') return undefined;
    const schema: Record<string, unknown> = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };
    if (defect !== 'no-id') schema['$id'] = defect === 'wrong-id' ? `${base}/schemas/envelopes/${ID}.schema.json` : `${base}/schemas/artifacts/${ID}.schema.json`;
    return { status: 200, headers: { 'content-type': defect === 'json-media' ? 'application/json' : 'application/schema+json; charset=utf-8' }, body: JSON.stringify(schema) };
  };
}

const host = new RunGraphDouble({ discovery: advert(HOST_TYPE) });
beforeAll(async () => {
  base = await host.start();
  vi.stubEnv('OPENWOP_BASE_URL', base);
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });

async function failures(defect: Defect): Promise<string[]> {
  host.reconfigure({ onGet: serve(defect) });
  const o = await driveSchemaUrls(V2, host.discovery);
  if (!Array.isArray(o)) return [`skip:${o.disposition}`];
  return o.flatMap(judgeSchemaUrl).filter((x) => !x.ok).map((x) => x.message);
}

describe('artifact schema-URL witness at major 2 (artifact-type-packs.md §Schema distribution)', () => {
  it('a host serving each host-registered schema at its canonical URL passes', async () => {
    expect(await failures('none')).toEqual([]);
  });

  it.each<[Defect, RegExp]>([
    ['not-served', /MUST serve host-registered/],
    ['json-media', /application\/schema\+json/],
    ['no-id', /\$id MUST be its canonical URL/],
    ['wrong-id', /\$id MUST be its canonical URL/],
  ])('defect %s fails', async (defect, want) => {
    const f = await failures(defect);
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((m) => want.test(m))).toBe(true);
    if (defect !== 'not-served') expect(f).toHaveLength(1);
  });

  it('only host-registered types with an advertised schemaVersion are in the MUST set; none is inapplicable', () => {
    expect(hostRegisteredTypes(V2, advert({ ...HOST_TYPE, 'vendor.example.pack': { registrationSource: 'pack', schemaVersion: 1 }, 'vendor.example.nov': { registrationSource: 'host' } }))).toEqual([ID]);
    expect(hostRegisteredTypes(V2, advert({ 'vendor.example.pack': { registrationSource: 'pack', schemaVersion: 1 } }))).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(hostRegisteredTypes(V2, {})).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });
});
