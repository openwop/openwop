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
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      fs: {
        // Allow Vite to serve files from the workflow-engine root so
        // the frontend can import the shared providers.json sibling.
        // By default Vite blocks files outside the project root.
        allow: [resolve(__dirname, '..', '..')],
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
