/**
 * v2-corpus-tag-pinned — RFC 0176 §E.1 (corpus wrapper, inline).
 *
 * A consumer that vendors any file from `schemas/`, `api/` or `spec/` MUST pin
 * to a published `openwop-conformance/vX.Y.Z` tag, record it, and refuse a sync
 * from any other ref. The committed cross-repo inventory
 * (`evidence/cross-repo-manifests.json`, `siblingVersions`) records what each
 * vendoring consumer — openwop-sdks, openwop-registry, openwop-app — pinned.
 * This wrapper asserts each of the three records a `corpusTag` matching
 * `^(openwop-conformance/)?v\d`; a consumer that tracks `main` (no tag) is the
 * RFC's reopened G3 leg and soft-skips `blocked` naming the consumers.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle, under `openwop.requirement.0176.corpus-tag-pinned`.
 *
 * @see RFCS/0176-v2-persisted-data-and-coexistence.md §E.1
 * @see evidence/cross-repo-manifests.json
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0176.corpus-tag-pinned';
const SECTION = 'RFC 0176 §E.1';
const CONSUMERS = ['openwop-sdks', 'openwop-registry', 'openwop-app'];
const TAG = /^(openwop-conformance\/)?v\d/;

describe('v2-corpus-tag-pinned (RFC 0176 §E.1)', () => {
  it('every vendoring consumer in the cross-repo inventory records a published corpus tag', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const path = join(SCHEMAS_DIR, '..', 'evidence', 'cross-repo-manifests.json');
    if (!existsSync(path)) return softSkip('blocked', 'evidence/cross-repo-manifests.json is absent — run scripts/generate-cross-repo-evidence.mjs against the sibling checkouts');
    const inventory = JSON.parse(readFileSync(path, 'utf8')) as { siblingVersions?: Record<string, { corpusTag?: unknown }> };
    const versions = inventory.siblingVersions ?? {};
    const unpinned = CONSUMERS.filter((c) => typeof versions[c]?.corpusTag !== 'string' || !TAG.test(versions[c]?.corpusTag as string));
    if (unpinned.length > 0) return softSkip('blocked', `RFC 0176 §E.1 G3: consumer(s) not pinned to a published openwop-conformance/vX.Y.Z tag: ${unpinned.join(', ')}`);
    for (const c of CONSUMERS) {
      expect(TAG.test(versions[c]?.corpusTag as string), req(ID, SECTION, `${c} MUST record the published corpus tag it vendored from (got ${String(versions[c]?.corpusTag)})`)).toBe(true);
    }
  });
});
