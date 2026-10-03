/**
 * The connection-provider registry witness (RFC 0233): the normative
 * observation path for `connection-packs.md` §Provider identity and §The
 * qualified form at major 2, read through `GET /connection-providers` and
 * `GET /connection-providers/{providerId}`.
 *
 * Installing a pack is no protocol operation, so the suite never causes the
 * conflict here. An operator installs the §D fixture pair
 * (`connection-pack-acme-widgets`, then `connection-pack-acme-widgets-rival`)
 * through the host's own install path, and the registry describes the outcome.
 *
 * Each leg OBSERVES and returns findings; it asserts nothing. The scenario maps
 * findings to requirement ids, and `provider-registry-witness.test.ts` proves
 * each leg against a scratch double with one defect turned on.
 */

import { driver } from './driver.js';
import { readErrorCode } from './error-envelope.js';

export const FIRST_PACK = 'core.openwop.connections.acme-widgets';
export const RIVAL_PACK = 'core.openwop.connections.acme-widgets-rival';
export const FIXTURE_ID = 'acme-widgets';

export interface RegistryFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type RegistryOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly RegistryFinding[] };

const DOC = 'connection-packs.md §Observation';
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): RegistryFinding => ({ ok, doc, message });

/** `connections.providerRead` as advertised in a v2 discovery document. */
export function providerReadAdvertised(connections: Record<string, unknown> | null): boolean {
  return connections !== null && connections['providerRead'] === true;
}

interface Read { readonly status: number; readonly json: unknown }
async function list(): Promise<Read> {
  const r = await driver.get('/connection-providers');
  return { status: r.status, json: r.json };
}
async function resolve(providerId: string, pack?: string): Promise<Read> {
  const q = pack === undefined ? '' : `?pack=${encodeURIComponent(pack)}`;
  const r = await driver.get(`/connection-providers/${encodeURIComponent(providerId)}${q}`);
  return { status: r.status, json: r.json };
}

const providersOf = (json: unknown): Array<Record<string, unknown>> => {
  const p = isRecord(json) ? json['providers'] : undefined;
  return Array.isArray(p) ? p.filter(isRecord) : [];
};
const refusalsOf = (json: unknown): Array<Record<string, unknown>> => {
  const r = isRecord(json) ? json['refusals'] : undefined;
  return Array.isArray(r) ? r.filter(isRecord) : [];
};

/** Is the §D fixture installed? The registry says so itself (RFC 0233 §D.2). */
export function fixtureInstalled(json: unknown): boolean {
  return providersOf(json).some((p) => p['id'] === FIXTURE_ID && p['packName'] === FIRST_PACK);
}

/** Leg 3: a schema-valid, content-free registry with each bare id once. Runs on any host with the facet. */
export async function uniqueLeg(validate: (doc: unknown) => { ok: boolean; errors: string }): Promise<RegistryOutcome> {
  const r = await list();
  if (r.status !== 200) return { kind: 'observed', findings: [f(false, DOC, `a host advertising connections.providerRead MUST serve GET /connection-providers (got ${r.status})`)] };
  const v = validate(r.json);
  const ids = providersOf(r.json).map((p) => String(p['id']));
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return { kind: 'observed', findings: [
    f(v.ok, DOC, `the registry MUST validate against connection-provider-registry.schema.json (closed: no endpoint, scope catalog or credential)${v.ok ? '' : `: ${v.errors}`}`),
    f(dupes.length === 0, 'connection-packs.md §Provider identity', `a bare provider id MUST appear at most once (duplicated: ${dupes.join(', ') || 'none'})`),
  ] };
}

const NOT_INSTALLED = 'the §D fixture pack connection-pack-acme-widgets is not installed on this host (RFC 0233 §D: operator opt-in), so no conflict has been caused to read';

/** Leg 1: the later registration of a bare id was refused, and the id is held once. */
export async function failClosedLeg(): Promise<RegistryOutcome> {
  const r = await list();
  if (r.status !== 200) return { kind: 'observed', findings: [f(false, DOC, `a host advertising connections.providerRead MUST serve GET /connection-providers (got ${r.status})`)] };
  if (!fixtureInstalled(r.json)) return { kind: 'skip', disposition: 'inapplicable', reason: NOT_INSTALLED };
  const holders = providersOf(r.json).filter((p) => p['id'] === FIXTURE_ID);
  const refused = refusalsOf(r.json).filter((x) => x['providerId'] === FIXTURE_ID && x['code'] === 'connection_provider_conflict');
  return { kind: 'observed', findings: [
    f(holders.length === 1, 'connection-packs.md §Provider identity', `${FIXTURE_ID} MUST be defined exactly once (got ${holders.length})`),
    f(refused.length >= 1, 'connection-packs.md §Provider identity', `a later registration of ${FIXTURE_ID} MUST be refused with connection_provider_conflict and appear in refusals (RFC 0233 §D.1: the rival is attempted after the first pack)`),
    f(refused.every((x) => x['heldBy'] === FIRST_PACK), 'connection-packs.md §Observation', `a conflict refusal MUST name the holder, ${FIRST_PACK} (got ${refused.map((x) => String(x['heldBy'])).join(', ') || 'none'})`),
    f(!refused.some((x) => x['packName'] === FIRST_PACK), 'connection-packs.md §Provider identity', 'the first registration MUST NOT be the one refused'),
  ] };
}

/** Leg 2: the qualified form resolves only to the named pack; bare resolves to the one definition. */
export async function qualifiedLeg(): Promise<RegistryOutcome> {
  const r = await list();
  if (r.status !== 200) return { kind: 'observed', findings: [f(false, DOC, `a host advertising connections.providerRead MUST serve GET /connection-providers (got ${r.status})`)] };
  if (!fixtureInstalled(r.json)) return { kind: 'skip', disposition: 'inapplicable', reason: NOT_INSTALLED };
  const named = await resolve(FIXTURE_ID, FIRST_PACK);
  const rival = await resolve(FIXTURE_ID, RIVAL_PACK);
  const bare = await resolve(FIXTURE_ID);
  const row = (x: Read): Record<string, unknown> => (isRecord(x.json) ? x.json : {});
  return { kind: 'observed', findings: [
    f(named.status === 200 && row(named)['source'] === 'pack' && row(named)['packName'] === FIRST_PACK, 'connection-packs.md §The qualified form', `${FIXTURE_ID}?pack=${FIRST_PACK} MUST resolve to that pack's definition (got ${named.status} ${JSON.stringify(named.json ?? null).slice(0, 160)})`),
    f(rival.status === 404 && readErrorCode(rival.json) === 'connection_provider_unresolved', 'connection-packs.md §The qualified form', `a qualified reference to a pack that does not define the id MUST answer 404 connection_provider_unresolved (got ${rival.status} ${String(readErrorCode(rival.json))})`),
    f(bare.status === 200 && row(bare)['packName'] === FIRST_PACK, 'connection-packs.md §The qualified form', `the bare id MUST resolve to its one definition, ${FIRST_PACK} (got ${bare.status} ${JSON.stringify(bare.json ?? null).slice(0, 160)})`),
  ] };
}
