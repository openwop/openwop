/**
 * Conformance harness — boots the sample backend in-process and runs
 * `@openwop/openwop-conformance` against it.
 *
 * Usage:
 *   npm run test:conformance           # boots in-process, runs full suite
 *   npm run test:conformance -- --filter discovery   # subset
 *
 * Exit code is the conformance CLI's exit code. CI gates on this.
 *
 * Honest expectations: this sample stubs more than the postgres
 * reference host (no Ed25519 audit chain, no durable webhook queue,
 * no production-profile claim). The pass-matrix in the README
 * documents which scenarios skip-equivalent and why.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp, loadConfigFromEnv } from '../src/index.js';

const PORT = 18080;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_KEY = process.env.OPENWOP_CONFORMANCE_API_KEY ?? 'sample-conformance-token';

async function main(): Promise<void> {
  // Boot in-process. Use the in-memory storage backend so the suite
  // gets a clean slate per process. Wire the conformance API key into
  // the BE's auth allowlist so authed requests succeed.
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.PORT = String(PORT);
  process.env.OPENWOP_API_KEY = API_KEY;
  // Conformance-only env. Both flags are spec-aligned for a black-box
  // suite run; production deploys NEVER set these.
  // - RATELIMIT_DISABLED: the suite issues 1200+ requests in a short
  //   window. The sample's per-IP rate limiter (60 req/min default)
  //   would otherwise 429-cascade and mask real failures.
  // - AUTH_DISABLE_COOKIES: the suite asserts 401 on missing
  //   credentials per `auth.md §3`. Default behavior auto-issues an
  //   anon session cookie, which silently grants access and shifts
  //   the 401 to a 200/201.
  process.env.OPENWOP_RATELIMIT_DISABLED = 'true';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  // Test seam needs enabling for envelope/accept, capability-toggle,
  // llm-prompt-wrap, and the variables mutation seam.
  process.env.OPENWOP_TEST_SEAM_ENABLED = 'true';

  const app = await createApp({
    ...loadConfigFromEnv(),
    port: PORT,
    storageDsn: 'memory://',
  });

  await new Promise<void>((res) => {
    const server = app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`[conformance] sample backend listening at ${BASE_URL}`);
      res();
      // Keep `server` referenced so it doesn't GC.
      void server;
    });
  });

  // Resolve the conformance CLI path. Falls back to the npm-installed
  // binary in node_modules/.bin.
  const cliPath = resolve('node_modules', '@openwop', 'openwop-conformance', 'dist', 'cli.js');
  const args = process.argv.slice(2);
  const child = spawn('node', [cliPath, '--base-url', BASE_URL, '--api-key', API_KEY, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENWOP_BASE_URL: BASE_URL,
      OPENWOP_API_KEY: API_KEY,
      OPENWOP_IMPLEMENTATION_NAME: 'openwop-workflow-engine-sample',
      OPENWOP_IMPLEMENTATION_VERSION: '0.1.0',
    },
  });

  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log(`[conformance] suite exited with code ${code}`);
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[conformance] harness error:', err);
  process.exit(1);
});
