/**
 * The major-2 profile derivation: `spec/v2/profiles.json` as a predicate over a
 * DECLARATION (RFC 0169 §C.1).
 *
 * ## Why this is its own module
 *
 * There were two implementations of "does this document derive this profile",
 * and only one of them knew that major 2 exists.
 *
 * The EMITTER (`cli.ts`) branched on the target major and, at 2, read this
 * registry. The VERIFIER (`certification-bundle-v3.ts`) called
 * `profiles.profileDerivable`, which is the v1 catalog: `isCore` wants a scalar
 * `protocolVersion` whose major is `1`, plus `supportedEnvelopes`,
 * `schemaVersions` and `limits.clarificationRounds`. A v2 declaration has none
 * of those — RFC 0169 restructured the root into `protocolVersions` /
 * `preferredVersion` and family records — so the verifier's answer for every
 * real v2 host was `false`, and a bundle that correctly claimed
 * `openwop-discovery-core` was refused with `profile-not-derivable`: "the host
 * does not advertise it", about a host that advertised exactly it.
 *
 * The emitter and the verifier now call THIS function, so they cannot disagree
 * again. That is the point of the module boundary — not tidiness.
 *
 * ## Unevaluable is not false
 *
 * `v2ProfileIds` returns `null`, not `[]`, when the registry cannot be read.
 * The distinction is load-bearing. `[]` would make every certified profile
 * underivable and reject the bundle — converting a fact about the SUITE'S
 * layout (the corpus file is missing from this install) into a verdict about
 * the HOST (it does not advertise what it advertises). `conformance.md`
 * §"Whose fact is the reason?" forbids exactly that substitution: where the
 * predicate is a fact about the suite, the row records the gap rather than
 * spending the host's evidence. Here the gap is `derivabilityChecked: false`,
 * the flag v3 already carries for a bundle that shipped no document.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_V2_DIR } from './paths.js';
import type { DiscoveryPayload } from './profiles.js';

interface V2RegistryEntry {
  readonly id?: unknown;
  readonly predicate?: { readonly families?: unknown; readonly metadata?: unknown };
}

/**
 * Path to `spec/v2/profiles.json`, or null when this layout has no v2 corpus.
 *
 * Anchored on `SPEC_V2_DIR` — one resolver, already correct for all three
 * layouts (env override, repo checkout, published install with the
 * `@openwop/spec-artifacts` peer). The shape this replaces resolved the peer
 * through Node AND kept three guessed directory candidates underneath it,
 * under a docblock that said it resolved "instead of guessing directory
 * shapes". The guesses were the half of that fix that never landed.
 */
export function v2RegistryPath(): string | null {
  if (SPEC_V2_DIR === null) return null;
  const path = join(SPEC_V2_DIR, 'profiles.json');
  return existsSync(path) ? path : null;
}

function readRegistry(): readonly V2RegistryEntry[] | null {
  const found = v2RegistryPath();
  if (found === null) return null;
  try {
    const parsed = JSON.parse(readFileSync(found, 'utf8')) as { profiles?: V2RegistryEntry[] };
    return parsed.profiles ?? [];
  } catch {
    return null;
  }
}

/** True when the registry is present AND parseable, so derivability can be decided at all. */
export function v2RegistryAvailable(): boolean {
  return readRegistry() !== null;
}

/**
 * Every profile the declaration derives at major 2, or `null` when the registry
 * is unavailable (see the module docblock — `null` is not `[]`).
 *
 * The predicate is the registry's own: every listed family present as a record,
 * every listed metadata key present at the root. Nothing here is hand-written
 * per profile, so adding a v2 profile is a corpus edit and not a code edit.
 */
export function v2ProfileIds(doc: DiscoveryPayload): readonly string[] | null {
  const profiles = readRegistry();
  if (profiles === null) return null;
  const root = doc as unknown as Record<string, unknown>;
  const isRecord = (k: string): boolean => {
    const v = root[k];
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  };
  const out: string[] = [];
  for (const p of profiles) {
    if (typeof p.id !== 'string') continue;
    const families = Array.isArray(p.predicate?.families) ? (p.predicate.families as unknown[]).map(String) : [];
    const metadata = Array.isArray(p.predicate?.metadata) ? (p.predicate.metadata as unknown[]).map(String) : [];
    if (families.every(isRecord) && metadata.every((k) => root[k] !== undefined)) out.push(p.id);
  }
  return out;
}

/**
 * Is `profile` derivable from `doc` at major 2? False when the registry is
 * unavailable — callers that must distinguish "not derivable" from "could not
 * be decided" check {@link v2RegistryAvailable} first, as the v3 verifier does.
 */
export function v2ProfileDerivable(doc: DiscoveryPayload, profile: string): boolean {
  return v2ProfileIds(doc)?.includes(profile) ?? false;
}

/**
 * Which of `profileIds` a relaxed obligation denies (RFC 0173 §A.2;
 * `security-defaults.md` §Relaxations: "a bundle that records a relaxation MUST
 * NOT certify the profile the relaxed obligation belongs to").
 *
 * An obligation is `<family>.<name>`. A profile OWNS a family when its registry
 * predicate lists it — `openwop-core-standard` is built on `interrupt`, `replay`,
 * `webhooks`, `idempotency`, `eventLog`, so a relaxation on any of those denies
 * it. That ownership was always stated in `spec/v2/profiles.json`; nothing read
 * it. Until 2.33.0 the verifier tested whether the profile ID contained the
 * family name, and the emitter tested whether it contained the WHOLE obligation
 * string — two different rules under a comment saying they matched — and since
 * no real v2 profile id contains a family name, a declared relaxation denied
 * nothing on any real host. The one scenario pinning the rule used a fixture
 * profile called `openwop-webhooks`, which is why it stayed green.
 *
 * The id-substring rule is KEPT as a second arm, not replaced: it is how a
 * non-registry profile id (a v1 alias, a fixture) names its family, and
 * dropping it would un-deny something that is denied today. When the registry
 * is unavailable only that arm can run; the caller already records that layout
 * as `derivabilityChecked: false`.
 *
 * ONE function, called by the emitter and the verifier, so the file and the
 * verdict on the file cannot disagree again.
 */
export function profilesRelaxedBy(obligations: readonly string[], profileIds: readonly string[]): ReadonlySet<string> {
  const families = new Set(obligations.map((o) => o.split('.')[0] ?? '').filter((f) => f.length > 0));
  const out = new Set<string>();
  if (families.size === 0) return out;
  const registry = readRegistry();
  const owned = new Map<string, readonly string[]>();
  for (const p of registry ?? []) {
    if (typeof p.id === 'string') owned.set(p.id, Array.isArray(p.predicate?.families) ? (p.predicate.families as unknown[]).map(String) : []);
  }
  for (const id of profileIds) {
    const ownsOne = (owned.get(id) ?? []).some((f) => families.has(f));
    const namesOne = [...families].some((f) => id.includes(f));
    if (ownsOne || namesOne) out.add(id);
  }
  return out;
}

/**
 * The requirement whose FAILURE is an observed, undeclared relaxation.
 *
 * `conformance/README.md` said of `OPENWOP_HOST_RELAXATIONS` that "the suite
 * cannot detect an undeclared one". For the egress guard that was never true:
 * a host that ACCEPTS `https://127.0.0.1/…` as a webhook destination has shown
 * on the wire that its guard is open (`webhooks.md`: "a host MUST reject (400
 * webhook_url_rejected) … RFC 1918 and loopback and link-local ranges").
 * `v2-webhook-egress-refusal` records that as `executed-fail` on this id unless
 * the operator DECLARED the relaxation — in which case {@link profilesRelaxedBy}
 * already denies the profile. Either way a profile built on `webhooks` does not
 * certify on a host whose guard is open; this closes the path where it did,
 * silently, because nobody declared anything.
 */
export const UNDECLARED_RELAXATION_WITNESSES: ReadonlyArray<{ readonly requirementId: string; readonly obligation: string }> = [
  { requirementId: 'openwop.requirement.0171.webhook-egress-refused', obligation: 'webhooks.egress-guard' },
];

/** Profiles that MUST NOT certify because a row above is `executed-fail` in this bundle's own results. */
export function profilesDeniedByObservedRelaxation(rows: ReadonlyArray<{ readonly id: string; readonly result: string }>, profileIds: readonly string[]): { readonly profiles: ReadonlySet<string>; readonly obligations: readonly string[] } {
  const obligations = UNDECLARED_RELAXATION_WITNESSES.filter((w) => rows.some((r) => r.id === w.requirementId && r.result === 'executed-fail')).map((w) => w.obligation);
  return { profiles: profilesRelaxedBy(obligations, profileIds), obligations };
}
