/**
 * RFC 0244 §B, G3 — trial isolation: each trial starts from the same
 * `memorySeed` snapshot, and memory one trial writes is not visible to another
 * trial of the same eval run. The suite-owned memory tool
 * `conformance.eval:memory` makes both observable from outside. A pure judge
 * over one eval run of `conformance-eval-memory-isolation`, for
 * `v2-eval-trajectory-trials.test.ts`.
 *
 * The tool reads and writes the trial's own agent memory, the store
 * `memorySeed` seeds (contract in `fixtures.md` §Eval-suite fixtures):
 * `write {id, content}` stores an entry, `read {id}` returns `{id, content}`,
 * with `content: null` for an entry the trial's memory does not hold. Every
 * trial runs the same script:
 *   1. read `seeded`      — the seed, in every trial;
 *   2. read `trial-note`  — nothing yet, unless another trial's write leaked;
 *   3. write `trial-note` = `written`;
 *   4. read `trial-note`  — `written`, the positive control.
 *
 * Trials may run concurrently (scheduling is host-internal), so the judge
 * never groups calls by trial. Over n trials a conforming host returns n
 * `null` and n `written` reads of `trial-note`. A leak turns a step-2 `null`
 * into `written`, so the run reads fewer than n `null`. A host whose writes
 * never read back (fewer than n `written`) shows nothing about isolation, and
 * the verdict is `blocked`, never a pass.
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md §B
 */

export const MEMORY_TOOL = 'conformance.eval:memory';
export const SEEDED = { id: 'seeded', content: 'seed' } as const;
export const NOTE = { id: 'trial-note', content: 'written' } as const;

export interface MemoryFinding { readonly ok: boolean; readonly message: string }
export type MemoryVerdict =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'judged'; readonly findings: readonly MemoryFinding[] };

type Rec = Record<string, unknown>;
export interface MemoryEvent { readonly type: string; readonly payload: Rec }
export interface MemoryCall { readonly op: unknown; readonly id: unknown; readonly outcome: unknown; readonly returned: boolean }

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The memory-tool calls of one run, in log order, each paired with its return by `callId`. */
export function memoryCalls(events: readonly MemoryEvent[], agentId: string): MemoryCall[] {
  const returns = new Map<string, Rec>();
  for (const e of events) {
    if (e.type === 'agent.tool-returned' && e.payload['toolName'] === MEMORY_TOOL && typeof e.payload['callId'] === 'string') returns.set(e.payload['callId'], e.payload);
  }
  const out: MemoryCall[] = [];
  for (const e of events) {
    if (e.type !== 'agent.tool-called' || e.payload['toolName'] !== MEMORY_TOOL || e.payload['agentId'] !== agentId) continue;
    const inputs = isRec(e.payload['inputs']) ? e.payload['inputs'] : {};
    const r = typeof e.payload['callId'] === 'string' ? returns.get(e.payload['callId']) : undefined;
    out.push({ op: inputs['op'], id: inputs['id'], outcome: r?.['outcome'], returned: r !== undefined });
  }
  return out;
}

const content = (c: MemoryCall): unknown => (isRec(c.outcome) ? c.outcome['content'] : undefined);

/** §B isolation over `trials` trials of the four-step script. */
export function judgeTrialMemoryIsolated(calls: readonly MemoryCall[], trials: number): MemoryVerdict {
  if (calls.length !== 4 * trials || !calls.every((c) => c.returned)) {
    return { kind: 'blocked', reason: `the run MUST log the ${4 * trials} scripted memory calls (four per trial), each with an agent.tool-returned (got ${calls.length}, ${calls.filter((c) => c.returned).length} returned)` };
  }
  const reads = calls.filter((c) => c.op === 'read');
  const seeded = reads.filter((c) => c.id === SEEDED.id);
  const note = reads.filter((c) => c.id === NOTE.id);
  const written = note.filter((c) => content(c) === NOTE.content).length;
  if (written < trials) {
    return { kind: 'blocked', reason: `only ${written} of ${trials} trials read back their own write of ${NOTE.id}, so the memory tool does not reach the trial's memory (fixtures.md memory contract) and isolation is not observable` };
  }
  const empty = note.filter((c) => content(c) === null).length;
  return {
    kind: 'judged',
    findings: [
      { ok: seeded.length === trials && seeded.every((c) => content(c) === SEEDED.content), message: `every trial MUST start from the memorySeed snapshot: each of the ${trials} reads of ${SEEDED.id} MUST return content "${SEEDED.content}" (got ${JSON.stringify(seeded.map(content))})` },
      { ok: empty === trials && note.length === 2 * trials, message: `memory one trial writes MUST NOT be visible to another trial: each trial's first read of ${NOTE.id} MUST find nothing, so ${trials} of the ${note.length} reads return content null (got ${empty})` },
    ],
  };
}
