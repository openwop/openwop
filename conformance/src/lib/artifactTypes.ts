/**
 * Shared helpers for the RFC 0071 host.artifactTypes conformance scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/artifactTypes.js`.
 *
 * The behavioral scenarios drive a documented host-extension seam — hosts
 * wiring RFC 0071 Phase 1 (artifact-type packs) expose:
 *
 *   POST /v1/host/sample/artifacttypes/install
 *     body: { manifest: <artifact-type-pack manifest>,
 *             schemas: { "<artifactTypeId>": <JSON Schema> } }
 *     → 2xx { installed: true, artifactTypeIds: string[] }
 *
 *   POST /v1/host/sample/artifacttypes/produce
 *     body: { artifactTypeId: string, payload: unknown }
 *     → 2xx {
 *         artifactId: string,
 *         registered: boolean,   // matched an installed artifact-type pack
 *         validated: boolean,    // payload checked against the pack schema
 *         stored: boolean,       // persisted (host.artifactTypes.store)
 *         rendered: boolean,     // a renderer ran (host.artifactTypes.render)
 *         runStatus: 'completed' | 'failed',
 *         artifactCreated?: { registered?: boolean, artifactType?: string }  // the emitted event
 *       }
 *
 * Either seam returning 404/405 means the host hasn't wired it → soft-skip.
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
  // host.* capabilities may also appear top-level per host-capabilities.md §"The contract pattern".
  [k: string]: unknown;
}

/** Reads `host.artifactTypes` from discovery (capabilities block or top-level); null when unadvertised. */
export async function readArtifactTypesCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const doc = res.json as DiscoveryDoc | undefined;
  const fromCaps = doc?.capabilities && typeof doc.capabilities === 'object'
    ? (doc.capabilities as Record<string, unknown>)['host.artifactTypes']
    : undefined;
  const cap = fromCaps ?? doc?.['host.artifactTypes'];
  return cap && typeof cap === 'object' ? (cap as Record<string, unknown>) : null;
}

export function artifactTypesSupported(cap: Record<string, unknown> | null): boolean {
  return cap?.['supported'] === true;
}

/** Installs an artifact-type pack via the host-sample seam, or null (soft-skip) when absent. */
export async function installArtifactTypePack(
  manifest: unknown,
  schemas: Record<string, unknown>,
): Promise<{ status: number; json: unknown } | null> {
  const res = await driver.post('/v1/host/sample/artifacttypes/install', { manifest, schemas });
  if (res.status === 404 || res.status === 405) return null;
  return { status: res.status, json: res.json };
}

/** Produces an artifact of `artifactTypeId` via the host-sample seam, or null (soft-skip) when absent. */
export async function produceArtifact(
  artifactTypeId: string,
  payload: unknown,
): Promise<{ status: number; json: Record<string, unknown> } | null> {
  const res = await driver.post('/v1/host/sample/artifacttypes/produce', { artifactTypeId, payload });
  if (res.status === 404 || res.status === 405) return null;
  return { status: res.status, json: (res.json ?? {}) as Record<string, unknown> };
}

/** A minimal valid artifact-type pack + schema pair the scenarios install. */
export function sampleArtifactTypePack() {
  const artifactTypeId = 'vendor.conformance.note';
  const manifest = {
    kind: 'artifact-type',
    name: 'vendor.conformance.notes',
    version: '1.0.0',
    engines: { openwop: '>=1.1' },
    artifactTypes: [
      {
        artifactTypeId,
        schemaVersion: 1,
        schemaRef: 'schemas/note.schema.json',
        rendering: { display: 'markdown' },
      },
    ],
  };
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://h.example/schemas/artifacts/vendor.conformance.note.schema.json',
    type: 'object',
    additionalProperties: false,
    required: ['title', 'body'],
    properties: { title: { type: 'string' }, body: { type: 'string' } },
  };
  return { artifactTypeId, manifest, schema };
}
