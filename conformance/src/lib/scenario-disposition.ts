/**
 * RFC 0148 §A / acceptance item 2 (S6) — file-level requirement recording and
 * the runner's derivation.
 *
 * Two halves that meet through the ledger file sink:
 *
 * 1. **In the vitest worker** (`setup.ts` hooks): every scenario FILE records
 *    exactly one disposition for its own requirement id when it finishes —
 *    `executed-fail` if any test failed, `executed-pass` if any test passed and
 *    none failed, and for a file whose tests ALL skipped: `inapplicable` /
 *    `skipped` if a `behaviorGate` inside the file recorded one of those for the
 *    profile it gates on (the honest reason the tests did not run), else
 *    `blocked` — an all-skipped file with no recorded reason is an unclassified
 *    return, and §A resolves it to `blocked`, never to a pass.
 *
 * 2. **In the `--certify` runner** (`deriveRequirementDispositions`): every
 *    scenario file's requirement is taken FROM THE LEDGER when present, falling
 *    back to the vitest per-file report only for pass/fail (which the ledger
 *    would agree with) and to `blocked` (unclassified) otherwise; the floor's
 *    prefix requirements (`openwop.floor.any.<prefix>`) are derived from the
 *    files that match; and a claimed profile whose floor contains ANY requirement
 *    with no ledger entry is flagged `unclassified` so the runner can REJECT the
 *    certification rather than round the silence up.
 *
 * Pure functions, no I/O, so `runner-ledger.test.ts` can pin them without a
 * host or a vitest subprocess.
 */

import { scenarioFileOfItId } from './requirement-ids.js';
import { PROFILE_FLOOR_SCENARIOS } from './profiles.js';
import { requirementIdForScenario, requirementIdForPrefix, requirementsFor } from './requirement-registry.js';
import { UNCLASSIFIED_RETURN_DETAIL } from './soft-skip.js';
import { SPEC_COHERENCE_SCENARIOS, SPEC_COHERENCE_DETAIL } from './spec-coherence.js';
import { CERTIFIABLE, type Disposition, type LedgerEntry } from './requirement-ledger.js';

/** All scenario basenames that appear in some profile's runtime floor. */
export function floorScenarioFiles(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const floor of Object.values(PROFILE_FLOOR_SCENARIOS)) {
    for (const f of floor.required) out.add(f);
    for (const c of floor.conditional ?? []) for (const f of c.required) out.add(f);
  }
  return out;
}

/** The requirement id a scenario FILE records under: the §A floor id when the
 *  file is part of a floor, else the runner's per-scenario id. */
export function requirementIdForFile(basename: string): string {
  return floorScenarioFiles().has(basename)
    ? requirementIdForScenario(basename)
    : `openwop.scenario.${basename.replace(/\.test\.ts$/, '')}`;
}

/**
 * Marks an `executed-pass` row whose file ALSO recorded a soft-skip note — the
 * file asserted something, then stopped short (gap G8). Greppable on purpose: a
 * bundle reader filters `disposition === 'executed-pass' && detail?.startsWith(
 * PARTIAL_WITNESS_PREFIX)` to find rows where the requirement may not have been
 * the thing that passed.
 */
export const PARTIAL_WITNESS_PREFIX = 'partial-witness: ';

export type FileTestState = 'pass' | 'fail' | 'skip';

/** Worker half: fold a file's per-test states (+ any gate-recorded reason) into
 *  the ONE disposition the file records. */
export function fileDisposition(
  states: readonly FileTestState[],
  gateReason: 'inapplicable' | 'skipped' | undefined,
  assertionCount?: number,
): { disposition: Disposition; detail?: string } {
  if (states.some((s) => s === 'fail')) return { disposition: 'executed-fail', detail: 'one or more assertions in the file failed' };
  if (states.some((s) => s === 'pass')) {
    // A test that early-returned through `behaviorGate` is reported by vitest
    // as a pass with zero assertions. When EVERY passing test in the file did
    // that (assertionCount 0) and the gate recorded why, the file's honest
    // disposition is the gate's — `inapplicable` / `skipped` with its reason —
    // not a vacuous executed-pass. Without a gate reason a zero-assertion pass
    // stays `executed-pass` with `assertionCount: 0`, which certification
    // rejects as unclassified (RFC 0148 §A).
    if (assertionCount === 0 && gateReason === 'inapplicable') {
      return { disposition: 'inapplicable', detail: 'every test returned early through behaviorGate with zero assertions: profile not advertised in the captured discovery set' };
    }
    if (assertionCount === 0 && gateReason === 'skipped') {
      return { disposition: 'skipped', detail: 'every test returned early through behaviorGate with zero assertions: operator opted the profile out (OPENWOP_OPTED_OUT_PROFILES)' };
    }
    return { disposition: 'executed-pass' };
  }
  if (gateReason === 'inapplicable') return { disposition: 'inapplicable', detail: 'every test skipped: profile not advertised in the captured discovery set (behaviorGate)' };
  if (gateReason === 'skipped') return { disposition: 'skipped', detail: 'every test skipped: operator opted the profile out (OPENWOP_OPTED_OUT_PROFILES)' };
  return {
    disposition: 'blocked',
    detail:
      states.length === 0
        ? 'no test executed and no disposition recorded — unclassified return (RFC 0148 §A resolves it to blocked)'
        : 'every test skipped with no recorded reason — unclassified return (RFC 0148 §A resolves it to blocked)',
  };
}

/**
 * The runner's file-level record (RFC 0148 §A), as `setup.ts` computes it in
 * `afterAll`. Pure so `conformance-execution-witness.test.ts` can pin the rule
 * the hooks apply:
 *   - a failed test ⇒ executed-fail; a witnessed pass ⇒ executed-pass;
 *   - a zero-assertion "pass" ⇒ the file's noted reason (`softSkip` /
 *     `seamAbsent`: inapplicable | skipped | blocked) or a behaviorGate reason;
 *   - a zero-assertion "pass" with NO reason ⇒ `blocked` + the marker detail —
 *     an early return can never become a pass;
 *   - every test `ctx.skip()`ped ⇒ the file's noted reason if it wrote one
 *     BEFORE skipping (`ctx.skip()` throws), else `blocked` + the marker.
 */
export function resolveFileRecord(
  states: readonly FileTestState[],
  gateReason: 'inapplicable' | 'skipped' | undefined,
  assertionCount: number,
  noted: { kind: 'inapplicable' | 'skipped' | 'blocked'; reason: string } | null,
  specCoherenceFile?: string,
): { disposition: Disposition; detail?: string } {
  // A scenario whose subject is the CORPUS, skipped because the published
  // tarball does not bundle spec/v1/. RFC 0148 §A: `blocked` is defined over
  // ADVERTISED BEHAVIOUR, and there is none here — nothing about the host was
  // ever going to be exercised. `inapplicable` is the honest label, and it is
  // CERTIFIABLE, so these rows stop counting against a host that cannot affect
  // them. See lib/spec-coherence.ts for why not a new disposition value.
  if (
    specCoherenceFile !== undefined
    && process.env.OPENWOP_CORPUS_GATE !== '1' // suite 2.0.0: under the corpus gate the coherence scenario IS the subject
    && SPEC_COHERENCE_SCENARIOS.has(specCoherenceFile)
    && !states.includes('fail')
    && assertionCount === 0
  ) {
    return { disposition: 'inapplicable', detail: SPEC_COHERENCE_DETAIL };
  }
  let { disposition, detail } = fileDisposition(states, gateReason, assertionCount);
  if (disposition === 'executed-pass' && assertionCount === 0) {
    if (noted !== null) {
      disposition = noted.kind;
      detail = noted.reason;
    } else {
      disposition = 'blocked';
      detail = UNCLASSIFIED_RETURN_DETAIL;
    }
  } else if (
    noted !== null &&
    gateReason === undefined &&
    states.length > 0 &&
    states.every((s) => s === 'skip')
  ) {
    // Every test called `ctx.skip()` (vitest reports them as skipped, not as
    // zero-assertion passes) and the file noted why first. Note-then-skip is
    // the required order: `ctx.skip()` throws, so a note written after it is
    // dead code — which is how seven files carried notes the ledger never saw.
    disposition = noted.kind;
    detail = noted.reason;
  } else if (noted !== null && disposition === 'executed-pass') {
    // PARTIAL WITNESS (2026-08-19, gap G8). The file asserted something and then
    // soft-skipped: `return softSkip(...)` yields a PASS state, not a skip, so
    // neither branch above fires and the note used to be discarded outright. The
    // row then read `executed-pass` for a requirement the run may never have
    // reached — e.g. a file asserting a `201` setup precondition before
    // returning `inapplicable`.
    //
    // Same defect as the note-after-`ctx.skip()` case the comment above records;
    // note-after-ASSERTION was the half that stayed. Both hid because nothing
    // goes red.
    //
    // The disposition is deliberately NOT changed. Honouring the note here would
    // downgrade a file that legitimately completed its requirement AND
    // soft-skipped an optional extra leg — trading a false positive for a false
    // negative, on a per-FILE note that cannot say which leg it came from. The
    // durable fix is per-`it` recording; this makes the affected rows
    // self-identifying first, so that change follows measurement instead of
    // preceding it. `detail` is permitted on `executed-pass` (RFC 0148 §A only
    // REQUIRES it for other dispositions), so this is additive on the wire.
    detail = `${PARTIAL_WITNESS_PREFIX}${noted.kind}: ${noted.reason}`;
  }
  return detail === undefined ? { disposition } : { disposition, detail };
}

export interface DerivedRequirement {
  readonly requirementId: string;
  readonly scenarioId: string;
  readonly disposition: Disposition;
  readonly detail?: string;
  /** RFC 0148 §C — present when the ledger recorded it. */
  readonly assertionCount?: number;
}

export interface DerivedProfileVerdict {
  readonly profile: string;
  /** Floor requirement ids with NO ledger entry (unclassified returns). */
  readonly unclassified: readonly string[];
  /** Floor requirement ids whose disposition is not certifiable. */
  readonly blocking: readonly string[];
  readonly certifiable: boolean;
  /**
   * `PROFILE_FLOOR_SCENARIOS[profile].runtimeDerived`: the profile is HELD only
   * when every floor requirement is a witnessed `executed-pass`. When false for
   * such a profile the emitter drops it from `claimedProfiles` — the host does
   * not hold it — rather than reporting a rejection or a blocked claim.
   */
  readonly runtimeDerived: boolean;
  /** For runtime-derived profiles: every floor row is a witnessed executed-pass. */
  readonly held: boolean;
}

export interface Derivation {
  readonly requirements: readonly DerivedRequirement[];
  readonly totals: { executedPass: number; executedFail: number; skipped: number; inapplicable: number; blocked: number };
  readonly verdicts: readonly DerivedProfileVerdict[];
  /** True when ANY claimed profile has an unclassified floor requirement. The
   *  runner MUST reject certification in that case (RFC 0148 acceptance item 2). */
  readonly rejectUnclassified: boolean;
  /** Whether a ledger was available at all (false ⇒ every row is report-derived). */
  readonly ledgerPresent: boolean;
}

/**
 * Runner half. `reportStates` is what vitest's JSON report said per file
 * (`passed`/`failed`/`skipped`); `ledger` is what the workers recorded.
 */
export function deriveRequirementDispositions(
  reportStates: ReadonlyMap<string, 'passed' | 'failed' | 'skipped'>,
  ledger: readonly LedgerEntry[],
  claimedProfiles: readonly string[],
  /** The captured discovery document — needed to evaluate a discovery-conditional floor (G7). */
  document?: Readonly<Record<string, unknown>>,
): Derivation {
  const byId = new Map(ledger.map((e) => [e.requirementId, e] as const));
  const ledgerPresent = ledger.length > 0;
  const rows: DerivedRequirement[] = [];
  const perFile = new Map<string, DerivedRequirement>();

  for (const [file, state] of [...reportStates.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const id = requirementIdForFile(file);
    const rec = byId.get(id);
    let row: DerivedRequirement;
    if (rec !== undefined) {
      row = {
        requirementId: id,
        scenarioId: file,
        disposition: rec.disposition,
        ...(rec.detail === undefined ? {} : { detail: rec.detail }),
        ...(rec.assertionCount === undefined ? {} : { assertionCount: rec.assertionCount }),
      };
    } else if (state === 'passed') {
      row = ledgerPresent
        ? { requirementId: id, scenarioId: file, disposition: 'executed-pass', detail: 'report-derived: vitest passed the file but no disposition was recorded (assertion count unknown) — unclassified for a claimed floor' }
        : { requirementId: id, scenarioId: file, disposition: 'executed-pass' };
    } else if (state === 'failed') {
      row = { requirementId: id, scenarioId: file, disposition: 'executed-fail', detail: 'the scenario executed and failed (report-derived; no ledger entry)' };
    } else {
      row = {
        requirementId: id,
        scenarioId: file,
        disposition: 'blocked',
        detail: ledgerPresent
          ? 'unclassified return: the file recorded no disposition — RFC 0148 §A resolves it to blocked, never to a pass'
          : 'runner cannot classify a skipped file without a ledger; RFC 0148 §A resolves an unclassifiable requirement to blocked',
      };
    }
    rows.push(row);
    perFile.set(file, row);
  }

  // Prefix requirements: derived from the matching files.
  const prefixIds = new Set<string>();
  for (const floor of Object.values(PROFILE_FLOOR_SCENARIOS)) for (const p of floor.requiredAnyPrefix ?? []) prefixIds.add(p);
  for (const prefix of [...prefixIds].sort()) {
    const matching = [...perFile.entries()].filter(([f]) => f.startsWith(prefix)).map(([, r]) => r);
    const id = requirementIdForPrefix(prefix);
    let row: DerivedRequirement;
    if (matching.some((r) => r.disposition === 'executed-pass')) {
      // Witnessed by the matching passes: the summary row carries their
      // combined assertion count so a consumer reading only this row still
      // sees a witnessed pass (RFC 0148 §C `assertionCount`).
      const witnessed = matching.filter((r) => r.disposition === 'executed-pass').reduce((n, r) => n + (r.assertionCount ?? 0), 0);
      row = { requirementId: id, scenarioId: `${prefix}*`, disposition: 'executed-pass', assertionCount: witnessed };
    } else if (matching.some((r) => r.disposition === 'executed-fail')) {
      row = { requirementId: id, scenarioId: `${prefix}*`, disposition: 'executed-fail', detail: `no ${prefix}* scenario passed and at least one failed` };
    } else if (matching.length === 0) {
      row = { requirementId: id, scenarioId: `${prefix}*`, disposition: 'blocked', detail: `no ${prefix}* scenario ran — unclassified return` };
    } else {
      // all matching files are skipped/inapplicable/blocked: the prefix requirement is met by ANY pass, so none ⇒ blocked
      row = { requirementId: id, scenarioId: `${prefix}*`, disposition: 'blocked', detail: `no ${prefix}* scenario executed a passing assertion (${matching.map((r) => r.disposition).join(', ')})` };
    }
    rows.push(row);
  }

  // Per-`it` rows (suite 1.153.0): every ledger entry keyed `openwop.it.<file>.<slug>`
  // becomes its own bundle row, attributed to its scenario file. Additive — the
  // file-level and prefix rows above are unchanged, and the floors still key on
  // them. This is the granularity RFC 0148 §A describes and the G8 fix.
  const emitted = new Set(rows.map((r) => r.requirementId));
  for (const e of [...ledger].sort((a, b) => a.requirementId.localeCompare(b.requirementId))) {
    // Prefer the file the entry recorded: an explicit `req()` id
    // (`openwop.requirement.…`) is authored, not file-derived, so deriving a
    // file from the id alone returned null and the row was dropped — every
    // explicit requirement id was missing from bundle v3 for that reason.
    const file = e.scenarioFile ?? scenarioFileOfItId(e.requirementId);
    // Attribute only to files this run reported on: a worker's ledger can carry
    // rows from files outside the certified set (the suite's own lib tests, or
    // a filtered run), and those are not evidence about the host.
    if (file === null || emitted.has(e.requirementId) || !reportStates.has(file)) continue;
    emitted.add(e.requirementId);
    rows.push({
      requirementId: e.requirementId,
      scenarioId: file,
      disposition: e.disposition,
      ...(e.detail === undefined ? {} : { detail: e.detail }),
      ...(e.assertionCount === undefined ? {} : { assertionCount: e.assertionCount }),
    });
  }

  const totals = { executedPass: 0, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 };
  for (const r of rows) {
    if (r.disposition === 'executed-pass') totals.executedPass++;
    else if (r.disposition === 'executed-fail') totals.executedFail++;
    else if (r.disposition === 'skipped') totals.skipped++;
    else if (r.disposition === 'inapplicable') totals.inapplicable++;
    else totals.blocked++;
  }

  const rowById = new Map(rows.map((r) => [r.requirementId, r] as const));
  const verdicts: DerivedProfileVerdict[] = [];
  for (const profile of claimedProfiles) {
    const ids = requirementsFor(profile, document);
    if (ids === null) {
      const floor = PROFILE_FLOOR_SCENARIOS[profile];
      const why = floor === undefined ? `(no floor defined for ${profile})` : `(discovery-conditional floor for ${profile} is unevaluable without the discovery document)`;
      verdicts.push({ profile, unclassified: [], blocking: [why], certifiable: false, runtimeDerived: false, held: false });
      continue;
    }
    const unclassified: string[] = [];
    const blocking: string[] = [];
    let witnessedPasses = 0;
    for (const id of ids) {
      const r = rowById.get(id);
      const fromLedger = byId.has(id) || (r !== undefined && r.scenarioId.endsWith('*'));
      if (r !== undefined && r.disposition === 'executed-pass' && (r.assertionCount ?? 0) > 0) witnessedPasses += 1;
      // Unclassified: no row, or a report-derived blocked (nothing recorded), or a
      // VACUOUS pass — executed-pass with assertionCount 0 is a witness of nothing
      // (RFC 0148 §A: "a required behavior MUST NOT be certified without a target
      // execution witness"), so for a claimed floor it counts as unclassified.
      const vacuous =
        r !== undefined &&
        ((r.disposition === 'executed-pass' && r.assertionCount === 0) ||
          // the runner's own §A resolution of a zero-assertion file that noted no
          // reason: honest as a row, still an unclassified return for a floor
          (r.disposition === 'blocked' && r.detail === UNCLASSIFIED_RETURN_DETAIL));
      // With a ledger present, ANY floor row that did not come from the ledger is
      // unclassified: silence is evidence of nothing (RFC 0148 §A). Without a
      // ledger only report-blocked rows are unclassified (the pre-S6 reading).
      const silent = !fromLedger && (ledgerPresent || r?.disposition === 'blocked');
      if (r === undefined || silent || vacuous) unclassified.push(id);
      // Unclassified always blocks: a requirement nobody recorded cannot certify.
      if (r === undefined || silent || vacuous || !CERTIFIABLE.includes(r.disposition)) blocking.push(id);
    }
    // discoveryOnly floors have ids.length === 0 and certify by design here (the
    // requirement-ledger's verifyProfileRequirements is stricter; the runner
    // consults PROFILE_FLOOR_SCENARIOS.discoveryOnly separately).
    const discoveryOnly = PROFILE_FLOOR_SCENARIOS[profile]?.discoveryOnly === true;
    const runtimeDerived = PROFILE_FLOOR_SCENARIOS[profile]?.runtimeDerived === true;
    // A runtime-derived profile is HELD only when every floor row is a witnessed
    // pass ("derivable from which scenarios pass" — profiles.md). Anything else
    // means the host does not hold it: not a rejection, not a blocked claim.
    const held = ids.length > 0 && witnessedPasses === ids.length;
    verdicts.push({
      profile,
      unclassified: runtimeDerived && !held ? [] : unclassified,
      blocking: runtimeDerived && !held ? ids.filter((id) => rowById.get(id)?.disposition !== 'executed-pass' || (rowById.get(id)?.assertionCount ?? 0) === 0) : blocking,
      certifiable: runtimeDerived ? held : discoveryOnly || (ids.length > 0 && blocking.length === 0),
      runtimeDerived,
      held,
    });
  }
  return { requirements: rows, totals, verdicts, rejectUnclassified: verdicts.some((v) => v.unclassified.length > 0), ledgerPresent };
}
