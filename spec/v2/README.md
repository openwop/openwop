# `spec/v2/` — the OpenWOP v2 tree (in construction; Phase 3 of the v2 charter)

> **Status: in construction.** Nothing under `spec/v2/`, `schemas/v2/` or `api/v2/` is served, published, or vendored by a 1.x consumer until the `v2.0.0-rc.1` corpus tag (RFC 0172 §D.1). The 1.x conformance tarball excludes this tree (`conformance/scripts/pack-vendor.sh`); `openwop-check.sh` stage 10 gates it.

Layout (RFC 0167 §C; RFC 0174 §E.2 budget):

| Path | Owner | What |
| --- | --- | --- |
| `declaration.json` (+ `declaration.schema.json`) | RFC 0169 §B | The one declaration file: every root key of the v2 discovery document with its anchor (`core` \| `ext` \| `deleted`), witness class, maturity, facets, peer-dependency identifier (≡ key), floor scenarios and requirement ids, and the profile predicates. Hand-reviewed source; everything else is generated from it (`scripts/generate-from-declaration.mjs`) and checked against it (`scripts/check-declaration.mjs`). |
| `profiles.json`, `peer-dependency-aliases.json` | RFC 0169 §C, RFC 0177 §B.2 | Generated. |
| `errors.json` (→ generated `schemas/v2/error-envelope.schema.json`), `event-codemap.json` (all rows decided), `path-manifest.json` (operations + channels), `release.json` (the one release identity `info.version` reads), `facets/<key>.schema.json` (hand-decided facet shapes the capabilities generator reads) | RFC 0171, 0176, 0172, 0169 | Landed P3-B/P3-C. `migrations.json` / `deprecations.json` stay at `spec/v1/` until the RC promotes them with `applied` marks (RFC 0167). |
| `core/*.md` | one per child | Normative prose, ≤ 25,000 words total (`scripts/check-core-budget.mjs`, `wc -w` on raw markdown, generated `core/headers.md` included). `capabilities.md` carries one `### § <key>` heading per core family (`check-declaration.mjs`). Lands in P3-D. |
| `ext/<key>/` | RFC 0169 §B.3, RFC 0175 §A.1, RFC 0173 §D | Extension documents with a declared `witness:` / `technical:` / `adoption:` header: the 13 ext-anchored families, plus `grpc-transport/` (demoted; non-normative proto), `portability/` (goals/export/import), `sandbox-runtime-notes/` (RFC 0035 history), `provider-idempotency/` (the Layer-2 provider registry). |

Machine artifacts here are published in `@openwop/spec-artifacts` (RFC 0168 §D.2), never inside the suite tarball.
