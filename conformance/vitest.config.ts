import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `src/scenarios/**/*.test.ts` are the host-targeted conformance
    // scenarios; `src/lib/**/*.test.ts` are server-free unit tests for
    // suite-internal helpers (e.g., the synthetic OIDC issuer harness)
    // that don't depend on OPENWOP_BASE_URL.
    include: ['src/scenarios/**/*.test.ts', 'src/lib/**/*.test.ts'],
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
    // RFC 0148 §A run-end disposition summary. `setup.ts` records an honest
    // disposition per scenario file on EVERY run; before this, only
    // `--certify` set OPENWOP_LEDGER_PATH, so on a plain `vitest run` the
    // recording was computed and then discarded, leaving "N passed" as the
    // sole artifact for rows the suite had classified `blocked`. This routes
    // the ledger to a temp file and prints what did not witness.
    globalSetup: ['src/global-setup.ts'],
  },
});
