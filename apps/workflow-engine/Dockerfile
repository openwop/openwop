# Cloud Run-shape image for the workflow-engine reference application.
#
# Multi-stage Node 22-slim + esbuild bundle. The runtime image carries
# the bundled JS + the externals npm marks (better-sqlite3 native
# binding, etc.) + the parent-dir `providers.json` AI-provider catalog
# + the in-tree conformance fixtures (vendored into
# `apps/workflow-engine/conformance-fixtures/` from the canonical
# `conformance/fixtures/` via `scripts/sync-fixtures.sh`, so the
# deployed sample BE can stand in as a black-box conformance target
# per RFC 0024 etc.).
#
# Build context: `apps/workflow-engine/` (the parent of `backend/`) so
# both the backend source AND the shared `providers.json` are reachable.
# Conformance fixtures are vendored as real files (symlinks would
# survive `gcloud run deploy --source`'s upload but break Docker COPY's
# build-context isolation). Run `scripts/sync-fixtures.sh` after any
# canonical fixture change.
#
# Deploy (from repo root):
#   gcloud run deploy openwop-app-backend \
#     --source apps/workflow-engine/ \
#     --region us-central1 --allow-unauthenticated
#
# Run locally (without docker build):
#   cd apps/workflow-engine/backend/typescript && npm run dev

# ── Builder stage ────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# better-sqlite3 needs build tools at install time. Removed from the
# runtime stage below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

# Build context is `apps/workflow-engine/`; pull only the backend
# subtree for `npm install` + esbuild.
COPY backend/typescript/package.json backend/typescript/package-lock.json* ./
RUN npm install --include=dev

COPY backend/typescript/tsconfig.json backend/typescript/vitest.config.ts ./
COPY backend/typescript/src ./src

RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Re-install production deps only. better-sqlite3 ships a prebuilt binary
# for node22 on linux-x64; the postinstall picks it up without rebuild.
COPY backend/typescript/package.json backend/typescript/package-lock.json* ./
RUN npm install --omit=dev

# Bundle (./lib/index.js) + shared provider catalog. catalog.ts resolves
# `../providers.json` relative to `lib/`, so providers.json must land at
# `/app/providers.json` (sibling of lib/, parent of lib/index.js).
COPY --from=builder /app/lib ./lib
COPY providers.json ./providers.json

# Conformance fixtures, vendored at `apps/workflow-engine/conformance-fixtures/`
# (kept in sync from the canonical `conformance/fixtures/` via
# `scripts/sync-fixtures.sh`; corpus gate enforces non-drift). Used by
# `capabilities.fixtures` advertisement + black-box conformance runs,
# AND by `host/promptStore.ts` + `host/promptCompose.ts` which call
# `locateRepoDir(__dirname, 'conformance-fixtures', ...)` at module load
# and crash hard if the dir isn't reachable from `/app/lib`.
#
# Two landing spots so both consumers resolve:
#   1. `/app/conformance/fixtures/` — what `findConformanceFixturesDir()`
#      in `host/index.ts` probes (legacy path; lazy, returns null when
#      absent, so it's tolerant but kept for backward-compat).
#   2. `/app/conformance-fixtures/` — what `_repoPath.ts::locateRepoDir`
#      probes (eager, throws at module-load if absent — so it MUST be
#      present in the image). Sibling-of-`lib/` matches the source-tree
#      layout where these modules' `..` walks land.
#
# Gated by the `INCLUDE_CONFORMANCE_FIXTURES` build arg (default `true`
# for the openwop reference deploy). Production forks of this codebase
# that don't need the conformance surface bundled set this to `false`:
#   docker build --build-arg INCLUDE_CONFORMANCE_FIXTURES=false ...
# When `false`, the runtime image ships without the ~50KB fixtures
# directory; the host's `findConformanceFixturesDir()` returns null and
# `capabilities.fixtures` advertises an empty array.
ARG INCLUDE_CONFORMANCE_FIXTURES=true

# Docker COPY can't be conditional on a build arg directly. The
# `conformance-fixtures` dir is always present in the build context;
# we conditionally REMOVE it post-COPY when the arg disables inclusion.
COPY conformance-fixtures ./conformance/fixtures
COPY conformance-fixtures ./conformance-fixtures
RUN if [ "$INCLUDE_CONFORMANCE_FIXTURES" != "true" ]; then \
      rm -rf ./conformance/fixtures ./conformance-fixtures; \
    fi

# JSON Schemas, vendored at `apps/workflow-engine/schemas/` (kept in
# sync from the canonical repo-root `schemas/` via
# `scripts/sync-schemas.sh`). The bundled `lib/index.js` walks parents
# from `/app/lib` via `host/_repoPath.ts::locateRepoSchemasDir()`
# looking for a sibling `schemas/` containing sentinels like
# `ai-envelope.schema.json` and `prompt-pack-manifest.schema.json`.
# Landing them at `/app/schemas/` makes the walk resolve on the first
# parent step. Without this, the module-load-time `SCHEMAS_DIR =
# locateRepoSchemasDir(__dirname, ...)` constants in
# `envelopeAcceptor.ts` and `promptPackLoader.ts` throw and the
# revision fails to start.
COPY schemas ./schemas

# Local-mount pack source. `bootstrap/mountLocalPacks.ts` symlinks
# `core.openwop.*` and `vendor.*` packs into the runtime pack dir at
# boot, and `bootstrap/agentPackResolver.ts::loadAllLocalAgents()`
# eager-loads every manifest agent into the AgentRegistry so the
# `/v1/agents` inventory + the Agents-tab Install-from-registry page
# reflect the local repo's packs. Without this COPY,
# `resolveLocalPacksDir()` walks up from `/app/lib`, finds no `packs/`
# dir, and the production revision shows zero agents even though local
# dev sees ~30.
#
# Vendored from repo-root `packs/` via `scripts/sync-packs.sh` (the
# canonical source is outside this build context). Run sync-packs.sh
# before `gcloud run deploy` when pack manifests change. Same pattern
# as `schemas/` + `conformance-fixtures/` above.
COPY packs ./packs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "lib/index.js"]
