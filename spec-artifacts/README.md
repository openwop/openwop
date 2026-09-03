# `@openwop/spec-artifacts`

The OpenWOP machine-readable contract as a package (RFC 0168 §D.2; v2 charter Phase 3). Contents are GENERATED from the corpus by `scripts/generate-spec-artifacts.mjs` and committed: `api/` (v1 `openapi.yaml`/`asyncapi.yaml`, `v2/`, `seams-v2.yaml`), `schemas/` (v1 flat + `envelopes/`, `v2/`), `spec/v1/*.json` and `spec/v2/**/*.json` (the registries: errors, event codemap, declaration, profiles, deprecations, migrations, gaps, path manifests), and `CORPUS-STAMP.json` — per-file SHA-256 digests plus the corpus commit and tag.

`@openwop/openwop-conformance` (2.x) declares this package as an exact-pinned peer dependency and refuses to start when the installed stamp's digests differ from the ones it was built against (`dist/spec-artifacts.lock.json`). One source, no copy: the 1.138.1 drift class cannot recur.

Versioning: tracks the corpus release identity (`spec/v2/release.json`); published on the `openwop-spec-artifacts/vX.Y.Z` tag by `.github/workflows/openwop-publish.yml`; pre-releases go to the npm dist-tag `next`.
