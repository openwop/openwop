/**
 * RFC 0192 — the facet advertisement semantic, and the generator that stops the
 * 27th `supported` ghost.
 *
 * Corpus-gate only (RFC 0168 §D.1). §C's row says the generator REFUSES to emit
 * a description conditioning on a field v2 retired — so this sabotages a facet
 * override and asserts the refusal, rather than asserting exit 0 against a tree
 * that is already clean. A bare exit-0 wrapper would pass just as happily with
 * the guard deleted, which is the vacuous-witness shape this corpus keeps
 * catching in others.
 *
 * @see RFCS/0192-facet-advertisement.md
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

/**
 * Sabotage runs against a THROWAWAY COPY of the corpus, never the working tree.
 *
 * These tests prove a gate REFUSES something, which means mutating a tracked
 * file. Doing that in place races every other coherence test in the same vitest
 * run — v2-spec-artifacts-digest compares the packed tree against the corpus and
 * fails if it observes the tree mid-sabotage. The copy removes the race instead
 * of sequencing around it.
 */
function inScratchCorpus(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-sabotage-'));
  try {
    for (const p of ['scripts', 'spec', 'schemas', 'docs', 'evidence']) {
      cpSync(join(root, p), join(dir, p), { recursive: true });
    }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const GEN = 'generate-from-declaration.mjs';

const CAPS_MD = join(root, 'spec', 'v2', 'core', 'capabilities.md');

const tail = (r: SpawnSyncReturns<string>): string =>
  (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
const run = (cwd: string = root) => spawnSync('node', [join(cwd, 'scripts', GEN)], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

describe('v2-facet-advertisement (RFC 0192 §A–§C)', () => {
  it('the rule is stated where the family rule lives', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const md = readFileSync(CAPS_MD, 'utf8');
    const row = md.split('\n').find((l) => l.startsWith('| facets |')) ?? '';
    expect(/presence of its key/.test(row) && /MUST omit the key/.test(row) && /meaning for its absence/.test(row),
      req('openwop.requirement.0192.facet-presence', 'RFC 0192 §A', `capabilities.md §2's facets row states presence-semantics WITH the absence exception that memory.writable depends on — got: ${row.slice(0, 160)}`)).toBe(true);
  }, 60_000);

  it('the generator refuses to emit a description conditioning on a retired field', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    inScratchCorpus((dir) => {
      const override = join(dir, 'spec', 'v2', 'facets', 'packs.schema.json');
      const doc = JSON.parse(readFileSync(override, 'utf8')) as { properties: Record<string, { description?: string }> };
      doc.properties['testMode'] = { ...doc.properties['testMode'], description: 'Hosts that advertise `supported: true` MUST honor the isolation guarantees.' };
      writeFileSync(override, `${JSON.stringify(doc, null, 2)}\n`);
      const sab = run(dir);
      const refused = sab.status !== 0 && /supported/.test(tail(sab));
      const clean = run();
      expect(refused && clean.status === 0,
        req('openwop.requirement.0192.no-supported-ghost', 'RFC 0192 §B/§C', `a MUST conditioned on \`supported\` cannot reach a published artifact: the generator fails by path on a reintroduced ghost (${refused}) and the committed tree carries none (${clean.status === 0}) — ${tail(sab)}`)).toBe(true);
    });
  }, 180_000);

});
