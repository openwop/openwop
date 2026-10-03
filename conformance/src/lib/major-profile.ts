/**
 * What differs between protocol majors, as data.
 *
 * A scenario that is "the same requirement at another major" used to be a
 * copy of the earlier file with the paths, event names and envelope rules
 * edited by hand. The differences are few and regular, so they live in one
 * table here. A shared witness (`backpressure-witness.ts`) takes a profile and
 * never names a major; the scenario file for each major is a thin wrapper.
 *
 * **Adding a major** is one row in {@link MAJOR_PROFILES} plus one thin
 * scenario file per ported witness. `majorProfile()` throws on a major with no
 * row, so a missing row is a loud failure and never a silent fall back to an
 * older major's rules.
 *
 * Keep a field here only when a shared witness reads it. A rule one major
 * states and another does not is not a field: the witness asks the profile
 * whether the rule binds (see `retryTiming`), and cites the document that
 * states it.
 */

import { capabilityFamily } from './discovery-capabilities.js';
import { codemapV1toV2 } from './era2-seed.js';
import { projectBoundId } from './bound-id.js';

export interface MajorProfile {
  readonly major: number;
  /** The run collection, e.g. `/v1/runs` or `/runs`. */
  readonly runsPath: string;
  /** Headers a raw `fetch` must add to speak this major (the driver adds its own). */
  readonly versionHeaders: Readonly<Record<string, string>>;
  /** Where the corpus states this major's rules, for requirement citations. */
  readonly specRoot: string;
  /**
   * Where retry timing lives on an error response. `header-and-details`: the
   * envelope repeats `Retry-After` in `details.retryAfter`. `header-only`: the
   * header is the only place, and `details.retryAfter*` is forbidden.
   */
  readonly retryTiming: 'header-and-details' | 'header-only';
  /** The advertised record for a capability family, or `null` when the host does not advertise it. */
  family(doc: unknown, key: string): Record<string, unknown> | null;
  /**
   * The `createRun` body fragment that carries a run budget policy, or `null`
   * when this major has no run wire surface for one (a witness that needs it
   * is then `inapplicable` at this major).
   */
  runBudget(policy: Readonly<Record<string, unknown>>): Record<string, unknown> | null;
  /**
   * This major's name for an event, given its era-1 name. `undefined` when the
   * mapping is not on disk in this layout: the caller records that as an
   * unread observation and never guesses a name.
   */
  eventType(era1Name: string): string | undefined;
  /** The trigger subscription collection, e.g. `/v1/trigger-subscriptions` or `/trigger-subscriptions`. */
  readonly triggerSubscriptionsPath: string;
  /** An id as one URL path segment: percent-encoded at v1, the `~` bound-id projection at v2 (`identity.md` §5). */
  idSegment(id: string): string;
  /**
   * How a read of another tenant's id is refused. `not_found`: as an id never
   * minted (v1, bare ids). `id_tenant_mismatch`: `403`, because a v2 bound id
   * names its tenant and `identity.md` §5 requires the refusal to say so.
   */
  readonly foreignTenantRead: 'not_found' | 'id_tenant_mismatch';
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export const MAJOR_PROFILES: Readonly<Record<number, MajorProfile>> = {
  1: {
    major: 1,
    runsPath: '/v1/runs',
    versionHeaders: {},
    specRoot: 'spec/v1',
    retryTiming: 'header-and-details',
    // v1: a family is advertised when its record says `supported: true`.
    family: (doc, key) => {
      const rec = capabilityFamily(doc, key);
      return isRecord(rec) && rec['supported'] === true ? rec : null;
    },
    // v1 budgets are driven through a host seam, not `createRun`.
    runBudget: () => null,
    eventType: (era1Name) => era1Name,
    triggerSubscriptionsPath: '/v1/trigger-subscriptions',
    idSegment: (id) => encodeURIComponent(id),
    foreignTenantRead: 'not_found',
  },
  2: {
    major: 2,
    runsPath: '/runs',
    versionHeaders: { 'OpenWOP-Version': '2.0' },
    specRoot: 'spec/v2/core',
    retryTiming: 'header-only',
    // v2: presence of the record is the advertisement.
    family: (doc, key) => {
      const rec = isRecord(doc) ? doc[key] : undefined;
      return isRecord(rec) ? rec : null;
    },
    runBudget: (policy) => ({ configurable: { version: 1, budget: { ...policy } } }),
    eventType: (era1Name) => codemapV1toV2().get(era1Name),
    triggerSubscriptionsPath: '/trigger-subscriptions',
    idSegment: (id) => projectBoundId(id),
    foreignTenantRead: 'id_tenant_mismatch',
  },
};

/** The profile for a major. Throws when the table has no row for it. */
export function majorProfile(major: number): MajorProfile {
  const p = MAJOR_PROFILES[major];
  if (p === undefined) throw new Error(`no MajorProfile for major ${major} — add a row to MAJOR_PROFILES in lib/major-profile.ts`);
  return p;
}
