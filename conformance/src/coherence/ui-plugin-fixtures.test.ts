/**
 * RFC 0238 §D — the `ui-plugin-pack-narrow` fixture pack is a well-formed
 * v2 frontend-plugin manifest with exactly the shape its legs depend on: one
 * plugin, `narrow`, declaring only `artifact.read` and no `connectSrc`.
 *
 * Corpus-only (it reads no host), so it lives in `src/coherence/` and never in a
 * host bundle (`spec/v2/core/conformance.md` §Two products).
 *
 * @see RFCS/0238-ui-plugin-observation-path.md §D
 * @see spec/v2/core/packs.md §Front-end plugin packs
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR, V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const DIR = join(FIXTURES_DIR, 'frontend-plugin-packs');
const DOC = 'RFCS/0238-ui-plugin-observation-path.md §D';
const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';

describe('ui-plugin fixtures (RFC 0238 §D)', () => {
  type Manifest = { uiPlugins: Array<{ pluginId: string; entry: string; hostApi: string[]; connectSrc?: string[] }> };
  const load = (): Manifest => JSON.parse(readFileSync(join(DIR, 'ui-plugin-pack-narrow.json'), 'utf8')) as Manifest;

  it('ui-plugin-pack-narrow validates against the v2 frontend-plugin manifest schema', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const manifest = load();
    const r = v2Validator('frontend-plugin-manifest')(manifest);
    expect(r.ok ? '' : r.errors, req('openwop.it.ui-plugin-fixtures.ui-plugin-pack-narrow-validates-against-the-v2-frontend-plugin-manifest-s', DOC, 'the fixture pack is a valid v2 frontend-plugin manifest')).toBe('');
  });

  it('declares one plugin, narrow, with only artifact.read and no connectSrc, and ships its entry', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const manifest = load();
    const [p] = manifest.uiPlugins;
    const shape = { count: manifest.uiPlugins.length, pluginId: p?.pluginId, hostApi: p?.hostApi, connectSrc: p?.connectSrc ?? null, entry: existsSync(join(DIR, p?.entry ?? '')) };
    expect(shape, req('openwop.it.ui-plugin-fixtures.declares-one-plugin-narrow-with-only-artifact-read-and-no-connectsrc-and-ships-its', DOC, 'the legs depend on exactly this shape')).toEqual({ count: 1, pluginId: 'narrow', hostApi: ['artifact.read'], connectSrc: null, entry: true });
  });
});
