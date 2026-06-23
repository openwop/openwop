/**
 * Multi-Agent Shift capability-gating helper.
 *
 * Reads the host's `/.well-known/openwop` `agents` block + the
 * `conversationPrimitive` flag — both at the document ROOT (RFC 0073
 * root-first; `setMultiAgentCapabilities` reads `body.agents` /
 * `body.conversationPrimitive`, NOT a nested `.capabilities` object) —
 * at suite init and caches them as discrete predicates. A host that
 * advertises these only under a `.capabilities` wrapper resolves to
 * `false` and its gated scenarios skip vacuously. Sibling to
 * `lib/fixtures.ts` — same pattern, different surface.
 *
 * Why: Multi-Agent Shift scenarios (Phases 1-6) gate on per-phase
 * capability flags. Mirrors the fixture-gating pattern from RFC 0003
 * so conformance scenarios skip honestly when the host's advertisement
 * doesn't claim the relevant phase support.
 *
 * Cache lifecycle:
 *   - `setMultiAgentCapabilities(...)` populates from a discovery
 *     payload. Idempotent — repeated calls with the same payload are
 *     no-ops. Setup file calls this from a top-level `await`.
 *   - Sync predicates (`isAgentSupported()`, etc.) return false until
 *     the cache is set — same defensive default as fixture-gating.
 *   - `__resetForTests()` clears the cache for unit tests.
 *
 * @see spec/v1/capabilities.md §`agents`
 * @see spec/v1/capabilities.md §`conversationPrimitive`
 */

import type { DiscoveryPayload } from './profiles.js';

interface AgentCaps {
  supported: boolean;
  profile: string | undefined;
  modelClasses: ReadonlySet<string>;
  orchestratorPattern: string | undefined;
  memoryBackends: ReadonlySet<string>;
  orchestrator: boolean;
  dispatch: boolean;
  reasoning:
    | {
        verbosity: 'summary' | 'full' | 'off' | undefined;
        tokenLimit: number | undefined;
        /** RFC 0024. When true, host may emit `agent.reasoning.delta`
         *  events in addition to the closing `agent.reasoned`. */
        streaming: boolean;
      }
    | undefined;
}

let _agentCaps: AgentCaps | null = null;
let _conversationPrimitive = false;
let _multiPartyConversation = false;

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringSet(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Populate the cache from a discovery-doc payload. Tolerant of malformed
 * inputs — anything other than the expected shape is treated as "absent."
 */
export function setMultiAgentCapabilities(c: DiscoveryPayload | null | undefined): void {
  if (!c || typeof c !== 'object') {
    _agentCaps = null;
    _conversationPrimitive = false;
    _multiPartyConversation = false;
    return;
  }

  const agentsRaw = (c as { agents?: unknown }).agents;
  if (agentsRaw && typeof agentsRaw === 'object') {
    const a = agentsRaw as Record<string, unknown>;
    const reasoningRaw = a.reasoning;
    const reasoning =
      reasoningRaw && typeof reasoningRaw === 'object'
        ? {
            verbosity: asString((reasoningRaw as Record<string, unknown>).verbosity) as
              | 'summary'
              | 'full'
              | 'off'
              | undefined,
            tokenLimit:
              typeof (reasoningRaw as Record<string, unknown>).tokenLimit === 'number'
                ? ((reasoningRaw as Record<string, unknown>).tokenLimit as number)
                : undefined,
            streaming: asBoolean((reasoningRaw as Record<string, unknown>).streaming),
          }
        : undefined;
    _agentCaps = {
      supported: asBoolean(a.supported),
      profile: asString(a.profile),
      modelClasses: asStringSet(a.modelClasses),
      orchestratorPattern: asString(a.orchestratorPattern),
      memoryBackends: asStringSet(a.memoryBackends),
      orchestrator: asBoolean(a.orchestrator),
      dispatch: asBoolean(a.dispatch),
      reasoning,
    };
  } else {
    _agentCaps = null;
  }

  _conversationPrimitive = asBoolean((c as { conversationPrimitive?: unknown }).conversationPrimitive);

  // RFC 0101 — root-first read of the `multiPartyConversation` block (sibling
  // of `conversationPrimitive`), matching the root-first convention above.
  const mpcRaw = (c as { multiPartyConversation?: unknown }).multiPartyConversation;
  _multiPartyConversation =
    !!mpcRaw && typeof mpcRaw === 'object' && asBoolean((mpcRaw as Record<string, unknown>).supported);
}

/** Phase 1 master switch. */
export function isAgentSupported(): boolean {
  return _agentCaps?.supported === true;
}

/** Phase 1 reasoning verbosity. */
export function getReasoningVerbosity(): 'summary' | 'full' | 'off' | undefined {
  return _agentCaps?.reasoning?.verbosity;
}

/** RFC 0024 — host emits incremental `agent.reasoning.delta` events
 *  while a reasoning block is still open. */
export function isReasoningStreamingSupported(): boolean {
  return _agentCaps?.reasoning?.streaming === true;
}

/** Phase 2 — host supports the named modelClass. */
export function hasModelClass(modelClass: string): boolean {
  return _agentCaps?.modelClasses.has(modelClass) === true;
}

/** Phase 2 — host advertises an orchestrator pattern (any value). */
export function hasOrchestratorPattern(): boolean {
  return typeof _agentCaps?.orchestratorPattern === 'string';
}

/** Phase 3 — host advertises long-term memory backend. */
export function hasLongTermMemory(): boolean {
  return _agentCaps?.memoryBackends.has('long-term') === true;
}

/** Phase 4 — host implements `core.conversationGate` + `conversation.*` suspends. */
export function isConversationPrimitiveSupported(): boolean {
  return _conversationPrimitive;
}

/** RFC 0101 — host enforces the multi-party group-conversation roster +
 *  speaker-attribution contract (`multiPartyConversation.supported: true`). */
export function isMultiPartyConversationSupported(): boolean {
  return _multiPartyConversation;
}

/** Phase 5 — host implements `core.orchestrator.supervisor` + CP-1. */
export function isOrchestratorSupported(): boolean {
  return _agentCaps?.orchestrator === true;
}

/** Phase 6 — host implements `core.dispatch` + CP-2. */
export function isDispatchSupported(): boolean {
  return _agentCaps?.dispatch === true;
}

/** Diagnostic — returns the cached state or `null` if not yet set. */
export function getCachedAgentCaps(): AgentCaps | null {
  return _agentCaps;
}

/** Test-only reset. */
export function __resetForTests(): void {
  _agentCaps = null;
  _conversationPrimitive = false;
  _multiPartyConversation = false;
}
