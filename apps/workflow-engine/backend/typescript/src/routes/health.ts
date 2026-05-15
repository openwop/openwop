import type { Express } from 'express';

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readiness', (_req, res) => {
    // Sample: ready when the process is up. Real impls check storage
    // connectivity, secret manager, downstream services.
    res.json({ status: 'ready' });
  });
}
