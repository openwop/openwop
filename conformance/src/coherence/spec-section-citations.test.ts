/**
 * spec-section-citations — server-free. A citation of the form
 * `<doc>.md §"<Section>"` MUST resolve to a heading that exists in that doc.
 *
 * SP-04 (2026-08-18): `storage-adapters.md §"Claim acquisition"` was cited by
 * FOUR artifacts — `production-profile.md` §Durability, RFC 0009's
 * scenario-citation table, and the docstrings of `staleClaim.test.ts` and
 * `restart-during-run.test.ts` — and the section did not exist. Nothing was
 * checking, so a normative `MUST` ("Storage adapters MUST satisfy
 * `storage-adapters.md` lease and event-log invariants") pointed at nothing for
 * the life of RFC 0009.
 *
 * Scope is deliberately narrow. A corpus-wide sweep of this citation form finds
 * ~1400 citations and ~260 that do not resolve under a heading-only matcher —
 * a mix of genuinely dangling anchors and legitimate informal references to
 * table rows and capability keys rather than headings. Triaging those is its own
 * work item; gating the whole corpus on an untriaged sweep would either fail
 * immediately or need an allowlist so large it would stop meaning anything.
 * So this pins the docs whose section citations are load-bearing for the
 * durability contract, and grows as other docs are triaged.
 *
 * @see spec/v1/storage-adapters.md §"Claim acquisition"
 * @see spec/v1/production-profile.md §Durability
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR, SCENARIOS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

/** Docs whose `§"Section"` citations are checked. Add a doc once its citations are triaged. */
const CHECKED_DOCS = ['storage-adapters.md', 'production-profile.md'] as const;

/** `<doc>.md §"Quoted Section"` or `<doc>.md §BareToken`. */
const CITATION = /([A-Za-z0-9._-]+)\.md\s*§\s*(?:"([^"\n]+)"|([A-Za-z][A-Za-z0-9.-]*))/g;

/**
 * Strip decoration, a leading `§` (headings in this corpus carry their own), and
 * trailing sentence punctuation — a docstring legitimately ends a sentence
 * inside the quotes (`… §"Claim acquisition."`) and still names that section.
 */
const normalize = (t: string): string =>
  t
    .replace(/[`*_"]/g, '')
    .replace(/^§\s*/, '')
    .replace(/[.,;:]+$/, '')
    .trim()
    .toLowerCase();

/** A heading matches its full text, or its lead token before an em-dash / period. */
function headingKeys(raw: string): string[] {
  const h = normalize(raw);
  const keys = new Set<string>([h]);
  const dash = h.split(/\s+[—–-]\s+/)[0]?.trim();
  if (dash) keys.add(dash);
  const dot = h.split(/\.\s+/)[0]?.trim();
  if (dot) keys.add(dot);
  return [...keys];
}

function walk(dir: string, keep: (n: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

describe.skipIf(V1_DIR === null)('spec-section-citations (SP-04)', () => {
  it('every cited section of a checked doc exists as a heading in that doc', () => {
    const v1 = V1_DIR as string;
    // `V1_DIR` is `<repo>/spec/v1` in a checkout; RFCS/ sits two levels up.
    // Both are absent from the published tarball, which is why the whole file
    // is `skipIf(V1_DIR === null)`.
    const rfcsDir = join(v1, '..', '..', 'RFCS');

    const sources = [
      ...walk(v1, (n) => n.endsWith('.md')),
      ...(existsSync(rfcsDir) ? walk(rfcsDir, (n) => n.endsWith('.md')) : []),
      ...(SCENARIOS_DIR !== null ? walk(SCENARIOS_DIR, (n) => n.endsWith('.test.ts')) : []),
    ];

    const headings = new Map<string, Set<string>>();
    for (const doc of CHECKED_DOCS) {
      const text = readFileSync(join(v1, doc), 'utf8');
      const keys = new Set<string>();
      for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
        for (const k of headingKeys(m[1] ?? '')) keys.add(k);
      }
      headings.set(doc, keys);
    }

    const dangling: string[] = [];
    let checked = 0;
    for (const src of sources) {
      const text = readFileSync(src, 'utf8');
      for (const m of text.matchAll(CITATION)) {
        const doc = `${m[1]}.md`;
        const keys = headings.get(doc);
        if (!keys) continue;
        const section = (m[2] ?? m[3] ?? '').trim();
        if (!section) continue;
        checked++;
        const want = normalize(section);
        // A MULTI-WORD citation must match a heading key exactly: prefix
        // matching would let `§"Claim acquisition"` be satisfied by a heading
        // named `Claim acquisition considered harmful`, which is how a renamed
        // section slips past a gate like this (caught while sabotage-testing
        // this very leg). A single-token citation — `§B`, `§C.2`,
        // `§host.aiProviders` — legitimately prefixes a longer heading
        // (`## §B — Channel resolution …`), so prefix matching stays for those.
        const hit = keys.has(want)
          || (!want.includes(' ') && [...keys].some((k) => k.startsWith(want)));
        if (!hit) dangling.push(`${src.split('/').slice(-2).join('/')} → ${doc} §"${section}"`);
      }
    }

    // Non-vacuity: these docs ARE cited. A zero here means the matcher stopped
    // matching, not that the corpus got clean — the failure mode this file exists
    // to prevent, one level up.
    expect(
      checked,
      req('openwop.it.spec-section-citations.every-cited-section-of-a-checked-doc-exists-as-a-heading-in-that-doc', 'storage-adapters.md §"Claim acquisition', 'spec-section-citations: no citations of the checked docs were found — the matcher is broken, not the corpus clean'),
    ).toBeGreaterThan(0);

    expect(
      dangling,
      req('openwop.it.spec-section-citations.every-cited-section-of-a-checked-doc-exists-as-a-heading-in-that-doc', 'storage-adapters.md §"Claim acquisition', `dangling section citations (the cited heading does not exist):\n  ${dangling.join('\n  ')}`),
    ).toEqual([]);
  });
});
