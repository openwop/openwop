# `spec/v2/` — the OpenWOP v2 tree (in construction; Phase 3 of the v2 charter)

> **Status: in construction.** Nothing under `spec/v2/`, `schemas/v2/` or `api/v2/` is served, published, or vendored by a 1.x consumer until the `v2.0.0-rc.1` corpus tag (RFC 0172 §D.1). The 1.x conformance tarball excludes this tree (`conformance/scripts/pack-vendor.sh`); `openwop-check.sh` stage 10 gates it.

Layout (RFC 0167 §C; RFC 0174 §E.2 budget):

| Path | Owner | What |
| --- | --- | --- |
| `declaration.json` (+ `declaration.schema.json`) | RFC 0169 §B | The one declaration file: every root key of the v2 discovery document with its anchor (`core` \| `ext` \| `deleted`), witness class, maturity, facets, peer-dependency identifier (≡ key), floor scenarios and requirement ids, and the profile predicates. Hand-reviewed source; everything else is generated from it (`scripts/generate-from-declaration.mjs`) and checked against it (`scripts/check-declaration.mjs`). |
| `profiles.json`, `peer-dependency-aliases.json` | RFC 0169 §C, RFC 0177 §B.2 | Generated. |
| `errors.json`, `event-codemap.json`, `path-manifest.json`, `migrations.json`, `deprecations.json` | RFC 0171, 0176, 0172, 0167, 0178 | Land in P3-B/C. |
| `core/*.md` | one per child | Normative prose, ≤ 25,000 words total (`scripts/check-core-budget.mjs`, `wc -w` on raw markdown). Lands in P3-D. |
| `ext/<key>/` | RFC 0169 §B.3, RFC 0175 §A.1 | Extension documents with a declared `witness` and both maturity axes in the header. |

Machine artifacts here are published in `@openwop/spec-artifacts` (RFC 0168 §D.2), never inside the suite tarball.
