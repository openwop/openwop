# Install the white-label demo app

Self-host your own branded copy of the OpenWOP reference app — the same workflow-engine deployment that runs at [app.openwop.dev](https://app.openwop.dev/), re-skinnable to your product without forking core logic. This page walks the full install: download, back-end, front-end, seeding, CLI, and re-brand.

The app is **two independent deploys** — a back-end (HTTP API, runs + events + host extensions) and a front-end (the React SPA). They are set up separately and the order matters at deploy time.

## Download

Grab the source bundle — the `apps/workflow-engine` subtree (back-end + front-end + `WHITE-LABEL.md` + `DEPLOY.md` + provider catalog), tracked files only (no `node_modules`, build output, or secrets):

### [Download openwop-demo-app.zip →](/downloads/openwop-demo-app.zip)

Verify integrity against the published checksum:

```bash
# macOS
shasum -a 256 openwop-demo-app.zip
# Linux
sha256sum openwop-demo-app.zip
# Compare against:
curl -s https://openwop.dev/downloads/openwop-demo-app.zip.sha256
```

The bundle is regenerated on every site deploy from the current `main`. Prefer git? `git clone https://github.com/openwop/openwop.git` and work in `apps/workflow-engine/`.

## Prerequisites

- **Node.js 20+** and npm.
- A model-provider key for live AI runs (optional — the demo seeds deterministic mock-AI workflows that run with no key).
- For the reference cloud deploy: a Google Cloud project (Cloud Run) and a Firebase Hosting project. Self-hosting on any Node host or container works too — the back-end is a plain Express app and the front-end is static files.

## 1. Back-end

```bash
unzip openwop-demo-app.zip && cd openwop-demo-app/backend/typescript
npm install
npm run build
# SQLite-backed local run (no external services):
OPENWOP_STORAGE_DSN="sqlite://./data/workflow-engine.db" npm start
```

The API comes up on `:8080`. Confirm it's live and advertising capabilities:

```bash
curl http://127.0.0.1:8080/readiness
curl http://127.0.0.1:8080/.well-known/openwop
```

Configure it with environment variables (all optional — sensible defaults apply):

- `OPENWOP_STORAGE_DSN` — `sqlite://…` (default) or a Postgres DSN for multi-instance durability.
- `OPENWOP_SERVICE_NAME` — your service name (surfaces in the OpenAPI discovery doc).
- `OPENWOP_SERVICE_DESCRIPTION` — your one-line service description.
- `OPENWOP_MANAGED_SYSTEM_PROMPT` — grounding prompt for the managed "try it free" chat tier (the code default is brand-neutral; set this to your own).

The cloud reference recipe (Cloud Run, secrets, Cloud SQL) is in the bundled `DEPLOY.md`.

## 2. Front-end

```bash
cd openwop-demo-app/frontend/react
npm install
VITE_OPENWOP_BASE_URL=/api npm run build
```

`VITE_OPENWOP_BASE_URL` points the SPA at your back-end (`/api` when proxied on the same origin, or an absolute `https://…` URL). The production build aborts if it's unset, so a broken bundle can never ship. The build output in `dist/` is static — serve it from Firebase Hosting, any CDN, or `npm run preview` locally.

> **Deploy order:** back-end first, then front-end. A new SPA calls new back-end endpoints; if the front-end lands first those calls 404 until the back-end catches up.

## 3. Seeding

On first use the app seeds a demo roster — five named agents (Sally, Marcus, Priya, Devon, Nora), each with a board, sample cards, schedules, and an org-chart position — so a first-time visitor sees the product without building anything. Seeding is idempotent and never clobbers a tenant's own edits.

- **Re-brand the demo content:** edit `backend/typescript/src/host/seed-data/demoAgents.json` (personas, roles, system prompts, cards). The shape is type-checked at build time.
- **Ship a clean tenant (no demo content):** set `OPENWOP_DEMO_SEED_ENABLED=false`.

See `backend/typescript/src/host/seed-data/SEEDING.md` in the bundle for the full strategy.

## 4. CLI

`@openwop/cli` is the control-plane CLI for any OpenWOP-compatible host — auth, capability discovery, run submission with SSE streaming, agent dispatch, and HITL interrupt resume. Point it at your self-hosted instance:

```bash
npm install -g @openwop/cli
export OPENWOP_BASE_URL=https://your-host.example/api
openwop doctor          # verify host + profile + auth
openwop runs create     # submit a run, stream its events
```

Full command catalog: the bundled CLI quickstart, or `@openwop/cli` on npm.

## 5. Re-brand (white-label)

Brand identity is isolated into three additive seams — no core-logic fork required. The default build renders the stock OpenWOP identity; everything below is opt-in.

- **Strings + assets** — set `VITE_BRAND_*` env vars at front-end build time: `VITE_BRAND_PRODUCT_NAME`, `VITE_BRAND_MARK_PRE` / `_EMPHASIS` / `_SUB`, `VITE_BRAND_LOGO_SRC`, `VITE_BRAND_DOCUMENT_TITLE`, `VITE_BRAND_PRIMARY_DOMAIN`, and more. No code edit needed.
- **Colors + typography** — override design tokens in `frontend/react/src/brand/brand.css` (it loads after the base stylesheet and wins the cascade). In most cases setting `--clay` (accent) and `--paper`/`--ink` is enough.
- **Back-end strings** — `OPENWOP_SERVICE_NAME`, `OPENWOP_SERVICE_DESCRIPTION`, `OPENWOP_MANAGED_SYSTEM_PROMPT` (above).

The full catalog — every `VITE_BRAND_*` var, a worked example, and the can/can't-change matrix — is in `frontend/react/WHITE-LABEL.md` in the bundle. Vendor sign-in marks (Google, GitHub) are never re-colored.

## 6. Verify

```bash
# Back-end healthy + advertising honestly
curl https://your-host.example/api/readiness          # → 200
curl https://your-host.example/api/.well-known/openwop  # → your capability set

# Front-end serves your brand
curl -s https://your-host.example/ | grep -i "<title>"  # → your product name
```

Then open the app: the header wordmark, logo, document title, and footer should all show your brand, and the demo roster (or a clean tenant) should load.

## Next steps

- [Run the quickstart](/quickstart/) — your first workflow against any host.
- [Host implementers](/for/host-implementers/) — the capability + conformance contract your deployment now implements.
- [Try the live reference](https://app.openwop.dev/) — the unbranded demo this bundle is built from.
