import { defineConfig } from 'vitest/config';
// Suite 2.0.0: the suite's own self-tests (src/lib/*.test.ts). Not host
// scenarios; not packed.
export default defineConfig({
  test: { include: ['src/lib/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000, globals: true, reporters: ['default'], bail: 0 },
});
