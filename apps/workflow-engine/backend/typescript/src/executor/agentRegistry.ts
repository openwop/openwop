/**
 * Module-scope AgentRegistry singleton — the manifest-agent parallel to
 * `nodeRegistry.ts` (RFC 0070 / RFC 0003 §ImplNotes `installAgents`).
 *
 * Holds the resolved `AgentManifest`s a host has installed from pack
 * `agents[]` arrays, keyed by `agentId`. `installAgents` is append-only;
 * a manifest agent is resolvable for dispatch via `core.dispatch` once it
 * lands here. Like the node registry, a single in-process map suffices for
 * the sample host; multi-instance hosts would replicate via a shared store.
 */

/** A pack-declared agent manifest, resolved for runtime use.
 *  Mirrors `schemas/agent-manifest.schema.json` (RFC 0003). After load,
 *  `systemPromptRef` is resolved to inline `systemPrompt`, and the two
 *  `handoff.*SchemaRef`s are resolved to parsed JSON Schemas. */
export interface ResolvedAgentManifest {
  agentId: string;
  persona: string;
  modelClass: string;
  /** Resolved system prompt body (inline, or read from `systemPromptRef`). */
  systemPrompt: string;
  /** Provenance: the tarball-relative ref when the prompt was external. */
  systemPromptRef?: string;
  toolAllowlist?: string[];
  memoryShape?: { scratchpad?: boolean; conversation?: boolean; longTerm?: boolean };
  confidence?: { defaultThreshold?: number };
  /** Resolved handoff JSON Schemas (parsed) + their provenance refs + the
   *  validators pre-compiled at load (RFC 0003 §D "MAY pre-compile"). Pre-
   *  compiling avoids per-dispatch recompilation and the shared-Ajv `$id`
   *  collision that a long-lived instance hits across packs. */
  handoff?: {
    taskSchemaRef?: string;
    returnSchemaRef?: string;
    taskSchema?: unknown;
    returnSchema?: unknown;
    validateTask?: AgentSchemaValidator;
    validateReturn?: AgentSchemaValidator;
  };
  label?: string;
  description?: string;
  /** The pack this agent was loaded from. */
  packName: string;
  packVersion: string;
  /** RFC 0072 §C — capability keys this agent's pack declared as
   *  `peerDependenciesMeta.optional` that this host does NOT satisfy, so they
   *  are inert for this installation. Absent/empty ⇒ full declared capability. */
  degraded?: string[];
  /** Owning tenant id for user-authored agents (sample-extension
   *  `POST /v1/host/sample/agents`, phase E1 2026-05-28). Pack-installed
   *  agents OMIT this field — they are tenant-agnostic (a host
   *  loads them once at boot for every tenant to share).
   *
   *  When present, the agent is ONLY visible to + dispatchable by
   *  the owning tenant. Enforces `agent-memory.md` CTI-1 cross-tenant
   *  isolation: the systemPrompt body is tenant-owned IP (an
   *  authoring artifact a tenant pays to compose) and MUST NOT leak
   *  across tenant boundaries via `GET /v1/agents` projections,
   *  `@`-mention picker results, or chat dispatch resolution.
   *
   *  Consumers MUST gate visibility / dispatch on
   *  `(!ownerTenant || ownerTenant === requestTenant)`. */
  ownerTenant?: string;
}

/** A pre-compiled handoff-schema validator (closes over an Ajv ValidateFunction
 *  produced at load). Returns a structured result so the dispatch path can cite
 *  the violation without re-touching Ajv. */
export type AgentSchemaValidator = (value: unknown) => { ok: boolean; errors?: string };

type AgentPackResolver = (agentId: string) => Promise<unknown>;

const inProcess = new Map<string, ResolvedAgentManifest>();
let resolver: AgentPackResolver | null = null;

export function getAgentRegistry() {
  return {
    /** Append-only install of a resolved manifest agent (RFC 0003). */
    register(agent: ResolvedAgentManifest): void {
      inProcess.set(agent.agentId, agent);
    },
    /** Drop one agent from the in-process registry. Returns true when
     *  a row was removed. The pack-loader path is append-only (RFC
     *  0003), so this is intended only for user-authored agents
     *  (`DELETE /v1/host/sample/agents/:agentId`, phase E1 2026-05-28).
     *  Calling on a pack-installed agentId is not blocked here — the
     *  delete route gates that at the storage layer (a row that
     *  doesn't exist in `user_agents` returns 404 before we get
     *  here). */
    remove(agentId: string): boolean {
      return inProcess.delete(agentId);
    },
    has(agentId: string): boolean {
      return inProcess.has(agentId);
    },
    /** Synchronous get (in-process only). */
    get(agentId: string): ResolvedAgentManifest | null {
      return inProcess.get(agentId) ?? null;
    },
    /** Async resolve — falls through to the pack resolver on miss. As with
     *  the node registry, the resolver typically registers EVERY agent in
     *  the matching pack, so we re-read after it runs. */
    async resolve(agentId: string): Promise<ResolvedAgentManifest | null> {
      const direct = inProcess.get(agentId);
      if (direct) return direct;
      if (resolver) {
        await resolver(agentId);
        const reread = inProcess.get(agentId);
        if (reread) return reread;
      }
      return null;
    },
    listAgentIds(): readonly string[] {
      return Array.from(inProcess.keys()).sort();
    },
    /** All resolved manifests (for the inventory route / CLI). */
    list(): readonly ResolvedAgentManifest[] {
      return Array.from(inProcess.values()).sort((a, b) => a.agentId.localeCompare(b.agentId));
    },
    /** Test seam — clears the in-process map. */
    _resetForTest(): void {
      inProcess.clear();
    },
  };
}

export function setAgentPackResolver(fn: AgentPackResolver): void {
  resolver = fn;
}
