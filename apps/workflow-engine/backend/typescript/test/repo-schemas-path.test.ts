/**
 * Pinning test for the `locateRepoSchemasDir()` contract.
 *
 * Regression guard for commit `d09d99c` (2026-05-23). The workflow-engine
 * is built in two layouts — source-tree (`src/host/<file>.ts`, six levels
 * deep from repo root) and esbuild-bundled (`lib/index.js`, four levels
 * deep). A `resolve(__dirname, '..' × 6, 'schemas')` pattern resolved
 * correctly under the source tree but overshot the repo root under the
 * bundled tree, crashing the host at first envelope-accept call.
 *
 * `host/_repoPath.ts:locateRepoSchemasDir(fromDir, sentinelFile)` solves
 * the bug by walking parents until a sibling `schemas/` containing the
 * sentinel is found. This test verifies the contract on the source-tree
 * layout (which is what we test under). A separate integration test
 * would be needed to verify the bundled-tree layout — out of scope for
 * a fast unit test.
 *
 * The test also asserts that `envelopeAcceptor.ts` and `promptPackLoader.ts`
 * — the two consumers that hit this bug — successfully locate the
 * schemas directory at module load via the helper.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locateRepoSchemasDir } from '../src/host/_repoPath.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('host/_repoPath: locateRepoSchemasDir', () => {
  it('locates the repo schemas/ directory under the source-tree layout', () => {
    const dir = locateRepoSchemasDir(__dirname, 'ai-envelope.schema.json');
    expect(basename(dir)).toBe('schemas');
    expect(existsSync(join(dir, 'ai-envelope.schema.json'))).toBe(true);
  });

  it('locates the same schemas/ directory regardless of sentinel filename', () => {
    const dir1 = locateRepoSchemasDir(__dirname, 'ai-envelope.schema.json');
    const dir2 = locateRepoSchemasDir(__dirname, 'prompt-pack-manifest.schema.json');
    expect(dir1).toBe(dir2);
  });

  it('throws when the sentinel cannot be found anywhere in the parent chain', () => {
    expect(() =>
      locateRepoSchemasDir(__dirname, 'this-schema-cannot-possibly-exist.schema.json'),
    ).toThrow(/walked from .* to filesystem root/);
  });

  it('envelopeAcceptor.ts loads its schema at module-load via the helper (no ENOENT)', async () => {
    // This `import` runs envelopeAcceptor.ts's top-level
    // `locateRepoSchemasDir(__dirname, 'ai-envelope.schema.json')`. If
    // the bundled-tree bug regressed, this import would throw the
    // walk-failed error from _repoPath.ts (the helper) OR an ENOENT
    // from readFileSync (the old buggy fallback). Either is a regression.
    await expect(import('../src/host/envelopeAcceptor.js')).resolves.toBeDefined();
  });

  it('promptPackLoader.ts loads its schema at module-load via the helper (no ENOENT)', async () => {
    await expect(import('../src/host/promptPackLoader.js')).resolves.toBeDefined();
  });
});
