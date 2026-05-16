import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      // Allow Vite to serve files from the workflow-engine root so the
      // FE can import the shared providers.json sibling. By default
      // Vite blocks files outside the FE project root.
      allow: [resolve(__dirname, '..', '..')],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
