# White-labeling the demo app

This reference app (the React SPA behind `app.openwop.dev`) is designed to
be re-skinned and re-deployed under your own brand **without forking core
logic**. Brand identity is isolated into three small seams:

| Seam | What it controls | How you change it |
|---|---|---|
| `VITE_BRAND_*` env vars | Brand **strings + asset paths**: product name, wordmark, footer, assistant persona, logo, favicon, document title, fonts, privacy domain/URLs | Set env vars at build time (no code edit) |
| `src/brand/brand.css` | Brand **colors + typography** (CSS custom properties) | Uncomment + set tokens in one file |
| Asset files in `public/` | The logo image, and any custom favicon/font files you reference | Drop in replacements |

The stock build with no overrides renders the standard OpenWOP identity,
byte-for-byte. Everything below is opt-in.

> **Why not just edit `global.css`?** The editorial palette in
> `src/styles/global.css :root` is under a lockstep sync rule with the
> marketing site's `public/styles.css` (see `DESIGN.app.md §2`), enforced
> in review. Re-brand in `src/brand/brand.css` instead — it loads *after*
> `global.css` and wins the cascade without touching the synced block.

---

## 1. Rebrand the strings + assets (`VITE_BRAND_*`)

Set these as environment variables for the build — in
`.env.production`, a `.env.production.local` override, your CI, or on the
command line. Vite inlines `VITE_*` vars at **build time**, so you must
rebuild after changing them. Any var left unset falls back to the OpenWOP
default in `src/brand/defaults.ts`.

| Env var | Default | Controls |
|---|---|---|
| `VITE_BRAND_PRODUCT_NAME` | `OpenWOP` | Plain-text product name (prose) |
| `VITE_BRAND_MARK_PRE` | `Open` | Wordmark — text before the emphasis |
| `VITE_BRAND_MARK_EMPHASIS` | `WOP` | Wordmark — emphasized (italic) span; set empty to drop |
| `VITE_BRAND_MARK_SUB` | `workflow engine` | Wordmark — muted sub-label |
| `VITE_BRAND_TAGLINE` | `workflow engine` | Short descriptor |
| `VITE_BRAND_FOOTER_TEXT` | `Sample / template code. Not production-hardened.` | Footer line |
| `VITE_BRAND_ASSISTANT_NAME` | `OpenWOP` | Name the in-app AI assistant refers to itself by |
| `VITE_BRAND_LOGO_SRC` | `/OpenWOP.svg` | Header logo (path under `public/` or a URL) |
| `VITE_BRAND_FAVICON_SRC` | *(inline SVG)* | Favicon — a URL or `data:` URI |
| `VITE_BRAND_DOCUMENT_TITLE` | `workflow-engine — OpenWOP Reference UI` | Browser tab `<title>` |
| `VITE_BRAND_FONTS_HREF` | *(Google Fonts triple)* | Web-font stylesheet `<link href>` |
| `VITE_BRAND_PRIMARY_DOMAIN` | `app.openwop.dev` | Domain shown in the privacy disclosure |
| `VITE_BRAND_HOME_URL` | `https://openwop.dev/` | "Learn more" link (privacy footer) |
| `VITE_BRAND_REPO_URL` | `https://github.com/openwop/openwop` | Source-repo link (privacy footer) |

**Example `.env.production.local`:**

```dotenv
VITE_OPENWOP_BASE_URL=/api
VITE_BRAND_PRODUCT_NAME=Acme Flow
VITE_BRAND_MARK_PRE=Acme
VITE_BRAND_MARK_EMPHASIS=Flow
VITE_BRAND_MARK_SUB=automation
VITE_BRAND_ASSISTANT_NAME=Acme Flow
VITE_BRAND_DOCUMENT_TITLE=Acme Flow — Workflow Automation
VITE_BRAND_LOGO_SRC=/acme-logo.svg
VITE_BRAND_PRIMARY_DOMAIN=flow.acme.example
VITE_BRAND_HOME_URL=https://acme.example/
VITE_BRAND_REPO_URL=https://github.com/acme/flow
```

### Swapping the logo + favicon

1. Drop your logo into `public/` (e.g. `public/acme-logo.svg`) and set
   `VITE_BRAND_LOGO_SRC=/acme-logo.svg`.
2. For the favicon, either set `VITE_BRAND_FAVICON_SRC` to a `/`-rooted
   path of a file in `public/`, or paste a `data:` URI inline.
3. The header logo's `alt` is intentionally empty + `aria-hidden` — the
   adjacent wordmark already names the product to screen readers, so the
   image is decorative. Keep it that way to avoid double-announcing.

---

## 2. Rebrand the colors + typography (`src/brand/brand.css`)

Open `src/brand/brand.css` — it ships empty (all tokens commented). Set
only the tokens you want to change; everything else inherits the stock
palette. In most cases you only need `--clay` (the accent) and maybe
`--paper` / `--ink`: the accent's alpha variants re-tint themselves from
`--clay` via `color-mix`.

```css
:root {
  --clay:   #2563eb;        /* your brand accent — buttons, links, active nav */
  --paper:  #ffffff;        /* page background */
  --ink:    #0f172a;        /* primary text */

  --serif:  "Fraunces", Georgia, serif;       /* headings + wordmark */
  --sans:   "Inter", system-ui, sans-serif;   /* body + UI */
}
```

If you change the font families, also point `VITE_BRAND_FONTS_HREF` at a
stylesheet that actually loads them (or self-host the fonts and reference
your own CSS), or the families won't render.

**Token catalog** (see the comments in `brand.css` for the full set):
`--clay`, `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--rule`
(palette); `--serif`, `--sans`, `--mono` (type); `--color-success`,
`--color-warning`, `--color-danger`, `--color-ai` (functional status —
keep legible on your `--paper`); `--color-flag-*`, `--color-trace-*`
(registry/trace category accents).

---

## 3. What you can vs. can't (yet) change cleanly

| ✅ Clean seam | ⚠️ Needs manual review |
|---|---|
| Product name, wordmark, footer, assistant persona | The **privacy page** (`src/PrivacyPage.tsx`) — its domain/URLs are tokenized, but the cookie name, retention windows, Cloud Run specifics, and steward contact are deployment/legal content you should rewrite for your service |
| Logo, favicon, document title, fonts | The **demo banner** (`src/builder/DemoHostBanner.tsx`) — "anonymous demo / resets after 24h" copy is tied to the public-demo deployment mode; review if you run a persistent backend |
| Accent + surface palette, typography, status/trace colors | Backend-set strings (e.g. the `openwop.session` cookie name) live in the server, not this SPA |
| Privacy domain + home/repo links | `package.json` `name`/`description` — internal, not user-facing; rename if forking |

Vendor brand marks (the Google `g` and GitHub octocat in the sign-in
buttons) are **never re-colored** — they must render in their canonical
fills per `DESIGN.md §13`. Don't theme them.

---

## 4. Backend (server) white-labeling

The backend follows the same principle: **no brand string is hard-coded into a
default that a white-label host would have to override.** Seed *content* lives
in data files, and the runtime fallbacks are brand-neutral. Configure via env
(all preserve-on-update — use an incremental `gcloud run services update`, not
`--set-env-vars`, so you don't wipe other secrets/config):

| Env var | Default | Controls |
|---|---|---|
| `OPENWOP_SERVICE_NAME` | `openwop-workflow-engine-sample` | Service name in `/.well-known/openwop` + the OpenAPI `info.title` |
| `OPENWOP_SERVICE_DESCRIPTION` | `An OpenWOP-compatible workflow and agent orchestration host.` | OpenAPI `info.description` (brand-neutral by default — no marketing URL) |
| `OPENWOP_MANAGED_SYSTEM_PROMPT` | *(brand-neutral generic assistant prompt)* | Grounding prompt for the managed "try it free" chat tier. **The code fallback is generic** — set this to your own grounding (the reference deploy supplies the OpenWOP blurb here) |
| `OPENWOP_DEMO_SEED_ENABLED` | `true` | Set `false` to ship a clean tenant with NO demo personas/boards |
| `OPENWOP_SESSION_COOKIE_NAME` | `__session` | Session cookie name (already un-branded; Firebase Hosting requires `__session`) |
| `OPENWOP_VAPID_SUBJECT` | `mailto:admin@openwop.dev` | Web-push contact (RFC 8030) |

### Demo seed content

The demo personas (Sally, Marcus, …), their boards, cards, schedules, and
org-chart live in **`backend/typescript/src/host/seed-data/demoAgents.json`** —
the brand-authoring surface. Edit that JSON to ship your own demo content (it's
type-checked at build time and bundled into the image), or set
`OPENWOP_DEMO_SEED_ENABLED=false` for none. Each persona also takes an optional
**`autonomyLevel`** (`"auto"` default, or `"review"`): a `review` persona ships
in "agents propose, humans dispose" mode — its heartbeat queues a proposal to
the approval inbox rather than running it (the stock seed ships **Nora** in
`review` so the approval flow is demoable out of the box). See
[`seed-data/SEEDING.md`](../../backend/typescript/src/host/seed-data/SEEDING.md).

> **Protocol identifiers are NOT branding** and must stay: `core.openwop.*`
> capability IDs, `/.well-known/openwop`, the `x-openwop-device-token` header,
> `Capabilities-Etag`, and `anon:`/`user:` tenant prefixes are the OpenWOP wire
> protocol your host implements — not a product name. Leave them as-is.

### Note for the reference `app.openwop.dev` deploy

Because the managed system-prompt fallback is now brand-neutral, the reference
deployment should set `OPENWOP_MANAGED_SYSTEM_PROMPT` to retain its OpenWOP
grounding blurb (incremental env update, no rebuild needed).

---

## 5. Build + deploy your white-label instance

The app is **two independent deploys** — backend (Cloud Run) and frontend
(Firebase Hosting). Full recipe + prerequisites in
[`../../DEPLOY.md`](../../DEPLOY.md); the white-label-relevant steps:

1. **Backend** (unchanged by re-branding — deploy first so new SPA calls
   resolve):

   ```sh
   gcloud run deploy <your-backend> --source apps/workflow-engine \
     --region <region> --project <project> --quiet
   ```

2. **Frontend** — build with your brand env in place, then deploy:

   ```sh
   ( cd apps/workflow-engine/frontend/react && npm run build )   # reads .env.production[.local]
   firebase deploy --only hosting:<target> --project <project>
   ```

   The production build **aborts** unless `VITE_OPENWOP_BASE_URL` is set
   and non-default (guards against shipping a localhost-pointed bundle).

3. **Verify**: load the page and confirm the tab title, header wordmark,
   logo, and footer all show your brand; `curl https://<your-domain>/`
   should reference the same `assets/index-<hash>.js` your local `dist/`
   just built.

---

## File map

| File | Role |
|---|---|
| `src/brand/defaults.ts` | Default brand values + `VITE_BRAND_*` → field mapping (pure data; shared by client + Vite plugin) |
| `src/brand/brand.ts` | Client-resolved `brand` singleton (layers `import.meta.env` over defaults) |
| `src/brand/BrandMark.tsx` | The header logo + wordmark component |
| `src/brand/brand.css` | The color/type override layer (loads after `global.css`) |
| `vite.config.ts` → `openwop-brand-html` | Stamps title/favicon/fonts into `index.html` at build time |
