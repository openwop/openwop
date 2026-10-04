/**
 * The prompt resolution + composition events witness (`host-services.md`
 * §`prompts` → §Resolution, §Composition; RFCs 0027, 0029), shared by every
 * major. A fixture run is created on the normative run surface and its durable
 * log read through `events/poll`; no seam. What differs between majors (the
 * run path, the id segment, the event names — `agent.promptResolved` is
 * `agent.prompt-resolved` at major 2 — and the payload schemas) is the profile
 * row plus the validators the scenario hands in.
 *
 * {@link driveFixture} observes and asserts nothing; the judges are pure:
 *   {@link judgeAllFourKinds}  `conformance-prompt-all-four-kinds`: one resolution
 *                             per configured ref, every ref composed;
 *   {@link judgeOrdering}      every composition follows a resolution for its node;
 *   {@link judgeEndToEnd}      `conformance-prompt-end-to-end`: node layer wins,
 *                             the composed hash, and bodies only under `full`;
 *   {@link judgeChain}         every resolution carries a well-formed chain whose
 *                             one applied layer is mirrored by `resolved`.
 */

import { driver } from './driver.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';

export interface EventFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type Skip = { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string };
export type Validate = (doc: unknown) => { ok: boolean; errors: string };

export const ALL_FOUR_FIXTURE = 'conformance-prompt-all-four-kinds';
export const END_TO_END_FIXTURE = 'conformance-prompt-end-to-end';
/** The five refs `conformance-prompt-all-four-kinds` configures, few-shot twice. */
export const ALL_FOUR_REFS = [
  'prompt:conformance.prompt.writer-system@1.0.0',
  'prompt:conformance.prompt.writer-user@1.0.0',
  'prompt:conformance.prompt.schema-hint@1.0.0',
  'prompt:conformance.prompt.few-shot@1.0.0',
  'prompt:conformance.prompt.few-shot-2@1.0.0',
] as const;
export const END_TO_END_REF = 'prompt:conformance.prompt.writer-system@1.0.0';
export const END_TO_END_NODE = 'writer';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): EventFinding => ({ ok, doc, message });
const SHA = /^sha256:[0-9a-f]{64}$/;
const DOC_RES = 'host-services.md §prompts → §Resolution';
const DOC_COMP = 'host-services.md §prompts → §Composition';

export interface Ev { readonly type: string; readonly sequence: number; readonly nodeId?: unknown; readonly payload: Record<string, unknown> }
export interface FixtureObservation {
  readonly fixture: string;
  readonly createStatus: number;
  readonly terminalStatus: string | undefined;
  /** Sorted by `sequence`. */
  readonly events: readonly Ev[];
  /** This major's names for the two events. */
  readonly resolvedType: string;
  readonly composedType: string;
  readonly observability: 'off' | 'hashed' | 'full';
}

/** The gate both fixture scenarios share: the `prompts` family, the fixture, and the event names. */
export function eventsGate(profile: MajorProfile, doc: unknown, fixture: string): Skip | { resolvedType: string; composedType: string; observability: 'off' | 'hashed' | 'full' } {
  const fam = profile.family(doc, 'prompts');
  if (fam === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise prompts' };
  if (!isFixtureAdvertised(fixture)) return { kind: 'skip', disposition: 'inapplicable', reason: `fixture ${fixture} is not advertised — the fixture is the opt-in` };
  const resolvedType = profile.eventType('agent.promptResolved');
  const composedType = profile.eventType('prompt.composed');
  if (resolvedType === undefined || composedType === undefined) return { kind: 'skip', disposition: 'blocked', reason: 'the event codemap is not on disk in this layout — the suite will not guess an event name' };
  const obs = fam['observability'];
  return { resolvedType, composedType, observability: obs === 'off' || obs === 'full' ? obs : 'hashed' };
}

/** Create a fixture run, wait for a terminal status, read the log. Asserts nothing. */
export async function driveFixture(profile: MajorProfile, doc: unknown, fixture: string, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<Skip | FixtureObservation> {
  const g = eventsGate(profile, doc, fixture);
  if ('kind' in g) return g;
  const created = await driver.post(profile.runsPath, { workflowId: fixture });
  const runId = isRecord(created.json) ? created.json['runId'] : undefined;
  const base = { fixture, createStatus: created.status, ...g };
  if ((created.status !== 201 && created.status !== 202) || typeof runId !== 'string') return { ...base, terminalStatus: undefined, events: [] };
  const at = `${profile.runsPath}/${profile.idSegment(runId)}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let status: string | undefined;
  for (;;) {
    const r = await driver.get(at);
    status = isRecord(r.json) && typeof r.json['status'] === 'string' ? (r.json['status'] as string) : undefined;
    if ((status !== undefined && ['completed', 'failed', 'cancelled'].includes(status)) || Date.now() > deadline) break;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 250));
  }
  const poll = await driver.get(`${at}/events/poll`);
  const raw = isRecord(poll.json) && Array.isArray(poll.json['events']) ? (poll.json['events'] as unknown[]) : [];
  const events = raw.filter(isRecord).map((e): Ev => ({
    type: String(e['type']),
    sequence: typeof e['sequence'] === 'number' ? e['sequence'] : Number.MAX_SAFE_INTEGER,
    nodeId: e['nodeId'],
    payload: isRecord(e['payload']) ? e['payload'] : {},
  })).sort((x, y) => x.sequence - y.sequence);
  return { ...base, terminalStatus: status, events };
}

const of = (o: FixtureObservation, type: string): Ev[] => o.events.filter((e) => e.type === type);
const nodeOf = (e: Ev): unknown => e.payload['nodeId'] ?? e.nodeId;

function runFindings(o: FixtureObservation): EventFinding[] {
  return [
    f(o.createStatus === 201 || o.createStatus === 202, 'runs.md createRun', `createRun of ${o.fixture} MUST be accepted (got ${o.createStatus})`),
    f(o.terminalStatus === 'completed', `fixtures.md ${o.fixture}`, `the fixture run MUST end completed (got ${String(o.terminalStatus)})`),
  ];
}
const payloadFindings = (events: readonly Ev[], validate: Validate, name: string): EventFinding[] =>
  events.map((e) => { const v = validate(e.payload); return f(v.ok, `schemas run-event-payloads ${name}`, `every ${e.type} payload MUST validate (seq ${e.sequence}): ${v.errors}`); });

/** `conformance-prompt-all-four-kinds`: every kind resolved, every configured ref resolved and composed. Pure. */
export function judgeAllFourKinds(o: FixtureObservation, v: { resolved: Validate; composed: Validate }): EventFinding[] {
  const out = runFindings(o);
  const resolved = of(o, o.resolvedType);
  const composed = of(o, o.composedType);
  const kinds = new Set(resolved.map((e) => e.payload['kind']));
  const resolvedRefs = new Set(resolved.map((e) => e.payload['resolved']));
  const composedRefs = composed.flatMap((e) => (Array.isArray(e.payload['refs']) ? e.payload['refs'].filter((r): r is string => typeof r === 'string') : []));
  for (const k of ['system', 'user', 'schema-hint', 'few-shot']) {
    out.push(f(kinds.has(k), DOC_RES, `the host MUST emit ${o.resolvedType} with kind ${k} when the node carries the matching ref`));
  }
  for (const ref of ALL_FOUR_REFS) {
    out.push(f(resolvedRefs.has(ref), DOC_RES, `${o.resolvedType}.resolved MUST surface ${ref} — the node configures it (fewShotPromptRefs[1] included)`));
    if (o.observability !== 'off') out.push(f(composedRefs.includes(ref), DOC_COMP, `${o.composedType}.refs MUST contain ${ref} — every resolved ref is composed`));
  }
  if (o.observability === 'off') out.push(f(composed.length === 0, DOC_COMP, `under observability off the host MUST NOT emit ${o.composedType} (got ${composed.length})`));
  out.push(...payloadFindings(resolved, v.resolved, 'agentPromptResolved'), ...payloadFindings(composed, v.composed, 'promptComposed'));
  return out;
}

/** Every composition follows a resolution for its node. Pure. */
export function judgeOrdering(o: FixtureObservation): EventFinding[] {
  const out = runFindings(o);
  const resolved = of(o, o.resolvedType);
  const composed = of(o, o.composedType);
  out.push(f(resolved.length > 0, DOC_RES, `the log MUST carry ${o.resolvedType}`));
  if (o.observability !== 'off') out.push(f(composed.length > 0, DOC_COMP, `the log MUST carry ${o.composedType} (observability ${o.observability})`));
  for (const c of composed) {
    const before = resolved.some((r) => r.sequence < c.sequence && nodeOf(r) === nodeOf(c));
    out.push(f(before, DOC_RES, `${o.resolvedType} MUST precede ${o.composedType} for node ${String(nodeOf(c))} (composed at seq ${c.sequence})`));
  }
  return out;
}

/** `conformance-prompt-end-to-end`: the node layer wins, the hash, and bodies only under `full`. Pure. */
export function judgeEndToEnd(o: FixtureObservation, v: { resolved: Validate; composed: Validate }): EventFinding[] {
  const out = runFindings(o);
  const r = of(o, o.resolvedType).find((e) => e.payload['kind'] === 'system');
  out.push(f(r !== undefined, DOC_RES, `the host MUST emit ${o.resolvedType} (kind system) for a node carrying systemPromptRef`));
  if (r !== undefined) {
    const chain = Array.isArray(r.payload['chain']) ? r.payload['chain'].filter(isRecord) : [];
    const applied = chain.find((c) => c['applied'] === true);
    out.push(
      f(nodeOf(r) === END_TO_END_NODE, DOC_RES, `${o.resolvedType}.nodeId MUST be ${END_TO_END_NODE} (got ${String(nodeOf(r))})`),
      f(applied?.['layer'] === 'node', `${DOC_RES} (layer 1)`, `the node config ref MUST win: the applied chain entry is layer node (got ${String(applied?.['layer'])})`),
      f(r.payload['resolved'] === END_TO_END_REF, DOC_RES, `${o.resolvedType}.resolved MUST be ${END_TO_END_REF} (got ${String(r.payload['resolved'])})`),
      ...payloadFindings([r], v.resolved, 'agentPromptResolved'),
    );
  }
  const composed = of(o, o.composedType);
  if (o.observability === 'off') {
    out.push(f(composed.length === 0, DOC_COMP, `under observability off the host MUST NOT emit ${o.composedType} (got ${composed.length})`));
    return out;
  }
  const c = composed[0];
  out.push(f(c !== undefined, DOC_COMP, `unless observability is off, the host MUST emit ${o.composedType} for the composition`));
  if (c === undefined) return out;
  const p = c.payload;
  out.push(
    f(typeof p['hash'] === 'string' && SHA.test(p['hash']), 'schemas run-event-payloads promptComposed.hash', `hash MUST match sha256:<hex64> (got ${String(p['hash'])})`),
    f(p['kind'] === 'system-only', 'schemas run-event-payloads promptComposed.kind', `a system-only composition MUST say kind system-only (got ${String(p['kind'])})`),
    ...payloadFindings([c], v.composed, 'promptComposed'),
  );
  if (o.observability === 'full') {
    out.push(
      f(typeof p['composed'] === 'string' && p['composed'].length > 0, DOC_COMP, 'under observability full, composed MUST carry the body'),
      f(p['systemPrompt'] === p['composed'], 'schemas run-event-payloads promptComposed.systemPrompt', 'for a system template, systemPrompt MUST equal composed'),
    );
  } else {
    const leaked = ['composed', 'systemPrompt', 'userPrompt', 'variableBindings'].filter((k) => p[k] !== undefined);
    out.push(f(leaked.length === 0, `${DOC_COMP} ("carrying bodies only under full")`, `under observability hashed, ${o.composedType} MUST carry no body (got ${JSON.stringify(leaked)})`));
  }
  return out;
}

const LAYERS = new Set(['run-configurable', 'node', 'agent-intrinsic', 'agent-overrides', 'agent-library-default', 'workflow-defaults', 'host-defaults']);

/** Every resolution carries a well-formed chain with at most one applied layer, mirrored by `resolved`. Pure. */
export function judgeChain(o: FixtureObservation): EventFinding[] {
  const out = runFindings(o);
  const resolved = of(o, o.resolvedType);
  out.push(f(resolved.length > 0, DOC_RES, `a host advertising prompts MUST emit ${o.resolvedType} when a node carries a PromptRef`));
  for (const e of resolved) {
    const chain = Array.isArray(e.payload['chain']) ? e.payload['chain'] : [];
    out.push(f(chain.length > 0, DOC_RES, `${o.resolvedType} MUST carry one chain[] entry per layer tried (seq ${e.sequence})`));
    for (const c of chain) {
      const rec = isRecord(c) ? c : {};
      out.push(
        f(typeof rec['layer'] === 'string' && LAYERS.has(rec['layer']), DOC_RES, `each chain entry MUST name a layer (got ${String(rec['layer'])})`),
        f(typeof rec['applied'] === 'boolean', DOC_RES, 'each chain entry MUST carry a boolean applied'),
      );
    }
    const applied = chain.filter((c) => isRecord(c) && c['applied'] === true) as Array<Record<string, unknown>>;
    out.push(f(applied.length <= 1, DOC_RES, `at most one chain entry is applied (got ${applied.length})`));
    out.push(applied.length === 1
      ? f(e.payload['resolved'] === applied[0]!['source'], 'schemas run-event-payloads agentPromptResolved.resolved', `resolved MUST mirror the applied entry's source (got ${String(e.payload['resolved'])} vs ${String(applied[0]!['source'])})`)
      : f(e.payload['resolved'] === null, 'schemas run-event-payloads agentPromptResolved.resolved', `with no applied layer, resolved MUST be null (got ${String(e.payload['resolved'])})`));
  }
  return out;
}
