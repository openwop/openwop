# Cloud Run-shape image for the workflow-engine reference application.
#
# Multi-stage Node 22-slim + esbuild bundle. The runtime image carries
# the bundled JS + the externals npm marks (better-sqlite3 native
# binding, etc.) + the parent-dir `providers.json` AI-provider catalog.
#
# Build context: `apps/workflow-engine/` (the parent of `backend/`) so
# both the backend source AND the shared `providers.json` are reachable.
#
# Deploy (from repo root):
#   gcloud run deploy openwop-app-backend \
#     --source apps/workflow-engine/ \
#     --region us-central1 --allow-unauthenticated \
#     --set-env-vars NODE_ENV=production,OPENWOP_AUTH_DISABLE_COOKIES=false,...
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

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "lib/index.js"]
