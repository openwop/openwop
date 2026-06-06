/**
 * Live pack-registry client (RFC 0003 / 0013 / 0043).
 *
 * Fetches the public registry index + per-pack detail straight from
 * `config.registryBaseUrl` (default packs.openwop.dev). The registry is
 * static JSON over HTTPS — no auth — so these are plain `fetch`es with
 * no credentials.
 *
 *   GET /v1/index.json                  → registry index (all packs)
 *   GET /v1/packs/<name>/index.json     → per-pack detail (versions[])
 *   <version>.json / .sig / .sbom.json  → manifest / signature / SBOM
 *
 * Per-version records carry the SRI `integrity`, `signingMethod`,
 * `signingKeyId`, and deprecated/yanked flags, so the browser surfaces
 * supply-chain provenance without downloading the tarball.
 */

import { config } from '../client/config.js';
import { assertArrayField, assertRecord } from '../client/parse.js';

export interface PackIndexEntry {
  name: string;
  kind: 'node' | 'agent' | string;
  latestVersion: string;
  description: string;
  license: string;
  tags: string[];
  typeIds: string[];
  nodeCount: number;
  agentCount: number;
  deprecated: boolean;
  yanked: boolean;
}

export interface PackVersionRecord {
  version: string;
  publishedAt: string;
  manifestUrl: string;
  tarballUrl: string;
  signatureUrl: string;
  signingMethod: string;
  signingKeyId: string;
  integrity: string;
  deprecated: boolean;
  yanked: boolean;
}

export interface PackDetail {
  name: string;
  kind: string;
  description: string;
  author?: string;
  license: string;
  homepage?: string;
  repository?: string;
  typeIds: string[];
  nodeCount: number;
  agentCount: number;
  versions: PackVersionRecord[];
  latest: string;
  deprecated: boolean;
}

export interface RegistryIndex {
  registryVersion: string;
  generatedAt: string;
  packCount: number;
  packs: PackIndexEntry[];
}

/** RFC 0043 trust tier inferred from the reverse-DNS namespace prefix. */
export type TrustTier = 'official' | 'vendor' | 'community' | 'unknown';

export function trustTierFor(packName: string): TrustTier {
  if (packName.startsWith('core.openwop.')) return 'official';
  if (packName.startsWith('vendor.')) return 'vendor';
  if (packName.startsWith('community.')) return 'community';
  return 'unknown';
}

export const TRUST_TIER_LABEL: Record<TrustTier, string> = {
  official: 'Official',
  vendor: 'Vendor',
  community: 'Community',
  unknown: 'Unverified',
};

/** Absolute URL for a registry-relative path (manifest/sig/sbom links
 *  in the index are root-relative, e.g. `/v1/packs/.../1.0.0.json`). */
export function registryUrl(relativePath: string): string {
  const base = config.registryBaseUrl.replace(/\/$/, '');
  return `${base}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
}

/** SBOM URL for a version record (sibling of the manifest, `.sbom.json`). */
export function sbomUrlFor(v: PackVersionRecord): string {
  return registryUrl(v.manifestUrl.replace(/\.json$/, '.sbom.json'));
}

async function getJson<T>(url: string, validate?: (v: unknown) => void): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Registry ${res.status} for ${url}`);
  const body: unknown = await res.json();
  // The registry is a separate, UNTRUSTED origin (packs.openwop.dev). Validate
  // the response is at least the expected shape before the cast (A-2 / E4), so
  // a malformed payload throws here instead of crashing a downstream `.map()`.
  if (validate) validate(body);
  else assertRecord(body, 'registry response');
  return body as T;
}

export function fetchRegistryIndex(): Promise<RegistryIndex> {
  // The index's `packs` array is immediately mapped over by the UI — assert it
  // is actually an array before the cast so a malformed registry response can't
  // crash the catalog (A-2 / E4).
  return getJson<RegistryIndex>(registryUrl('/v1/index.json'), (v) => assertArrayField(v, 'packs', 'registry index'));
}

export function fetchPackDetail(name: string): Promise<PackDetail> {
  return getJson<PackDetail>(registryUrl(`/v1/packs/${encodeURIComponent(name)}/index.json`));
}
