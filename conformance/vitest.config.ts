import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/scenarios/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    reporters: ['default'],
    bail: 0,
    // RFC 0003 — load the host's `/.well-known/openwop` `fixtures` array
    // before any scenario file imports. Top-level await in setupFiles
    // populates `lib/fixtures.ts` so `describe.skipIf(...)` predicates
    // see the cached set when scenarios register their tests.
    setupFiles: ['src/setup.ts'],
  },
});
