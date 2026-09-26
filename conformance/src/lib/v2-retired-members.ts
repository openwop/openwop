/**
 * RFC 0197 §A.3 — which persisted-class v2 members are retired at the release
 * the suite ships, and whether an emitted event carries one.
 *
 * A persisted-class retirement keeps the member in the READER schema,
 * annotated `x-openwop-retired-in: "2.N"`, and forbids only its EMISSION after
 * `2.N`. The deprecations register says WHICH rows are persisted-class and
 * when they fall due; the annotation in the v2 schema says WHAT the member is
 * (a property name, or a `const` / single-member `enum` value). This module
 * joins the two so `v2-capability-maturity-bounded`'s `retired-not-emitted`
 * leg can scan real events for it.
 *
 * Pure (the caller passes the parsed register and a schema loader) so the
 * self-test drives the due / not-due / unlocatable branches with fixtures —
 * the register is empty today, so the host leg cannot reach them yet.
 *
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §A.3
 * @see scripts/check-removal-dates.mjs (the corpus gate that requires the annotation on a due persisted row)
 */

type Json = Record<string, unknown>;

export interface PersistedRetirement {
  readonly id: string;
  readonly removeIn: string;
  readonly due: boolean;
  /** `schemas/v2/…` source files the row cites, relative to the contract root. */
  readonly schemaFiles: readonly string[];
}

export interface RetiredMember {
  readonly rowId: string;
  readonly removeIn: string;
  readonly schemaFile: string;
  /** `property`: an object key; `value`: a string value. */
  readonly kind: 'property' | 'value';
  readonly name: string;
}

export interface RetiredEmission {
  readonly rowId: string;
  readonly member: string;
  readonly eventType: string;
  readonly path: string;
}

const minorOf = (v: string): number | null => {
  const m = /^2\.(\d+)(?:\.\d+)?$/.exec(v.trim());
  return m ? Number(m[1]) : null;
};

const triggersOf = (e: Json): string[] => {
  const t = e['removalTrigger'];
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : typeof t === 'string' ? [t] : [];
};

/** Every `v2-minor` row whose `retirement.persistence` is `persisted`, and whether `release` has reached its `removeIn`. */
export function persistedRetirements(deprecations: unknown, release: string): PersistedRetirement[] {
  const entries = ((deprecations as { entries?: unknown } | null)?.entries ?? []) as Json[];
  const rel = minorOf(release);
  const out: PersistedRetirement[] = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!triggersOf(e).includes('v2-minor')) continue;
    const r = e['retirement'] as Json | undefined;
    if ((r?.['persistence'] ?? 'advertised') !== 'persisted') continue;
    const removeIn = String(e['removeIn'] ?? '');
    const at = minorOf(removeIn);
    const sources = (Array.isArray(e['sources']) ? e['sources'] : []) as Json[];
    out.push({
      id: String(e['id'] ?? '(no id)'),
      removeIn,
      due: rel !== null && at !== null && rel >= at,
      schemaFiles: sources.map((s) => String(s['file'] ?? '')).filter((f) => /^schemas\/v2\//.test(f)),
    });
  }
  return out;
}

/** The members a due row's schema annotates `x-openwop-retired-in: <removeIn>`. */
export function retiredMembers(row: PersistedRetirement, loadSchema: (file: string) => unknown): RetiredMember[] {
  const out: RetiredMember[] = [];
  for (const file of row.schemaFiles) {
    const walk = (node: unknown, parentKey: string | null, grandKey: string | null): void => {
      if (Array.isArray(node)) { for (const n of node) walk(n, null, parentKey); return; }
      if (node === null || typeof node !== 'object') return;
      const o = node as Json;
      if (o['x-openwop-retired-in'] === row.removeIn) {
        if (typeof o['const'] === 'string') out.push({ rowId: row.id, removeIn: row.removeIn, schemaFile: file, kind: 'value', name: o['const'] });
        else if (Array.isArray(o['enum']) && o['enum'].length === 1 && typeof o['enum'][0] === 'string') out.push({ rowId: row.id, removeIn: row.removeIn, schemaFile: file, kind: 'value', name: o['enum'][0] });
        else if (grandKey === 'properties' && parentKey !== null) out.push({ rowId: row.id, removeIn: row.removeIn, schemaFile: file, kind: 'property', name: parentKey });
      }
      for (const [k, v] of Object.entries(o)) walk(v, k, parentKey);
    };
    walk(loadSchema(file), null, null);
  }
  return out;
}

/** Every place an event carries a retired member: a key named for a `property` member, or a string equal to a `value` member. */
export function findRetiredEmissions(events: readonly unknown[], members: readonly RetiredMember[]): RetiredEmission[] {
  const hits: RetiredEmission[] = [];
  for (const ev of events) {
    const eventType = String((ev as Json | null)?.['type'] ?? '(untyped)');
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        for (const m of members) if (m.kind === 'value' && node === m.name) hits.push({ rowId: m.rowId, member: m.name, eventType, path });
        return;
      }
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Json)) {
        for (const m of members) if (m.kind === 'property' && k === m.name) hits.push({ rowId: m.rowId, member: m.name, eventType, path: `${path}.${k}` });
        walk(v, `${path}.${k}`);
      }
    };
    walk(ev, '$');
  }
  return hits;
}
