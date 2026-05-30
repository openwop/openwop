/**
 * Standing agent roster — host extension (sample-grade, non-normative).
 *
 * The reference implementation of RFCS/0086: a named, tenant-scoped agent
 * INSTANCE (the "digital-twin employee", e.g. "Sally") that references a
 * manifest agent (`agentRef.agentId`) and OWNS a workflow portfolio
 * (`workflows[]`) — the workflows it is responsible for by role. A board
 * (host/kanbanService.ts) can be bound to a roster member; when a card
 * fires a portfolio workflow, the run is attributed to the member (the
 * RFC 0086 §C `roster.run.initiated` attribution — emitted here via the
 * Kanban route as a content-free `kanban.card.moved` carrying the
 * rosterId + persona).
 *
 * `rosterId` is a `host:<id>` form — the runtime-synthesis namespace RFC
 * 0002 reserves for host-internal agents that don't ship as packs (RFC
 * 0086 §A: a roster entry IS a dispatchable `host:<id>` AgentRef, not a
 * parallel id space). Store is process-local (sample-grade), mirroring
 * host/schedulingService.ts + host/kanbanService.ts; a production host
 * persists it and scopes by the RFC 0048 owner triple. This module is
 * pure data — the Kanban route owns the run side effects.
 *
 * Scope note (reference impl): a board-triggered run is dispatched by its
 * `workflowId`; the bound member's `agentRef` is recorded for ATTRIBUTION
 * only (persona + agentId in the run's `kanban` metadata), not yet used to
 * execute the workflow *as* that agent. Full RFC 0086 dispatch-as-agent is
 * deferred to the Draft→Active wire surface. `enabled: false` makes a
 * member's board triggers inert (enforced in routes/kanban.ts).
 *
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md §A/§B/§C
 * @see src/host/kanbanService.ts — the board surface a roster member owns
 */

import { randomUUID } from 'node:crypto';
import { loadCollection, schedulePersist } from './hostExtPersistence.js';

const ROSTER_KEY = 'hostext:roster';

/** The manifest/deployment a roster member instantiates (a trimmed
 *  AgentRef — RFC 0002). `version` XOR `channel` per RFC 0082 §A. */
export interface RosterAgentRef {
  agentId: string;
  version?: string;
  channel?: string;
}

/** A standing named agent instance (RFC 0086 §A). */
export interface RosterEntry {
  /** `host:<slug>` — a dispatchable AgentRef agentId (RFC 0086 §A). */
  rosterId: string;
  /** Human display name, projected onto AgentRef.persona (RFC 0002). */
  persona: string;
  agentRef: RosterAgentRef;
  /** The standing portfolio — workflows this member owns by role. */
  workflows: string[];
  tenantId: string;
  enabled: boolean;
  label?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

const entries = new Map<string, RosterEntry>();

function persistRoster(): void {
  schedulePersist(ROSTER_KEY, () => [...entries.values()]);
}

/** Hydrate the roster from durable storage on boot. */
export async function hydrateRoster(): Promise<void> {
  for (const e of await loadCollection<RosterEntry>(ROSTER_KEY)) entries.set(e.rosterId, e);
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(persona: string): string {
  const base = persona
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'agent';
}

export function createRosterEntry(input: {
  tenantId: string;
  persona: string;
  agentRef: RosterAgentRef;
  workflows?: string[];
  label?: string;
  description?: string;
  enabled?: boolean;
}): RosterEntry {
  // `host:<slug>-<short>` keeps the id human-readable + collision-safe.
  const rosterId = `host:${slugify(input.persona)}-${randomUUID().slice(0, 8)}`;
  const now = nowIso();
  const entry: RosterEntry = {
    rosterId,
    persona: input.persona,
    agentRef: { ...input.agentRef },
    workflows: input.workflows ? [...input.workflows] : [],
    tenantId: input.tenantId,
    enabled: input.enabled ?? true,
    label: input.label,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };
  entries.set(rosterId, entry);
  persistRoster();
  return entry;
}

export function listRoster(tenantId: string): RosterEntry[] {
  return [...entries.values()]
    .filter((e) => e.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getRosterEntry(rosterId: string): RosterEntry | undefined {
  return entries.get(rosterId);
}

export function updateRosterEntry(
  rosterId: string,
  patch: { persona?: string; workflows?: string[]; enabled?: boolean; label?: string; description?: string },
): RosterEntry | undefined {
  const entry = entries.get(rosterId);
  if (!entry) return undefined;
  if (patch.persona !== undefined) entry.persona = patch.persona;
  if (patch.workflows !== undefined) entry.workflows = [...patch.workflows];
  if (patch.enabled !== undefined) entry.enabled = patch.enabled;
  if (patch.label !== undefined) entry.label = patch.label;
  if (patch.description !== undefined) entry.description = patch.description;
  entry.updatedAt = nowIso();
  persistRoster();
  return entry;
}

export function deleteRosterEntry(rosterId: string): boolean {
  const ok = entries.delete(rosterId);
  if (ok) persistRoster();
  return ok;
}

/** Test-only: drop all roster entries. */
export function __resetRosterStore(): void {
  entries.clear();
}
