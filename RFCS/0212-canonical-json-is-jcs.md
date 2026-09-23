# RFC 0212: canonical JSON is RFC 8785 JCS, and a certification preimage does not depend on the machine that computed it

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0212                                                            |
| **Title**         | canonical JSON is RFC 8785 JCS, and a certification preimage does not depend on the machine that computed it |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-23                                                      |
| **Updated**       | 2026-09-23 — filed and moved `Draft → Active` the same day by an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the public window for an RFC affecting **certification** and **replay**. This RFC is in both classes: it defines the bytes a certification bundle's signature and `witnessSha256` cover, and the bytes the RFC 0150 replay request digest hashes. The override is recorded in `MAINTAINERS.md` as an override row, not as a routine waiver. It is **not** folded under any earlier override. What the override does not touch: the evidence gate (RFC 0147 §A.5) — `Accepted` still requires the vectors to pass on the suite and on one host verifier, and an `executed-pass` from the coherence test over every committed bundle. **Acceptance is provisional and the RFC 0156 §B retrospective review is owed** (register row `not-reviewed`). |
| **Affects**       | `spec/v2/core/packs.md` §Signing (one table cell, one paragraph) · `spec/v2/core/conformance.md` §Bundle (one row, one paragraph) · the `scheme` description in 8 schemas (below) · `schemas/v2/certification-bundle.schema.json` (3 descriptions) · `schemas/v2/run-event-payloads.schema.json` (2 descriptions) · `spec/v1/replay.md` §"LLM cache-key recipe" (2 bullets) · new `conformance/vectors/jcs-v1.json` (+ two pairs in `semantic-request-digest-v2.json`) · new `conformance/src/lib/jcs.ts` (the suite's one canonicalizer) · new scenario `jcs-vectors.test.ts` · new coherence test `v2-bundle-witness-preimage.test.ts` · `conformance/src/lib/{certification-bundle-v3,llm-cache-key-recipe}.ts`, `conformance/src/cli.ts` · `SECURITY/threat-model-replay.md` §3.6 · `SECURITY/invariants.yaml` (+1) · `COMPATIBILITY.md` §3 (one Class-3 entry) |
| **Compatibility** | Conformance-affecting correction (W3C Process Class 3, `COMPATIBILITY.md` §3). No shape moves; no `spec/v2/corrections.json` row. Census: 5 committed v3 bundles, 156 registry `pack.json`, **0 affected** |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The corpus signs and hashes "canonical JSON" in at least seven places and never says which canonicalization. Every JavaScript implementation in the tree happens to produce RFC 8785 JCS bytes for well-formed input, so nothing has broken — but a Python or Go verifier following the prose cannot reproduce a pack signature, a bundle signature, `discovery.sha256` or `witnessSha256`, and the one ordering step the prose does gesture at is implemented with a **locale-sensitive** comparator. On a machine whose default locale is Czech, Slovak, Lithuanian or Hawaiian, the suite today computes a different `witnessSha256` for the committed MyndHyve and v2-reference bundles than it does anywhere else. This RFC names JCS, adds the I-JSON refusal set a signer MUST enforce, specifies the whole `witnessSha256` preimage including its order, fixes the same locale bug in the RFC 0150 replay digest, and ships cross-language vectors.

## Motivation

Verified read-only on 2026-09-23 against corpus `d593ad55`.

### 1. "Canonical JSON" is never defined

`spec/v2/core/packs.md:67`: "a detached 64-byte Ed25519 signature over the canonical-JSON `pack.json`". `spec/v2/core/conformance.md:71`: "an Ed25519 attestation over the canonical JSON of `{ witnessSha256, host.build, suite.version, discovery.sha256 }`". RFC 0177 §C.3 defines no algorithm and points at `build-pack-tarball.mjs --signed`. JCS is cited only in `audit-verify-result.schema.json:27`, `run-event-payloads.schema.json:2642`, `spec/v1/replay.md:259` and RFC 0150 — and `replay.md:259`'s "no JCS library" fallback is itself looser than JCS (it names no sort unit and no string escaping).

### 2. The JavaScript implementations are JCS for valid input — and coerce invalid input silently

The suite (`certification-bundle-v3.ts:82-88`), the CLI (`cli.ts:334-345`) and the registry signer (`../openwop-registry/scripts/build-pack-tarball.mjs:144-151`) all use `Object.keys(v).sort()` + `JSON.stringify`. `Array.prototype.sort()` without a comparator compares UTF-16 code units, which is exactly JCS §3.2.3; `JSON.stringify` of numbers and strings is exactly JCS §3.2.2. The vectors in this RFC confirm it: the suite's `canonicalJSON` reproduces **10 of 10** object vectors, including RFC 8785's own §3.2.2 and §3.2.3 examples.

The same functions accept, and silently change, input JCS forbids:

| Input | Suite `canonicalJSON` today | JCS / I-JSON |
| --- | --- | --- |
| `{"a":1,"a":2}` | `{"a":2}` | duplicate names — refuse |
| `{"s":"\ud800"}` | `{"s":"\ud800"}` | lone surrogate — refuse |
| `{"n":9007199254740993}` | `{"n":9007199254740992}` — **a different number** | integer beyond ±(2^53−1) — refuse |
| in-memory `NaN`, `1e400` | `null` | non-finite — refuse |
| in-memory `undefined` | `{"a":undefined}` — not JSON | refuse |

The integer row matters most: a Python verifier keeps `9007199254740993` exact, the JavaScript signer rounds it, and the two disagree on the bytes of the same document with no error on either side.

### 3. `witnessSha256` exists only in code, and its order is locale-sensitive

`conformance.md:64` says only that `witnessSha256` "covers the reporter record". The preimage — which row members, when the `{rows, relaxations}` wrapper applies, and the row order — lives in `certification-bundle-v3.ts:104-110`, which sorts with `a.id.localeCompare(b.id)` in the process default locale. openwop-app's two verifier copies use `localeCompare(…, 'en')`. The vectors' `ordering` block shows both disagree with code-unit order as soon as an id carries an uppercase letter or `_`, and the Czech collation (`ch` after `h`) reorders ids already present in committed bundles (`chain-…`). The requirement-id grammar (`certification-bundle.schema.json:262`) does not exclude uppercase, `_` or non-ASCII after its first segment.

### 4. The RFC 0150 replay digest has the same bug

`spec/v1/replay.md:254`: "Sort `tools[]` by `name` ascending" — no comparator. `conformance/src/lib/llm-cache-key-recipe.ts:47,79` uses `localeCompare`. Tool names are exactly where `_` and camelCase live (`get_weather` / `getWeather`), and `semantic-request-digest-v2.json` tests only `alpha`/`zeta`, which every comparator orders the same way. RFC 0150 §C's acceptance criterion is TypeScript/Python/Go agreement; Python's `sorted()` is code-unit order and disagrees with `'en'` on that pair.

## Proposal

### §A. Canonical JSON is RFC 8785

Wherever the corpus signs or hashes "canonical JSON", the bytes MUST be the RFC 8785 (JCS) serialization of the value, encoded as UTF-8. This covers: `ed25519-canonical-json` pack signatures; the certification-bundle attestation; `discovery.sha256`; `witnessSha256`; the RFC 0063 sub-run output checksum; the RFC 0064 hashed tool arguments; the RFC 0150 semantic request digest; and the audit-chain `prevHash` of `openwop-audit-log-integrity`.

### §B. The input MUST be I-JSON, and a canonicalizer MUST refuse rather than coerce

The value MUST be I-JSON (RFC 7493). A signer or hasher MUST refuse — fail the operation, not emit bytes — when the value contains any of:

1. an object with duplicate member names;
2. a string containing a lone surrogate (a UTF-16 code unit in `D800–DFFF` not part of a valid pair);
3. a number that is not finite (NaN, ±Infinity, or a literal that overflows to one);
4. an integer (a number literal with no fraction and no exponent) whose magnitude exceeds 2^53 − 1;
5. anything that is not a JSON value (in-memory `undefined`, functions, dates, `toJSON` objects).

A verifier that encounters one of these in a document it must re-canonicalize MUST fail verification. Checks 1 and 4 need the JSON **text**, not a parsed native value; an implementation whose parser loses that information MUST parse with one that keeps it for these inputs.

Check 4 is about a *literal*. A value that is already a double is exact and JCS serializes it, however large (RFC 8785 Appendix B includes `9007199254740994`); the refusal applies where a literal names an integer no double holds, which only the text shows. The suite's implementation applies checks 1 and 4 in `parseIJson` (the reader for a discovery document and for a bundle under `--verify`) and checks 2, 3 and 5 in `canonicalJSON`.

### §C. The `witnessSha256` preimage

`witnessSha256` is the lowercase-hex SHA-256 of the JCS bytes of:

- the **rows** — one object per `results.requirements[]` entry with exactly the members `id`, `scenario`, `result`, and, each only when present on the entry, `assertions`, `detail`, `evidence`; sorted by `id` in **UTF-16 code-unit order** (the RFC 8785 §3.2.3 comparator);
- **if and only if** `host.relaxations[]` is present and non-empty, the object `{ "rows": <rows>, "relaxations": <host.relaxations[] in the order carried> }`; otherwise the rows array itself.

A producer or verifier MUST NOT sort with a locale-sensitive comparator.

### §D. The RFC 0150 `tools[]` order

`spec/v1/replay.md` §"LLM cache-key recipe" step 1: "Sort `tools[]` by `name` in UTF-16 code-unit order (RFC 8785 §3.2.3)." The "no JCS library" fallback in step 2 is deleted: a host MUST produce JCS bytes; the vectors are the test of whether it does.

### §E. Vectors

`conformance/vectors/jcs-v1.json` is normative for §A–§D. It carries RFC 8785 Appendix B's number serializations, the §3.2.2 and §3.2.3 examples, integer-like keys, escapes, raw non-ASCII, an NFC/NFD pair that MUST hash differently, the §B refusal cases, and an ordering block. Every SDK implementing a hash or signature in this corpus MUST reproduce it.

### Examples

Positive: `{"9":"nine","10":"ten","a":0}` → `{"10":"ten","9":"nine","a":0}` (sha256 `ac5e0767681af2d226a2a4df567cee9cd3254a7819a7643f8bddbfa690792dad`).

Negative: a canonicalizer that rebuilds a JavaScript object with sorted keys and calls `JSON.stringify` emits `{"9":…,"10":…}` (integer-like keys enumerate first) and fails that vector. A signer handed `{"n":9007199254740993}` that emits bytes instead of refusing fails `integer-above-range`.

## Compatibility

Class-3 correction. The prior text defined no algorithm, so no host could conform to a different one; every committed artifact already carries JCS bytes:

- **Bundles:** all 5 committed v3 bundles (`evidence/v2-host-bundles/*.json`, `../openwop-examples/examples/hosts/v2-reference/bundle-v3.json`, the openwop-app major-2 fixture) re-derive their stored `witnessSha256` under §C's code-unit order. Every id in them is `[a-z0-9.-]`, where code-unit and `en` order coincide.
- **Packs:** all 156 `../openwop-registry/packs/*/pack.json` canonicalize identically under JCS (625 non-ASCII strings, 44 non-integer numbers, 0 integer-like keys, 0 out-of-range integers). Pack verifiers check raw signed bytes and never re-canonicalize, so no published signature changes.
- **Behavior change:** §B turns silent coercion into refusal. No committed input triggers it.

## Conformance

- New `conformance/vectors/jcs-v1.json` and `conformance/src/scenarios/jcs-vectors.test.ts` (corpus-validity class, server-free): the suite's `canonicalJSON` MUST reproduce every `objects` and `numbers` entry and refuse every `refusals` entry.
- New coherence test `conformance/src/coherence/v2-bundle-witness-preimage.test.ts`: every committed v3 bundle recomputes its `witnessSha256` under §C; the test fails if it compares fewer bundles than the directory holds.
- `semantic-request-digest-v2.json` gains a pair (`get_weather` / `getWeather`) whose expected digest is computed under code-unit order.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A JCS bytes | digest/signature of a vector input | the suite, unaided | witnessable |
| §B refusal | canonicalizer throws on each refusal vector | the suite, unaided | witnessable |
| §C preimage + order | recomputed `witnessSha256` equals stored | the suite over committed bundles | witnessable |
| §D `tools[]` order | digest of the `get_weather`/`getWeather` vector | the suite, unaided | witnessable |

Sabotage, each run on 2026-09-23 and each turning a leg red for the reason named:

- `a.id.localeCompare(b.id, 'cs')` in `witnessDigest` → the coherence census (the committed bundles DO reorder under Czech collation) and the comparator leg; the `jcs-vectors` ordering leg.
- a rebuild-object canonicalizer (`JSON.stringify` of a key-sorted rebuilt object) → `integer-like-keys`, `rfc8785-3.2.3-sort`.
- NaN → `null` coercion → the value-boundary refusal leg.
- a last-duplicate-wins parser → the `duplicate-name` refusal.
- `localeCompare` in the recipe's `tools[]` sort → `tools-code-unit-order`, `tools-code-unit-order-reversed`, and the relationship leg.

## Alternatives considered

- **Define OpenWOP's own "sorted keys, no whitespace" rule.** Rejected: it is JCS minus the parts that matter (number form, escaping, sort unit), and a second definition is a second place to disagree.
- **Bump `bundleVersion` for the order change.** Rejected: the census shows no committed bundle changes digest.
- **Accept both orders in a verifier for a transition.** Rejected for the same reason, and because a dual-order verifier is an ambiguity an attacker can choose between.

## Unresolved questions

1. The audit-entry export shape for `openwop-audit-log-integrity` is undefined (no v2 endpoint exposes entries), so no external verifier can recompute a chain yet. Deferred to an `auditLogIntegrity` RFC (RFC 0010:303 already asks for one).

## Acceptance criteria

- [ ] `jcs-vectors.test.ts` green on the suite with every sabotage above turning it red.
- [ ] Coherence test green over every committed v3 bundle (count asserted).
- [ ] One host-side verifier (openwop-app `bundle-v3-verify.mjs` or `certificationEvidence.ts`) reproduces the vectors and verifies the committed bundles under §C.
- [ ] Registry signer refuses the §B vectors.
- [ ] RFC 0156 §B retrospective review row filed `not-reviewed`.

## References

RFC 8785; RFC 7493; RFC 0148; RFC 0150 §C; RFC 0177 §C.3; RFC 0063; RFC 0064; `spec/v1/auth-profiles.md:262`.
