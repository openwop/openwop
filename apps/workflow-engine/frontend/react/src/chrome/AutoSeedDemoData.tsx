import { useEffect } from 'react';
import { seedDemoAgents } from '../agents/rosterClient.js';

let started = false;

/**
 * Public demo deployments use cookie-per-visitor tenancy, so any deep link can
 * be the first route a fresh anonymous tenant sees. Fire the idempotent seed
 * once per page load from the shell instead of only from `/agents`.
 */
export function AutoSeedDemoData(): null {
  useEffect(() => {
    if (started) return;
    started = true;
    void seedDemoAgents().catch((err) => {
      console.warn('auto demo seed failed', err);
    });
  }, []);

  return null;
}
