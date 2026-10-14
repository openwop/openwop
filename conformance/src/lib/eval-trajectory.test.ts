import { describe, it, expect } from 'vitest';
import { gradeTrajectory, passAtK, passHatK, scoreStderr, jsonSubset, withinTolerance } from './eval-trajectory.js';

const L = 'conformance.eval:lookup';
const R = 'conformance.eval:refund';
const N = 'conformance.eval:note';
const o = (tool: string, inputs?: unknown) => ({ tool, inputs });

describe('eval-trajectory reference grader (RFC 0244 §A)', () => {
  it('in-order allows extras and refuses a wrong order', () => {
    const spec = { match: 'in-order' as const, calls: [{ tool: L }, { tool: R }] };
    expect(gradeTrajectory(spec, [o(L), o(N), o(R)]).matched).toBe(true);
    expect(gradeTrajectory(spec, [o(R), o(L)]).matched).toBe(false);
    expect(gradeTrajectory(spec, [o(R), o(L)]).matchedCount).toBe(2);
  });
  it('exact needs the same length and pairwise matches', () => {
    const spec = { match: 'exact' as const, calls: [{ tool: L }, { tool: R }] };
    expect(gradeTrajectory(spec, [o(L), o(R)]).matched).toBe(true);
    expect(gradeTrajectory(spec, [o(L), o(N), o(R)]).matched).toBe(false);
  });
  it('any-order matches each expected call once, any order', () => {
    const spec = { match: 'any-order' as const, calls: [{ tool: L }, { tool: L }] };
    expect(gradeTrajectory(spec, [o(L), o(R)]).matched).toBe(false);
    expect(gradeTrajectory(spec, [o(R), o(L), o(L)]).matched).toBe(true);
  });
  it('subset refuses a tool outside the calls and allows repeats', () => {
    const spec = { match: 'subset' as const, calls: [{ tool: L }, { tool: R }] };
    expect(gradeTrajectory(spec, [o(L), o(L)]).matched).toBe(true);
    expect(gradeTrajectory(spec, [o(L), o(N)]).matched).toBe(false);
  });
  it('a forbidden call fails any mode and is counted', () => {
    const g = gradeTrajectory({ match: 'any-order', calls: [{ tool: L }], forbidden: [R] }, [o(L), o(R)]);
    expect(g.matched).toBe(false);
    expect(g.forbiddenCount).toBe(1);
  });
  it('argsMatch exact and subset', () => {
    const exact = { match: 'exact' as const, calls: [{ tool: R, args: { a: 1 }, argsMatch: 'exact' as const }] };
    expect(gradeTrajectory(exact, [o(R, { a: 1 })]).matched).toBe(true);
    expect(gradeTrajectory(exact, [o(R, { a: 1, b: 2 })]).matched).toBe(false);
    expect(jsonSubset({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 })).toBe(true);
    expect(jsonSubset({ a: [1] }, { a: [1, 2] })).toBe(false);
  });
});

describe('eval-trajectory trial formulas (RFC 0244 §B)', () => {
  // [n, c, k, passAtK, passHatK]
  const table: Array<[number, number, number, number, number]> = [
    [5, 4, 3, 1, 0.4],
    [3, 3, 2, 1, 1],
    [3, 0, 2, 0, 0],
    [4, 1, 2, 0.5, 0],
    [10, 5, 1, 0.5, 0.5],
  ];
  for (const [n, c, k, at, hat] of table) {
    it(`n=${n} c=${c} k=${k}`, () => {
      expect(passAtK(n, c, k)).toBeCloseTo(at, 10);
      expect(passHatK(n, c, k)).toBeCloseTo(hat, 10);
    });
  }
  it('is exact for large n: pass^k(200, 100, 50) ≈ 2.2e-19', () => {
    // C(100,50)/C(200,50), computed independently in log space.
    const lnC = (n: number, k: number): number => { let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; };
    const ref = Math.exp(lnC(100, 50) - lnC(200, 50));
    const got = passHatK(200, 100, 50);
    expect(got).toBeGreaterThan(2.1e-19);
    expect(got).toBeLessThan(2.3e-19);
    expect(Math.abs(got - ref) / ref).toBeLessThan(1e-9);
    expect(passAtK(200, 100, 50)).toBe(1);
  });
  it('the tolerance is 1e-9 relative, floored at 1e-9 absolute', () => {
    expect(withinTolerance(0.4 + 1e-12, 0.4)).toBe(true);
    expect(withinTolerance(0.4 + 1e-8, 0.4)).toBe(false);
    expect(withinTolerance(2.2e-19, 0)).toBe(true);
    expect(withinTolerance(Number.NaN, 0)).toBe(false);
  });
  it('stderr is clustered by task and undefined below two tasks', () => {
    expect(scoreStderr([1, 0])).toBeCloseTo(0.5, 10);
    expect(scoreStderr([0.7])).toBeUndefined();
  });
});
