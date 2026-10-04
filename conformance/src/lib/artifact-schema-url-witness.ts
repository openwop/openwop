/**
 * The artifact canonical schema-URL witness (`artifact-type-packs.md`
 * §Schema distribution), unaided.
 *
 * "Its canonical URL and `$id` is
 * `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json`, served as
 * `application/schema+json`. A host advertising `artifactTypes` SHOULD serve
 * each installed type's schema there, and MUST for a host-registered type whose
 * `schemaVersion` it advertises."
 *
 * The MUST set is read from discovery alone: every `artifactTypes.types[id]`
 * with `registrationSource: "host"` and an integer `schemaVersion`
 * (`capabilities.schema.json`: the facet "discloses which §Schema distribution
 * regime applies"). For each, `GET {HostBase}/schemas/artifacts/{id}.schema.json`:
 *   served    answers `200`;
 *   media     with `Content-Type: application/schema+json`;
 *   schema    a JSON object whose `$id` is an absolute URL ending
 *             `/schemas/artifacts/{id}.schema.json`.
 * `{HostBase}` is the base the suite drives the host at (the v2 text does not
 * define it further), so the `$id`'s origin is not compared: a host fronted by
 * a public origin legitimately mints its `$id` there.
 *
 * {@link driveSchemaUrls} observes and asserts nothing; {@link judgeSchemaUrl}
 * is pure, proven in `artifact-schema-url-witness.test.ts`.
 */

import { driver } from './driver.js';
import type { MajorProfile } from './major-profile.js';
import { finding, isRecord, skip, type Finding, type Skip } from './fixture-run-observer.js';

const DOC = 'artifact-type-packs.md §Schema distribution';

export interface SchemaUrlObservation {
  readonly artifactTypeId: string;
  readonly path: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly json: unknown;
}

/** The host-registered types whose `schemaVersion` the host advertises, sorted. */
export function hostRegisteredTypes(profile: MajorProfile, doc: unknown): string[] | Skip {
  const fam = profile.family(doc, 'artifactTypes');
  if (fam === null) return skip('inapplicable', 'the host does not advertise artifactTypes');
  const types = isRecord(fam['types']) ? fam['types'] : {};
  const ids = Object.entries(types)
    .filter(([, t]) => isRecord(t) && t['registrationSource'] === 'host' && Number.isInteger(t['schemaVersion']))
    .map(([id]) => id)
    .sort();
  if (ids.length === 0) return skip('inapplicable', 'the host advertises no artifactTypes.types entry with registrationSource "host" and a schemaVersion — serving the canonical URL is only a SHOULD for the rest');
  return ids;
}

export const schemaPath = (artifactTypeId: string): string => `/schemas/artifacts/${encodeURIComponent(artifactTypeId)}.schema.json`;

/** Fetch each MUST-served schema. Asserts nothing. */
export async function driveSchemaUrls(profile: MajorProfile, doc: unknown): Promise<Skip | SchemaUrlObservation[]> {
  const ids = hostRegisteredTypes(profile, doc);
  if (!Array.isArray(ids)) return ids;
  const out: SchemaUrlObservation[] = [];
  for (const artifactTypeId of ids) {
    const path = schemaPath(artifactTypeId);
    const r = await driver.get(path, { headers: { Accept: 'application/schema+json, application/json' } });
    out.push({ artifactTypeId, path, status: r.status, contentType: r.headers.get('content-type'), json: r.json });
  }
  return out;
}

/** One type's served schema. Pure. */
export function judgeSchemaUrl(o: SchemaUrlObservation): Finding[] {
  const media = (o.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const id = isRecord(o.json) ? o.json['$id'] : undefined;
  let idOk = false;
  if (typeof id === 'string') {
    try { idOk = /^https?:$/.test(new URL(id).protocol) && id.endsWith(`/schemas/artifacts/${o.artifactTypeId}.schema.json`); } catch { idOk = false; }
  }
  return [
    finding(o.status === 200, DOC, `the host MUST serve host-registered ${o.artifactTypeId}'s schema at ${o.path} (got ${o.status})`),
    finding(media === 'application/schema+json', DOC, `${o.path} MUST be served as application/schema+json (got ${JSON.stringify(o.contentType)})`),
    finding(isRecord(o.json), DOC, `${o.path} MUST be a JSON Schema object`),
    finding(idOk, DOC, `the schema's $id MUST be its canonical URL, {HostBase}/schemas/artifacts/${o.artifactTypeId}.schema.json (got ${JSON.stringify(id)})`),
  ];
}
