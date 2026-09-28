#!/usr/bin/env node
/**
 * generate-gaps — `spec/v1/gaps.json`, the one gap namespace (RFC 0166 §B).
 *
 * One entry per gap-register row, id `openwop.gap.<rfc>.<n>`. Generated
 * fields (rfc, local, section, surface, disposition, target, sources) are
 * re-derived from the registers every run; hand-maintained fields (witness,
 * requirementId, note) are preserved from the committed file when the id
 * already exists, and default to `witness: "unclassified"` for a new row —
 * the unclassified count is reported so it can only ratchet down.
 *
 *   --write   regenerate the file
 *   --check   fail when the committed file differs from a regeneration, when
 *             a requirementId does not resolve, or when a source row is gone
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listRegisterFiles, parseRegister, gapId } from './registers-lib.mjs';

const OUT = join(ROOT, 'spec', 'v1', 'gaps.json');
const WITNESS = ['witnessable-unaided', 'witnessable-gated', 'seam-gated', 'claims-check', 'negative-existence', 'unwitnessable', 'unclassified'];

function committed() {
  return existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { entries: [] };
}

export function generate(prev) {
  const prevById = new Map((prev.entries ?? []).map((e) => [e.id, e]));
  const entries = [];
  for (const file of listRegisterFiles().filter((f) => f.kind === 'gaps')) {
    const { rows } = parseRegister(file);
    for (const row of rows) {
      const id = gapId(row);
      const old = prevById.get(id);
      const surface = (row.cells[2] ?? '').replace(/\s+/g, ' ').trim();
      entries.push({
        id,
        rfc: file.rfc,
        local: row.local,
        section: (row.cells[1] ?? '').trim(),
        surface: surface.length > 0 ? surface : '(empty question cell)',
        witness: old?.witness ?? 'unclassified',
        requirementId: old?.requirementId ?? null,
        disposition: row.token ?? 'open',
        target: row.arg ?? null,
        ...(old?.note ? { note: old.note } : {}),
        sources: [{ file: file.rel, token: row.local }],
      });
    }
  }
  // RFC 0174 §E.3 (v2 charter Phase 3, P3-D): the 43 prose "Open spec gaps"
  // tables in spec/v1/*.md were absorbed into spec/v1/spec-gaps.json — one
  // hand-classified row per table row (id openwop.gap.spec.<doc>.<local>) —
  // and the tables replaced by a pointer. Those rows join the one namespace
  // here; their witness and disposition come from that file (reviewed), not
  // from the unclassified default.
  const specGapsPath = join(ROOT, 'spec', 'v1', 'spec-gaps.json');
  if (existsSync(specGapsPath)) {
    for (const g of JSON.parse(readFileSync(specGapsPath, 'utf8')).entries ?? []) {
      const old = prevById.get(g.id);
      entries.push({ id: g.id, rfc: g.owningRfc ?? 'spec', local: g.local, section: g.section ?? g.doc, surface: g.surface, witness: g.witness ?? old?.witness ?? 'unclassified', requirementId: old?.requirementId ?? null, disposition: g.disposition ?? 'open', target: g.target ?? null, ...(g.resolutionPath ? { note: g.resolutionPath } : {}), sources: g.sources ?? [{ file: g.doc, token: g.local }] });
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return {
    $schema: './gaps.schema.json',
    version: 1,
    updated: prev.updated ?? '2026-09-02',
    witnessClasses: WITNESS,
    entries,
  };
}

const stable = (o) => JSON.stringify(o, null, 2) + '\n';
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'report';
const prev = committed();
const fresh = generate(prev);
const counts = {
  entries: fresh.entries.length,
  unclassified: fresh.entries.filter((e) => e.witness === 'unclassified').length,
  byDisposition: fresh.entries.reduce((m, e) => ((m[e.disposition] = (m[e.disposition] ?? 0) + 1), m), {}),
};

if (mode === 'write') {
  fresh.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, stable(fresh));
  console.log(`wrote spec/v1/gaps.json: ${counts.entries} gaps (${counts.unclassified} unclassified witness); dispositions ${JSON.stringify(counts.byDisposition)}`);
} else if (mode === 'check') {
  const failures = [];
  if (!existsSync(OUT)) failures.push('spec/v1/gaps.json is missing — run generate-gaps.mjs --write');
  else {
    const a = { ...prev, updated: 'x' };
    const b = { ...fresh, updated: 'x' };
    if (stable(a) !== stable(b)) failures.push('spec/v1/gaps.json is stale against the registers — run generate-gaps.mjs --write');
    // requirementId resolves
    const reqPath = join(ROOT, 'conformance', 'requirements.json');
    const aliasPath = join(ROOT, 'conformance', 'requirement-aliases.json');
    const ids = new Set();
    if (existsSync(reqPath)) for (const r of JSON.parse(readFileSync(reqPath, 'utf8')).records ?? []) if (r.id) ids.add(r.id);
    if (existsSync(aliasPath)) for (const k of Object.keys(JSON.parse(readFileSync(aliasPath, 'utf8')).aliases ?? {})) ids.add(k);
    // One namespace means one row per id. Two register rows sharing a local ID
    // (a G9 appended twice) generated two entries with the same id, and every
    // check above passed: the second silently shadowed the first for anyone
    // resolving the id.
    const seen = new Map();
    for (const e of prev.entries ?? []) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    // Ratchet: these ids were already doubled when the guard landed (registers
    // 0124–0129 repeat local IDs across tables). They are recorded, not fixed
    // here; a NEW duplicate fails.
    const LEGACY_DUPLICATES = new Set(['openwop.gap.0124.5','openwop.gap.0124.6','openwop.gap.0126.1','openwop.gap.0126.2','openwop.gap.0126.3','openwop.gap.0126.4','openwop.gap.0126.5','openwop.gap.0126.6','openwop.gap.0126.7','openwop.gap.0127.1','openwop.gap.0127.2','openwop.gap.0127.3','openwop.gap.0127.4','openwop.gap.0127.5','openwop.gap.0128.1','openwop.gap.0128.2','openwop.gap.0128.3','openwop.gap.0128.4','openwop.gap.0128.5','openwop.gap.0128.6','openwop.gap.0129.1','openwop.gap.0129.2','openwop.gap.0129.3','openwop.gap.0129.4','openwop.gap.0129.5']);
    for (const [id, n] of seen) if (n > 1 && !LEGACY_DUPLICATES.has(id)) failures.push(`${id}: ${n} register rows share this id — give each row its own local ID`);
    for (const e of prev.entries ?? []) {
      if (e.requirementId && !ids.has(e.requirementId)) failures.push(`${e.id}: requirementId ${e.requirementId} is not in conformance/requirements.json or its aliases`);
      if (!WITNESS.includes(e.witness)) failures.push(`${e.id}: witness ${JSON.stringify(e.witness)} is not in the closed enum`);
      for (const s of e.sources ?? []) {
        const p = join(ROOT, s.file);
        if (!existsSync(p) || !readFileSync(p, 'utf8').includes(s.token)) failures.push(`${e.id}: source ${s.file} no longer contains row ${s.token}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(`=== check-gaps FAILED — ${failures.length} problem(s) ===`);
    for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`=== check-gaps OK — ${counts.entries} gaps, one namespace; ${counts.unclassified} unclassified witness (ratchet); dispositions ${JSON.stringify(counts.byDisposition)} ===`);
} else {
  console.log(JSON.stringify(counts, null, 2));
}
