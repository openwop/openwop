#!/usr/bin/env node
/**
 * RFC 0216 §C: report, for every colocated companion in an evidence directory,
 * the served-host bundle it pairs with and the rows it witnesses. The code is
 * the same code `check-accepted-predicate.mjs` rule 4 runs
 * (scripts/lib/companion-pairing.mjs).
 *
 *   node scripts/check-companion-pairing.mjs [--dir <evidence dir>] [--anchors <list.json>]
 *
 * Prints one JSON document on stdout. Always exits 0; the verdict is the data.
 * The coherence scenario `v2-colocated-companion.test.ts` drives it on fixture directories.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { companionWitness, isCompanion } from './lib/companion-pairing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? resolve(argv[i + 1]) : d; };
const dir = opt('--dir', join(ROOT, 'evidence', 'v2-host-bundles'));
const anchors = opt('--anchors', join(ROOT, 'spec', 'v2', 'harness-trust-anchors.json'));

const anchorIds = new Set(JSON.parse(readFileSync(anchors, 'utf8')).rows.map((r) => r.requirementId));
const loaded = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f, bundle: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
const companions = loaded.filter((x) => isCompanion(x.bundle)).map((c) => {
  const w = companionWitness(c, loaded, anchorIds);
  return { name: c.name, pairedWith: w.pairedWith, counted: [...w.counted].sort(), discarded: w.discarded.sort(), failures: w.failures };
});
process.stdout.write(`${JSON.stringify({ companions }, null, 2)}\n`);
