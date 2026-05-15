# Cloud Run-shape image for the workflow-engine reference application.
#
# Multi-stage Node 22-slim + esbuild bundle. The runtime image carries
# only the bundled JS + the externals npm marks (better-sqlite3 native
# binding, etc.).
#
# Deploy:
#   gcloud run deploy workflow-engine --source . --region us-central1
#
# Run locally (without docker build):
#   npm run dev

# ── Builder stage ────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# better-sqlite3 needs build tools at install time. Removed from the
# runtime stage below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev

COPY tsconfig.json vitest.config.ts ./
COPY src ./src

RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Re-install production deps only. better-sqlite3 ships a prebuilt binary
# for node22 on linux-x64; the postinstall picks it up without rebuild.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/lib ./lib

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "lib/index.js"]
