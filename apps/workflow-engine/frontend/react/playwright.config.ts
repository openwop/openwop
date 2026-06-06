import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config (GAP-ANALYSIS E16). Boots the Vite dev server and runs
 * the smoke specs in e2e/. NOTE: requires browsers once via
 * `npx playwright install chromium`, and a backend on :8080 (or
 * OPENWOP_DEV_PROXY_TARGET) for the data-dependent specs. Kept out of the
 * default `npm test` (vitest) — run with `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
