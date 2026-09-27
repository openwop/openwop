/**
 * ext-claims — the `claims-check` witness for an extension family (RFC 0220 §B).
 *
 * An extension family (`anchor: ext` in `spec/v2/declaration.json`) is
 * advertised as `extensions["<org>.<extensionName>"]` (capabilities.md §3.2),
 * where `extensionName` is the kebab-case name the declaration row carries —
 * the family key itself is camelCase and could never match the key pattern.
 *
 * `claims-check` checks the claim, not behavior (conformance.md §Witness
 * classes). For an org-shaped record that means exactly:
 *
 *   1. the key matches `extensionsKeyPattern`;
 *   2. its org is registered in the declaration and is not reserved;
 *   3. the record is a JSON object (not an array, not a scalar, not null);
 *   4. the family key is NOT also a member of the discovery root — an ext
 *      family is never a root family, and a root copy is a second claim the
 *      client would have to reconcile.
 *
 * `classifyExtClaim` is pure so the self-test can run each negative control
 * without a host; the scenario only reads discovery and calls it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_V2_DIR } from './paths.js';

type Json = Record<string, unknown>;

export interface ExtFamily {
  readonly key: string;
  readonly extensionName: string;
  readonly witness: string;
}

export interface ExtDeclaration {
  readonly families: readonly ExtFamily[];
  readonly registeredOrgs: ReadonlySet<string>;
  readonly reservedOrgs: ReadonlySet<string>;
  readonly keyPattern: RegExp;
}

let cached: ExtDeclaration | null | undefined;
/** The ext rows of the declaration, or `undefined` when it is not on disk in this layout. */
export function extDeclaration(): ExtDeclaration | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = null;
  const file = SPEC_V2_DIR ? join(SPEC_V2_DIR, 'declaration.json') : null;
  if (file && existsSync(file)) {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as Json;
      const fams = (Array.isArray(d['families']) ? d['families'] : []) as Json[];
      cached = {
        families: fams
          .filter((f) => f['anchor'] === 'ext' && typeof f['extensionName'] === 'string')
          .map((f) => ({ key: String(f['key']), extensionName: String(f['extensionName']), witness: String(f['witness']) })),
        registeredOrgs: new Set(Object.keys((d['extensions'] ?? {}) as Json)),
        reservedOrgs: new Set((Array.isArray(d['reservedOrgs']) ? d['reservedOrgs'] : []) as string[]),
        keyPattern: new RegExp(String(d['extensionsKeyPattern'])),
      };
    } catch { /* left null: unreadable and absent are the same soft-skip */ }
  }
  return cached ?? undefined;
}

export type ExtClaim =
  | { readonly state: 'absent' }
  | { readonly state: 'well-formed'; readonly key: string; readonly org: string }
  | { readonly state: 'malformed'; readonly key: string; readonly why: string };

/**
 * Every claim `discovery` makes for `family`, classified. A host that
 * advertises the family under more than one registered org yields one entry
 * per key; a host that advertises it nowhere yields `[{ state: 'absent' }]`.
 */
export function classifyExtClaim(discovery: Json, family: ExtFamily, decl: ExtDeclaration): ExtClaim[] {
  const ext = discovery['extensions'];
  const members = ext && typeof ext === 'object' && !Array.isArray(ext) ? Object.entries(ext as Json) : [];
  const suffix = `.${family.extensionName}`;
  const claims: ExtClaim[] = [];
  for (const [key, rec] of members) {
    if (!key.endsWith(suffix)) continue;
    const org = key.slice(0, -suffix.length);
    if (!decl.keyPattern.test(key)) { claims.push({ state: 'malformed', key, why: `the key does not match extensionsKeyPattern ${decl.keyPattern.source}` }); continue; }
    if (decl.reservedOrgs.has(org)) { claims.push({ state: 'malformed', key, why: `org '${org}' is reserved (declaration reservedOrgs); a host MUST NOT use it` }); continue; }
    if (!decl.registeredOrgs.has(org)) continue; // an unregistered org is someone else's name, not a claim on this family
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      claims.push({ state: 'malformed', key, why: `the record is ${rec === null ? 'null' : Array.isArray(rec) ? 'an array' : typeof rec}, not an object` });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(discovery, family.key)) {
      claims.push({ state: 'malformed', key, why: `the family key '${family.key}' is also a member of the discovery root; an ext family is advertised only under extensions` });
      continue;
    }
    claims.push({ state: 'well-formed', key, org });
  }
  return claims.length > 0 ? claims : [{ state: 'absent' }];
}
