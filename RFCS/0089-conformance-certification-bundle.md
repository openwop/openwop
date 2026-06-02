# RFC 0089: Conformance certification bundle — machine-readable per-profile evidence

| Field | Value |
|---|---|
| **RFC** | 0089 |
| **Title** | Conformance certification bundle — machine-readable per-profile evidence |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-02 |
| **Updated** | 2026-06-02 (Draft → Active same-day: the lead maintainer waived the 7-day comment window under the bootstrap-phase one-approval rule — cf. RFC 0012's bootstrap-phase waiver — moving this RFC to merge-candidate. The design + the `additive` classification are firm; implementation (schema + `--certify` generator + spec doc + conformance assertions + a reference-host bundle) is pending toward `Accepted`. Gap **G1** — machine-readable per-profile floor-scenario sets, which the §B binding rule needs — is the gating design item to settle during implementation; the other gaps/risks have named resolution paths in the companion registers.) |
| **Affects** | NEW `spec/v1/conformance-certification.md` · NEW `schemas/conformance-certification-bundle.schema.json` · `schemas/capabilities.schema.json` (optional `conformance.certificationBundleUrl`) · `spec/v1/capabilities.md` · `conformance/` CLI (`--certify`) + a reporter lib · `conformance/src/scenarios/spec-corpus-validity.test.ts` · `examples/hosts/*` (generated bundles) · `INTEROP-MATRIX.md` · `CHANGELOG.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop derives a host's **profile claims** from its `/.well-known/openwop` discovery document, but the **evidence** that a host actually passes a claimed profile lives as hand-authored prose in `examples/hosts/*/conformance.md` and `INTEROP-MATRIX.md` — not bound to the run that produced it. This RFC defines a **machine-readable conformance certification bundle**: a single JSON artifact, emitted by the conformance harness, that binds a set of claimed profiles to the exact `{ suite version, per-scenario pass list, host identity + commit, captured discovery document }` that substantiates them, with a falsifiable **binding rule** (claimed profiles MUST be derivable from the captured discovery document, and every floor scenario of each claimed profile MUST appear in the pass list). It adds no runtime wire message; the bundle is an out-of-band attestation, with one optional discovery field pointing at a host's published bundle.

## Motivation

An external standards-readiness audit (2026-06) accepted the narrow Core Standard Profile as a serious candidate-standard but flagged: *"a standard should bind each claimed profile to a concrete suite version, pass list, host commit, and discovery document."* Today it does not. The gap is concrete:

- **Claim ≠ evidence, and the gap is unbridged mechanically.** `spec/v1/compliance.md` already states "claim ≠ conformance evidence; the matrix records what each host has actually demonstrated," and `INTEROP-MATRIX.md` + `examples/hosts/*/conformance.md` carry the four data points the audit names — **but in prose, hand-maintained, and not tied to a reproducible run.** A reader cannot mechanically verify that "host X claims `openwop-core-standard`" is backed by a specific suite run.
- **The harness emits nothing machine-readable.** `conformance/src/cli.ts` exposes only `--base-url` / `--api-key` / `--filter`; it produces human console output, no structured result. There is no artifact to attach to a profile claim.
- **The Core Standard Profile annex (`spec/v1/core-standard-profile.md`, RFC 0088) records this as an open gap** ("a claimed profile is not yet bound to a reproducible `{suite version, pass list, host commit, discovery document}` bundle").

The spec is the right place because a certification *format* is an interop contract: third parties (auditors, adopters, a future registry) must read the same bundle shape from any host. An implementation-private results file would not be portable.

## Proposal

### §A — The bundle (new schema, normative)

`schemas/conformance-certification-bundle.schema.json` (JSON Schema 2020-12, `additionalProperties: false`). Required fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/conformance-certification-bundle.schema.json",
  "title": "OpenWOP Conformance Certification Bundle",
  "type": "object",
  "additionalProperties": false,
  "required": ["bundleVersion", "generatedAt", "generator", "suite", "host", "discovery", "claimedProfiles", "results"],
  "properties": {
    "bundleVersion": { "const": "1" },
    "generatedAt": { "type": "string", "format": "date-time" },
    "generator": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "version"],
      "properties": { "name": { "type": "string" }, "version": { "type": "string" } }
    },
    "suite": {
      "type": "object", "additionalProperties": false,
      "required": ["package", "version"],
      "properties": { "package": { "const": "@openwop/openwop-conformance" }, "version": { "type": "string" } }
    },
    "host": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "version"],
      "properties": {
        "name": { "type": "string" }, "version": { "type": "string" },
        "vendor": { "type": "string" },
        "commit": { "type": "string", "description": "VCS commit/build id of the host under test, when known." }
      }
    },
    "discovery": {
      "type": "object", "additionalProperties": false,
      "required": ["url", "sha256", "document"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "document": { "type": "object", "description": "The verbatim /.well-known/openwop document captured for this run." }
      }
    },
    "claimedProfiles": { "type": "array", "items": { "type": "string" }, "minItems": 0 },
    "results": {
      "type": "object", "additionalProperties": false,
      "required": ["totals", "passed", "failed", "skipped"],
      "properties": {
        "totals": {
          "type": "object", "additionalProperties": false,
          "required": ["passed", "failed", "skipped", "total"],
          "properties": {
            "passed": { "type": "integer", "minimum": 0 }, "failed": { "type": "integer", "minimum": 0 },
            "skipped": { "type": "integer", "minimum": 0 }, "total": { "type": "integer", "minimum": 0 }
          }
        },
        "passed": { "type": "array", "items": { "type": "string" } },
        "failed": { "type": "array", "items": { "type": "string" } },
        "skipped": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

Scenario identifiers in `results.*` are the conformance suite's stable scenario IDs (file + assertion path), so the bundle is diffable across runs.

### §B — The binding rule (normative)

A certification bundle is **valid for a profile `P`** iff **both** hold:

1. **Discovery-derivable.** `P` ∈ the profiles derivable from `discovery.document` via the canonical profile predicates (`profiles.md` `deriveProfiles`, `core-standard-profile.md` `isCoreStandard`, `agent-platform-profile.md` `isAgentPlatform`). A bundle MUST NOT list a profile in `claimedProfiles` that its own captured discovery document does not derive.
2. **Floor-proven.** Every floor/required scenario for `P` (per that profile's definition) appears in `results.passed` — never in `failed` or `skipped`.

A consumer that trusts a bundle MUST re-check both conditions against the embedded `discovery.document` rather than trusting `claimedProfiles` verbatim. `discovery.sha256` is the SHA-256 of the canonical-JSON serialization of `discovery.document`, letting a verifier confirm the captured document matches one fetched live.

### §C — The generator (normative behavior of the reference harness)

The conformance CLI gains `--certify <out.json>`. When set, the harness MUST: (a) fetch `/.well-known/openwop` and capture it verbatim + its SHA-256; (b) derive `claimedProfiles` from it; (c) run the suite, recording every scenario's terminal state into `results`; (d) write a bundle that validates against §A. The harness MUST NOT fabricate a `passed` entry for a scenario that did not run non-vacuously (it is `skipped`, not `passed`).

### §D — Optional discovery pointer (additive wire field)

`schemas/capabilities.schema.json` gains an **optional** `conformance.certificationBundleUrl` (a `format: uri` string) so a client MAY discover where a host publishes its latest bundle. Omitting it is fully conformant; existing hosts that don't emit it are unaffected.

```diff
   "conformance": {
     "type": "object",
+    "properties": {
+      "certificationBundleUrl": {
+        "type": "string", "format": "uri",
+        "description": "OPTIONAL. URL of the host's most recent RFC 0089 conformance certification bundle."
+      }
+    },
     "additionalProperties": true
   }
```

### Examples

**Positive (valid bundle, abbreviated):** a Postgres host claiming `openwop-core-standard` whose `discovery.document` derives that profile and whose `results.passed` includes every §C floor scenario from `core-standard-profile.md` → valid.

**Negative (rejected):** a bundle listing `claimedProfiles: ["openwop-production"]` whose `discovery.document` does **not** satisfy the production predicate → fails §B(1); a verifier MUST reject the production claim. Likewise a bundle with `openwop-core-standard` in `claimedProfiles` but `eventOrdering.test.ts` in `results.failed` → fails §B(2).

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.

- **New artifact + schema:** a net-new file format; consumes no existing wire shape.
- **One optional discovery field** (`conformance.certificationBundleUrl`): optional, no default emitted; existing clients ignore it; existing servers don't emit it.
- **No existing field, event, endpoint, MUST, or error code changes.** No OpenAPI/AsyncAPI runtime-endpoint addition (the bundle is out-of-band; it is not fetched over a normative `/v1/*` route).
- Existing conformance passes are unaffected; the new server-free schema-validity assertion is purely additive.

## Conformance

- **Existing coverage:** none — there is no certification-bundle surface today. Adjacent: `spec-corpus-validity.test.ts` (schema-compile + corpus-consistency checks), the profile-derivation helpers in `conformance/src/lib/profiles.ts`.
- **New scenarios (server-free, in `spec-corpus-validity.test.ts` — no new scenario file, no count churn):** (1) `conformance-certification-bundle.schema.json` compiles under Ajv2020 with the canonical `$id`; (2) a committed sample bundle validates; (3) the binding rule holds on the sample (claimed profiles are derivable from its `discovery.document`, and each profile's floor scenarios are in `results.passed`); (4) a negative sample (profile not derivable) is correctly rejected by a reference `verifyBundle()` helper.
- **Capability gating:** the optional `conformance.certificationBundleUrl` field, if exercised by a future live scenario, gates on its presence; the schema-validity assertions are always-on.
- **Reference-host coverage:** at `Accepted`, at least one reference host (Postgres and/or SQLite) commits a real generated bundle next to its `conformance-full.md`, linked from `INTEROP-MATRIX.md`.

## Alternatives considered

1. **Do nothing — keep prose evidence in `conformance.md` + `INTEROP-MATRIX.md`.** Rejected: the audit's specific finding is that claims aren't *mechanically* bound to a reproducible run; prose can drift from reality and can't be machine-verified. Doing nothing leaves the standard's strongest credibility lever unrealized.
2. **A signed attestation (SLSA / in-toto provenance) instead of a bespoke bundle.** Heavier and orthogonal: SLSA attests *build* provenance, not *protocol-conformance* semantics, and would still need the openwop-specific profile-binding rule. A future RFC MAY wrap this bundle in an in-toto/Sigstore envelope for tamper-evidence; this RFC defines the payload first (Unresolved Q3).
3. **A runtime `GET /v1/conformance/certification` endpoint.** Rejected for v1.x: conformance is a point-in-time measurement, not live host state; a runtime endpoint invites hosts to self-report unverified claims. An out-of-band, harness-generated artifact + the optional discovery *pointer* keeps generation in the (trusted) suite, not the host-under-test.

## Unresolved questions

1. **Scenario-ID stability.** Are the conformance suite's scenario identifiers stable enough across minor suite versions to diff `results.passed` lists meaningfully, or does the bundle need a normalized scenario taxonomy first?
2. **Profile floor-set source of truth.** §B(2) needs each profile to expose its *required floor scenarios* mechanically. `core-standard-profile.md` §C lists them in prose; should the floor sets move into a machine-readable manifest the verifier reads, and is that in-scope here or a prerequisite RFC?
3. **Tamper-evidence / signing.** Should v1 bundles be signed (Ed25519, reusing the registry trust-anchor recipe from `node-packs.md`), or is an unsigned-but-reproducible bundle sufficient for the audit's ask? (Reproducibility — re-run the named suite vs the same host commit — is the integrity story without signatures.)
4. **Host commit provenance.** `host.commit` is optional and self-reported; for a steward-run reference host it's trustworthy, but for a third-party self-published bundle it's unverifiable without §B-style re-execution. Does the spec need to say bundles are only authoritative when generated by an independent verifier?
5. **Publication location.** Where do reference-host bundles live — next to `conformance.md`, under `site/`/`public/`, or in the registry? (Affects the optional `certificationBundleUrl`.)

## Implementation notes (non-normative)

- The generator reads vitest's stable JSON reporter output (not internal APIs) to build `results`; the harness already boots hosts and runs the suite (`apps/.../conformance/run.ts`, `examples/hosts/*`), so `--certify` is an output-shaping addition, not new test infrastructure.
- A reference `verifyBundle(bundle)` helper in `conformance/src/lib/` implements §B and backs both the conformance assertions and any third-party verifier.
- Sequencing: this RFC is the *format*. Q2 (machine-readable floor sets) may warrant landing first or alongside; flag as a possible prerequisite during the comment window.
- No cross-cut (`CC-N`) to the impl plan: additive, no breaking impl assumption.

## Acceptance criteria

- [ ] Spec text merged (`spec/v1/conformance-certification.md`).
- [ ] `conformance-certification-bundle.schema.json` + optional `conformance.certificationBundleUrl` in `capabilities.schema.json` merged.
- [ ] At least one conformance assertion covering the schema + binding rule (server-free).
- [ ] CHANGELOG entry under the appropriate version.
- [ ] At least one reference host generates + commits a real bundle and links it from `INTEROP-MATRIX.md`, OR the RFC explicitly defers reference-host generation to a follow-up.

## References

- External standards-readiness audit (2026-06) — the conditional-acceptance finding binding profile claims to reproducible evidence.
- `spec/v1/core-standard-profile.md` (RFC 0088) §"Open spec gaps" — the per-profile certification-bundle open gap.
- `spec/v1/profiles.md`, `spec/v1/agent-platform-profile.md` — profile-derivation predicates the binding rule reuses.
- `spec/v1/compliance.md` — "claim ≠ conformance evidence" framing.
- `INTEROP-MATRIX.md`, `examples/hosts/*/conformance.md` — today's prose evidence the bundle formalizes.
- Prior art: SLSA / in-toto provenance attestations; npm/PyPI provenance; W3C Verifiable Credentials (claim-vs-evidence binding model).
