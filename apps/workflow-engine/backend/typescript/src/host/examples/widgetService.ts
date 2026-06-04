/**
 * REFERENCE DOMAIN MODULE — the canonical host-extension vertical slice
 * (white-label PRD §4; documented in ../../../HOST-EXTENSIONS.md).
 *
 * The CoLabCare fork re-derived this exact shape SEVEN times (clinical,
 * comms, analytics, audit, compatibility, practice-config, alerts) because no
 * example showed the full, correct pattern. This module is that example: a
 * deliberately tiny "widgets" domain demonstrating every convention a real
 * domain needs. Copy it, rename it, keep the properties:
 *
 *   1. TENANT SCOPING — `StoredWidget = Widget & { tenantId }`; the row key is
 *      `${tenantId}:${widgetId}` so one prefix scan never crosses tenants, and
 *      every read filter double-checks `tenantId` (defense-in-depth against a
 *      key-construction bug).
 *   2. DURABLE, READ-THROUGH — a `DurableCollection` over the host kv store:
 *      no in-memory cache to drift, multi-instance safe.
 *   3. IDEMPOTENT SEED — `seedDemoWidgets` inserts only what is missing
 *      (per-entity, so it also self-heals a partial seed) and never clobbers
 *      user edits.
 *   4. FAIL-CLOSED MUTATION — `archiveWidget` returns a discriminated
 *      `WidgetMutation` (`{ ok: true } | { ok: false, reason }`) instead of
 *      throwing on domain conflicts; the route maps `ok: false` → HTTP 409
 *      with the machine-readable reason (see routes/widgets.ts), and a client
 *      surfaces it as a typed error.
 *   5. DERIVED READ-THROUGH PROJECTION — `widgetSummary` computes from the
 *      live store at read time (no second copy of the truth to drift).
 *
 * The whole slice (service → route → registration → seed → test) is wired and
 * CI-guarded, but the ROUTE mounts only when `OPENWOP_EXAMPLE_WIDGETS_ENABLED=true`
 * so the example never pollutes a real deployment's API surface.
 */

import { DurableCollection } from '../hostExtPersistence.js';

export interface Widget {
  widgetId: string;
  name: string;
  /** Domain lifecycle — mutations are only legal from some states (the
   *  fail-closed mutation demonstrates enforcing that). */
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/** The stored row carries its owning tenant. NEVER trust the entity id alone. */
export type StoredWidget = Widget & { tenantId: string };

/** Row key = `${tenantId}:${widgetId}` — tenant first, so a tenant's rows are
 *  one contiguous key range and a cross-tenant read cannot happen by prefix. */
const widgets = new DurableCollection<StoredWidget>(
  'example:widget',
  (w) => `${w.tenantId}:${w.widgetId}`,
);

/** List a tenant's widgets. The filter re-checks tenantId even though the key
 *  prefix already scopes — belt-and-suspenders (PRD §4 lesson). */
export async function listWidgets(tenantId: string): Promise<StoredWidget[]> {
  const all = await widgets.list();
  return all
    .filter((w) => w.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getWidget(tenantId: string, widgetId: string): Promise<StoredWidget | null> {
  const row = await widgets.get(`${tenantId}:${widgetId}`);
  return row && row.tenantId === tenantId ? row : null;
}

export async function createWidget(tenantId: string, name: string): Promise<StoredWidget> {
  const now = new Date().toISOString();
  const row: StoredWidget = {
    tenantId,
    widgetId: `wgt_${Math.random().toString(36).slice(2, 10)}`,
    name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await widgets.put(row);
  return row;
}

// ── 4. Fail-closed mutation ────────────────────────────────────────────────
// Domain conflicts are RESULTS, not exceptions: the discriminated union forces
// the route (and any other caller) to handle every refusal reason explicitly.
// The route maps `ok: false` → 409 + the reason string (machine-readable), so
// a client can present a typed, actionable error instead of a generic 500.

export type WidgetMutation =
  | { ok: true; widget: StoredWidget }
  | { ok: false; reason: 'not_found' | 'already_archived' };

export async function archiveWidget(tenantId: string, widgetId: string): Promise<WidgetMutation> {
  const row = await getWidget(tenantId, widgetId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'archived') return { ok: false, reason: 'already_archived' };
  const next: StoredWidget = { ...row, status: 'archived', updatedAt: new Date().toISOString() };
  await widgets.put(next);
  return { ok: true, widget: next };
}

// ── 3. Idempotent, per-entity seed ─────────────────────────────────────────
// Inserts only the canonical demo entities that are MISSING: re-running never
// duplicates, never clobbers user edits, and self-heals a seed that failed
// partway. A real domain registers its seeder with seedEverything.ts so the
// first-load seed stays comprehensive (and the agents-demo test proves it).

const DEMO_WIDGET_NAMES = ['Flux capacitor', 'Turbo encabulator'] as const;

export async function seedDemoWidgets(tenantId: string): Promise<{ seeded: boolean; widgets: number }> {
  const existing = await listWidgets(tenantId);
  const byName = new Set(existing.map((w) => w.name));
  let created = 0;
  for (const name of DEMO_WIDGET_NAMES) {
    if (byName.has(name)) continue;
    await createWidget(tenantId, name);
    created += 1;
  }
  return { seeded: created > 0, widgets: existing.length + created };
}

// ── 5. Derived read-through projection ─────────────────────────────────────
// Computed from the live store at read time. There is no stored "summary" row
// to drift out of sync; if this gets hot, cache it BEHIND this function so the
// contract stays read-through. When joining ACROSS stores, join on stable ids,
// never display names (the CoLabCare "Marcus Garcia" vs "Garcia, M." lesson).

export interface WidgetSummary {
  total: number;
  active: number;
  archived: number;
}

export async function widgetSummary(tenantId: string): Promise<WidgetSummary> {
  const rows = await listWidgets(tenantId);
  return {
    total: rows.length,
    active: rows.filter((w) => w.status === 'active').length,
    archived: rows.filter((w) => w.status === 'archived').length,
  };
}
