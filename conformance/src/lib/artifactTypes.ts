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
/**
 * Capability-key lookup order (RFC 0137 G16, resolved 2026-08-05).
 *
 * The canonical discovery key for a `host.*` capability family is the PLAIN
 * family name at the document root — NOT the dotted identifier. Evidence:
 * `schemas/capabilities.schema.json` declares 82 properties and **zero** dotted
 * `host.*` keys, and five host capabilities are already declared plainly there —
 * `fs`, `kvStorage`, `tableStorage`, `queueBus`, `scheduling` — each mapping to a
 * `§host.<name>` section in `host-capabilities.md` (`§host.fs` ↔ `fs`, and so on).
 * The `host.` prefix is the capability IDENTIFIER notation used in prose headings,
 * pack `peerDependencies`, and `error.capability` — not the discovery-document key.
 *
 * These helpers previously read the dotted key ONLY, which made them the outlier
 * against five established precedents and rendered a schema-following host
 * INVISIBLE to the scenario — a silent soft-skip to green.
 *
 * Order: plain at root (canonical) → dotted at root → plain under the deprecated
 * `capabilities` wrapper → dotted under the wrapper. Root before wrapper per
 * `capabilities.md` §"Document-root layout (normative — RFC 0073)"; the wrapper
 * arms retire with the migration window at v2.0.
 */
export async function readArtifactTypesCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const doc = res.json as DiscoveryDoc | undefined;
  const caps = doc?.capabilities && typeof doc.capabilities === 'object'
    ? (doc.capabilities as Record<string, unknown>)
    : undefined;
  const cap = doc?.['artifactTypes'] ?? doc?.['host.artifactTypes'] ?? caps?.['artifactTypes'] ?? caps?.['host.artifactTypes'];
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

/**
 * Recursively strips `^(x-|vendor\.)` properties from a value, so two
 * registration projections can be compared for equality *modulo* the
 * extensions themselves (RFC 0139 §"The differential-install contract").
 *
 * A host that echoes the submitted manifest back inside its projection would
 * otherwise always differ — trivially, and for a reason that proves nothing.
 * Stripping is recursive because the echo can be nested at any depth.
 */
export function stripExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripExtensions);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(x-|vendor\.)/.test(k)) continue;
      out[k] = stripExtensions(v);
    }
    return out;
  }
  return value;
}

/** Deep-clones a manifest and hangs `extras` off its first `artifactTypes[]` entry AND its root. */
export function withExtensions(manifest: unknown, extras: Record<string, unknown>): unknown {
  const m = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  Object.assign(m, extras);
  const types = m['artifactTypes'];
  if (Array.isArray(types) && types.length > 0 && types[0] && typeof types[0] === 'object') {
    Object.assign(types[0] as Record<string, unknown>, extras);
  }
  return m;
}

/**
 * Stable stringify for projection comparison — key order must not decide the
 * verdict, or leg 3 would red on a host that serialises its map differently
 * between two calls and we would report an opacity violation that isn't one.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}
