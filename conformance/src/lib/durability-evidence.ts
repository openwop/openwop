/**
 * RFC 0158 §E — the rung and the recovery bound, IN THE BUNDLE.
 *
 * §E.10 mints no discovery capability: "a qualification ladder is evidence about
 * behaviour that already exists, so the useful place for a rung and a recovery
 * bound is the host's conformance evidence bundle — where a claim without
 * evidence is already a defect." Until 2.34.0 that sentence had nothing behind
 * it. `certification-bundle.schema.json` had no seat for a rung, a bound or its
 * terms; a bundle showed five pass/fail rows, and a reader could neither tell
 * which rung was claimed nor recompute the bound. The terms lived only on a
 * non-normative seam route. Found by READING acceptance criterion 1 at the
 * moment of flipping the RFC, with every row already green.
 *
 * ── Why the evidence rides on ROWS ───────────────────────────────────────────
 * The attestation covers exactly `{ witnessSha256, host.build, suite.version,
 * discovery.sha256 }` (`conformance.md` §Bundle v3), and `witnessSha256` digests
 * the requirement rows. A top-level block would therefore be UNSIGNED — a bound
 * or a rung editable after signing on a bundle that still verifies. Evidence
 * carried on a row is inside the witness digest, and so inside the signature.
 * It enters the digest ONLY WHEN PRESENT, so every bundle cut before 2.34.0
 * digests byte-identically and still verifies (pinned against the three
 * committed bundles in `durability-evidence.test.ts`).
 *
 * ── Why the rung claim is NOT trusted ────────────────────────────────────────
 * `durability.rung` sits at the top level, outside the signature, and that is
 * sound for the same reason `claimedProfiles[].certified` is: the verifier
 * RE-DERIVES it from signed rows and rejects a claim it cannot derive. §D: "a
 * host MAY claim a rung only with the evidence named for it."
 *
 * ── Why a kill row names its recovery CLASS ──────────────────────────────────
 * Unresolved Question 1 resolved PER WORK CLASS, not a scalar. A host with an
 * outbox lane (65 s) and a dispatch lease (750 s) has two bounds, so each kill
 * row records `{ class, boundMs, observedMs }`: the class MUST name a declared
 * entry, `boundMs` MUST equal that entry's `bound`, and `observedMs` MUST NOT
 * exceed it.
 *
 * WHAT THAT CATCHES, and what it cannot. It refuses an undeclared class, a bound
 * label that disagrees with its class, and a resumption outside the bound. It
 * does NOT catch a host that names the WRONG DECLARED class while resuming
 * inside that class's (longer) bound — which a tier-1 host actually shipped: the
 * seam killed before the execution claim was held, the 65 s lane rescued the run
 * in 11.6 s, and the exercise was labelled leased / 750 s, every row green. No
 * arithmetic separates that from a fast leased recovery. What the evidence
 * changes is that it becomes VISIBLE — 11.6 s recorded against a class whose own
 * terms say 720 s of lease — where before nothing was recorded at all. Killing
 * only once the claim is held stays the HOST's obligation (§E).
 *
 * `class` is an OPAQUE host-chosen string, never an enum: "leased" / "unleased"
 * name one host's mechanisms and boot re-entry is another's. An enum would
 * select for an architecture, which this RFC refuses to do everywhere else.
 * There is NO scalar "overall bound": that is UQ1's lie by aggregation with a
 * friendlier name, and a reader would use it.
 *
 * What this block proves: ARITHMETIC (Σ terms = bound) and, through the kill
 * rows' `observedMs`, that the mechanism RAN at least once inside the bound.
 * `bound-is-derived` alone remains a paper check and MUST NOT be cited for
 * liveness.
 */

/** Host-chosen identifiers enter a PUBLISHED bundle: short, plain, no free text. */
export const EVIDENCE_NAME_PATTERN = /^[a-z][A-Za-z0-9._-]{0,63}$/;
export const MAX_RECOVERY_CLASSES = 16;
export const MAX_TERMS_PER_CLASS = 16;

export interface RecoveryTerm { readonly name: string; readonly ms: number }
export interface RecoveryBound { readonly class: string; readonly bound: number; readonly terms: readonly RecoveryTerm[] }
export interface RecoveryObservation { readonly class: string; readonly boundMs: number; readonly observedMs: number }
/** Closed. One optional member per KIND of structured evidence a row may carry. */
export interface RowEvidence { readonly recovery?: RecoveryObservation; readonly recoveryBounds?: readonly RecoveryBound[] }

export type DurabilityRung = 'durable-single-instance' | 'durable-multi-instance' | 'multi-region-qualified';
export const RUNGS: readonly DurabilityRung[] = ['durable-single-instance', 'durable-multi-instance', 'multi-region-qualified'];

const R = 'openwop.requirement.0158.';
/** The rows §Acceptance names for the lowest rung. */
export const SINGLE_INSTANCE_ROWS: readonly string[] = ['kill-after-accept', 'kill-during-execution', 'duplicate-delivery', 'poison-exhaustion', 'bound-is-derived'].map((r) => R + r);
const KILL_ROWS: readonly string[] = [R + 'kill-after-accept', R + 'kill-during-execution'];
const BOUND_ROW = R + 'bound-is-derived';

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isName = (s: unknown): s is string => typeof s === 'string' && EVIDENCE_NAME_PATTERN.test(s);

/** Normalise what a host's seam returned into bundle evidence, or say exactly why it cannot be. */
export function parseRecoveryBounds(raw: unknown): { ok: true; bounds: RecoveryBound[] } | { ok: false; why: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, why: 'no recovery classes were declared' };
  if (raw.length > MAX_RECOVERY_CLASSES) return { ok: false, why: `more than ${MAX_RECOVERY_CLASSES} recovery classes` };
  const bounds: RecoveryBound[] = [];
  const seen = new Set<string>();
  for (const entry of raw as Array<Record<string, unknown>>) {
    const cls = entry?.['class'];
    if (!isName(cls)) return { ok: false, why: `a recovery class name does not match ${String(EVIDENCE_NAME_PATTERN)}` };
    if (seen.has(cls)) return { ok: false, why: `recovery class ${cls} is declared twice` };
    seen.add(cls);
    const terms = entry['terms'];
    if (!Array.isArray(terms) || terms.length === 0 || terms.length > MAX_TERMS_PER_CLASS) return { ok: false, why: `class ${cls}: terms[] MUST carry 1..${MAX_TERMS_PER_CLASS} entries — a total alone cannot be recomputed` };
    const clean: RecoveryTerm[] = [];
    for (const t of terms as Array<Record<string, unknown>>) {
      if (!isName(t?.['name']) || !isCount(t['ms'])) return { ok: false, why: `class ${cls}: every term is { name, ms } with ms a non-negative integer` };
      clean.push({ name: t['name'] as string, ms: t['ms'] as number });
    }
    if (!isCount(entry['bound'])) return { ok: false, why: `class ${cls}: bound is a non-negative integer of milliseconds` };
    const sum = clean.reduce((a, t) => a + t.ms, 0);
    if (sum !== entry['bound']) return { ok: false, why: `class ${cls}: terms sum to ${sum} ms but the declared bound is ${String(entry['bound'])} ms — a host that states a bound its terms do not produce fails §B.5` };
    bounds.push({ class: cls, bound: entry['bound'] as number, terms: clean });
  }
  return { ok: true, bounds };
}

interface Row { readonly id: string; readonly result: string; readonly evidence?: RowEvidence }

/**
 * The highest rung these SIGNED rows support, and — when it is lower than a
 * reader might hope — the first reason why. Only `durable-single-instance` is
 * derivable today: `peer-resume` is bundle-witnessed by a per-boot incarnation
 * token this revision does not yet carry (§E), so a higher claim is REFUSED
 * rather than waved through.
 */
export function deriveRung(rows: readonly Row[]): { rung: DurabilityRung | null; why: string } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of SINGLE_INSTANCE_ROWS) {
    const row = byId.get(id);
    if (row === undefined) return { rung: null, why: `${id} is absent from the bundle` };
    if (row.result !== 'executed-pass') return { rung: null, why: `${id} is ${row.result}, not executed-pass` };
  }
  const declared = parseRecoveryBounds(byId.get(BOUND_ROW)?.evidence?.recoveryBounds);
  if (!declared.ok) return { rung: null, why: `${BOUND_ROW} carries no usable evidence.recoveryBounds — ${declared.why}` };
  const bounds = new Map(declared.bounds.map((b) => [b.class, b.bound]));
  for (const id of KILL_ROWS) {
    const obs = byId.get(id)?.evidence?.recovery;
    if (obs === undefined) return { rung: null, why: `${id} passed but recorded no evidence.recovery — the class it exercised and the interval it observed are unknown` };
    if (!isName(obs.class) || !isCount(obs.boundMs) || !isCount(obs.observedMs)) return { rung: null, why: `${id}: evidence.recovery is malformed` };
    const bound = bounds.get(obs.class);
    if (bound === undefined) return { rung: null, why: `${id} exercised recovery class "${obs.class}", which ${BOUND_ROW} does not declare (declared: ${[...bounds.keys()].join(', ')})` };
    if (obs.boundMs !== bound) return { rung: null, why: `${id} was judged against ${obs.boundMs} ms but class "${obs.class}" declares ${bound} ms — the exercise was labelled with a bound that does not govern it` };
    if (obs.observedMs > bound) return { rung: null, why: `${id} resumed after ${obs.observedMs} ms, outside the ${bound} ms bound of class "${obs.class}"` };
  }
  return { rung: 'durable-single-instance', why: 'all five rows executed-pass; each kill row names a declared class and resumed inside its bound' };
}

/** Is the rung a bundle CLAIMS supported by its own signed rows? */
export function checkRungClaim(claimed: unknown, rows: readonly Row[]): { ok: true } | { ok: false; detail: string } {
  if (claimed === undefined) return { ok: true };
  if (typeof claimed !== 'string' || !(RUNGS as readonly string[]).includes(claimed)) return { ok: false, detail: `durability.rung ${JSON.stringify(claimed)} is not one of ${RUNGS.join(' | ')}` };
  const derived = deriveRung(rows);
  if (derived.rung === null) return { ok: false, detail: `durability.rung claims ${claimed}, but the signed rows do not support any rung: ${derived.why}` };
  if (claimed !== derived.rung) return { ok: false, detail: `durability.rung claims ${claimed}, but the signed rows support only ${derived.rung} — a higher rung is bundle-witnessed by evidence this revision does not yet carry (RFC 0158 §E, peer-resume), so it is refused rather than assumed` };
  return { ok: true };
}

/**
 * Was this bundle cut by a NEWER suite than the verifier reading it?
 *
 * Row evidence enters the witness digest, so a verifier older than 2.34.0 that
 * meets a bundle carrying it recomputes a different digest and reports
 * `witness-digest` — it FAILS CLOSED, which is right, but the message reads as
 * tampering when the truth is "upgrade the verifier". Every later digested
 * member will repeat that. The notice is advice; it never changes a verdict.
 */
export function emittedByNewerSuite(bundleSuite: unknown, verifierSuite: string): boolean {
  const parse = (v: unknown): number[] | null => {
    const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null;
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const b = parse(bundleSuite); const mine = parse(verifierSuite);
  if (b === null || mine === null) return false;
  for (let i = 0; i < 3; i++) { if ((b[i] as number) !== (mine[i] as number)) return (b[i] as number) > (mine[i] as number); }
  return false;
}

// ── the scenario → setup.ts → ledger channel ─────────────────────────────────
let pending: RowEvidence | null = null;
/** Called by a scenario inside an `it`; setup.ts attaches it to that test's ledger row. Later notes merge. */
export function noteEvidence(evidence: RowEvidence): void { pending = { ...(pending ?? {}), ...evidence }; }
/** setup.ts reads and clears it after each test. */
export function takeNotedEvidence(): RowEvidence | null { const e = pending; pending = null; return e; }
