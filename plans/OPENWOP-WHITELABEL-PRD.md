# PRD — Make the OpenWOP demo app a first-class white-label foundation

**Status:** In progress · 2026-06-03 (status + review findings updated 2026-06-04 — see §12)
**Author:** Derived from building **CoLabCare** (a pediatric behavioral-health practice app) on top of the white-labeled OpenWOP workflow-engine demo app.
**Audience:** OpenWOP demo-app maintainers (`apps/workflow-engine/`).
**Goal:** Capture every place CoLabCare had to **deviate from, fork, work around, or fix** the upstream demo app, and turn those into a prioritized set of improvements so the next white-label build (the next "CoLabCare") is dramatically faster and lower-risk.

> **One-sentence thesis:** OpenWOP's demo app is an excellent *engine* and a good *single-purpose reference UI*, but it was not built to be **re-skinned into a different product**. White-labeling currently means forking the navigation, hand-wiring every page, rediscovering deploy footguns, and patching branding/seed/auth gaps the framework should own. This PRD makes "white-label a new vertical app" a supported, paved path.

---

## 1. Context & method

CoLabCare was built by extracting a snapshot of `apps/workflow-engine/` and reshaping it into a clinical practice app: ~15 new pages, ~7 new backend domain services, a re-organized sidebar, custom branding, a public no-login demo, and a Firebase/Cloud Run deploy. Along the way the team kept hitting the same class of problem: **the engine is reusable, but the *app shell* assumes it is the OpenWOP demo and nothing else.**

This document is grounded in a deep-dive comparison of the two trees:

- **App A (base):** `openwop/apps/workflow-engine/`
- **App B (fork):** `CoLabCare/app/openwop-demo-app/`

Each section below states **how A does it → what B had to do → the GAP → the proposed fix**, then §10 rolls everything into a prioritized backlog.

---

## 2. Navigation & information architecture  `[P0]`

**How A does it.** One flat nav (`chrome/navItems.ts`) with a handful of groups (Build / Operate / Admin), every route hand-wired in `App.tsx`, and **no distinction between "the product a normal user uses" and "platform/config/admin surfaces."** Orgs, keys, capabilities, demo-data, run history, etc. sit as peer routes next to the actual workspace.

**What B had to do.** This was the single biggest fork. CoLabCare invented:
- a **two-tier IA**: a primary **Workspace** rail (the clinical product) + a single **Admin** entry,
- a separate `chrome/adminNav.ts` (`ADMIN_NAV`, ~14 items) for everything platform/config,
- an `AdminLayout.tsx` with its own **embedded, collapsible** admin rail,
- a **pathless layout route** (`<Route element={<AdminLayout/>}>`) so admin pages keep their original deep-link paths while rendering inside the admin chrome,
- an `isAdminPath()` predicate driving full-bleed + active-state + which chrome to show,
- moving demoted surfaces (Organizations, capabilities, demo-data, run history, builder) *under* Admin so the primary nav stays product-focused.

**GAP.** A treats every surface as equal and user-facing. A real product needs **"site-wide product nav" vs "admin/console nav"** as a built-in concept. Every white-label build will re-derive this.

**Proposed (the user's lead lessons):**
1. **First-class nav tiers.** Ship `navConfig` with a `tier: 'workspace' | 'admin' | 'platform'` (or similar) on every entry, and **group entries by category** with group headers, collapse state, and persisted per-tier collapse. CoLabCare's `navItems.ts` + `adminNav.ts` + `AdminLayout` should become the *default* shape, not a fork.
2. **`AdminLayout` in the framework.** Ship the pathless-admin-shell + embedded collapsible rail + `isAdminPath()` as reusable chrome, so a white-label app declares which routes are admin and gets the two-tier shell for free.
3. **Category grouping as data.** Nav groups (with icons, order, and "this group is admin-only") declared as config, not hand-built JSX.

**Acceptance:** a new app can declare `workspace` vs `admin` nav entries in one config file and get the full split shell (collapsible admin rail, full-bleed admin content, preserved deep links) with zero bespoke layout code.

---

## 3. Page & feature extensibility (the paved path)  `[P0]`

**How A does it.** ~22 pages, **38 hand-wired `<Route>` entries** in one `App.tsx`, plus a manually-maintained `NARROW_ROUTES` set and per-page nav entries. Adding a page = import + `<Route>` + `navItems` edit + remember the width/chrome rules. No registry, no scaffold.

**What B had to do.** Hand-wired 11+ new clinical pages the same way, organized only by an informal `colabcare/*Page.tsx` naming convention. Every page was copy-paste-shaped (header, surface-card grid, data fetch, loading/empty states). The backend story was worse: every new domain (clinical, comms, analytics, audit, compatibility, practice-config, alerts) was a **hand-built vertical slice** — service → route file → **manual `registerXRoutes(app)` in `index.ts`** → seed-hook in the demo-seed route → frontend client → page → nav entry. `index.ts` now has ~55 sequential `register*Routes()` calls; registration is scattered and easy to forget (we shipped at least one route that 404'd until registered).

**GAP.** There is no convention or tooling for "add an app page" or "add a backend domain." Everything is procedural and copy-paste, which is slow and error-prone, and the per-step omissions (forgot to register a route, forgot a seed hook) are silent.

**Proposed:**
1. **A documented + scaffolded vertical-slice.** A `feature` generator (or at minimum a `CONTRIBUTING-FEATURES.md`) that stamps: backend service (on the existing `DurableCollection` pattern), route file, **auto-registration**, seed hook, typed frontend client, and a page wired into nav.
2. **Route/nav registry.** Replace the hand-wired `App.tsx` + `navItems.ts` pair with a single declarative feature manifest (`{ path, element, navTier, navGroup, chrome: 'default'|'narrow'|'fullbleed' }`). `App.tsx` renders from the manifest; nav renders from the manifest; width/chrome rules come from the manifest. No more `NARROW_ROUTES` drift.
3. **Centralized route registration.** A `registerAllRoutes(app, deps)` that iterates a route module list, so a new domain can't ship unregistered.

**Acceptance:** adding a new domain feature is one generator invocation + filling in logic; the page appears in nav, routes are registered, and seeding is wired, with no edits to `App.tsx`/`index.ts` by hand.

---

## 4. Backend host-extension domain pattern  `[P1]`

**How A does it.** A has the right *primitive* — `DurableCollection` on `hostExtPersistence` (a read-through kv store, no migration needed) — and a `register*Routes(app, deps)` convention. But it ships only generic surfaces (chat, canvas, kanban) and **no example of a real domain** (entities + list/get + mutations + seed + tenant scoping).

**What B did.** Re-derived the exact same shape seven times (clinicalService, commsService, analyticsService, auditService, compatibilityService, practiceConfigService, clinicalAlertsService). Each reinvented: `StoredX = X & { tenantId }`, key `${tenantId}:${id}`, idempotent seeders, fail-closed mutations, and a tenant accessor `(req).tenantId ?? 'default'`. We also independently invented two reusable patterns the framework should own:
- **Fail-closed mutation result** — a discriminated `{ ok: true, ... } | { ok: false, reason }` returned from the service, mapped to a `409 conflict` in the route, surfaced as a typed `XBlockedError` on the client (used for sign-note, submit-claim, complete-session).
- **Read-through derived projection** — analytics/alerts compute from the live stores (the `clientKey()` cross-store name-join was a sharp edge: two seed datasets used `"Marcus Garcia"` vs `"Garcia, M."`).

**GAP.** The durable-store primitive exists but there's no **domain template** showing the full, correct shape (tenant scoping, idempotent seed, fail-closed mutation, derived read). Everyone re-discovers it (and the tenant-scoping/join sharp edges) by hand.

**Proposed:** ship a **reference domain module** (`host/examples/widgetService.ts`) demonstrating: tenant-scoped `DurableCollection`, idempotent `seedDemoWidgets`, a fail-closed mutation with the discriminated-result→409→typed-error chain, and a derived read-through projection — plus a `host-extensions.md` documenting the pattern. Extract the `XBlockedError`/409 helper into the SDK.

---

## 5. White-label completeness  `[P0]`

**How A does it.** A genuinely good string/asset branding system: `brand/brand.ts` + `defaults.ts` with ~12 `VITE_BRAND_*` overrides, an `index.html`-stamping Vite plugin (title/favicon/fonts), and a `BrandMark` component.

**What B had to fix (real bugs we shipped and corrected):**
- **Favicon didn't switch.** The favicon env var (`VITE_BRAND_FAVICON_SRC`) wasn't set, so the deployed app kept the OpenWOP "O" favicon. *(The system supported it; nothing forced/validated it.)*
- **Logo lockup vs icon-only.** `logoSrc` pointed at a full 140×32 "CoLabCare" lockup squished into a 28×28 box **and** the text wordmark re-rendered the name → the brand showed twice. We had to author a separate **icon-only** mark. The framework offers one `logoSrc` slot but the sidebar composition needs an *icon*, not a lockup.
- **No PWA manifest.** A ships no `manifest.webmanifest`/theme-color/apple-touch-icon, so the app isn't installable. We added it by hand.
- **Instance identity isn't brandable.** The practice name ("Life Lab Kids"), the demo password ("JRD-Demo"), the "Practice" workspace label, and the deployed domain are **hardcoded**, not `VITE_BRAND_*`/config.
- **`.env.production` shipped with the *base's* values** (it pointed at `openwop-dev`/`app.openwop.dev`), so a naive build inherits the upstream's backend + Firebase config.

**GAP.** Branding covers *strings and one logo*; it does **not** cover favicon-by-default, an icon mark, PWA install, instance identity, or a clean per-fork `.env.production`. And there's no **enumerated checklist** of every brandable surface, so forks miss some (we missed the favicon and manifest at first).

**Proposed:**
1. **`WHITE-LABEL.md` surface checklist** — every brandable surface (product name, mark **icon** + lockup, favicon, PWA manifest + theme-color, fonts, title, domain, home/repo, instance name, gate password, default theme) with the exact env var / file for each, and a **`scripts/check-branding.sh`** that fails the build if any still resolves to the OpenWOP default.
2. **Split `logoSrc` into `markSrc` (icon) + `lockupSrc`** so the sidebar uses the icon and the marketing surfaces can use the lockup.
3. **Ship the PWA manifest as a branded, stamped artifact** (theme-color from the brand, icon = `markSrc`).
4. **Instance config block** — `VITE_BRAND_INSTANCE_NAME`, optional gate config, default theme — first-class, not hardcoded.
5. **`.env.production.example`** (brand-neutral, with TODO markers) instead of shipping the base's live values.

**Acceptance:** a fork sets its env vars + drops two SVGs, and `check-branding.sh` proves zero OpenWOP defaults leak into the build (favicon, manifest, title, names all switched).

---

## 6. Design tokens & theming  `[P1]`

**How A does it.** CSS custom properties in `global.css :root`, a `ThemeToggle` (system/light/dark), **default = `system`** (follows the OS). No `DESIGN.app.md`, no token-discipline gate.

**What B did/hit.**
- Wanted **light as the default** (a health product reads better light); had to patch the `index.html` pre-paint boot script *and* `ThemeToggle.readTheme()` so unset → light while keeping an explicit "System" option. Default theme should be **config**, not a code edit in two places.
- Heavy use of **inline `oklch()`/hex literals** for the per-agent brand palette (Ava/Nova/… colors) and modal scrims — there's no governed token doc telling a fork where colors live or how to theme them.
- A real CSS-integrity bug class exists: a dropped `}` makes esbuild lower a swallowed rule to an empty `:is()` and silently delete rules (this bit the upstream app historically). There's no build gate for it in the demo app.

**GAP.** No `DESIGN.app.md`, no token-discipline, default theme hardcoded, agent palette as scattered literals.

**Proposed:**
1. **`DESIGN.app.md`** for the demo app (tokens, the cohesion primitives `surface-card`/`chip`/`Notice`/`StateCard`, status-as-labeled-chip, focus-ring, reduced-motion) — the thing `/ux-review` already wants to cite.
2. **`VITE_BRAND_DEFAULT_THEME=light|dark|system`** read by both the boot script and the toggle.
3. **Tokenize the agent/status palette** in `:root` (`--agent-*`, `--scrim`) so a fork re-themes without touching TSX.
4. **CI gate:** assert `0` empty `:is()` in the built CSS (the swallowed-rule fingerprint) + a "no raw color literal in TSX outside `ui/icons`" lint.

---

## 7. Auth, tenancy & demo seeding  `[P0]`

**How A does it.** Optional Firebase auth; managed-provider chat gated behind a **sign-in requirement**; anon (`anon:<sid>`) sessions per cookie; **manual** demo-data seeding via a `/demo-data` re-seed button; `/v1/agents` user-agent listing treats an API-key/wildcard caller as "see everything."

**What B had to do (and the bugs it caused):**
- **Public no-login demo.** CoLabCare needed anyone to use the chat without an account. We had to remove **two** sign-in gates (the dispatch-time `isSignedInTenant` check *and* an anon×managed **preflight** in `POST /v1/runs`) and update their tests. "Public, no-login, operator-funded model" should be a **first-class supported mode**, not a gate you reverse-engineer.
- **App-wide gate.** No primitive for "lock the whole app behind a screen," so we built `DemoGate` (password + localStorage) as a top-level wrapper.
- **Seeding is per-tenant and the cookie path bites.** Hosted = cookie auth = each visitor gets a **fresh empty anon tenant**. Only `/home` auto-seeded, so deep-linking to any other page showed **blank screens**, while localhost (bearer/shared `default` tenant, pre-seeded) looked full. We had to add **auto-seed-on-entry** (seed-if-empty in `DemoGate`) and confirm the seed covers *every* surface. The framework's seed is ad-hoc and not guaranteed comprehensive.
- **Cross-tenant `/v1/agents` leak (latent).** A wildcard/API-key caller sees user-agents from *all* tenants. Harmless in a single-tenant local dev, but a real isolation issue for a multi-tenant fork.

**GAP.** Auth posture is binary (Firebase-or-anon, with a sign-in wall on the free model), there's no app-gate primitive, and seeding isn't a guaranteed-comprehensive, per-tenant-aware, auto-on-empty operation.

**Proposed:**
1. **First-class deploy posture flag** — `bearer-shared` (one demo tenant, login-free, simplest) vs `cookie-per-visitor` (isolated) vs `auth` — selectable by env, with the managed-tier sign-in gate **off by default in demo postures** (bounded by the existing per-IP/day rate limits + an optional global token ceiling).
2. **`<AppGate>` primitive** — a configurable pre-render gate (password / sign-in / none) shipped in the framework; `DemoGate` becomes a 3-line config.
3. **Comprehensive, idempotent, auto-on-empty seed** — one `seedEverything(tenant)` that provably covers all registered domains (a test asserts every domain seeded), plus an opt-in "seed this tenant on first load if empty" hook so no page is ever blank.
4. **Tenant-scope the `/v1/agents` user-agent listing** (or document the wildcard behavior loudly).

**Acceptance:** a fork picks a posture in env; the demo is never blank for any visitor on any landing page; no sign-in wall on the free model unless opted in.

---

## 8. Deploy developer-experience  `[P0]`

**The footguns CoLabCare hit, in order:**
1. **Dev proxy defaulted to *production*.** `vite.config.ts` defaulted `/api` → `https://app.openwop.dev` unless `OPENWOP_DEV_PROXY_TARGET` was exported. Result: the local frontend silently talked to the **deployed OpenWOP backend** — wrong data, an outdated sign-in gate, and generic agents instead of the local CoLabCare ones. This masquerade caused *three* separate "bugs" before we found it. **Default must be `http://localhost:8080`.**
2. **Cloud Run runtime SA lacked Secret Manager access.** First deploy failed: the compute SA needed `roles/secretmanager.secretAccessor` on the provider-key secret. Not in any checklist.
3. **`OPENWOP_SESSION_SECRET` required in prod, silently.** Cookie-auth mode throws on session minting if it's unset — but **readiness `GET` still returned 200**, so the failure only showed as a 503 on the *first session-minting POST*. We lost time because the health check lied.
4. **`.env.production` carried the base's live infra** (project, run.app URL, Firebase config) — a fork must scrub it.
5. **SSE must bypass the Firebase `/api` proxy** (it buffers streams) → the build needs `VITE_OPENWOP_SSE_BASE_URL=<run.app>`; easy to miss.

**GAP.** No deploy preflight, the dev-proxy default is actively dangerous, required prod env isn't validated at startup, and there's no per-fork deploy doc/script.

**Proposed:**
1. **Flip the dev-proxy default to localhost** (override to point remote, not the other way around).
2. **Startup preflight** that fails fast (and reflects in `/readiness`) if a prod-required var is missing — `OPENWOP_SESSION_SECRET` in cookie mode, provider secret, etc. **Readiness must not return 200 when a required secret is missing.**
3. **A `deploy/` recipe** (script or `DEPLOY.md`) that does backend→frontend in order, sets the secret-accessor IAM, the session secret, and the SSE URL, and verifies `/api/readiness` + a seed round-trip. (CoLabCare's `FIREBASE.md` + `DEPLOY.md` are a good seed for this.)
4. **`.env.production.example`** scrubbed of base infra.

**Acceptance:** `bash deploy/up.sh` (or a documented sequence) takes a fork from clean to a verified live deploy without rediscovering any of the five footguns.

---

## 9. Demo-quality & honesty primitives  `[P2]`

CoLabCare invented several "make a demo feel real and honest" patterns the framework should standardize:
- **`Illustrative` badge** for panels backed by sample (not live) data — so trend charts that can't be derived from the store don't masquerade as real.
- **Disabled-with-reason buttons** (`disabled title="Not available in this prototype"`) instead of dead clicks.
- **Honest empty/loading states** on every data surface.
- **Icon-only buttons need `aria-label`** — we found a repeated a11y gap (modal close X's, a bell) that the base also has; ship a lint or a `<IconButton>` that requires a label.
- **`@`-mention picker should title by the handle you type** (persona), not the role — a UX papercut we fixed.

**Proposed:** fold these into the cohesion layer (`<Notice>`, `<StateCard>`, `<IllustrativeBadge>`, `<IconButton requires aria-label>`) and the `DESIGN.app.md`, with a lint for unlabeled icon buttons.

---

## 10. Prioritized backlog

| # | Item | Theme | Priority | Why |
|---|------|-------|----------|-----|
| 1 | Flip dev-proxy default to localhost + `.env.*.example` | Deploy | **P0** | Actively misleading; cost us 3 phantom bugs |
| 2 | Startup preflight for required prod env + honest `/readiness` | Deploy | **P0** | Silent 503s; health check lied |
| 3 | Two-tier nav (workspace vs admin) + `AdminLayout` + grouped nav as config | Nav/IA | **P0** | The biggest fork; the user's lead lessons |
| 4 | Declarative feature/route/nav manifest + centralized route registration | Extensibility | **P0** | Kills copy-paste + unregistered-route bugs |
| 5 | `WHITE-LABEL.md` checklist + `check-branding.sh` + favicon/manifest/icon-mark/instance config | Branding | **P0** | Forks silently ship OpenWOP branding |
| 6 | First-class demo posture (public no-login) + `<AppGate>` + comprehensive auto-on-empty seed | Auth/Seed | **P0** | Blank hosted screens; sign-in walls reverse-engineered |
| 7 | Reference domain module + fail-closed/derived-read patterns + `host-extensions.md` | Backend | **P1** | 7× reinvented; extract the patterns |
| 8 | `DESIGN.app.md` + `VITE_BRAND_DEFAULT_THEME` + tokenized palette + CSS `:is()` gate | Tokens/Theme | **P1** | No token discipline; default theme hardcoded |
| 9 | Tenant-scope `/v1/agents`; document wildcard | Tenancy | **P1** | Latent cross-tenant visibility |
| 10 | Cohesion primitives: `IllustrativeBadge`, `IconButton`(aria), honest states, `@`-handle titling | Demo quality | **P2** | Polish + a11y, reusable |
| 11 | `deploy/up.sh` end-to-end recipe (incl. IAM + secrets + SSE URL + verify) | Deploy | **P2** | One-command repeatable deploys |

---

## 11. The deviation inventory (appendix — quick reference)

| Surface | OpenWOP base | CoLabCare had to… |
|---|---|---|
| Sidebar/IA | one flat nav, all routes equal | invent workspace/admin split, `adminNav.ts`, `AdminLayout`, pathless route, `isAdminPath`, collapse |
| Routing | 38 hand-wired routes in `App.tsx`, `NARROW_ROUTES` set | hand-wire 11 more by an informal convention |
| Backend domains | generic surfaces + `DurableCollection` primitive only | build 7 domain services by hand; reinvent tenant scoping, idempotent seed, fail-closed mutation, derived reads, cross-store name join |
| Route registration | ~55 manual `register*Routes()` in `index.ts` | add 6 more; shipped one unregistered (404) before catching it |
| Branding | `VITE_BRAND_*` strings + one `logoSrc` | fix favicon default, author an icon-only mark, add PWA manifest, hardcode instance name/gate password, scrub `.env.production` |
| Theme | default `system`, no token doc | force light default in two places; scattered `oklch` literals |
| Auth | sign-in gate on free model, optional Firebase | remove 2 gates for public no-login, build `DemoGate`, fix tests |
| Seeding | manual `/demo-data` re-seed, `/home`-only auto-seed | add auto-seed-on-entry (seed-if-empty), enrich the seed to fill every screen |
| `/v1/agents` | wildcard sees all tenants' user agents | (latent leak; mitigated by single-tenant + clean DB) |
| Deploy | dev proxy → prod by default; no preflight; no deploy doc | flip proxy to localhost; grant secret-accessor IAM; set `OPENWOP_SESSION_SECRET`; set SSE run.app URL; write `FIREBASE.md`/`DEPLOY.md` |

---

*If this PRD is adopted upstream, the single highest-leverage change is the **declarative feature/nav manifest (§3) + two-tier shell (§2)** — together they convert "fork the app shell" into "declare your pages," which is what made CoLabCare slow. The deploy-DX fixes (§8) are the cheapest high-value wins.*

---

## 12. Status & senior code-review findings (2026-06-04)

Implementation landed across **7 merged PRs + 1 direct-to-main commit** (range `d4ebff4e..860895b4`):
#568 dev-proxy→localhost · #569 zip strips `.env*` · #570/#571 logo theme fixes · #573 honest `/readiness` · #574 `.env.production.example` + `check-branding.sh` · #575 brand-stamped PWA manifest · `860895b4` (deploy posture + `<AppGate>` + auto-seed + `markSrc`/`lockupSrc` + instance/theme config + `deploy/up.sh` + WHITE-LABEL.md checklist + `/v1/agents` tenant scoping — **pushed directly to main, no PR**).

### Backlog status (§10)

| # | Item | Status |
|---|------|--------|
| 1 | Dev-proxy default → localhost + `.env.*.example` | ✅ **Done** (#568, #569, #574) |
| 2 | Startup preflight + honest `/readiness` | ✅ **Done** (#573 + `sessionSecretConfigError` shared predicate) |
| 3 | Two-tier nav (workspace vs admin) + `AdminLayout` + grouped nav config | ❌ **Not started** — `App.tsx` still 29 hand-wired routes, no `adminNav`/`navTier` |
| 4 | Declarative feature/route/nav manifest + centralized registration | ❌ **Not started** |
| 5 | `WHITE-LABEL.md` checklist + `check-branding.sh` + favicon/manifest/mark/instance config | ✅ **Done** (#574, #575, `860895b4`: `markSrc`/`lockupSrc` split, `VITE_BRAND_INSTANCE_NAME`, stamped manifest, 262-line checklist, `check-brand-resolver.mjs` in the build) |
| 6 | Deploy posture + `<AppGate>` + comprehensive auto-on-empty seed | 🟡 **Mostly done** (`860895b4`: posture flag, password/sign-in/none gate, `AutoSeedDemoData` on-entry) — but `seedEverything` is a relabel of `seedDemoAgents` with a hardcoded domain list, not a registry (finding M2); the PRD's **global token ceiling was NOT implemented** (finding C1) |
| 7 | Reference domain module + `host-extensions.md` | ❌ **Not started** |
| 8 | `DESIGN.app.md` + `VITE_BRAND_DEFAULT_THEME` + tokenized palette + CSS `:is()` gate | 🟡 **Partial** — theme var ✅, CSS empty-`:is()` gate ✅ (already wired as `check-built-css.mjs`), `DESIGN.app.md` **already existed at repo root** (this PRD's "no DESIGN.app.md" claim is stale), agent-palette tokenization ❌ |
| 9 | Tenant-scope `/v1/agents` wildcard | ✅ **Done** (`860895b4`: explicit `?tenantId=*` escape hatch + isolation test) — see finding H2 for the migration caveat |
| 10 | Cohesion primitives (`IllustrativeBadge`, `IconButton` aria, `@`-handle titling) | ❌ **Not started** |
| 11 | `deploy/up.sh` end-to-end recipe | ✅ **Done** (`860895b4`, dry-run-default, merge-style `--update-*` flags) — see findings M3/M4 |

**Verification (2026-06-04):** full `openwop:check` 10/10 GREEN; all touched backend test files pass (deploy-posture 4, anon-preflight 5, user-agents 12, agents-demo + readiness 13); frontend build green incl. the brand-resolver and built-CSS gates; zero banned patterns in the range diff. The red **Conformance Soak** on `860895b4` is the *scheduled* SQLite-host soak failing since ≥2026-06-03 (missing profile opt-outs: `deployment-channel-dispatch`, `safefetch-live-audit`, `roster-attribution`) — pre-existing, **not** caused by this work.

### Findings (severity-ordered)

**C1 [CRITICAL — cost exposure on the live deploy].** `managedAnonSignInRequired()` defaults the managed free-tier sign-in wall **OFF** in the default `cookie-per-visitor` posture (`deployPosture.ts:11-16`; both the dispatch gate in `managedProvider.ts` and the run-create preflight in `routes/runs.ts` now condition on it). The live Cloud Run service predates the new env vars, so the **next backend deploy silently opens the operator-funded MiniMax tier to anonymous visitors**. The per-tenant daily token cap (50k) is evadable by clearing cookies (each cookie jar = a fresh `anon:<sid>` tenant), and §7.1's "optional global token ceiling" was **not implemented**. → Before the next deploy: `gcloud run services update openwop-app-backend --update-env-vars OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED=true …` (or ship the global ceiling first).

**H1 [HIGH — governance].** `860895b4` was pushed **directly to main with no PR and no DCO `Signed-off-by`** (every other commit in the program is signed), and its **commit message is confabulated** — it describes `FIREBASE_PROJECT_ID`/`CLOUD_SQL_INSTANCE`/`KMS_KEY_RING` boot checks, a 503-driven AppGate, and an env-gated admin-only seed, *none of which exist in the diff* (the real contents are the §7 posture flag, brand-config gate, and on-entry seed). History is misleading; this section is the corrective record. Don't rewrite main; do enforce PR + DCO going forward.

**H2 [HIGH — behavior change + data orphaning].** Bearer/API-key callers of the normative `GET /v1/agents` changed from implicit-wildcard to tenant `default` (wildcard now requires an explicit `?tenantId=*` from a wildcard principal), and the user-agents fallback tenant renamed `_anon` → `default`. Right direction (it closes this PRD's §7 latent leak, with a test) — but (a) any **existing live durable records under `_anon` orphan** after deploy (invisible to list/GET/DELETE), (b) external tooling relying on implicit wildcard now sees a filtered list with no error, (c) no CHANGELOG entry and the host's conformance evidence wasn't re-measured. → one-time `_anon`→`default` migration (or an explicit decision to abandon those rows) + a CHANGELOG line + re-run the black-box suite against the workflow-engine host before the next conformance publish.

**M1 [MEDIUM].** No CHANGELOG `[Unreleased]` entries for any of the 8 changesets, despite precedent for workflow-engine entries (e.g. the earlier `/readiness` managed-provider line).

**M2 [MEDIUM].** `seedEverything.ts` returns a **hardcoded** `domains` constant when `agents > 0` — the agents-demo test asserts the constant, not actual per-domain coverage. The §7.3 acceptance ("a test asserts every domain seeded") is only nominally met; a real domain registry should ride along with backlog #4.

**M3 [MEDIUM].** `deploy/up.sh` runs `check-branding.sh` unconditionally before the Firebase deploy — the **steward's own OpenWOP-branded deploy always fails it** (the script is documented as a fork tool). Needs a skip flag for the reference deploy. Also: the first-ever deploy boots one revision without the session secret (attached only in the follow-up `services update`) — transient 503 window; and `capture()` passes its dry-run fallback as a live argument (latent footgun).

**M4 [MEDIUM].** `AppGate` `password` mode is **client-side only** (password inlined in the JS bundle, unlock in localStorage). Acceptable as demo friction; WHITE-LABEL.md should say explicitly it is not authentication.

**L1 [LOW].** `check-branding.sh`: check 4 (`og:site_name`/`application-name`) is vacuous (no such meta exists in `index.html`); check 2 false-positives on any custom inline-SVG data-URI favicon containing `viewBox`.

**L2 [LOW].** PWA manifest hardcodes `type: 'image/svg+xml'` and `sizes: 'any'` for the icon — a fork pointing `markSrc` at a PNG ships a wrong-MIME manifest icon; no `maskable` purpose.

**L3 [LOW].** The brand-mark SVG now exists in 4 copies with 2 theming mechanisms (class-based `@media` in the 3 committed `.svg` assets; `currentColor` in `OpenwopLogo.tsx`) — drift hazard; consider one generated source.

**L4 [LOW].** The published `/install/` zip (`openwop.dev/downloads/openwop-demo-app.zip`, last published 2026-06-03 14:13 GMT) predates all 8 changesets — run `/publish-whitelabel` to ship the posture/gate/seed/manifest/env-template work to adopters.

### Remaining work, in priority order

1. **C1 mitigation on the live service** (one `gcloud run services update`, before any backend deploy).
2. **Backlog #3 + #4** (two-tier nav + declarative manifest) — the PRD's stated highest-leverage items, untouched.
3. **H2 follow-ups** (`_anon` migration decision, CHANGELOG, conformance re-measure) + **M1** CHANGELOG batch entry.
4. Republish the white-label zip (**L4**), then backlog #7, the §6 palette tokenization, #10, and the M3/M4/L1–L3 polish.
