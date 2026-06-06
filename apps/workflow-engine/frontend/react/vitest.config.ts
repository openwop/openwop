import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Test runner config (GAP-ANALYSIS F1). Mirrors the two vite.config.ts pieces
// the test graph needs: the React plugin (JSX/TSX transform) and the
// webhook-helpers stub (the @openwop/openwop barrel re-exports node:crypto
// HMAC helpers that would otherwise fail to resolve under the test bundler).
// Vite resolves the codebase's `.js` import specifiers to their `.ts(x)`
// sources automatically, so tests import exactly as app code does.
const stubWebhookHelpers: Plugin = {
  name: 'openwop-stub-webhook-helpers',
  enforce: 'pre',
  load(id: string) {
    if (/[/\\]@openwop[/\\]openwop[/\\]dist[/\\]webhook-helpers\.js$/.test(id)) {
      return 'export {};';
    }
    return null;
  },
};

export default defineConfig({
  plugins: [react(), stubWebhookHelpers],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
