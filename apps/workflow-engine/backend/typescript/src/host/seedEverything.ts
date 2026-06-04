/**
 * Comprehensive demo seed orchestrator.
 *
 * Today the stock seed is centered on the agent-coworker demo, but that one
 * seed already writes the surfaces a first visitor expects to see: inventory
 * agents, roster entries, boards, cards, schedules, and the org chart. Keep
 * the domain list explicit so future host-extension domains can register here
 * and tests can prove the first-load seed stays comprehensive.
 *
 * HONESTY CONTRACT: `domains` reports what is VERIFIED present in the durable
 * stores after the seed ran — each entry is backed by a live read, never a
 * constant. A domain whose store is empty (seed disabled, partial failure, a
 * future seeder that silently skipped) is simply absent, so the agents-demo
 * test asserting the full list actually proves per-domain coverage.
 */

import { seedDemoAgents, type SeedOptions, type SeedResult } from './demoSeed.js';
import { listRoster } from './rosterService.js';
import { listBoardsWithCards } from './kanbanService.js';
import { listJobs } from './schedulingService.js';
import { getChart } from './orgChartService.js';
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
  /** Domains verified non-empty in the durable stores after this call. */
  domains: DemoSeedDomain[];
}

/** Read-through verification per domain. Listed in DEMO_SEED_DOMAINS order so
 *  the response (and the test asserting it) stays stable. */
async function verifyDomains(tenantId: string, storage: Storage): Promise<DemoSeedDomain[]> {
  const boards = await listBoardsWithCards(tenantId);
  const checks: Record<DemoSeedDomain, boolean> = {
    'user-agents': (await storage.listUserAgents(tenantId)).length > 0,
    roster: (await listRoster(tenantId)).length > 0,
    boards: boards.length > 0,
    cards: boards.some((b) => b.cards.length > 0),
    schedules: (await listJobs(tenantId)).length > 0,
    'org-chart': (await getChart(tenantId)) !== null,
  };
  return DEMO_SEED_DOMAINS.filter((d) => checks[d]);
}

export async function seedEverything(
  tenantId: string,
  storage: Storage,
  opts: SeedOptions = {},
): Promise<SeedEverythingResult> {
  const result = await seedDemoAgents(tenantId, storage, opts);
  return {
    ...result,
    domains: await verifyDomains(tenantId, storage),
  };
}
