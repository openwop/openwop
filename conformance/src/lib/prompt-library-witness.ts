/**
 * The prompt-library witness on the normative `/prompts*` surface
 * (`host-services.md` §`prompts` + §Library; RFC 0028), shared by every major
 * that serves it. What differs between majors (the path prefix, how an id
 * becomes a path segment, how a family is advertised, the schemas) is the
 * profile row plus the validators the scenario hands in.
 *
 * Legs, grouped by the scenario that owns them:
 *   list-and-fetch   list (envelope + every item validates), filters
 *                    (`kind`, `source`), fetch-by-id, ETag revalidation,
 *                    unknown id `404`, and the gate-off read (`404 not_found`
 *                    when `endpointsSupported` is not advertised);
 *   mutable          the create → read → duplicate → update → non-monotonic
 *                    → delete round trip ({@link driveLifecycle} observes,
 *                    {@link judgeLifecycle} is pure), built-ins read-only,
 *                    writes authenticated, and the gate-off write;
 *   render           deterministic hash, a changed binding changes the hash,
 *                    hash shapes, the body present only under `full`, and an
 *                    unbound required variable refused `validation_error`;
 *   packs            pack-source listing coherent with `packsSupported`, the
 *                    `meta.packName`/`packVersion` stamps, and the in-tree
 *                    reference pack fetched by id (inapplicable when absent).
 *
 * Each leg OBSERVES and returns findings; it asserts nothing. The scenario maps
 * findings to requirement ids, and `prompt-library-witness.test.ts` proves every
 * leg against `prompt-double.ts` with one defect turned on.
 */

import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import type { MajorProfile } from './major-profile.js';

export interface PromptFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type Skip = { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string };
export type PromptOutcome = Skip | { readonly kind: 'observed'; readonly findings: readonly PromptFinding[] };
/** A schema validator, e.g. `v2Validator('prompt-template')`. */
export type Validate = (doc: unknown) => { ok: boolean; errors: string };

interface Variable { name?: unknown; required?: unknown; source?: unknown }
export interface Template { templateId?: unknown; version?: unknown; kind?: unknown; text?: unknown; variables?: unknown; meta?: { source?: unknown; packName?: unknown; packVersion?: unknown } }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): PromptFinding => ({ ok, doc, message });
const SHA = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DOC_PROMPTS = 'host-services.md §prompts';
const DOC_LIB = 'host-services.md §Library';
const DOC_GATE = 'errors.md §Unadvertised operations';

/** The in-tree reference prompt pack (`examples/packs/prompt-sample`). */
export const REFERENCE_PACK = 'vendor.openwop.prompt-sample';
export const REFERENCE_TEMPLATE = 'writer-system';

/** What the host advertises for `prompts` at this major. */
export interface PromptAdverts {
  readonly family: Record<string, unknown> | null;
  readonly endpoints: boolean;
  readonly mutable: boolean;
  readonly packs: boolean;
  readonly observability: 'off' | 'hashed' | 'full';
  readonly promptsPath: string;
  readonly renderPath: string;
}

export function promptAdverts(profile: MajorProfile, doc: unknown): PromptAdverts {
  const family = profile.family(doc, 'prompts');
  const promptsPath = profile.major >= 2 ? '/prompts' : '/v1/prompts';
  const lib = isRecord(family?.['library']) ? (family!['library'] as Record<string, unknown>) : undefined;
  const obs = family?.['observability'];
  return {
    family,
    endpoints: family?.['endpointsSupported'] === true,
    mutable: family?.['endpointsSupported'] === true && family['mutableLibrary'] === true,
    packs: family?.['packsSupported'] === true,
    observability: obs === 'off' || obs === 'full' ? obs : 'hashed',
    promptsPath,
    renderPath: typeof lib?.['renderEndpoint'] === 'string' ? (lib['renderEndpoint'] as string) : `${promptsPath}:render`,
  };
}

export function endpointsGate(a: PromptAdverts): Skip | null {
  if (a.family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise prompts' };
  if (!a.endpoints) return { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.endpointsSupported is not true — the /prompts* operations are not served' };
  return null;
}
function mutableGate(a: PromptAdverts): Skip | null {
  const g = endpointsGate(a); if (g) return g;
  return a.mutable ? null : { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.mutableLibrary is not true — the /prompts writes are not served' };
}

const tplPath = (profile: MajorProfile, a: PromptAdverts, id: string, query = ''): string => `${a.promptsPath}/${profile.idSegment(id)}${query}`;
const items = (res: OpenWOPResponse): Template[] => {
  const v = isRecord(res.json) ? res.json['items'] : undefined;
  return Array.isArray(v) ? v.filter(isRecord) as Template[] : [];
};
const gateOff = (res: OpenWOPResponse, what: string, facet: string): PromptFinding[] => [
  f(res.status === 404, DOC_GATE, `${what} with ${facet} unadvertised MUST answer 404 (got ${res.status})`),
  f(readErrorCode(res.json) === 'not_found', DOC_GATE, `${what} with ${facet} unadvertised MUST carry not_found (got ${String(readErrorCode(res.json))})`),
];

// ── list-and-fetch ─────────────────────────────────────────────────────────

/** Leg: GET /prompts answers `{ items, nextCursor? }` and every item validates. */
export async function listLeg(a: PromptAdverts, validate: Validate): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const res = await driver.get(a.promptsPath);
  const body = isRecord(res.json) ? res.json : {};
  const findings = [
    f(res.status === 200, DOC_PROMPTS, `GET ${a.promptsPath} MUST answer 200 when endpointsSupported is advertised (got ${res.status})`),
    f(Array.isArray(body['items']), DOC_PROMPTS, 'the list MUST carry an items array'),
    f(body['nextCursor'] === undefined || typeof body['nextCursor'] === 'string', DOC_PROMPTS, `nextCursor MUST be an opaque string when present (got ${JSON.stringify(body['nextCursor'])})`),
  ];
  for (const t of items(res)) {
    const v = validate(t);
    findings.push(f(v.ok, 'schemas PromptTemplate', `every listed template MUST validate (${String(t.templateId)}): ${v.errors}`));
  }
  return { kind: 'observed', findings };
}

/** Leg: `?kind=system` and `?source=host` narrow without breaking the envelope. */
export async function filterLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const byKind = await driver.get(`${a.promptsPath}?kind=system`);
  const bySource = await driver.get(`${a.promptsPath}?source=host`);
  return { kind: 'observed', findings: [
    f(byKind.status === 200 && Array.isArray(isRecord(byKind.json) ? byKind.json['items'] : undefined), DOC_PROMPTS, `GET ?kind=system MUST answer 200 with items (got ${byKind.status})`),
    ...items(byKind).map((t) => f(t.kind === 'system', DOC_PROMPTS, `?kind=system MUST narrow to kind system (got ${String(t.kind)} on ${String(t.templateId)})`)),
    f(bySource.status === 200 && Array.isArray(isRecord(bySource.json) ? bySource.json['items'] : undefined), DOC_PROMPTS, `GET ?source=host MUST answer 200 with items (got ${bySource.status})`),
    ...items(bySource).map((t) => f(t.meta?.source === 'host', DOC_PROMPTS, `?source=host MUST narrow to meta.source host (got ${String(t.meta?.source)} on ${String(t.templateId)})`)),
  ] };
}

/** A listed template to fetch, host-sourced first. `null`: the library lists nothing. */
async function aTemplate(a: PromptAdverts): Promise<Template | null> {
  const host = items(await driver.get(`${a.promptsPath}?source=host&limit=1`))[0];
  return host ?? items(await driver.get(`${a.promptsPath}?limit=1`))[0] ?? null;
}

/** Leg: a listed template is fetched by id. */
export async function fetchLeg(profile: MajorProfile, a: PromptAdverts, validate: Validate): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const t = await aTemplate(a);
  if (t === null || typeof t.templateId !== 'string') return { kind: 'skip', disposition: 'inapplicable', reason: 'the library lists no template, so there is none to fetch (an empty library is conformant)' };
  const res = await driver.get(tplPath(profile, a, t.templateId));
  const body = isRecord(res.json) ? res.json : {};
  const v = validate(body);
  return { kind: 'observed', findings: [
    f(res.status === 200, DOC_PROMPTS, `GET ${a.promptsPath}/{templateId} MUST answer 200 for a listed template (got ${res.status})`),
    f(body['templateId'] === t.templateId, DOC_PROMPTS, `the fetched template MUST be the one named (got ${String(body['templateId'])})`),
    f(v.ok, 'schemas PromptTemplate', `the fetched template MUST validate: ${v.errors}`),
  ] };
}

/** Leg: an ETag, when sent, revalidates to `304`. `getPromptTemplate` SHOULD send one; none is inapplicable. */
export async function etagLeg(profile: MajorProfile, a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const t = await aTemplate(a);
  if (t === null || typeof t.templateId !== 'string') return { kind: 'skip', disposition: 'inapplicable', reason: 'the library lists no template, so there is none to revalidate' };
  const first = await driver.get(tplPath(profile, a, t.templateId));
  const etag = first.headers.get('etag');
  if (first.status !== 200 || etag === null || etag.length === 0) return { kind: 'skip', disposition: 'inapplicable', reason: `getPromptTemplate sent no ETag (status ${first.status}) — a SHOULD, so there is nothing to revalidate` };
  const again = await driver.get(tplPath(profile, a, t.templateId), { headers: { 'If-None-Match': etag } });
  return { kind: 'observed', findings: [f(again.status === 304, `${DOC_LIB}; RFC 9110 §13.1.2`, `If-None-Match with the current ETag MUST answer 304 (got ${again.status})`)] };
}

/** Leg: an unknown template id is `404` with the error envelope. */
export async function unknownLeg(profile: MajorProfile, a: PromptAdverts, validateEnvelope: Validate): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const res = await driver.get(tplPath(profile, a, `conformance-unknown-${randomBytes(6).toString('hex')}`));
  const v = validateEnvelope(res.json);
  return { kind: 'observed', findings: [
    f(res.status === 404, DOC_PROMPTS, `an unknown templateId MUST answer 404 (got ${res.status})`),
    f(v.ok, 'errors.md; schemas ErrorEnvelope', `the 404 MUST carry the error envelope: ${v.errors}`),
  ] };
}

/** Leg: with `endpointsSupported` unadvertised, the read answers `404 not_found`. */
export async function gateOffReadLeg(a: PromptAdverts): Promise<PromptOutcome> {
  if (a.endpoints) return { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.endpointsSupported is advertised — the gate is on' };
  return { kind: 'observed', findings: gateOff(await driver.get(a.promptsPath), `GET ${a.promptsPath}`, 'prompts.endpointsSupported') };
}

// ── mutable library ────────────────────────────────────────────────────────

export interface LifecycleObservation {
  readonly templateId: string;
  readonly create: { status: number; location: string | null };
  readonly read: { status: number; source: unknown; templateId: unknown };
  readonly duplicate: number;
  readonly update: { status: number; storedVersion: unknown };
  readonly nonMonotonic: number;
  readonly remove: { status: number; after: number };
}

/** The round trip, observed. Asserts nothing. */
export async function driveLifecycle(profile: MajorProfile, a: PromptAdverts): Promise<Skip | LifecycleObservation> {
  const g = mutableGate(a); if (g) return g;
  const templateId = `conformance.user.lifecycle-${randomBytes(5).toString('hex')}`;
  const at = tplPath(profile, a, templateId);
  const body = (version: string, text: string): Record<string, unknown> => ({ templateId, version, kind: 'system', text });
  const created = await driver.post(a.promptsPath, body('1.0.0', 'You are a conformance probe. {{tone}}'));
  const read = await driver.get(at);
  const dup = await driver.post(a.promptsPath, body('1.0.0', 'duplicate'));
  const upd = await driver.put(at, body('1.1.0', 'You are a conformance probe v1.1. {{tone}}'));
  const stored = await driver.get(at);
  const back = await driver.put(at, body('0.9.0', 'cannot go back'));
  const del = await driver.delete(at);
  const after = await driver.get(at);
  const r = isRecord(read.json) ? read.json : {};
  const meta = isRecord(r['meta']) ? r['meta'] : {};
  return {
    templateId,
    create: { status: created.status, location: created.headers.get('location') },
    read: { status: read.status, source: meta['source'], templateId: r['templateId'] },
    duplicate: dup.status,
    update: { status: upd.status, storedVersion: isRecord(stored.json) ? stored.json['version'] : undefined },
    nonMonotonic: back.status,
    remove: { status: del.status, after: after.status },
  };
}

export type LifecycleStep = 'create' | 'read' | 'duplicate' | 'update' | 'nonMonotonic' | 'remove';

/** The round trip, judged per step. Pure. */
export function judgeLifecycle(o: LifecycleObservation): Record<LifecycleStep, PromptFinding[]> {
  return {
    create: [
      f(o.create.status === 201, DOC_LIB, `POST creates a user template: 201 (got ${o.create.status})`),
      f(typeof o.create.location === 'string' && o.create.location.includes(o.templateId), 'openapi createPromptTemplate 201', `the 201 MUST carry a Location naming the new templateId (got ${String(o.create.location)})`),
    ],
    read: [
      f(o.read.status === 200 && o.read.templateId === o.templateId, DOC_LIB, `the created template MUST be readable (got ${o.read.status})`),
      f(o.read.source === 'user', 'schemas PromptTemplate meta.source', `a template created through the API MUST carry meta.source user (got ${String(o.read.source)})`),
    ],
    duplicate: [f(o.duplicate === 409, 'openapi createPromptTemplate 409', `a second POST of the same (templateId, version) MUST answer 409 (got ${o.duplicate})`)],
    update: [
      f(o.update.status === 200, DOC_LIB, `an update carrying a greater SemVer MUST be accepted: 200 (got ${o.update.status})`),
      f(o.update.storedVersion === '1.1.0', DOC_LIB, `the stored version MUST reflect the update (got ${String(o.update.storedVersion)})`),
    ],
    nonMonotonic: [f(o.nonMonotonic === 409, DOC_LIB, `an update MUST carry a greater SemVer; a lower one answers 409 (got ${o.nonMonotonic})`)],
    remove: [
      f(o.remove.status === 204, 'openapi deletePromptTemplate 204', `DELETE of a user template MUST answer 204 (got ${o.remove.status})`),
      f(o.remove.after === 404, DOC_LIB, `a deleted template MUST read 404 (got ${o.remove.after})`),
    ],
  };
}

/** Leg: built-in templates are read-only — DELETE answers 403. */
export async function readOnlyLeg(profile: MajorProfile, a: PromptAdverts): Promise<PromptOutcome> {
  const g = mutableGate(a); if (g) return g;
  const t = items(await driver.get(`${a.promptsPath}?source=host&limit=1`))[0];
  if (t === undefined || typeof t.templateId !== 'string') return { kind: 'skip', disposition: 'inapplicable', reason: 'the library lists no host built-in template to probe' };
  // DELETE only, as at major 1: a PUT probe would overwrite a shared built-in on a defective host.
  const del = await driver.delete(tplPath(profile, a, t.templateId));
  return { kind: 'observed', findings: [f(del.status === 403, DOC_LIB, `built-in templates are read-only: DELETE MUST answer 403 (got ${del.status})`)] };
}

/** Leg: writes MUST be authenticated. */
export async function unauthenticatedWriteLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = mutableGate(a); if (g) return g;
  const templateId = `conformance.user.anon-${randomBytes(5).toString('hex')}`;
  const res = await driver.post(a.promptsPath, { templateId, version: '1.0.0', kind: 'system', text: 'x' }, { authenticated: false });
  return { kind: 'observed', findings: [f(res.status === 401, DOC_LIB, `an unauthenticated write MUST be refused 401 (got ${res.status})`)] };
}

/** Leg: with `mutableLibrary` unadvertised, a write answers `404 not_found`. */
export async function gateOffWriteLeg(profile: MajorProfile, a: PromptAdverts): Promise<PromptOutcome> {
  if (a.mutable) return { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.mutableLibrary is advertised — the gate is on' };
  const templateId = `conformance.user.gate-off-${randomBytes(5).toString('hex')}`;
  const res = await driver.post(a.promptsPath, { templateId, version: '1.0.0', kind: 'system', text: 'x' });
  if (res.status >= 200 && res.status < 300) await driver.delete(tplPath(profile, a, templateId)).catch(() => undefined);
  return { kind: 'observed', findings: gateOff(res, `POST ${a.promptsPath}`, 'prompts.mutableLibrary') };
}

// ── render ─────────────────────────────────────────────────────────────────

const vars = (t: Template): Variable[] => (Array.isArray(t.variables) ? t.variables.filter(isRecord) as Variable[] : []);
const renderable = (t: Template): boolean => !vars(t).some((v) => v.source === 'secret' && v.required === true);
const bindings = (t: Template, value: (name: string) => string): Record<string, string> =>
  Object.fromEntries(vars(t).filter((v) => v.source !== 'secret' && typeof v.name === 'string').map((v) => [v.name as string, value(v.name as string)]));
const refOf = (t: Template): string => `prompt:${String(t.templateId)}@${String(t.version)}`;

/** A host-listed template every required binding of which the suite can supply (no required secret). */
async function renderTarget(a: PromptAdverts, want?: (t: Template) => boolean): Promise<Template | null> {
  const listed = items(await driver.get(`${a.promptsPath}?source=host&limit=200`)).filter(renderable);
  const pool = listed.length > 0 ? listed : items(await driver.get(`${a.promptsPath}?limit=200`)).filter(renderable);
  const ok = pool.filter((t) => typeof t.templateId === 'string' && typeof t.version === 'string' && (want ?? (() => true))(t));
  return ok.find((t) => vars(t).some((v) => v.required === true && v.source !== 'secret')) ?? ok[0] ?? null;
}
const render = (a: PromptAdverts, ref: string, variables: Record<string, unknown>): Promise<OpenWOPResponse> => driver.post(a.renderPath, { ref, variables });
const rbody = (r: OpenWOPResponse): Record<string, unknown> => (isRecord(r.json) ? r.json : {});
const vh = (r: OpenWOPResponse): Record<string, unknown> => (isRecord(rbody(r)['variableHashes']) ? rbody(r)['variableHashes'] as Record<string, unknown> : {});
const noTarget: Skip = { kind: 'skip', disposition: 'inapplicable', reason: 'the library lists no template the suite can render (none, or every one needs a secret binding)' };

/** Leg: identical inputs render the identical hash and variableHashes. */
export async function deterministicLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const t = await renderTarget(a); if (t === null) return noTarget;
  const v = bindings(t, (n) => `conformance-${n}-value`);
  const one = await render(a, refOf(t), v);
  const two = await render(a, refOf(t), v);
  return { kind: 'observed', findings: [
    f(one.status === 200 && two.status === 200, DOC_LIB, `renderPromptTemplate MUST answer 200 for ${refOf(t)} with every required binding (got ${one.status}, ${two.status})`),
    f(typeof rbody(one)['hash'] === 'string' && rbody(one)['hash'] === rbody(two)['hash'], DOC_LIB, `identical (ref, variables) MUST render the identical hash (got ${String(rbody(one)['hash'])} vs ${String(rbody(two)['hash'])})`),
    f(JSON.stringify(Object.entries(vh(one)).sort()) === JSON.stringify(Object.entries(vh(two)).sort()), DOC_LIB, 'identical (ref, variables) MUST render identical variableHashes'),
  ] };
}

/** Leg: a changed binding changes the hash and its variableHash. */
export async function variesLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const t = await renderTarget(a); if (t === null) return noTarget;
  const req = vars(t).find((v) => v.required === true && v.source !== 'secret' && typeof v.name === 'string');
  if (req === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: `no listed template has a required non-secret variable to toggle (${refOf(t)})` };
  const name = req.name as string;
  const v = bindings(t, (n) => `conformance-${n}-baseline`);
  const base = await render(a, refOf(t), v);
  const toggled = await render(a, refOf(t), { ...v, [name]: 'conformance-toggled-value' });
  return { kind: 'observed', findings: [
    f(base.status === 200 && toggled.status === 200, DOC_LIB, `renderPromptTemplate MUST answer 200 (got ${base.status}, ${toggled.status})`),
    f(rbody(base)['hash'] !== rbody(toggled)['hash'], DOC_LIB, 'a changed binding MUST change the rendered hash'),
    f(vh(base)[name] !== undefined && vh(base)[name] !== vh(toggled)[name], DOC_LIB, `a changed binding MUST change variableHashes.${name}`),
  ] };
}

/** Leg: hash shapes, refs, and the body present only under `observability: full`. */
export async function renderShapeLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  // A few-shot or schema-hint body is the one a kind-specific field would miss.
  const t = (await renderTarget(a, (x) => x.kind === 'few-shot' || x.kind === 'schema-hint')) ?? (await renderTarget(a));
  if (t === null) return noTarget;
  const res = await render(a, refOf(t), bindings(t, () => 'conformance-value'));
  const b = rbody(res);
  const findings: PromptFinding[] = [
    f(res.status === 200, DOC_LIB, `renderPromptTemplate MUST answer 200 for ${refOf(t)} (got ${res.status})`),
    f(typeof b['hash'] === 'string' && SHA.test(b['hash']), 'openapi renderPromptTemplate 200', `hash MUST match sha256:<hex64> (got ${String(b['hash'])})`),
    f(Array.isArray(b['refs']), 'openapi renderPromptTemplate 200', 'refs MUST be an array'),
    ...Object.entries(vh(res)).map(([k, h]) => f(typeof h === 'string' && SHA.test(h), 'openapi renderPromptTemplate 200', `variableHashes.${k} MUST match sha256:<hex64> (got ${String(h)})`)),
  ];
  findings.push(a.observability === 'full'
    ? f(typeof b['composed'] === 'string' && b['composed'].length > 0, `${DOC_PROMPTS} §Composition; openapi renderPromptTemplate`, `under observability full, composed MUST carry the body for every kind (${String(t.kind)} ${refOf(t)})`)
    : f(b['composed'] === undefined, `${DOC_PROMPTS} §Composition ("carrying bodies only under full"); openapi renderPromptTemplate`, `under observability ${a.observability}, composed MUST be absent (got ${typeof b['composed']})`));
  return { kind: 'observed', findings };
}

/** Leg: an unbound required variable is refused `400 validation_error`. */
export async function unboundRequiredLeg(a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const t = await renderTarget(a); if (t === null) return noTarget;
  const req = vars(t).find((v) => v.required === true && v.source !== 'secret' && typeof v.name === 'string');
  if (req === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: `no listed template has a required non-secret variable to leave unbound (${refOf(t)})` };
  const v = bindings(t, (n) => `conformance-${n}`);
  delete v[req.name as string];
  const res = await render(a, refOf(t), v);
  return { kind: 'observed', findings: [
    f(res.status === 400, 'openapi renderPromptTemplate 400', `rendering with required variable ${String(req.name)} unbound MUST answer 400 (got ${res.status})`),
    f(readErrorCode(res.json) === 'validation_error', 'openapi renderPromptTemplate 400', `the refusal MUST carry validation_error (got ${String(readErrorCode(res.json))})`),
  ] };
}

// ── packs ──────────────────────────────────────────────────────────────────

/** Leg: `?source=pack` lists only pack templates, none at all unless `packsSupported`, and at least one when the operator says a pack is installed. */
export async function packListLeg(a: PromptAdverts, opts: { requireInstalled?: boolean } = {}): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  const res = await driver.get(`${a.promptsPath}?source=pack`);
  const listed = items(res);
  const findings: PromptFinding[] = [
    f(res.status === 200 && Array.isArray(isRecord(res.json) ? res.json['items'] : undefined), DOC_PROMPTS, `GET ?source=pack MUST answer 200 with items (got ${res.status})`),
    ...listed.map((t) => f(t.meta?.source === 'pack', DOC_PROMPTS, `?source=pack MUST narrow to meta.source pack (got ${String(t.meta?.source)} on ${String(t.templateId)})`)),
  ];
  if (!a.packs) findings.push(f(listed.length === 0, 'capabilities.schema.json §prompts.packsSupported', `with packsSupported not advertised, packs are not loaded — ?source=pack MUST list none (got ${listed.length})`));
  if (opts.requireInstalled === true) findings.push(f(listed.length > 0, 'RFC 0028 §B (operator: OPENWOP_TEST_PROMPT_PACK_INSTALLED=true)', 'the operator says a prompt pack is installed, so ?source=pack MUST list at least one template'));
  return { kind: 'observed', findings };
}

/** Leg: every pack template carries `meta.packName` and `meta.packVersion`. */
export async function packStampLeg(a: PromptAdverts, validate: Validate): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  if (!a.packs) return { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.packsSupported is not true — no pack template exists to stamp' };
  const listed = items(await driver.get(`${a.promptsPath}?source=pack`)).filter((t) => t.meta?.source === 'pack');
  if (listed.length === 0) return { kind: 'skip', disposition: 'inapplicable', reason: 'no prompt pack is installed — zero installed packs is conformant, and there is no template to judge' };
  return { kind: 'observed', findings: listed.flatMap((t) => [
    f(typeof t.meta?.packName === 'string' && t.meta.packName.length > 0, DOC_LIB, `a pack template MUST carry meta.packName (${String(t.templateId)})`),
    f(typeof t.meta?.packVersion === 'string' && SEMVER.test(t.meta.packVersion), DOC_LIB, `a pack template MUST carry a SemVer meta.packVersion (${String(t.templateId)}: ${String(t.meta?.packVersion)})`),
    f(validate(t).ok, 'schemas PromptTemplate', `a pack template MUST validate (${String(t.templateId)}): ${validate(t).errors}`),
  ]) };
}

/** Leg: the in-tree reference pack's template is fetched by id under its library. Inapplicable when that pack is not installed. */
export async function referencePackLeg(profile: MajorProfile, a: PromptAdverts): Promise<PromptOutcome> {
  const g = endpointsGate(a); if (g) return g;
  if (!a.packs) return { kind: 'skip', disposition: 'inapplicable', reason: 'prompts.packsSupported is not true' };
  const listed = items(await driver.get(`${a.promptsPath}?source=pack`));
  const ref = listed.find((t) => t.templateId === REFERENCE_TEMPLATE && t.meta?.packName === REFERENCE_PACK);
  if (ref === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: `the reference pack ${REFERENCE_PACK} is not installed — a host MAY install other packs or none` };
  const res = await driver.get(tplPath(profile, a, REFERENCE_TEMPLATE, `?libraryId=${encodeURIComponent(REFERENCE_PACK)}`));
  const b = isRecord(res.json) ? res.json : {};
  const meta = isRecord(b['meta']) ? b['meta'] : {};
  return { kind: 'observed', findings: [
    f(res.status === 200, DOC_PROMPTS, `GET ${a.promptsPath}/${REFERENCE_TEMPLATE}?libraryId=${REFERENCE_PACK} MUST answer 200 for a listed pack template (got ${res.status})`),
    f(b['templateId'] === REFERENCE_TEMPLATE, DOC_PROMPTS, `the fetched template MUST be ${REFERENCE_TEMPLATE} (got ${String(b['templateId'])})`),
    f(meta['source'] === 'pack' && meta['packName'] === REFERENCE_PACK, DOC_LIB, `the fetched template MUST keep its pack provenance (got source ${String(meta['source'])}, packName ${String(meta['packName'])})`),
  ] };
}
