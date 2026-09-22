/**
 * RFC 0200 §A — the shared gate and the derived URL for the protected-resource
 * scenarios.
 *
 * The gate is the lane, not a `.supported` seat: §A.1 binds a host that advertises an
 * `auth.lanes[]` member with `lane ∈ {oauth2, oidc}` and binds no other. A host with
 * neither records `inapplicable`; a host with one that then answers `404` at the derived
 * URL records an `executed-fail`, never a soft-skip — the lane is the advertisement and
 * the document is owed.
 *
 * @see spec/v2/core/identity.md §2.5
 * @see RFCS/0200-host-as-oauth-protected-resource.md §A, §B
 */

import { loadEnv } from './env.js';
import { v2Discovery } from './v2.js';
import type { SoftSkipKind } from './soft-skip.js';

export const PRM_SEGMENT = '/.well-known/oauth-protected-resource';

export interface Lane {
  readonly lane?: unknown;
  readonly issuers?: unknown;
  readonly minimumAssurance?: unknown;
  readonly delegationProofs?: unknown;
}

export type PrmGate =
  | { readonly ok: true; readonly doc: Record<string, unknown>; readonly lanes: readonly Lane[]; readonly resource: string; readonly prmUrl: string }
  | { readonly ok: false; readonly kind: SoftSkipKind; readonly reason: string };

/**
 * RFC 9728 §3 / §3.1 — insert `/.well-known/oauth-protected-resource` between the host
 * component and any path of the resource identifier, removing a terminating slash after
 * the host. A root-mounted host gets `https://h.example/.well-known/…`; a host under
 * `/api` gets `https://h.example/.well-known/…/api`.
 */
export function prmUrlFor(resource: string): string {
  const u = new URL(resource);
  const path = u.pathname.replace(/\/$/, '');
  return `${u.origin}${PRM_SEGMENT}${path}`;
}

/** The lanes §A.1 gates on, read off the live discovery document. */
export function oauthLanes(doc: Record<string, unknown>): Lane[] {
  const auth = doc['auth'] as { lanes?: unknown } | undefined;
  const lanes = Array.isArray(auth?.lanes) ? (auth.lanes as Lane[]) : [];
  return lanes.filter((l) => l.lane === 'oauth2' || l.lane === 'oidc');
}

/** Every lane the host advertises, OAuth or not — the mount leg reads this. */
export function allLanes(doc: Record<string, unknown>): Lane[] {
  const auth = doc['auth'] as { lanes?: unknown } | undefined;
  return Array.isArray(auth?.lanes) ? (auth.lanes as Lane[]) : [];
}

/**
 * The URL-form issuers of the OAuth lanes. `identity.md` §2.5 says
 * `authorization_servers` MUST list exactly these: a `urn:` trust root (the api-key,
 * session and anonymous lanes) is not an authorization server and is excluded.
 */
export function urlIssuers(lanes: readonly Lane[]): string[] {
  return [...new Set(lanes.flatMap((l) => (Array.isArray(l.issuers) ? l.issuers.map(String) : [])).filter((i) => /^https?:\/\//.test(i)))].sort();
}

export async function prmGate(): Promise<PrmGate> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable — the lanes cannot be read, so nothing is gated' };
  const lanes = oauthLanes(doc);
  if (lanes.length === 0) {
    return { ok: false, kind: 'inapplicable', reason: 'no auth.lanes[] member has lane oauth2 or oidc — RFC 0200 §A.1 does not bind this host (serving the metadata anyway is RECOMMENDED, not required, and is not measured here)' };
  }
  const resource = loadEnv().baseUrl;
  return { ok: true, doc, lanes, resource, prmUrl: prmUrlFor(resource) };
}

/** Parse a `WWW-Authenticate: Bearer k="v", …` value into its scheme and auth-params. */
export function parseChallenge(raw: string | null): { scheme: string; params: Record<string, string> } | null {
  if (raw === null || raw.trim() === '') return null;
  const m = /^\s*([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*(.*)$/s.exec(raw);
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const p of (m[2] ?? '').matchAll(/([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g)) {
    params[(p[1] as string).toLowerCase()] = (p[2] ?? p[3] ?? '');
  }
  return { scheme: (m[1] as string).toLowerCase(), params };
}
