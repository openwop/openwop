# Host extensions — adding a backend domain (the paved path)

How to add a new backend domain (entities + routes + seed) to the workflow-engine
reference app **without re-deriving the conventions** (white-label PRD §4 — the
CoLabCare fork rebuilt this shape seven times by hand; this doc + the reference
module make it a copy-paste).

> **The reference implementation is `src/host/examples/widgetService.ts` +
> `src/routes/widgets.ts` + `test/widget-reference-domain.test.ts`.** Copy the
> three files, rename "widget" to your entity, keep every property below. The
> example routes are env-gated (`OPENWOP_EXAMPLE_WIDGETS_ENABLED=true`) so they
> never pollute a real deployment.

## The vertical slice, step by step

| Step | File | Convention |
|---|---|---|
| 1. Service | `src/host/<your>Service.ts` | `StoredX = X & { tenantId }` over a `DurableCollection` (read-through kv; no migration needed, multi-instance safe). Row key `${tenantId}:${id}` — tenant FIRST, and every read filter re-checks `tenantId` (belt-and-suspenders) |
| 2. Mutations | same file | **Fail-closed**: domain conflicts return a discriminated `{ ok: true, … } \| { ok: false, reason }` — never a throw, never a silent success |
| 3. Derived reads | same file | Projections compute from the live stores at read time (no second copy of the truth). Join across stores on **stable ids**, never display names |
| 4. Seed | same file | Idempotent + per-entity (insert only what's missing → re-run is a no-op and a partial seed self-heals). Register it in `src/host/seedEverything.ts` `DEMO_SEED_DOMAINS` + `verifyDomains` so the first-load seed stays provably comprehensive |
| 5. Routes | `src/routes/<your>.ts` | Vendor-prefixed namespace (`/v1/host/sample/...`), `tenantOf(req)` accessor, `ok: false` → **409 + machine-readable `reason`**, validation → `OpenwopError('validation_error', …, 400)`, everything else → `next(err)` (the canonical envelope middleware) |
| 6. Registration | `src/routes/registerAllRoutes.ts` | Add ONE entry to `ROUTE_MODULES` where it belongs in mount order. **You cannot forget this**: `test/register-all-routes.test.ts` fails CI for any `register*Routes` export not in the list |
| 7. Frontend client | `frontend/react/src/<your>/<your>Client.ts` | Typed fetch wrappers; surface the 409 `reason` as a typed error the page can switch on |
| 8. Page + nav | `frontend/react/src/chrome/features.tsx` | ONE manifest entry `{ path, element, tier, chrome, nav }` — route, nav item, tier (workspace/admin), and width chrome all derive from it. No `App.tsx` edits |

## Worked example: the fail-closed chain

```ts
// service — the refusal is a RESULT the caller must handle
export type WidgetMutation =
  | { ok: true; widget: StoredWidget }
  | { ok: false; reason: 'not_found' | 'already_archived' };

// route — ok:false → 409 + the reason (machine-readable, never a 500)
res.status(409).json({ error: 'conflict', reason: result.reason, message: '…' });

// client — a typed error the UI can switch on
if (res.status === 409) throw new WidgetBlockedError((await res.json()).reason);
```

## Sharp edges this pattern exists to avoid

- **Unregistered routes** — a route file whose `register` call was forgotten
  404s only at runtime. The `ROUTE_MODULES` guard test makes it a CI failure.
- **Cross-tenant leakage** — keying by entity id alone, or trusting the key
  prefix without re-checking `tenantId` on read.
- **Display-name joins** — two seed datasets wrote `"Marcus Garcia"` vs
  `"Garcia, M."`; the cross-store join silently dropped rows. Join on ids.
- **Stored projections** — a persisted "summary" row drifts from its sources.
  Compute at read time; cache *behind* the function only if it gets hot.
- **Seeds that clobber** — a seed that rewrites existing rows fights the user.
  Insert-if-missing only.

## Tenancy quick reference

| Caller | `tenantOf(req)` |
|---|---|
| Cookie-anon visitor | `anon:<sid>` (fresh per cookie jar) |
| Signed-in (OIDC) | `user:<hash>` |
| API-key bearer (demo / tests) | `default` (the shared bearer-demo tenant) |
| Explicit admin override | `?tenantId=…` honored only for wildcard principals |
