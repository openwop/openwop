/**
 * Comprehensive demo seed orchestrator.
 *
 * Today the stock seed is centered on the agent-coworker demo, but that one
 * seed already writes the surfaces a first visitor expects to see: inventory
 * agents, roster entries, boards, cards, schedules, and the org chart. Keep
 * the domain list explicit so future host-extension domains can register here
 * and tests can prove the first-load seed stays comprehensive.
 */

import { seedDemoAgents, type SeedResult } from './demoSeed.js';
import type { Storage } from '../storage/storage.js';

export const DEMO_SEED_DOMAINS = [
  'user-agents',
  'roster',
  'boards',
  'cards',
  'schedules',
  'org-chart',
] as const;

export type DemoSeedDomain = (typeof DEMO_SEED_DOMAINS)[number];

export interface SeedEverythingResult extends SeedResult {
  domains: DemoSeedDomain[];
}

export async function seedEverything(tenantId: string, storage: Storage): Promise<SeedEverythingResult> {
  const result = await seedDemoAgents(tenantId, storage);
  return {
    ...result,
    domains: result.agents > 0 ? [...DEMO_SEED_DOMAINS] : [],
  };
}
