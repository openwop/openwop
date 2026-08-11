#!/usr/bin/env node
/**
 * check-capability-declaration-classes — enforce the §A rule (RFC 0144 G3).
 *
 * `spec/v1/host-extensions.md` §A: a `§host.<name>` section MUST be declared as a property
 * of `schemas/capabilities.schema.json` when it states a normative requirement binding the
 * shape or content of a WIRE ARTIFACT; a section describing only a host-side `ctx.*` method
 * surface is an EXTENSION NAMESPACE and MUST NOT be declared in the core schema.
 *
 * WHY THIS GATE DOES NOT CLASSIFY. The trigger — "binds the shape or content of a wire
 * artifact" — is a semantic judgement, and every heuristic reaching for it has been wrong in
 * this corpus. Two worked cases, both recorded in RFC 0144:
 *
 *   - `§host.http` advertises `httpClient`. A heading-derived list calls it undeclared. It is
 *     not: the section's own JSON example carries the real key. FALSE POSITIVE.
 *   - `§host.coordination` names `agentRuntime` in prose, to CONTRAST itself with it. A
 *     backtick-matching list calls it declared-by-that-key. It is not: it is a `ctx.*` surface
 *     with its own dotted sub-capabilities. FALSE POSITIVE, found while building this gate.
 *
 * So the classification lives in a REVIEWED ledger and this gate enforces that the ledger and
 * the corpus cannot drift apart. That is the honest division: a human decides the semantics
 * once, per section, in a file a reviewer reads — and a machine guarantees the decision was
 * made at all, still holds, and matches the schema.
 *
 * The failure this closes is narrow and real: before it, a NEW `§host.<name>` section could
 * land with nobody noticing it needed a declaration. It can no longer land UNCLASSIFIED.
 *
 * Checks:
 *   1. coverage      — every §host.<name> heading has a ledger entry
 *   2. no stale      — every ledger entry names a heading that exists
 *   3. declared      — a `declared` entry's key IS a property of capabilities.schema.json
 *   4. extension     — an `extension` entry's section name is NOT a property
 *   5. reason        — an `extension` section containing MUST / MUST NOT carries a `reason`
 *
 * Check 5 is where the risk concentrates: an extension namespace that states a MUST is
 * exactly the shape that gets mis-filed, so the burden of articulating why falls there and
 * nowhere else.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'spec', 'v1', 'host-capabilities.md');
const LEDGER = join(ROOT, 'spec', 'v1', 'capability-declaration-classes.json');
const SCHEMA = join(ROOT, 'schemas', 'capabilities.schema.json');

const failures = [];
const fail = (msg) => failures.push(msg);

const doc = readFileSync(DOC, 'utf8');
const declared = new Set(Object.keys(JSON.parse(readFileSync(SCHEMA, 'utf8')).properties));
const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const entries = ledger.sections ?? [];

/** Section bodies, keyed by family name. Duplicate headings (RFC 0144 G2) are concatenated. */
const lines = doc.split('\n');
const marks = [];
lines.forEach((l, i) => {
  const m = /^## §host\.([A-Za-z0-9._-]+)\s*$/.exec(l);
  if (m) marks.push({ name: m[1], start: i });
});
marks.forEach((m, i) => {
  m.end = i + 1 < marks.length ? marks[i + 1].start : lines.length;
});
const bodies = new Map();
for (const m of marks) {
  const body = lines.slice(m.start, m.end).join('\n');
  bodies.set(m.name, (bodies.get(m.name) ?? '') + '\n' + body);
}

const byName = new Map(entries.map((e) => [e.section, e]));

// 1. coverage
for (const name of bodies.keys()) {
  if (!byName.has(name)) {
    fail(
      `§host.${name} has no entry in spec/v1/capability-declaration-classes.json. ` +
        `Classify it per host-extensions.md §A: "declared" (and add it to capabilities.schema.json) ` +
        `if it binds the shape or content of a wire artifact, else "extension".`,
    );
  }
}

// 2. no stale entries
for (const e of entries) {
  if (!bodies.has(e.section)) {
    fail(`ledger entry "${e.section}" names a §host section that no longer exists in host-capabilities.md.`);
  }
}

for (const e of entries) {
  if (!bodies.has(e.section)) continue;
  const body = bodies.get(e.section);

  if (e.class === 'declared') {
    // 3. the declared key must really be in the schema
    const key = e.key ?? e.section;
    if (!declared.has(key)) {
      fail(
        `§host.${e.section} is classified "declared" with key "${key}", but "${key}" is not a property ` +
          `of schemas/capabilities.schema.json. Either declare it or reclassify the section.`,
      );
    }
  } else if (e.class === 'extension') {
    // 4. an extension namespace must NOT occupy a core property
    if (declared.has(e.section)) {
      fail(
        `§host.${e.section} is classified "extension", but "${e.section}" IS a property of ` +
          `schemas/capabilities.schema.json. §A: an extension namespace MUST NOT be declared in the core schema.`,
      );
    }
    // 5. an extension stating a MUST has to say why it is not wire-binding
    if (/\bMUST(\s+NOT)?\b/.test(body) && !(typeof e.reason === 'string' && e.reason.trim().length > 0)) {
      fail(
        `§host.${e.section} is classified "extension" and states a MUST / MUST NOT, but carries no "reason". ` +
          `An extension namespace with a normative requirement is exactly the shape that gets mis-filed — ` +
          `record why that MUST does not bind the shape or content of a wire artifact.`,
      );
    }
  } else {
    fail(`§host.${e.section} has an unknown class "${e.class}" (expected "declared" or "extension").`);
  }
}

const nDeclared = entries.filter((e) => e.class === 'declared').length;
const nExtension = entries.filter((e) => e.class === 'extension').length;

console.log(`=== check-capability-declaration-classes — verifying ${LEDGER} ===\n`);
console.log(`§host sections:   ${bodies.size} unique`);
console.log(`  declared:       ${nDeclared}  (core families, present in capabilities.schema.json)`);
console.log(`  extension:      ${nExtension}  (ctx.* / product surfaces, absent from the core schema)`);

if (failures.length > 0) {
  console.error(`\n=== check-capability-declaration-classes FAILED — ${failures.length} problem(s) ===\n`);
  for (const f of failures) console.error(`  FAIL: ${f}`);
  console.error('\nSee spec/v1/host-extensions.md §A and RFCS/0144-capability-declaration-classes.md.');
  process.exit(1);
}

console.log('\n=== check-capability-declaration-classes OK — every §host section is classified and consistent ===');
