#!/usr/bin/env node
/**
 * RFC 0174 §E.2 — spec/v2/core/ is under 25,000 words. Measured the way the
 * charter's 225,858-word figure was: `wc -w` on the raw markdown (tables,
 * examples and generated documents such as core/headers.md all count). Prints
 * the per-document table so a budget overrun names its document. Green while
 * spec/v2/core/ does not exist (nothing to measure is not a pass on prose that
 * does not exist — it is reported as such).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'spec', 'v2', 'core');
const BUDGET = 25_000;
if (!existsSync(DIR)) { console.log('=== check-core-budget — spec/v2/core/ does not exist yet (0 words of a 25,000 budget; nothing measured) ==='); process.exit(0); }
const rows = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort().map((f) => [f, readFileSync(join(DIR, f), 'utf8').split(/\s+/).filter(Boolean).length]);
const total = rows.reduce((n, [, w]) => n + w, 0);
for (const [f, w] of rows) console.log(`  ${String(w).padStart(6)}  core/${f}`);
if (total > BUDGET) { console.error(`=== check-core-budget FAILED — spec/v2/core/ is ${total.toLocaleString()} words; budget ${BUDGET.toLocaleString()} (RFC 0174 §E.2) ===`); process.exit(1); }
console.log(`=== check-core-budget OK — ${total.toLocaleString()} / ${BUDGET.toLocaleString()} words across ${rows.length} document(s) ===`);
