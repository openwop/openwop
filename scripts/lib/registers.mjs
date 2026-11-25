/**
 * registers — the deprecation and v1→v2 migration registers as one view
 * (RFC 0266 §A).
 *
 * v2 owns its registers: `spec/v2/deprecations.json` carries every row whose
 * removal trigger is a v2 event, and `spec/v2/major-1-migrations.json` the
 * v1→v2 rows v2 prose cites. The v1 files are frozen (RFC 0234 §A.3) and keep
 * their rows as history. A reader merges the two by id with the v2 row winning:
 * a v2 row replaces the v1 row its `movedFrom` names (and any v1 row with its
 * own id); a v2 row with `movedFrom: null` is born in v2 and is appended.
 *
 * Each path is overridable by env so a coherence twin can drive a fixture
 * without writing into the real registers:
 *   OPENWOP_DEPRECATIONS_FILE          the v1 deprecation register
 *   OPENWOP_V2_DEPRECATIONS_FILE       the v2 deprecation register
 *   OPENWOP_MAJOR1_MIGRATIONS_FILE     the v2 copy of the v1→v2 migration rows
 * (spec/v1/migrations.json is never overridden; no fixture needs it.)
 *
 * The loaders throw on an unreadable file. Callers that fail closed let it
 * propagate; callers that tolerate a missing register catch it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const V1_DEPRECATIONS = 'spec/v1/deprecations.json';
export const V2_DEPRECATIONS = 'spec/v2/deprecations.json';
export const V1_MIGRATIONS = 'spec/v1/migrations.json';
export const V2_MAJOR1_MIGRATIONS = 'spec/v2/major-1-migrations.json';

/** Merge two row lists by id; the v2 row wins, in the v1 row's position. */
export function mergeById(v1Rows, v2Rows) {
  const replaced = new Map();
  for (const r of v2Rows) {
    replaced.set(r.id, r);
    if (r.movedFrom) replaced.set(r.movedFrom, r);
  }
  const out = [];
  const placed = new Set();
  for (const r of v1Rows) {
    const w = replaced.get(r.id);
    if (!w) { out.push(r); continue; }
    if (!placed.has(w)) { out.push(w); placed.add(w); }
  }
  for (const r of v2Rows) if (!placed.has(r)) { out.push(r); placed.add(r); }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function deprecationPaths(root) {
  return {
    v1: process.env['OPENWOP_DEPRECATIONS_FILE'] ?? join(root, V1_DEPRECATIONS),
    v2: process.env['OPENWOP_V2_DEPRECATIONS_FILE'] ?? join(root, V2_DEPRECATIONS),
  };
}

/** { v1, v2, entries } — the two documents and the merged `entries`. */
export function loadDeprecations(root, paths = deprecationPaths(root)) {
  const v1 = readJson(paths.v1);
  const v2 = readJson(paths.v2);
  return { v1, v2, entries: mergeById(v1.entries ?? [], v2.entries ?? []) };
}

export function migrationPaths(root) {
  return {
    v1: join(root, V1_MIGRATIONS),
    v2: process.env['OPENWOP_MAJOR1_MIGRATIONS_FILE'] ?? join(root, V2_MAJOR1_MIGRATIONS),
  };
}

/** { v1, v2, rows } — the two documents and the merged `rows`. */
export function loadMajor1Migrations(root, paths = migrationPaths(root)) {
  const v1 = readJson(paths.v1);
  const v2 = readJson(paths.v2);
  return { v1, v2, rows: mergeById(v1.rows ?? [], v2.rows ?? []) };
}

/**
 * Structural rules of a v2 register beside its v1 twin, for the gates that
 * validate it: ids unique inside the v2 file; a moved row's `movedFrom` names
 * a v1 row; a row born in v2 does not reuse a v1 id. Returns failure strings.
 */
export function movedFromFailures(label, v1Rows, v2Rows) {
  const failures = [];
  const v1Ids = new Set(v1Rows.map((r) => r.id));
  const seen = new Set();
  const moved = new Set();
  for (const r of v2Rows) {
    if (seen.has(r.id)) failures.push(`${label}: duplicate id ${r.id}`);
    seen.add(r.id);
    if (r.movedFrom === null || r.movedFrom === undefined) {
      if (v1Ids.has(r.id)) failures.push(`${label}: ${r.id} reuses a v1 row id but has movedFrom null — a row moved from v1 names its v1 row`);
      continue;
    }
    if (!v1Ids.has(r.movedFrom)) failures.push(`${label}: ${r.id} has movedFrom ${r.movedFrom}, which is not a row in the v1 register`);
    if (moved.has(r.movedFrom)) failures.push(`${label}: two rows move ${r.movedFrom}`);
    moved.add(r.movedFrom);
  }
  return failures;
}
