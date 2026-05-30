/**
 * Compatibility-profile derivation for openwop v1.x.
 *
 * Profiles are a named set of capability requirements. A host's profile
 * set is derived from the `/.well-known/openwop` discovery payload — never
 * declared as a separate wire field. See `spec/v1/profiles.md` for the
 * normative predicate definitions.
 *
 * This module is the single canonical implementation of profile membership.
 * Conformance scenarios use it to gate profile-specific assertions; SDKs
 * MAY re-export the derivation helper to give clients a way to ask
 * "does this host satisfy `openwop-secrets`?" without re-implementing the
 * predicates.
 *
 * **Derivation is deterministic and pure.** Same payload, same profile
 * set. No time-of-day, host-specific state, or hidden inputs.
 */

/**
 * Closed v1.x catalog. Adding a profile requires an RFC per
 * `RFCS/0001-rfc-process.md`.
 */
export const PROFILE_NAMES = [
  'openwop-core',
  'openwop-interrupts',
  'openwop-stream-sse',
  'openwop-stream-poll',
  'openwop-secrets',
  'openwop-provider-policy',
  'openwop-node-packs',
  'openwop-replay-fork',
  'openwop-fixtures',
  'openwop-memory',
] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

/**
 * Loose typing for the discovery payload — just enough structure to
 * apply the predicates safely. Schema-level validation is the
 * conformance suite's `discovery.test.ts` job.
 */
export interface DiscoveryPayload {
  protocolVersion?: unknown;
  supportedEnvelopes?: unknown;
  schemaVersions?: unknown;
  limits?: {
    clarificationRounds?: unknown;
    schemaRounds?: unknown;
    envelopesPerTurn?: unknown;
    [key: string]: unknown;
  };
  supportedTransports?: unknown;
  secrets?: {
    supported?: unknown;
    scopes?: unknown;
    [key: string]: unknown;
  };
  aiProviders?: {
    supported?: unknown;
    byok?: unknown;
    policies?: {
      modes?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  replay?: {
    supported?: unknown;
    modes?: unknown;
    [key: string]: unknown;
  };
  fixtures?: unknown;
  [key: string]: unknown;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * `openwop-core` predicate. Every other profile implies `openwop-core`. A host
 * that fails this predicate is not openwop-compatible.
 *
 * @see spec/v1/profiles.md §`openwop-core`
 */
export function isCore(c: DiscoveryPayload): boolean {
  if (typeof c.protocolVersion !== 'string') return false;
  if (!c.protocolVersion.startsWith('1.')) return false;
  if (!Array.isArray(c.supportedEnvelopes)) return false;
  if (!c.supportedEnvelopes.every((entry) => typeof entry === 'string')) return false;
  if (typeof c.schemaVersions !== 'object' || c.schemaVersions === null) return false;
  if (typeof c.limits !== 'object' || c.limits === null) return false;
  if (!isNonNegativeInteger(c.limits.clarificationRounds)) return false;
  if (!isNonNegativeInteger(c.limits.schemaRounds)) return false;
  if (!isNonNegativeInteger(c.limits.envelopesPerTurn)) return false;
  return true;
}

/**
 * `openwop-interrupts` predicate.
 *
 * @see spec/v1/profiles.md §`openwop-interrupts`
 */
export function isInterrupts(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (!isStringArray(c.supportedEnvelopes)) return false;
  return c.supportedEnvelopes.includes('clarification.request');
}

/**
 * `openwop-stream-sse` predicate (discovery-payload only — runtime SSE
 * behavior is verified by `stream-modes*.test.ts`).
 *
 * @see spec/v1/profiles.md §`openwop-stream-sse`
 */
export function isStreamSse(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (c.supportedTransports == null) return true;
  if (!isStringArray(c.supportedTransports)) return false;
  return c.supportedTransports.includes('rest');
}

/**
 * `openwop-stream-poll` predicate (discovery-payload only — runtime polling
 * behavior is verified by `stream-modes.test.ts`).
 *
 * @see spec/v1/profiles.md §`openwop-stream-poll`
 */
export function isStreamPoll(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (c.supportedTransports == null) return true;
  if (!isStringArray(c.supportedTransports)) return false;
  return c.supportedTransports.includes('rest');
}

/**
 * `openwop-secrets` predicate.
 *
 * @see spec/v1/profiles.md §`openwop-secrets`
 */
export function isSecrets(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (c.secrets == null || typeof c.secrets !== 'object') return false;
  if (c.secrets.supported !== true) return false;
  if (!isStringArray(c.secrets.scopes)) return false;
  return c.secrets.scopes.includes('user');
}

/**
 * `openwop-provider-policy` predicate.
 *
 * @see spec/v1/profiles.md §`openwop-provider-policy`
 */
export function isProviderPolicy(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (c.aiProviders == null || typeof c.aiProviders !== 'object') return false;
  const policies = c.aiProviders.policies;
  if (policies == null || typeof policies !== 'object') return false;
  if (!isStringArray(policies.modes)) return false;
  if (policies.modes.length === 0) return false;
  return policies.modes.includes('optional');
}

/**
 * `openwop-node-packs` discovery-only predicate. Runtime registry behavior
 * is verified by `pack-registry*.test.ts`. Discovery alone cannot tell
 * whether GET /v1/packs returns a list-shaped body.
 *
 * @see spec/v1/profiles.md §`openwop-node-packs`
 */
export function isNodePacksDiscovery(c: DiscoveryPayload): boolean {
  return isCore(c);
}

/**
 * `openwop-replay-fork` predicate. Host advertises `replay.supported: true`
 * with at least one entry in `replay.modes`. Runtime determinism /
 * branch behavior is verified by `replayDeterminism.test.ts` and
 * `replay-fork.test.ts`.
 *
 * @see spec/v1/profiles.md §`openwop-replay-fork`
 * @see spec/v1/replay.md
 */
export function isReplayFork(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (c.replay == null || typeof c.replay !== 'object') return false;
  if (c.replay.supported !== true) return false;
  if (!isStringArray(c.replay.modes)) return false;
  return c.replay.modes.length > 0;
}

/**
 * `openwop-fixtures` predicate (RFC 0003). Host advertises `fixtures` as a
 * non-empty array of non-empty strings — fixture-workflow IDs the host
 * has seeded. Per-fixture skip decisions are made by the suite via
 * `lib/fixtures.ts`; the profile predicate is the all-up "any-advertised"
 * check.
 *
 * @see spec/v1/profiles.md §`openwop-fixtures`
 * @see spec/v1/capabilities.md §`fixtures`
 * @see RFCS/0003-fixture-gating.md
 */
export function isFixtures(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  if (!Array.isArray(c.fixtures)) return false;
  if (c.fixtures.length === 0) return false;
  return c.fixtures.every((id) => typeof id === 'string' && id.length > 0);
}

/**
 * `openwop-memory` predicate (RFC 0080). Host implements the reconciled
 * memory-capability model at the core tier: a read/write `MemoryAdapter`
 * (`memory.supported: true` and `memory.writable !== false`) plus a cross-run
 * durable store (`agents.memoryBackends` includes `'long-term'`). Capability
 * families are document-root properties of the discovery payload (RFC 0073),
 * so this reads `c.memory` / `c.agents`, matching `isReplayFork`.
 *
 * @see spec/v1/profiles.md §`openwop-memory`
 * @see spec/v1/agent-memory.md §"Memory capability model"
 */
export function isMemory(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  const memory = c.memory as { supported?: unknown; writable?: unknown } | undefined;
  if (memory == null || typeof memory !== 'object') return false;
  if (memory.supported !== true) return false;
  if (memory.writable === false) return false;
  const agents = c.agents as { memoryBackends?: unknown } | undefined;
  if (agents == null || !isStringArray(agents.memoryBackends)) return false;
  return agents.memoryBackends.includes('long-term');
}

/**
 * Derive the full profile set from a discovery payload.
 *
 * Returns a set sorted by `PROFILE_NAMES` order so output is stable
 * across calls and across implementations.
 */
export function deriveProfiles(c: DiscoveryPayload): readonly ProfileName[] {
  const result: ProfileName[] = [];
  if (isCore(c)) result.push('openwop-core');
  if (isInterrupts(c)) result.push('openwop-interrupts');
  if (isStreamSse(c)) result.push('openwop-stream-sse');
  if (isStreamPoll(c)) result.push('openwop-stream-poll');
  if (isSecrets(c)) result.push('openwop-secrets');
  if (isProviderPolicy(c)) result.push('openwop-provider-policy');
  if (isNodePacksDiscovery(c)) result.push('openwop-node-packs');
  if (isReplayFork(c)) result.push('openwop-replay-fork');
  if (isFixtures(c)) result.push('openwop-fixtures');
  if (isMemory(c)) result.push('openwop-memory');
  return result;
}

/**
 * One-shot membership check.
 */
export function hasProfile(c: DiscoveryPayload, profile: ProfileName): boolean {
  switch (profile) {
    case 'openwop-core':
      return isCore(c);
    case 'openwop-interrupts':
      return isInterrupts(c);
    case 'openwop-stream-sse':
      return isStreamSse(c);
    case 'openwop-stream-poll':
      return isStreamPoll(c);
    case 'openwop-secrets':
      return isSecrets(c);
    case 'openwop-provider-policy':
      return isProviderPolicy(c);
    case 'openwop-node-packs':
      return isNodePacksDiscovery(c);
    case 'openwop-replay-fork':
      return isReplayFork(c);
    case 'openwop-fixtures':
      return isFixtures(c);
    case 'openwop-memory':
      return isMemory(c);
  }
}
