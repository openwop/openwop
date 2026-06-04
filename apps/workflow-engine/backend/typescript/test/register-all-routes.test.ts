/**
 * Centralized-registration guard (white-label PRD §3).
 *
 * The CoLabCare fork shipped a route file that 404'd in production because
 * its `registerXRoutes(app)` call was forgotten in index.ts. This test makes
 * that bug impossible: every `register*Route(s)` export under `src/routes/`
 * MUST be referenced by `src/routes/registerAllRoutes.ts` (the one ordered
 * module list index.ts mounts). Add the module to the list — or, for a
 * deliberately unmounted module, add it to the documented allowlist below.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(__dirname, '..', 'src', 'routes');
const REGISTRAR = join(ROUTES_DIR, 'registerAllRoutes.ts');

/** Modules deliberately NOT mounted by registerAllRoutes (document why). */
const UNMOUNTED_ALLOWLIST = new Set<string>([
  // (none today)
]);

describe('registerAllRoutes — every routes/ module is mounted', () => {
  it('lists every register* export from src/routes/', () => {
    const registrarSource = readFileSync(REGISTRAR, 'utf8');
    const missing: string[] = [];
    for (const file of readdirSync(ROUTES_DIR)) {
      if (!file.endsWith('.ts') || file === 'registerAllRoutes.ts') continue;
      const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
      for (const m of source.matchAll(/export (?:async )?function (register\w*Routes?)\b/g)) {
        const fn = m[1];
        if (UNMOUNTED_ALLOWLIST.has(fn)) continue;
        if (!registrarSource.includes(fn)) missing.push(`${fn} (${file})`);
      }
    }
    expect(
      missing,
      `These route registrars are not mounted in registerAllRoutes.ts — a new domain can't ship unregistered: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('index.ts mounts through registerAllRoutes only (no stray register calls)', () => {
    const indexSource = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    const strays = [...indexSource.matchAll(/\bregister\w+Routes?\(/g)]
      .map((m) => m[0])
      .filter((c) => c !== 'registerAllRoutes(');
    expect(
      strays,
      `index.ts must not hand-mount route modules — move these into routes/registerAllRoutes.ts: ${strays.join(', ')}`,
    ).toEqual([]);
  });
});
