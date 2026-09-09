import { defineConfig } from 'vitest/config';
// Suite 2.0.0 (RFC 0168 §D.1): the corpus-coherence scenarios. Run by
// scripts/check-spec-coherence.mjs in the spec repo's CI; never in a host run,
// never packed. They need a spec checkout (OPENWOP_CONFORMANCE_ROOT or the
// repo layout) and no host.
export default defineConfig({
  test: {
    include: ['src/coherence/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    reporters: ['default'],
    bail: 0,
    setupFiles: ['src/setup.ts'],
    globalSetup: ['src/global-setup.ts'],
  },
});
