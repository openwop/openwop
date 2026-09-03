/**
 * Scenarios that measure the SPEC, not the host (RFC 0148 §A).
 *
 * ## The defect
 *
 * 28 scenarios read `spec/v1/*.md` to check the corpus is internally coherent —
 * that the `protocolVersion` grammar in the schema matches RFC 0149, that error
 * envelopes are the shape `error-envelope.schema.json` declares, that every
 * normative example extracts and validates. They assert nothing whatever about
 * a host.
 *
 * `spec/v1/` is deliberately NOT bundled in the published tarball (`paths.ts`
 * says so), so in a published-layout run `V1_DIR` is null and they
 * `describe.skipIf` at COLLECTION time. No test body runs, so no `softSkip`
 * note is recorded, and `resolveFileRecord` resolves an all-skipped file with no
 * reason to **`blocked`** carrying "every test returned early … no recorded
 * reason".
 *
 * That row then lands in a HOST's certification bundle. A host operator reads
 * `blocked` and cannot tell it from a real gap in their implementation. A
 * tier-2 host measured 13 such rows — **a third of their undiagnosed set** —
 * and only discovered what they were by pointing `OPENWOP_CONFORMANCE_ROOT` at
 * a spec checkout and watching 85 assertions pass in about a second, 59 of them
 * against a dead `localhost:9`.
 *
 * ## Why `inapplicable`, and why not the other four
 *
 * RFC 0148 §A defines the two candidates precisely, and the definitions decide
 * it:
 *
 *   - `blocked` — "**advertised behavior** could not be exercised because a
 *     required seam, fixture, credential, or dependency was unavailable."
 *     There is no advertised behaviour here. Nothing about the host was ever
 *     going to be exercised, so nothing about the host failed to be.
 *   - `inapplicable` — "the requirement does not apply to the captured
 *     discovery/profile set." A requirement about the spec corpus does not
 *     apply to any host's discovery set. This is the honest label.
 *
 * `executed-pass` is wrong for the obvious reason: in a run where the corpus is
 * absent, nothing executed, and claiming a pass for an unrun scenario is the
 * defect this whole disposition system exists to prevent. A NEW disposition
 * value was considered and rejected — `certification-bundle-v2.schema.json`
 * enumerates the five, and `verifyBundleV2` is a published consumer contract,
 * so a sixth is a wire break for every existing verifier. Correct use of an
 * existing value costs nothing and breaks no one.
 *
 * `inapplicable` is in `CERTIFIABLE`, which is the point: these rows stop
 * counting against a host that has no way to affect them.
 *
 * ## Why a list and not a predicate
 *
 * The property is static — "gates on `V1_DIR` and never touches `driver`" — and
 * cannot be evaluated from `setup.ts` at runtime. So it is a list, and a list
 * drifts. `spec-coherence-registry.test.ts` re-derives it from source on every
 * run and fails when the two disagree, which is the only thing that makes a
 * hand-maintained set trustworthy.
 *
 * ## What is deliberately NOT here — and why it is a Set, not a sentence
 *
 * Seven scenarios gate on `V1_DIR` **and** drive the host. They assert
 * advertised host behaviour that could not be exercised because a dependency
 * was unavailable — `blocked`, exactly as §A defines it. Classifying them
 * `inapplicable` would tell a host "this does not apply to you" about a
 * requirement that does.
 *
 * They are listed in `SPEC_COHERENCE_EXCLUDED` below rather than named in this
 * prose, because naming them here made this file lie to a reasonable reader.
 * A peer checking membership with `grep -c "<scenario>" spec-coherence.ts` got
 * **1 hit for all three** of the ones the prose named — from this very
 * paragraph — and was one step from reporting that host-behaviour rows had
 * been downgraded to "does not apply to you" as a credit. They caught it only
 * because two counts disagreed: 28 members and those 7 included cannot both be
 * true.
 *
 * **A text search over this file still matches both sets** — that is inherent
 * to any file that names what it excludes. So the exclusions are now an
 * exported Set with the same standing as the inclusions: membership has a
 * programmatic answer, `spec-coherence-registry.test.ts` asserts the two are
 * disjoint and jointly exhaustive over the `V1_DIR`-gated files, and a comment
 * is no longer the only place the exclusion reason lives.
 */

/**
 * Scenarios whose subject is the corpus. Suite 2.0.0 (RFC 0168 §D.1): they
 * live in `src/coherence/`, not `src/scenarios/`, and the set is the DIRECTORY
 * LISTING — one source of truth instead of four (this list, the package.json
 * negations, spec-coherence-scenarios.json and the registry self-test used to
 * each carry a copy). They run in the spec repo's CI (scripts/check-spec-coherence.mjs)
 * and never enter a host bundle; the published tarball excludes the directory.
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const COHERENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'coherence');
export const SPEC_COHERENCE_SCENARIOS: ReadonlySet<string> = new Set(
  existsSync(COHERENCE_DIR) ? readdirSync(COHERENCE_DIR).filter((f) => f.endsWith('.test.ts')).sort() : [],
);

/**
 * Scenarios that gate on `V1_DIR` **and** drive the host, so their `blocked` is
 * honest: advertised behaviour a missing dependency prevented exercising.
 * Exported so membership is checkable in code rather than inferred from prose.
 */
export const SPEC_COHERENCE_EXCLUDED: ReadonlySet<string> = new Set([
  'artifact-type-registration-source.test.ts',
  'artifact-type-store-emission.test.ts',
  'data-residency-admission.test.ts',
  'profile-discovery-core-alias.test.ts',
  'replay-side-effect-suppression.test.ts',
  'workflow-chain-deferred-parameters.test.ts',
  'workflow-variable-format.test.ts',
]);

/** The reason recorded on such a row, written for the host operator reading it. */
export const SPEC_COHERENCE_DETAIL =
  'inapplicable to any host: this scenario reads spec/v1/ to check the SPEC corpus is internally coherent and asserts nothing about a host. '
  + 'The published tarball does not bundle spec/v1/ (see lib/paths.ts), so it does not run here. '
  + 'Set OPENWOP_CONFORMANCE_ROOT to a spec checkout to run it; it needs no host.';
