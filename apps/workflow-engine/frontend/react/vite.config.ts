import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { resolveBrandFromEnv } from './src/brand/defaults';

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
      // Dev-server `/api` proxy: forward `/api/*` from the dev server to a
      // backend so the SPA and the API share an origin from the browser's POV
      // (the __session cookie then travels naturally on credentials: 'include'
      // fetches). Keeps the SPA on the same origin so cookies aren't dropped.
      //
      // DEFAULTS TO A LOCAL BACKEND (`http://localhost:8080`). This is critical
      // for white-label adopters: a remote default would silently route a
      // freshly-set-up app's dev traffic to whatever backend was baked in
      // (previously `https://app.openwop.dev` — i.e. the steward's backend),
      // leaking the adopter's data and load onto someone else's system. With a
      // local default, `npm run dev` hits the adopter's own backend (run it on
      // :8080 per WHITE-LABEL.md / DEPLOY.md).
      //
      // To proxy a REMOTE backend in dev (e.g. the steward running the SPA
      // against the deployed app.openwop.dev without a local backend), set
      // OPENWOP_DEV_PROXY_TARGET=https://app.openwop.dev in your shell or
      // `.env.local`. Phoning home is now opt-in, never the default.
      proxy: {
        '/api': {
          target: process.env.OPENWOP_DEV_PROXY_TARGET ?? 'http://localhost:8080',
          changeOrigin: true,
          secure: true,
          // Strip Set-Cookie's Domain attribute so cookies bind to the
          // browser-visible origin (`localhost`) rather than the upstream
          // backend's domain — otherwise the browser drops them.
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
        // White-label: stamp the brand document title, favicon, and font
        // stylesheet into index.html at build time from `VITE_BRAND_*`
        // env (falling back to `BRAND_DEFAULTS`). Runs for both `vite dev`
        // and `vite build`. The `{{BRAND_*}}` placeholders in index.html
        // are always replaced, so an un-overridden build renders the
        // stock OpenWOP identity. See `src/brand/defaults.ts`.
        name: 'openwop-brand-html',
        transformIndexHtml: {
          order: 'pre' as const,
          handler(html: string) {
            const brand = resolveBrandFromEnv(loadEnv(mode, __dirname, ''));
            return html
              .replaceAll('{{BRAND_TITLE}}', brand.documentTitle)
              .replaceAll('{{BRAND_FAVICON}}', brand.faviconSrc)
              .replaceAll('{{BRAND_FONTS_HREF}}', brand.fontsHref);
          },
        },
      },
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
