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
 * ## What is deliberately NOT here
 *
 * Seven scenarios gate on `V1_DIR` **and** drive the host
 * (`replay-side-effect-suppression`, `data-residency-admission`,
 * `profile-discovery-core-alias`, `workflow-variable-format`,
 * `workflow-chain-deferred-parameters`, `artifact-type-store-emission`,
 * `artifact-type-registration-source`). Those assert advertised host behaviour
 * that could not be exercised because a dependency was unavailable — which is
 * `blocked`, exactly as §A defines it. Classifying them `inapplicable` would
 * tell a host "this does not apply to you" about a requirement that does.
 */

/** Scenarios whose subject is the corpus. Kept honest by `spec-coherence-registry.test.ts`. */
export const SPEC_COHERENCE_SCENARIOS: ReadonlySet<string> = new Set([
  'artifact-schema-compile-bounded.test.ts',
  'artifact-type-legacy-ids.test.ts',
  'capability-example-root-layout.test.ts',
  'certification-floor-enforcement.test.ts',
  'chain-subchain-unsupported-refused.test.ts',
  'compensation-profile.test.ts',
  'core-manifest-and-extension-registry.test.ts',
  'discovery-canonical-family-no-shadow.test.ts',
  'edge-condition-truthy-falsy.test.ts',
  'effect-identity-composition.test.ts',
  'effect-identity-cross-scope.test.ts',
  'error-envelope-canonical-shape.test.ts',
  'form-content-packs.test.ts',
  'multi-region-effect-vocabulary.test.ts',
  'normative-example-extraction.test.ts',
  'openapi-asyncapi-sdk-parity.test.ts',
  'pack-manifest-extensions.test.ts',
  'protocol-version-grammar.test.ts',
  'registry-declarative-kinds.test.ts',
  'rfc-0147-self-audit.test.ts',
  'rfc-lifecycle-coherence.test.ts',
  'semantic-digest-v2.test.ts',
  'spec-corpus-validity.test.ts',
  'spec-section-citations.test.ts',
  'tool-result-trust-monotone.test.ts',
  'versioned-composition-profiles.test.ts',
  'workflow-chain-internal-flag.test.ts',
  'workload-identity-profile.test.ts',
]);

/** The reason recorded on such a row, written for the host operator reading it. */
export const SPEC_COHERENCE_DETAIL =
  'inapplicable to any host: this scenario reads spec/v1/ to check the SPEC corpus is internally coherent and asserts nothing about a host. '
  + 'The published tarball does not bundle spec/v1/ (see lib/paths.ts), so it does not run here. '
  + 'Set OPENWOP_CONFORMANCE_ROOT to a spec checkout to run it; it needs no host.';
