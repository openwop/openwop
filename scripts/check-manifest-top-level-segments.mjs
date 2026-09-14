#!/usr/bin/env node
/**
 * check-manifest-top-level-segments — adding a top-level name to the manifest
 * is a retirement hazard, so it must be deliberate.
 *
 * `versioning.md` §5: *"Retirement flips every header-less request's contract.
 * Through the overlap a header-less request on an unversioned name is served
 * major 1 … At end-of-support the same request is served major 2 and the page
 * starts answering the operation. A `/v1/`-counting inventory cannot see this.
 * Test: `manifest top-level segments ∩ anything else served unversioned`."*
 *
 * That test has two halves and only one of them is the corpus's. What a host
 * serves unversioned — a marketing page, a public catalog, a health endpoint —
 * is a fact about that host, and the tier-2 host implemented its half after
 * finding five such roots its own `/v1` sweep could not see. The corpus's half
 * is the OTHER operand: the set of top-level names the manifest claims. Nothing
 * checked it, so the set could grow silently and every host's intersection
 * would change under it without a single host being told.
 *
 * The live example, measured 2026-09-13: `packs` is a declared family in
 * `spec/v2/declaration.json` and is NOT a manifest segment — so the tier-2
 * host's public `/packs/v1/**` catalog does not collide today. The day a
 * manifest operation lands under `/packs`, it would, and at retirement that
 * catalog would begin answering a protocol operation. This gate is what makes
 * that day loud.
 *
 * This is a PIN, not a rule: it does not say which segments are allowed, only
 * that changing the set is a decision someone made on purpose. Update PINNED
 * in the same commit that changes the manifest, having first confirmed that no
 * host in `INTEROP-MATRIX.md` serves the new name unversioned for something
 * else.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The manifest's top-level names, as of corpus 2.1.6. Changing this list is the
 * point: it is the acknowledgement that the §5 intersection just moved.
 */
const PINNED = [
  '.well-known', 'agents', 'audit', 'content', 'host', 'interrupts',
  'openapi.json', 'prompts', 'prompts:render', 'runs', 'runs:bulk-cancel',
  'tools', 'trigger-subscriptions', 'webhooks', 'workflows',
];

const manifest = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'path-manifest.json'), 'utf8'));
const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
if (operations.length === 0) {
  console.error('✗ check-manifest-top-level-segments: the manifest lists no operations — an empty sweep is a broken instrument, not an empty intersection');
  process.exit(1);
}

const actual = [...new Set(operations.map((o) => String(o.path ?? '').split('/')[1]).filter(Boolean))].sort();
const pinned = [...PINNED].sort();
const added = actual.filter((s) => !pinned.includes(s));
const removed = pinned.filter((s) => !actual.includes(s));

if (added.length || removed.length) {
  console.error('✗ check-manifest-top-level-segments — the manifest\'s top-level name set changed:');
  for (const s of added) console.error(`   + ${s}  (NEW top-level name)`);
  for (const s of removed) console.error(`   - ${s}  (no longer claimed)`);
  console.error('');
  console.error('  versioning.md §5: at v1 end-of-support every header-less request on an unversioned');
  console.error('  name flips from major 1 to major 2, so a page or catalog already served at one of');
  console.error('  these names starts answering a protocol operation. Before updating PINNED, check');
  console.error('  that no host in INTEROP-MATRIX.md serves the new name unversioned for something else.');
  console.error('  Then update PINNED in this file, in the same commit, and say so in the CHANGELOG.');
  process.exit(1);
}

// Context, not a failure: a family sharing a manifest segment's name is normal
// (the operation and the capability describe the same surface). A family that
// does NOT is where a future collision would come from — `packs` is the one
// with a known host-side catalog at that name.
const declaration = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'declaration.json'), 'utf8'));
const families = (declaration.families ?? []).filter((f) => f.kind === 'family').map((f) => f.key);
const shared = actual.filter((s) => families.includes(s));
console.log(`=== check-manifest-top-level-segments OK — ${actual.length} top-level name(s), unchanged from the pin ===`);
console.log(`  ${shared.length} also name a declared family (${shared.join(', ')}) — the operation and the capability describing one surface.`);
console.log('  Known host-side hazard if ever added: `packs` (a declared family, not a manifest segment; a tier-2 host serves a public /packs/v1/** catalog there).');
