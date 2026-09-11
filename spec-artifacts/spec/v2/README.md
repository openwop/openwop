# `spec/v2/` — the OpenWOP v2 tree (the current protocol major)

> **Status: released.** v2 is the current protocol major — `v2.0.0` was tagged 2026-09-05 and this tree is at corpus `v2.1.1` (`release.json`). Everything under `spec/v2/`, `schemas/v2/` and `api/v2/` is normative, is vendored into `@openwop/spec-artifacts`, and is what `@openwop/openwop-conformance` 2.x measures. A new integration targets v2.
>
> **v1 is not retired.** Through the overlap a host advertises both majors and `preferredVersion` MUST remain a `1.x` member (`core/versioning.md` §1.1); v1 clients keep working unchanged on `/v1/…`. v1 end-of-support is the later of two clocks in `core/overview.md`, earliest 2026-12-04, and until then `spec/v1/` stays the maintained parallel track. A `1.x` conformance tarball still excludes this tree (`conformance/scripts/pack-vendor.sh`).
>
> The banner that stood here until 2026-09-10 said *"in construction … until the `v2.0.0-rc.1` corpus tag"*. That tag landed 2026-09-03 and the line was never updated; a reader who trusted it concluded v2 did not exist. Status lines that are hand-kept drift; this one now names the tag and the file that carry the truth.

Layout (RFC 0167 §C; RFC 0174 §E.2 budget):

| Path | Owner | What |
| --- | --- | --- |
| `declaration.json` (+ `declaration.schema.json`) | RFC 0169 §B | The one declaration file: every root key of the v2 discovery document with its anchor (`core`, `ext` or `deleted`), witness class, maturity, facets, peer-dependency identifier (≡ key), floor scenarios and requirement ids, and the profile predicates. Hand-reviewed source; everything else is generated from it (`scripts/generate-from-declaration.mjs`) and checked against it (`scripts/check-declaration.mjs`). |
| `profiles.json`, `peer-dependency-aliases.json` | RFC 0169 §C, RFC 0177 §B.2 | Generated. |
| `errors.json` (→ generated `schemas/v2/error-envelope.schema.json`), `event-codemap.json` (all rows decided), `path-manifest.json` (operations + channels), `release.json` (the one release identity `info.version` reads), `facets/<key>.schema.json` (hand-decided facet shapes the capabilities generator reads) | RFC 0171, 0176, 0172, 0169 | Landed P3-B/P3-C. `migrations.json` / `deprecations.json` stay at `spec/v1/` until the RC promotes them with `applied` marks (RFC 0167). |
| `core/*.md` | one per child | Normative prose, ≤ 25,000 words total (`scripts/check-core-budget.mjs`, `wc -w` on raw markdown, generated `core/headers.md` included). `capabilities.md` carries one `### § <key>` heading per core family (`check-declaration.mjs`). Lands in P3-D. |
| `ext/<key>/` | RFC 0169 §B.3, RFC 0175 §A.1, RFC 0173 §D | Extension documents with a declared `witness:` / `technical:` / `adoption:` header: the 13 ext-anchored families, plus `grpc-transport/` (demoted; non-normative proto), `portability/` (goals/export/import), `sandbox-runtime-notes/` (RFC 0035 history), `provider-idempotency/` (the Layer-2 provider registry). |

Machine artifacts here are published in `@openwop/spec-artifacts` (RFC 0168 §D.2), never inside the suite tarball.
