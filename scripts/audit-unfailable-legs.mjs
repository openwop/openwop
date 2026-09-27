#!/usr/bin/env node
/**
 * Audit aid (not a gate): find conformance legs that witness an Accepted RFC's
 * Falsifiability row and carry a shape that has let a leg pass without
 * measuring anything. Each hit is a CANDIDATE for human review, not a finding.
 *
 * Shapes (each one has shipped as a real defect in this corpus):
 *   H1 bound  — toBeLessThanOrEqual / toBeGreaterThanOrEqual / toBeLessThan / toBeGreaterThan:
 *               a bound the no-op host meets (1 <= 1, 0 >= 0) — the #1636 no-refire leg.
 *   H2 loop   — every expect sits inside a for/forEach over a collection, and no
 *               expect on that collection's size precedes it: an empty list asserts nothing.
 *   H3 guard  — expects only under `if (…)` with no softSkip/else on the other branch:
 *               the condition false ⇒ the leg records executed-pass on its other assertions.
 *   H4 self   — the expected value is a literal the test itself sent in the same block
 *               (echo check), or `.toBeDefined()`/`.toBeTruthy()` on a freshly built object.
 *   H5 ledger — the only witness is the host's own ledger/projection read back
 *               (`/effects`, `/events`, `/ledger`), with no suite-owned receiver count.
 *
 * Output: JSON lines { rfc, requirementId, file, line, title, shapes[] } on stdout.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RFCS = join(ROOT, 'RFCS');
const SCEN = join(ROOT, 'conformance', 'src', 'scenarios');

// Accepted RFCs → ids named in their Falsifiability tables.
const accepted = new Map(); // id -> rfc
for (const f of readdirSync(RFCS).filter((n) => /^\d{4}-.*\.md$/.test(n))) {
  const t = readFileSync(join(RFCS, f), 'utf8');
  if ((/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(t) ?? [])[1] !== 'Accepted') continue;
  const table = t.split(/^### Falsifiability[^\n]*$/m)[1]?.split(/^## /m)[0] ?? '';
  for (const m of table.matchAll(/openwop\.requirement\.[a-z0-9.-]+/g)) if (!accepted.has(m[0])) accepted.set(m[0], f.slice(0, 4));
}

const records = JSON.parse(readFileSync(join(ROOT, 'conformance', 'requirements.json'), 'utf8')).records;
const fileCache = new Map();
const src = (f) => { if (!fileCache.has(f)) fileCache.set(f, readFileSync(join(SCEN, f), 'utf8')); return fileCache.get(f); };

/** The it() block starting at 1-based `line`: from that line to its balanced close. */
function block(text, line) {
  const lines = text.split('\n');
  let depth = 0, started = false, out = [];
  for (let i = line - 1; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth <= 0) break;
  }
  return out.join('\n');
}

const covered = (id, ex) => ex === id || ex.startsWith(`${id}.`);
let n = 0;
for (const rec of records) {
  if (!rec.explicitId || !rec.file) continue;
  const rfcId = [...accepted.keys()].find((id) => covered(id, rec.explicitId));
  if (!rfcId) continue;
  let text; try { text = src(rec.file); } catch { continue; }
  const b = block(text, rec.line);
  const shapes = [];
  if (/\.toBe(Less|Greater)Than(OrEqual)?\(/.test(b)) shapes.push('H1-bound');
  const expects = [...b.matchAll(/expect\(/g)].length;
  const loopExpects = (b.match(/for \(const [^)]+ of [^)]+\)\s*\{[\s\S]*?expect\(/g) ?? []).length + (b.match(/\.forEach\([\s\S]*?expect\(/g) ?? []).length;
  if (loopExpects > 0 && !/\.length[^;\n]*\)\.(toBe|toBeGreaterThan)|toHaveLength|\.size[^;\n]*\)\.(toBe|toBeGreaterThan)/.test(b)) shapes.push('H2-loop-unsized');
  const guarded = (b.match(/\bif \([^)]*\)\s*\{?\s*\n?\s*expect\(/g) ?? []).length;
  if (guarded > 0 && guarded >= expects - 1) shapes.push('H3-guarded');
  if (/\.toBe(Defined|Truthy)\(\)/.test(b)) shapes.push('H4-defined');
  if (/\/(effects|ledger)\b/.test(b) && !/receiver|received|deliveries|hits|count\(/i.test(b)) shapes.push('H5-own-ledger');
  if (shapes.length === 0) continue;
  n++;
  process.stdout.write(`${JSON.stringify({ rfc: accepted.get(rfcId), requirementId: rec.explicitId, file: rec.file, line: rec.line, title: rec.title, shapes })}\n`);
}
process.stderr.write(`audit-unfailable-legs: ${accepted.size} Accepted-RFC falsifiability ids; ${n} candidate legs\n`);
