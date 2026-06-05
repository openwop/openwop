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
 * parallel id space). The store is now a read-through, per-entity durable
 * collection (host/hostExtPersistence.ts) — every read/write hits storage,
 * so the roster is consistent across instances and survives restarts. A
 * production host scopes by the RFC 0048 owner triple.
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
import { DurableCollection } from './hostExtPersistence.js';

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
  /** Profile picture as a small `data:image/*;base64,…` URI (host-extension
   *  only; never crosses the normative RFC 0072 manifest inventory). The
   *  reference impl stores the cropped 256×256 thumbnail inline on the durable
   *  roster row — multi-instance safe + restart-durable, unlike the in-memory
   *  media-asset store. Absent ⇒ the UI renders the persona initials. */
  avatarUrl?: string;
  /** ISO-8601 timestamp of the last "Check now" heartbeat that actually ran
   *  (set in routes/agentOps.ts). Absent ⇒ never checked. Surfaced in the UI
   *  as "last checked …"; the heartbeat is a manual pull in this sample, so
   *  there is no persisted "next check" beyond any enabled scheduler job. */
  lastHeartbeatAt?: string;
  /** Opt-in autonomous heartbeat cadence in milliseconds. When > 0, the
   *  background heartbeat daemon (host/heartbeatService.ts) auto-runs this
   *  member's "Check now" on this interval. Absent or <= 0 ⇒ manual pull only
   *  (the prior, default behavior) — the daemon never touches it. */
  heartbeatIntervalMs?: number;
  /** How much autonomy this member has when its heartbeat picks up work.
   *  `auto` (default) — start the proposed run immediately (today's behavior).
   *  `review` — "agents propose, humans dispose": the heartbeat does NOT start
   *  the run; it queues a pending approval (host/approvalService.ts) that a
   *  human must affirmatively claim before the run starts. Host-extension only;
   *  the normative manifest inventory is unaffected. Absent ⇒ `auto`. */
  autonomyLevel?: 'auto' | 'guided' | 'review';
  createdAt: string;
  updatedAt: string;
}

/** The effective autonomy of an entry (the field is optional; absent ⇒ auto).
 *  `guided` (2026-06-05): routine heartbeat picks run immediately; HIGH-
 *  priority picks queue as proposals — the only middle level composable from
 *  data the host actually has (card.priority + the approval path).
 *  TRIPWIRE: this host-ext field MUST NEVER be serialized onto a normative
 *  /v1/agents/roster response (agent-roster-entry.schema.json is
 *  additionalProperties:false — any host that leaks it fails conformance). */
export function autonomyOf(entry: RosterEntry): 'auto' | 'guided' | 'review' {
  if (entry.autonomyLevel === 'review') return 'review';
  if (entry.autonomyLevel === 'guided') return 'guided';
  return 'auto';
}

const roster = new DurableCollection<RosterEntry>('roster', (e) => e.rosterId);

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

export async function createRosterEntry(input: {
  tenantId: string;
  persona: string;
  agentRef: RosterAgentRef;
  workflows?: string[];
  label?: string;
  description?: string;
  enabled?: boolean;
  avatarUrl?: string;
  heartbeatIntervalMs?: number;
  autonomyLevel?: 'auto' | 'guided' | 'review';
}): Promise<RosterEntry> {
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
    avatarUrl: input.avatarUrl,
    ...(input.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: input.heartbeatIntervalMs } : {}),
    // Persist non-default levels; `auto`/absent normalize to undefined (the
    // default) so stock entries stay shape-stable.
    autonomyLevel: input.autonomyLevel === 'review' || input.autonomyLevel === 'guided' ? input.autonomyLevel : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await roster.put(entry);
  return entry;
}

export async function listRoster(tenantId: string): Promise<RosterEntry[]> {
  return (await roster.list())
    .filter((e) => e.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRosterEntry(rosterId: string): Promise<RosterEntry | null> {
  return roster.get(rosterId);
}

/** Distinct tenant ids that own at least one roster member. The background
 *  heartbeat daemon uses this to scope its per-tenant scan (the store lists
 *  per tenant). Prefix-scan posture, like the rest of the host-ext surfaces. */
export async function listRosterTenants(): Promise<string[]> {
  const tenants = new Set<string>();
  for (const e of await roster.list()) tenants.add(e.tenantId);
  return [...tenants];
}

export async function updateRosterEntry(
  rosterId: string,
  patch: {
    persona?: string;
    workflows?: string[];
    enabled?: boolean;
    label?: string;
    description?: string;
    /** `string` sets the photo, `null` clears it, `undefined` leaves it. */
    avatarUrl?: string | null;
    /** Autonomous heartbeat cadence (ms). 0 or negative disables it. */
    heartbeatIntervalMs?: number;
    autonomyLevel?: 'auto' | 'guided' | 'review';
  },
): Promise<RosterEntry | null> {
  const entry = await roster.get(rosterId);
  if (!entry) return null;
  if (patch.persona !== undefined) entry.persona = patch.persona;
  if (patch.workflows !== undefined) entry.workflows = [...patch.workflows];
  if (patch.enabled !== undefined) entry.enabled = patch.enabled;
  if (patch.label !== undefined) entry.label = patch.label;
  if (patch.description !== undefined) entry.description = patch.description;
  if (patch.heartbeatIntervalMs !== undefined) {
    if (patch.heartbeatIntervalMs > 0) entry.heartbeatIntervalMs = patch.heartbeatIntervalMs;
    else delete entry.heartbeatIntervalMs;
  }
  if (patch.avatarUrl !== undefined) {
    if (patch.avatarUrl === null) delete entry.avatarUrl;
    else entry.avatarUrl = patch.avatarUrl;
  }
  if (patch.autonomyLevel !== undefined) {
    // Normalize: non-default levels persist; 'auto' is the absent default.
    if (patch.autonomyLevel === 'review' || patch.autonomyLevel === 'guided') entry.autonomyLevel = patch.autonomyLevel;
    else delete entry.autonomyLevel;
  }
  entry.updatedAt = nowIso();
  await roster.put(entry);
  return entry;
}

/** Stamp the last-heartbeat time on an entry (called when a "Check now"
 *  heartbeat actually runs). Returns the updated entry, or null if missing.
 *  Does not touch `updatedAt` — a heartbeat is an activity marker, not an
 *  edit to the agent's definition. */
export async function recordHeartbeat(rosterId: string): Promise<RosterEntry | null> {
  const entry = await roster.get(rosterId);
  if (!entry) return null;
  entry.lastHeartbeatAt = nowIso();
  await roster.put(entry);
  return entry;
}

export async function deleteRosterEntry(rosterId: string): Promise<boolean> {
  return roster.delete(rosterId);
}

/** Test-only: drop all roster entries. */
export async function __resetRosterStore(): Promise<void> {
  await roster.__clear();
}
