/**
 * RFC 0244 — the suite's reference grader for eval trajectories and trials.
 *
 * Pure functions, no I/O. `v2-eval-trajectory-trials.test.ts` uses them to
 * recompute what a host must report, so a host's grade is checked against the
 * normative definition rather than against itself:
 *
 *   gradeTrajectory   §A — the four match modes, `forbidden`, `argsMatch`,
 *                     and the mode-independent `matchedCount` (a maximum
 *                     one-to-one matching, ignoring order).
 *   passAtK / passHatK / scoreStderr   §B — the normative formulas.
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md
 * @see schemas/v2/agent-eval-suite.schema.json, schemas/v2/eval-summary.schema.json
 */

export type ArgsMatch = 'ignore' | 'exact' | 'subset';
export type MatchMode = 'exact' | 'in-order' | 'any-order' | 'subset';
export interface ExpectedCall { readonly tool: string; readonly args?: unknown; readonly argsMatch?: ArgsMatch }
export interface ObservedCall { readonly tool: string; readonly inputs?: unknown }
export interface TrajectorySpec { readonly match: MatchMode; readonly calls: readonly ExpectedCall[]; readonly forbidden?: readonly string[] }
export interface TrajectoryGrade {
  readonly mode: MatchMode;
  readonly matched: boolean;
  readonly expectedCount: number;
  readonly observedCount: number;
  readonly matchedCount: number;
  readonly forbiddenCount: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON deep equality, key-order insensitive. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** `subset`: every key path in `expected` is present in `actual` with a JSON-deep-equal value. */
export function jsonSubset(expected: unknown, actual: unknown): boolean {
  if (isRecord(expected)) return isRecord(actual) && Object.keys(expected).every((k) => k in actual && jsonSubset(expected[k], actual[k]));
  return jsonEqual(expected, actual);
}

export function callMatches(e: ExpectedCall, o: ObservedCall): boolean {
  if (e.tool !== o.tool) return false;
  const mode = e.argsMatch ?? 'ignore';
  if (mode === 'ignore' || e.args === undefined) return true;
  return mode === 'exact' ? jsonEqual(e.args, o.inputs) : jsonSubset(e.args, o.inputs);
}

/** Size of a maximum one-to-one matching (Kuhn's augmenting paths). */
function maxMatching(expected: readonly ExpectedCall[], observed: readonly ObservedCall[]): number {
  const owner: (number | undefined)[] = new Array(observed.length).fill(undefined);
  const augment = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < observed.length; j++) {
      if (seen[j] || !callMatches(expected[i]!, observed[j]!)) continue;
      seen[j] = true;
      if (owner[j] === undefined || augment(owner[j]!, seen)) { owner[j] = i; return true; }
    }
    return false;
  };
  let n = 0;
  for (let i = 0; i < expected.length; i++) if (augment(i, new Array(observed.length).fill(false))) n++;
  return n;
}

function inOrder(expected: readonly ExpectedCall[], observed: readonly ObservedCall[]): boolean {
  let j = 0;
  for (const e of expected) {
    while (j < observed.length && !callMatches(e, observed[j]!)) j++;
    if (j === observed.length) return false;
    j++;
  }
  return true;
}

export function gradeTrajectory(spec: TrajectorySpec, observed: readonly ObservedCall[]): TrajectoryGrade {
  const forbidden = new Set(spec.forbidden ?? []);
  const forbiddenCount = observed.filter((o) => forbidden.has(o.tool)).length;
  const matchedCount = maxMatching(spec.calls, observed);
  let modeOk: boolean;
  switch (spec.match) {
    case 'exact': modeOk = observed.length === spec.calls.length && spec.calls.every((e, i) => callMatches(e, observed[i]!)); break;
    case 'in-order': modeOk = inOrder(spec.calls, observed); break;
    case 'any-order': modeOk = matchedCount === spec.calls.length; break;
    case 'subset': modeOk = observed.every((o) => spec.calls.some((e) => callMatches(e, o))); break;
  }
  return { mode: spec.match, matched: modeOk && forbiddenCount === 0, expectedCount: spec.calls.length, observedCount: observed.length, matchedCount, forbiddenCount };
}

/**
 * C(a, k) / C(b, k) as an exact rational, converted to a double once. The
 * ratio telescopes to Π (a−i)/(b−i) for i < k, so no factorial is formed and
 * the result is stable for large n (pass^k(200, 100, 50) ≈ 2.2e-19).
 */
function binomRatio(a: number, b: number, k: number): number {
  if (k < 0 || k > b) throw new RangeError(`k=${k} outside 0..${b}`);
  if (k > a) return 0;
  let num = 1n;
  let den = 1n;
  for (let i = 0; i < k; i++) { num *= BigInt(a - i); den *= BigInt(b - i); }
  return ratioToNumber(num, den);
}

/** num/den (num ≤ den, both > 0) to the nearest double, without overflowing either. */
function ratioToNumber(num: bigint, den: bigint): number {
  if (num === 0n) return 0;
  const shift = den.toString(2).length - num.toString(2).length + 64;
  const q = (num << BigInt(shift)) / den;
  let r = Number(q);
  let e = shift;
  while (e > 1000) { r *= 2 ** -1000; e -= 1000; }
  return r * 2 ** -e;
}

/** pass@k = 1 − C(n−c, k) / C(n, k); 0 when c = 0. */
export function passAtK(n: number, c: number, k: number): number {
  if (c === 0) return 0;
  return 1 - binomRatio(n - c, n, k);
}

/** pass^k = C(c, k) / C(n, k); 0 when c < k. */
export function passHatK(n: number, c: number, k: number): number {
  if (c < k) return 0;
  return binomRatio(c, n, k);
}

/** RFC 0244 §B tolerance: a host value agrees with the formula when |host − ref| ≤ 1e-9 · max(1, |ref|). */
export function withinTolerance(host: number, ref: number): boolean {
  return Number.isFinite(host) && Math.abs(host - ref) <= 1e-9 * Math.max(1, Math.abs(ref));
}

/** Sample sd of the per-task mean scores over √T; undefined when T < 2. */
export function scoreStderr(taskMeans: readonly number[]): number | undefined {
  const t = taskMeans.length;
  if (t < 2) return undefined;
  const mean = taskMeans.reduce((a, b) => a + b, 0) / t;
  const variance = taskMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (t - 1);
  return Math.sqrt(variance) / Math.sqrt(t);
}
