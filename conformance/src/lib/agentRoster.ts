/**
 * Shared helpers for the RFC 0086 `agents.roster` conformance scenarios.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/agentRoster.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE read (`GET /v1/agents/roster[/{rosterId}]`, RFC 0086 §B),
 *     exercised black-box against any conformant host; and
 *   - the host-sample fire seam (`POST /v1/host/sample/roster/fire`), used to
 *     drive a portfolio trigger so the `roster.run.initiated` attribution +
 *     ordering can be asserted against the test event-log seam. The fire seam
 *     is OPTIONAL — scenarios soft-skip on 404/405 (the reference roster store
 *     is deferred per RFC 0086 §Conformance).
 *
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 * @see spec/v1/agent-roster.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.roster` from discovery (root-first per RFC 0073); null when
 *  unadvertised. */
export async function readRosterCap(): Promise<Record<string, unknown> | null> {
  const agents = await readCapabilityFamily<{ roster?: unknown }>('agents');
  const r = agents?.roster;
  return r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
}

export interface RosterEntry {
  rosterId?: string;
  persona?: string;
  agentRef?: { agentId?: string; version?: string; channel?: string };
  workflows?: string[];
  owner?: { tenantId?: string; workspaceId?: string };
  [k: string]: unknown;
}

export interface RosterResponse {
  roster?: RosterEntry[];
  total?: number;
}

/** GET the NORMATIVE standing roster (RFC 0086 §B `GET /v1/agents/roster`);
 *  null when the host doesn't serve it (404/405/501). */
export async function listRoster(): Promise<RosterResponse | null> {
  const res = await driver.get('/v1/agents/roster');
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as RosterResponse | undefined) ?? {};
}

/** GET a single roster entry by id. Returns `{ status, entry }` so a caller can
 *  distinguish a 404 (cross-tenant / unknown) from a served entry. */
export async function getRosterEntry(
  rosterId: string,
): Promise<{ status: number; entry: RosterEntry | undefined }> {
  const res = await driver.get(`/v1/agents/roster/${encodeURIComponent(rosterId)}`);
  return { status: res.status, entry: res.json as RosterEntry | undefined };
}

export interface RosterFireResult {
  runId?: string;
  rosterId?: string;
  triggerSubscriptionId?: string;
}

/** Drive a portfolio trigger for a roster member via the host-sample fire seam.
 *  `asWorkItem:true` requests the RFC 0083 durable-work-item path (carries a
 *  `triggerSubscriptionId` + run `causationId`). Returns null when the seam is
 *  unwired (404/405). */
export async function fireRosterPortfolio(
  body: { rosterId?: string; triggerSource?: string; asWorkItem?: boolean } = {},
): Promise<RosterFireResult | null> {
  const res = await driver.post('/v1/host/sample/roster/fire', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as RosterFireResult | undefined) ?? {};
}
