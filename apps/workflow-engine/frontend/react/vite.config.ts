import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite inlines `import.meta.env.VITE_*` at build time, NOT at runtime.
// A production build with `VITE_OPENWOP_BASE_URL` unset bakes the dev
// fallback (`http://localhost:8080`) into the bundle and silently
// ships a broken deploy — the page tries to fetch localhost on every
// visitor's machine.
//
// Defense in depth on top of `.env.production`: assert the var is
// present + non-default whenever `mode === 'production'`. Catches the
// failure mode where `.env.production` is missing, gitignored, or
// renamed. Errors at config-resolution time so no broken bundle is
// ever produced.
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const env = loadEnv(mode, __dirname, '');
    const baseUrl = env.VITE_OPENWOP_BASE_URL;
    if (!baseUrl || baseUrl === 'http://localhost:8080') {
      throw new Error(
        `[openwop] Production build aborted — VITE_OPENWOP_BASE_URL must be set and non-default ` +
          `(got: ${baseUrl ?? '<unset>'}). Define it in ` +
          `apps/workflow-engine/frontend/react/.env.production, in a .env.production.local ` +
          `override, or pass it on the command line.`,
      );
    }
  }

  return {
    server: {
      port: 5173,
      strictPort: false,
      fs: {
        // Allow Vite to serve files from the workflow-engine root so
        // the frontend can import the shared providers.json sibling.
        // By default Vite blocks files outside the project root.
        allow: [resolve(__dirname, '..', '..')],
      },
      // Default-to-prod proxy: forward `/api/*` requests from the
      // dev server to the deployed backend at app.openwop.dev. Keeps
      // the SPA and the API on the same origin from the browser's
      // POV so the __session cookie travels naturally on
      // credentials: 'include' fetches.
      //
      // Override by setting OPENWOP_DEV_PROXY_TARGET=http://localhost:8080
      // (or another URL) in your shell or `.env.local` to point at a
      // locally-running backend instead.
      proxy: {
        '/api': {
          target: process.env.OPENWOP_DEV_PROXY_TARGET ?? 'https://app.openwop.dev',
          changeOrigin: true,
          secure: true,
          // Strip Set-Cookie's Domain attribute so cookies bind to
          // `localhost` (the browser-visible origin) instead of
          // `app.openwop.dev` — otherwise the browser drops them.
          cookieDomainRewrite: '',
        },
      },
    },
    // The SDK's main barrel re-exports `verifyWebhookSignature` /
    // `signWebhookDelivery` from `./webhook-helpers.js`, which imports
    // `node:crypto`. Even though every frontend import from `@openwop/openwop`
    // is `import type {…}` (no runtime symbols needed), rollup's static
    // analysis pulls the whole barrel including the HMAC helpers, then
    // vite externalizes `node:crypto` and the build dies on unresolved
    // `createHmac` named export. A custom plugin short-circuits the load
    // step for any path ending in `webhook-helpers.js` and returns an
    // empty module — the frontend never executes the HMAC code path.
    plugins: [
      react(),
      {
        name: 'openwop-stub-webhook-helpers',
        enforce: 'pre',
        load(id) {
          if (/[/\\]@openwop[/\\]openwop[/\\]dist[/\\]webhook-helpers\.js$/.test(id)) {
            return 'export {};';
          }
          return null;
        },
      },
    ],
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Code-split the markdown stack into its own chunk. The chat
          // surface is the only consumer of react-markdown + remark-gfm
          // + their transitive unified/mdast/micromark deps (~250KB
          // minified, ~70KB gzip). Splitting keeps the main bundle
          // under the vite 500KB warning threshold and lets browsers
          // cache the markdown chunk independently of UI churn.
          manualChunks: {
            markdown: ['react-markdown', 'remark-gfm'],
          },
        },
      },
    },
  };
});
