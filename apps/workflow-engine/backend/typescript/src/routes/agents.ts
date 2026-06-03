/**
 * Manifest-agent inventory + dispatch (RFC 0070).
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; not part of the
 * normative wire contract (the RFC 0070 §Unresolved-questions entry tracks
 * whether `/v1/agents` should be promoted to normative).
 *
 * This is the registry-backed surface that replaces the prior 3-constant
 * placeholder: it lists the agent manifests this host actually loaded from
 * pack `agents[]` (RFC 0003) into the AgentRegistry, and dispatches one via
 * the RFC 0070 floor (`runAgentDispatch`). When the host advertises
 * `capabilities.agents.manifestRuntime`, these reflect real installed agents.
 */

import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { getAgentRegistry, type ResolvedAgentManifest } from '../executor/agentRegistry.js';
import { runAgentDispatch, runAgentDispatchLive, AgentNotFoundError, type AgentDispatchRequest } from '../host/agentDispatch.js';
import { createAiProvidersAdapter } from '../aiProviders/aiProvidersHost.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import type { UserAgentRecord } from '../types.js';

interface AgentRoutesDeps {
  /** When provided, `dispatch` with `live: true` makes a real model turn. */
  hostSuite?: HostAdapterSuite;
  /** When provided, the inventory list reads through to durable user-agent
   *  storage so a concrete-tenant caller on a cold instance (registry is
   *  boot-hydrated, not refreshed) still sees its seeded/user agents — keeping
   *  the chat `@`-mention list consistent across instances. */
  storage?: Storage;
}

interface AgentInventoryEntry {
  agentId: string;
  persona: string;
  label: string;
  description?: string;
  modelClass: string;
  packName: string;
  packVersion: string;
  toolAllowlist: string[];
  hasHandoffSchemas: boolean;
  memoryShape?: ResolvedAgentManifest['memoryShape'];
  confidenceThreshold?: number;
  degraded?: string[];
}

function toEntry(a: ResolvedAgentManifest): AgentInventoryEntry {
  return {
    agentId: a.agentId,
    persona: a.persona,
    label: a.label ?? a.persona,
    description: a.description,
    modelClass: a.modelClass,
    packName: a.packName,
    packVersion: a.packVersion,
    toolAllowlist: a.toolAllowlist ?? [],
    hasHandoffSchemas: Boolean(a.handoff?.taskSchema || a.handoff?.returnSchema),
    memoryShape: a.memoryShape,
    confidenceThreshold: a.confidence?.defaultThreshold,
    degraded: a.degraded && a.degraded.length > 0 ? a.degraded : undefined,
  };
}

/** Project a durable user-agent record straight to the inventory shape — used by
 *  the list read-through (`listVisibleAgents`) for records that aren't yet in
 *  this instance's boot-hydrated registry. Mirrors `registerUserAgent`'s
 *  projection in `userAgents.ts` (synthetic `user:<tenant>` provenance). */
function userRecordToEntry(r: UserAgentRecord): AgentInventoryEntry {
  return {
    agentId: r.agentId,
    persona: r.persona,
    label: r.label ?? r.persona,
    description: r.description,
    modelClass: r.modelClass,
    packName: `user:${r.tenantId}`,
    packVersion: '0',
    toolAllowlist: r.toolAllowlist ?? [],
    hasHandoffSchemas: false,
    memoryShape: r.memoryShape,
    confidenceThreshold: r.confidenceThreshold,
  };
}

/** The tenant-visible inventory: registry agents (pack + boot-hydrated user)
 *  filtered by `ownerTenant`, plus a read-through merge of durable user agents
 *  that this instance hasn't hydrated yet. Wildcard/admin callers (`undefined` /
 *  `*`) already see the full hydrated set, so the extra storage read is skipped. */
async function listVisibleAgents(
  storage: Storage | undefined,
  tenant: string | undefined,
): Promise<AgentInventoryEntry[]> {
  const entries = getAgentRegistry().list().filter((a) => visibleTo(a, tenant)).map(toEntry);
  if (storage && tenant && tenant !== '*') {
    const known = new Set(entries.map((e) => e.agentId));
    for (const r of await storage.listUserAgents(tenant)) {
      if (!known.has(r.agentId)) entries.push(userRecordToEntry(r));
    }
  }
  return entries;
}

/** Cross-tenant isolation filter for user-authored agents (phase E1,
 *  2026-05-28). Pack-installed agents (no `ownerTenant`) are
 *  tenant-agnostic — every tenant sees them. User-authored agents
 *  (a tenant POSTed them via `/v1/host/sample/agents`) carry an
 *  `ownerTenant` and are only visible to that tenant.
 *
 *  `requestTenant` comes from `req.tenantId` populated by the auth
 *  middleware:
 *    - `anon:<sid>` for cookie-anon callers
 *    - `user:<hash>` for OIDC-signed-in callers
 *    - `undefined` for API-key Bearer callers (the auth middleware
 *      sets `principal.tenants = ['*']` but doesn't bind `tenantId`;
 *      the conformance harness + admin tooling reach this path).
 *      Treated as wildcard-read here, matching the `runs.list` +
 *      `chat_sessions.list` patterns.
 *    - `*` is the explicit wildcard from `?tenantId=*` overrides.
 *
 *  Wildcard sees everything — that's by-design for the conformance
 *  suite and admin tooling. Real user sessions (cookie-anon / OIDC)
 *  carry a concrete tenantId and only see their own user-authored
 *  agents. */
function visibleTo(a: ResolvedAgentManifest, requestTenant: string | undefined): boolean {
  if (!a.ownerTenant) return true;
  if (requestTenant === undefined || requestTenant === '*') return true;
  return a.ownerTenant === requestTenant;
}

interface AgentReqLike { tenantId?: string }

export function registerAgentRoutes(app: Express, deps: AgentRoutesDeps = {}): void {
  // RFC 0072 §A — NORMATIVE read-only inventory (matches agent-inventory-response.schema.json).
  // Auth-gated (registered after authMiddleware in index.ts). This host advertises
  // capabilities.agents.manifestRuntime UNCONDITIONALLY (discovery.ts), so the route
  // is always live; a host that gates the advertisement MUST 404 these endpoints when
  // it does not advertise the capability (RFC 0072 §A: "MUST serve iff advertised").
  app.get('/v1/agents', async (req, res) => {
    const tenant = (req as AgentReqLike).tenantId;
    const agents = await listVisibleAgents(deps.storage, tenant);
    res.json({ agents, total: agents.length });
  });
  app.get('/v1/agents/:agentId', async (req, res) => {
    const tenant = (req as AgentReqLike).tenantId;
    // `resolve()` reads through to durable storage on a registry miss, so a
    // cold instance still serves a seeded/user agent it hasn't hydrated.
    const a = await getAgentRegistry().resolve(req.params.agentId);
    if (!a || !visibleTo(a, tenant)) {
      // Same 404 for "absent" and "not yours" — never leak that a
      // cross-tenant agent exists by returning a distinct status.
      res.status(404).json({ error: 'not_found', message: `agent '${req.params.agentId}' is not installed on this host` });
      return;
    }
    res.json(toEntry(a));
  });

  // Sample-extension aliases (RFC 0070 convenience; non-normative). The list
  // form additionally reports the host's runtime posture for the CLI.
  app.get('/v1/host/sample/agents', async (req, res) => {
    const tenant = (req as AgentReqLike).tenantId;
    const agents = await listVisibleAgents(deps.storage, tenant);
    res.json({ agents, total: agents.length, runtime: { manifestRuntime: true } });
  });
  app.get('/v1/host/sample/agents/:agentId', async (req, res) => {
    const tenant = (req as AgentReqLike).tenantId;
    const a = await getAgentRegistry().resolve(req.params.agentId);
    if (!a || !visibleTo(a, tenant)) {
      res.status(404).json({ error: 'not_found', message: `agent '${req.params.agentId}' is not installed on this host` });
      return;
    }
    res.json(toEntry(a));
  });

  // Dispatch one turn of a manifest agent (RFC 0070 floor). Deterministic by
  // default (replay-safe, conformance-stable); a real model turn when the body
  // sets `live: true` AND the host wired an AI adapter (deps.hostSuite). Live
  // turns default to the managed tier so no BYOK is required.
  app.post('/v1/host/sample/agents/:agentId/dispatch', async (req, res) => {
    const body = (req.body ?? {}) as Partial<AgentDispatchRequest> & { live?: boolean };
    const reqShape: AgentDispatchRequest = {
      agentId: req.params.agentId,
      task: body.task,
      availableTools: Array.isArray(body.availableTools) ? body.availableTools : undefined,
      confidenceThreshold: typeof body.confidenceThreshold === 'number' ? body.confidenceThreshold : undefined,
      simulateConfidence: typeof body.simulateConfidence === 'number' ? body.simulateConfidence : undefined,
      validateHandoff: body.validateHandoff,
    };
    try {
      if (body.live === true && deps.hostSuite) {
        const tenantId = (req as AgentReqLike).tenantId ?? 'default';
        // Ad-hoc dispatch (not a persisted run): a synthetic scope, empty BYOK
        // secrets, no event-log emit. The managed tier needs none of these; a
        // pinned BYOK provider would fail byok_required (returned as a failed
        // turn), which is the honest outcome without a per-run vault.
        const adapter = createAiProvidersAdapter({
          runId: `agent-dispatch:${randomUUID()}`,
          nodeId: 'agent.dispatch',
          tenantId,
          attempt: 1,
          secrets: {},
          policyResolver: deps.hostSuite.providerPolicyResolver,
        });
        const result = await runAgentDispatchLive(reqShape, { callAI: adapter.callAI });
        res.status(200).json(result);
        return;
      }
      res.status(200).json(runAgentDispatch(reqShape));
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        res.status(404).json({ error: 'agent_not_found', message: err.message });
        return;
      }
      res.status(500).json({ error: 'dispatch_error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}
