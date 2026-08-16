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
/**
 * RFC 0155 §A/§E — deprecated profile aliases, keyed by alias → canonical id.
 * A certification bundle v2 (`certification-bundle-v2.schema.json`) MUST name
 * canonical ids in `claimedProfiles`; an alias that also derives goes in
 * `aliases`, never in `claimedProfiles` — a badge cannot be substantiated by a
 * name that no longer means what it did.
 */
export const DEPRECATED_PROFILE_ALIASES: Readonly<Record<string, string>> = {
  'openwop-core': 'openwop-discovery-core',
};

export const PROFILE_NAMES = [
  // RFC 0155 §A (2026-08-16): `openwop-discovery-core` is the CANONICAL name of
  // the discovery predicate; `openwop-core` is its DEPRECATED ALIAS for all of
  // v1 and derives exactly when the canonical name derives — both or neither.
  // The predicate is a discovery-payload check and says nothing about whether a
  // run can be started, suspended, or replayed; the executable floor is
  // `openwop-core-standard` (`core-standard-profile.md`, RFC 0088).
  'openwop-discovery-core',
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
  'openwop-trigger-bridge',
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
 * RFC 0149 §C — `protocolVersion` is ASCII `<major>.<minor>`, no leading zero
 * except zero itself. Kept identical to the `pattern` in
 * `schemas/capabilities.schema.json`; `protocol-version-grammar.test.ts` asserts
 * the two agree, so this cannot drift into being the looser of the pair again.
 */
const PROTOCOL_VERSION_GRAMMAR = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/**
 * `openwop-core` predicate. Every other profile implies `openwop-core`. A host
 * that fails this predicate is not openwop-compatible.
 *
 * @see spec/v1/profiles.md §`openwop-core`
 */
export function isCore(c: DiscoveryPayload): boolean {
  if (typeof c.protocolVersion !== 'string') return false;
  // RFC 0149 §C. `startsWith('1.')` admitted `1.0.0` and `1.banana` while
  // rejecting `1`, so the predicate deciding whether a host is openwop-compatible
  // at all was looser than the schema every host validates against. The major is
  // the hard boundary; a higher minor stays core under v1 additive rules.
  const version = PROTOCOL_VERSION_GRAMMAR.exec(c.protocolVersion);
  if (version === null) return false;
  if (version[1] !== '1') return false;
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
 * `openwop-trigger-bridge` predicate (RFC 0083, widened by RFC 0099). Host
 * composes the durable inbound-work contract: advertises the `triggerBridge`,
 * has a `deadLetter` sink for exhausted deliveries, and has at least one
 * durable inbound source (queue bus, durable webhooks, scheduling, OR — per
 * RFC 0099 — externally-ingested `email`/`form` via
 * `triggerBridge.ingestion.externalSources[]`). Capability families are
 * document-root properties (RFC 0073), so this reads `c.triggerBridge` /
 * `c.deadLetter` / `c.queueBus` / `c.webhooks` / `c.scheduling`. The RFC 0099
 * widening only ADDS disjuncts — a host already in the profile stays in it.
 *
 * @see spec/v1/profiles.md §`openwop-trigger-bridge`
 * @see spec/v1/trigger-bridge.md §D / §F
 */
export function isTriggerBridge(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  const supported = (v: unknown): boolean =>
    v != null && typeof v === 'object' && (v as { supported?: unknown }).supported === true;
  if (!supported(c.triggerBridge)) return false;
  if (!supported(c.deadLetter)) return false;
  const webhooks = c.webhooks as { durable?: unknown } | undefined;
  // RFC 0099: an externally-ingested email/form source is a durable inbound
  // source for the profile (it rides the same four-state machine + dead-letter).
  const ingestion = (c.triggerBridge as { ingestion?: { externalSources?: unknown } } | undefined)?.ingestion;
  const externalSources = Array.isArray(ingestion?.externalSources) ? (ingestion!.externalSources as unknown[]) : [];
  const externalEmailOrForm = externalSources.includes('email') || externalSources.includes('form');
  const durableSource =
    supported(c.queueBus) ||
    supported(c.scheduling) ||
    (webhooks != null && typeof webhooks === 'object' && webhooks.durable === true) ||
    externalEmailOrForm;
  return durableSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational annex: openwop-agent-platform (RFC 0085).
//
// NOT part of the closed `profiles.md` predicate catalog (PROFILE_NAMES /
// deriveProfiles above) — it is an operational ANNEX (the production-profile.md /
// auth-profiles.md pattern) combining a discovery predicate with required runtime
// conformance evidence + documentation + a badge. These helpers compute only the
// discovery-PREDICATE part; the live aggregate-evidence assertion (does every
// constituent scenario actually pass?) lives in agent-platform-profile.test.ts.
//
// @see spec/v1/agent-platform-profile.md
// ─────────────────────────────────────────────────────────────────────────────

/** Narrow helper: a capability sub-block with `supported === true`. */
function blockSupported(v: unknown): boolean {
  return v != null && typeof v === 'object' && (v as { supported?: unknown }).supported === true;
}

/** The `openwop-agent-platform` FLOOR (`partial`) discovery predicate — RFC 0085 §B. */
export function isAgentPlatformPartial(c: DiscoveryPayload): boolean {
  if (!isCore(c)) return false;
  const agents = c.agents as { manifestRuntime?: unknown; liveRuntime?: unknown } | undefined;
  const httpClient = c.httpClient as { safeFetch?: unknown; egressPolicy?: unknown } | undefined;
  const replay = c.replay as { supported?: unknown } | undefined;
  const nondet = c.nondeterminismPolicy as { declared?: unknown } | undefined;
  return (
    blockSupported(agents?.manifestRuntime) &&
    blockSupported(agents?.liveRuntime) &&
    blockSupported(c.toolCatalog) &&
    blockSupported(c.toolHooks) &&
    blockSupported(httpClient?.safeFetch) &&
    blockSupported(c.providerUsage) &&
    blockSupported(c.prompts) &&
    blockSupported(c.memory) &&
    blockSupported(c.feedback) &&
    (replay?.supported === true || nondet?.declared === true)
  );
}

/** The `openwop-agent-platform` `full` discovery predicate (floor + governance tier) — RFC 0085 §B. */
export function isAgentPlatformFull(c: DiscoveryPayload): boolean {
  if (!isAgentPlatformPartial(c)) return false;
  const agents = c.agents as { manifestRuntime?: { installScope?: unknown } } | undefined;
  const memory = c.memory as { attribution?: unknown } | undefined;
  // Debug bundle is advertised at `capabilities.debugBundle.supported` (debug-bundle.md /
  // RFC 0009), NOT under `production.*` — the production block only adds stricter truncation MUSTs.
  const httpClient = c.httpClient as { egressPolicy?: unknown } | undefined;
  return (
    blockSupported(c.authorization) &&
    agents?.manifestRuntime?.installScope === 'tenant' &&
    blockSupported(memory?.attribution) &&
    blockSupported(c.debugBundle) &&
    blockSupported(c.triggerBridge) &&
    blockSupported(httpClient?.egressPolicy)
  );
}

/** The host-reported annex status: `full` ⊃ `partial` ⊃ `none` (discovery-predicate only). */
export function agentPlatformStatus(c: DiscoveryPayload): 'none' | 'partial' | 'full' {
  if (isAgentPlatformFull(c)) return 'full';
  if (isAgentPlatformPartial(c)) return 'partial';
  return 'none';
}

/**
 * The per-term satisfaction breakdown (RFC 0085 §D) — the richer interop signal
 * alongside the flat `none`/`partial`/`full` ladder. Adoption is NON-CONTIGUOUS:
 * a real host built feature-by-feature can satisfy `full`-tier terms (RBAC,
 * memory-attribution, tenant-scoping) while still failing `floor` terms, so the
 * flat status would understate it (reads identical to a do-nothing host). This
 * returns exactly the term ids a host satisfies, so a `none` host honoring 6/16
 * terms is distinguishable from one honoring 0/16.
 */
export function agentPlatformSatisfiedTerms(c: DiscoveryPayload): readonly string[] {
  const agents = c.agents as { manifestRuntime?: { installScope?: unknown }; liveRuntime?: unknown } | undefined;
  const httpClient = c.httpClient as { safeFetch?: unknown; egressPolicy?: unknown } | undefined;
  const memory = c.memory as { attribution?: unknown } | undefined;
  const replay = c.replay as { supported?: unknown } | undefined;
  const nondet = c.nondeterminismPolicy as { declared?: unknown } | undefined;
  const checks: ReadonlyArray<readonly [string, boolean]> = [
    // floor
    ['floor:agents.manifestRuntime', blockSupported(agents?.manifestRuntime)],
    ['floor:agents.liveRuntime', blockSupported(agents?.liveRuntime)],
    ['floor:toolCatalog', blockSupported(c.toolCatalog)],
    ['floor:toolHooks', blockSupported(c.toolHooks)],
    ['floor:httpClient.safeFetch', blockSupported(httpClient?.safeFetch)],
    ['floor:providerUsage', blockSupported(c.providerUsage)],
    ['floor:prompts', blockSupported(c.prompts)],
    ['floor:memory', blockSupported(c.memory)],
    ['floor:feedback', blockSupported(c.feedback)],
    ['floor:replay-or-nondeterminism', replay?.supported === true || nondet?.declared === true],
    // full (governance)
    ['full:authorization', blockSupported(c.authorization)],
    ['full:tenant-installScope', agents?.manifestRuntime?.installScope === 'tenant'],
    ['full:memory.attribution', blockSupported(memory?.attribution)],
    ['full:debugBundle', blockSupported(c.debugBundle)],
    ['full:triggerBridge', blockSupported(c.triggerBridge)],
    ['full:egressPolicy', blockSupported(httpClient?.egressPolicy)],
  ];
  return checks.filter(([, ok]) => ok).map(([id]) => id);
}

// ─────────────────────────────────────────────────────────────────────────────
// `openwop-core-standard` operational-annex predicate (RFC 0088). Like the
// agent-platform annex above, this is NOT a closed-catalog profile (so it is
// absent from deriveProfiles) — it is an operational ANNEX whose claim is backed
// by the §C floor scenarios passing black-box. This helper computes only the §B
// discovery predicate (the floor of MUSTs with black-box production-path proof).
//
// @see spec/v1/core-standard-profile.md
// ─────────────────────────────────────────────────────────────────────────────

/** The `openwop-core-standard` floor discovery predicate — RFC 0088 §B. */
export function isCoreStandard(c: DiscoveryPayload): boolean {
  return isCore(c) && isInterrupts(c) && (isStreamSse(c) || isStreamPoll(c));
}

/**
 * Derive the full profile set from a discovery payload.
 *
 * Returns a set sorted by `PROFILE_NAMES` order so output is stable
 * across calls and across implementations.
 */
export function deriveProfiles(c: DiscoveryPayload): readonly ProfileName[] {
  const result: ProfileName[] = [];
  if (isCore(c)) {
    result.push('openwop-discovery-core');
    result.push('openwop-core'); // deprecated alias — never alone (RFC 0155 §A)
  }
  if (isInterrupts(c)) result.push('openwop-interrupts');
  if (isStreamSse(c)) result.push('openwop-stream-sse');
  if (isStreamPoll(c)) result.push('openwop-stream-poll');
  if (isSecrets(c)) result.push('openwop-secrets');
  if (isProviderPolicy(c)) result.push('openwop-provider-policy');
  if (isNodePacksDiscovery(c)) result.push('openwop-node-packs');
  if (isReplayFork(c)) result.push('openwop-replay-fork');
  if (isFixtures(c)) result.push('openwop-fixtures');
  if (isMemory(c)) result.push('openwop-memory');
  if (isTriggerBridge(c)) result.push('openwop-trigger-bridge');
  return result;
}

/**
 * One-shot membership check.
 */
export function hasProfile(c: DiscoveryPayload, profile: ProfileName): boolean {
  switch (profile) {
    case 'openwop-discovery-core':
    case 'openwop-core': // deprecated alias of `openwop-discovery-core` (RFC 0155 §A)
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
    case 'openwop-trigger-bridge':
      return isTriggerBridge(c);
  }
}

// ── RFC 0089: conformance certification bundle — floor-scenario sets + verifier ──
//
// G1 (RFC 0089): the §B binding rule needs each profile's REQUIRED floor
// scenarios in a machine-readable form. Source of truth for
// `openwop-core-standard` is `core-standard-profile.md` §C — the nine named
// black-box floor scenarios plus the `interrupt-*` family. Keyed by profile
// name (string) because annex profiles like `openwop-core-standard` sit outside
// the closed `PROFILE_NAMES` catalog.

export interface ProfileFloor {
  /** Scenario files (basenames) that MUST each appear in `results.passed`. */
  readonly required: readonly string[];
  /** Prefix groups where ≥1 matching passed scenario satisfies the group. */
  readonly requiredAnyPrefix?: readonly string[];
  /**
   * The profile is discovery-payload-only: its predicate IS the whole claim and
   * it has no runtime floor. This flag exists so an EMPTY floor is a decision on
   * record rather than an absence — an absent key means "not yet transcribed",
   * which `verifyBundleProfile()` treats as unprovable (RFC 0148 §C). Conflating
   * the two is what let five undefined-floor claims verify as proven.
   */
  readonly discoveryOnly?: true;
  /**
   * The profile's discovery predicate is degenerate (it is `openwop-core`) and
   * `profiles.md` says the profile is "derivable from which scenarios pass" —
   * the RUNTIME floor decides whether the host holds it. `--certify` therefore
   * lists such a profile in `claimedProfiles` only when every floor requirement
   * recorded a witnessed `executed-pass`; otherwise the host simply does not
   * hold it, which is not a defect and not a rejection. Without this flag every
   * core host was "claiming" `openwop-node-packs` on the emitter's behalf and
   * then being rejected for not shipping a registry it never advertised.
   */
  readonly runtimeDerived?: true;
  /**
   * RFC 0148 §C gap G7 — a DISCOVERY-CONDITIONAL floor. Each entry adds its
   * `required` scenarios to the floor when the captured discovery document's
   * array at `path` (dot-path from the document root, RFC 0073) includes
   * `includes`. `profiles.md` §`openwop-replay-fork`: "the conformance
   * scenarios pass on whichever mode the host advertises" — a flat list either
   * over-requires (fails an honest single-mode host) or under-requires (the
   * vacuity RFC 0148 exists to close). Evaluated by `requirementsFor(profile,
   * document)`; without a document a conditional floor is UNEVALUABLE (null),
   * never empty. A conditional floor whose branches all miss evaluates to zero
   * requirements and therefore does not certify.
   */
  readonly conditional?: ReadonlyArray<{ readonly path: string; readonly includes: string; readonly required: readonly string[] }>;
}

export const PROFILE_FLOOR_SCENARIOS: Readonly<Record<string, ProfileFloor>> = {
  'openwop-core-standard': {
    required: [
      'runs-lifecycle.test.ts',
      'discovery.test.ts',
      'auth.test.ts',
      'eventOrdering.test.ts',
      'failure-path.test.ts',
      'idempotency.test.ts',
      'idempotency-key-determinism.test.ts',
      'webhook-negative.test.ts',
      // Removed 2026-08-16 (S6): since RFC 0088/0089 this list carried
      // `audit-log-verification.test.ts` — a file that has NEVER existed. The
      // RFC 0148 §A ledger surfaced it on its first end-to-end `--certify` run
      // as an unclassified floor requirement. The scenario it meant is
      // `audit-log-integrity.test.ts`, which soft-skips unless the host
      // advertises the OPTIONAL annex profile `openwop-audit-log-integrity`
      // (auth-profiles.md §"Audit-log integrity" — `GET /v1/audit/verify` is
      // REQUIRED-when-profile-claimed, not a core MUST). §C's membership rule
      // is "no soft-skip, no seam, no env-gate", and §B's predicate does not
      // include that profile, so by RFC 0088's own rule the row was never a
      // floor scenario. Audit-log integrity remains required by
      // `openwop-production` (PROFILE-DECISION-GUIDE) and certifiable on its
      // own profile; it is not part of `openwop-core-standard`.
    ],
    requiredAnyPrefix: ['interrupt-'],
  },

  // ── Floors TRANSCRIBED from `profiles.md`, not invented here ────────────────
  // `profiles.md` §"Claiming vs passing" already states the rule normatively:
  // "A host CLAIMS a profile by satisfying its predicate AND passing the
  // conformance scenarios labelled with the profile tag." Each per-profile
  // section then names its scenarios. This map was an incomplete transcription
  // of that prose, and every profile it omitted verified as floor-proven
  // against nothing (RFC 0148 §C, gap G6).

  // `profiles.md` §`openwop-core` is a pure discovery-payload predicate — it
  // names no runtime scenario, so the predicate IS the whole claim.
  'openwop-discovery-core': { required: [], discoveryOnly: true },
  'openwop-core': { required: [], discoveryOnly: true }, // deprecated alias (RFC 0155 §A)

  // `profiles.md` §`openwop-fixtures`: "The profile is discovery-payload-only —
  // it confirms the host claims SOME fixture, not that any specific fixture is
  // wired."
  'openwop-fixtures': { required: [], discoveryOnly: true },

  // `profiles.md` §`openwop-stream-sse`: "A host passes `openwop-stream-sse`
  // when discovery passes the predicate AND those scenarios pass."
  'openwop-stream-sse': {
    required: ['stream-modes.test.ts', 'stream-modes-buffer.test.ts', 'stream-modes-mixed.test.ts'],
  },

  // `profiles.md` §`openwop-stream-poll`: "Conformance scenarios in
  // `stream-modes.test.ts` exercise polling."
  'openwop-stream-poll': { required: ['stream-modes.test.ts'] },

  // `profiles.md` §`openwop-node-packs`: "a host passes `openwop-node-packs`
  // when it passes those scenarios."
  // RFC 0025 makes the `/v1/packs/*` read surface unconditional-when-shipped
  // with NO discovery advert, and `profiles.md` §openwop-node-packs says the
  // profile "is derivable from which scenarios pass" — so it is runtime-derived.
  'openwop-node-packs': { required: ['pack-registry.test.ts', 'pack-registry-publish.test.ts'], runtimeDerived: true },

  // ── Transcribed 2026-08-16 (RFC 0148 §C gap G7) ─────────────────────────────
  // Each floor below is named in `profiles.md`'s section for the profile
  // ("Floor (RFC 0148 §C)") and obeys `core-standard-profile.md` §C's membership
  // rule: black-box, no seam, no soft-skip on the profile's OWN advert. Fixture-
  // gated scenarios stay in (the conformance fixture IS the black-box seam and
  // its absence records honestly as blocked/skipped), capability-gated ones are
  // in only where the gate is the profile predicate itself.

  // `profiles.md` §`openwop-interrupts`: the `clarification.request` envelope is
  // the canonical interrupt envelope; the interrupt family proves resume.
  'openwop-interrupts': { required: ['interrupt-clarification.test.ts'], requiredAnyPrefix: ['interrupt-'] },

  // `profiles.md` §`openwop-secrets`: credential resolution per `run-options.md`
  // §"Credential references" — the BYOK canary round-trip (`fixtures.md`
  // §conformance-secrets-roundtrip, SR-1) is the profile's proof.
  'openwop-secrets': { required: ['byok-roundtrip.test.ts'] },

  // `profiles.md` §`openwop-provider-policy`: the four-mode taxonomy shape and
  // its enforcement on the wire.
  'openwop-provider-policy': { required: ['policies.test.ts', 'providerPolicyEnforcement.test.ts'] },

  // `profiles.md` §`openwop-memory`: capability model shape, write attribution
  // (RFC 0080 §A) and the degraded-projection contract (RFC 0080 §C).
  'openwop-memory': {
    required: [
      'memory-capability-model-shape.test.ts',
      'memory-attribution-shape.test.ts',
      'memory-attribution-emits-on-write.test.ts',
      'memory-degraded-projection.test.ts',
    ],
  },

  // `profiles.md` §`openwop-trigger-bridge`: "The runtime conformance scenarios
  // (`trigger-bridge-delivery.test.ts`, profile-gated) verify …" plus the shape.
  'openwop-trigger-bridge': { required: ['trigger-bridge-shape.test.ts', 'trigger-bridge-delivery.test.ts'] },

  // `profiles.md` §`openwop-replay-fork`: "This profile gates
  // `replayDeterminism.test.ts` and `replay-fork.test.ts` … the conformance
  // scenarios pass on whichever mode the host advertises." Discovery-conditional
  // on `replay.modes` (RFC 0073 root family).
  'openwop-replay-fork': {
    required: [],
    conditional: [
      // `replay` mode carries caveat 1 (a replay MUST NOT re-fire external
      // effects — unconditional, `replay.md`); the suppression scenario records
      // `blocked` when no probeable mechanism is advertised, so a
      // `sideEffectSuppression: none` host does NOT certify on determinism alone.
      { path: 'replay.modes', includes: 'replay', required: ['replayDeterminism.test.ts', 'replay-side-effect-suppression.test.ts'] },
      { path: 'replay.modes', includes: 'branch', required: ['replay-fork.test.ts'] },
    ],
  },
};

/** Is `profile` derivable from a discovery document? Maps a profile name to its predicate (RFC 0089 §B(1)). */
export function profileDerivable(c: DiscoveryPayload, profile: string): boolean {
  if (profile === 'openwop-core-standard') return isCoreStandard(c);
  if (profile === 'openwop-agent-platform') return agentPlatformStatus(c) !== 'none';
  if ((PROFILE_NAMES as readonly string[]).includes(profile)) {
    return deriveProfiles(c).includes(profile as ProfileName);
  }
  return false;
}

/** Minimal shape of an RFC 0089 certification bundle the verifier reads. */
export interface CertificationBundleLike {
  readonly discovery: { readonly document: DiscoveryPayload };
  readonly claimedProfiles: readonly string[];
  readonly results: { readonly passed: readonly string[] };
}

export interface BundleProfileVerdict {
  readonly profile: string;
  /** §B(1): derivable from the captured discovery document. */
  readonly derivable: boolean;
  /** §B(2): every floor scenario for the profile is in `results.passed`. */
  readonly floorProven: boolean;
  readonly valid: boolean;
  readonly missingFloor: readonly string[];
  /**
   * True when no floor set is defined for this profile, so §B(2) cannot be
   * evaluated at all. Distinct from `floorProven: false` with a populated
   * `missingFloor`, which means the floor WAS evaluated and the bundle failed
   * it. Both are invalid; only this one is a gap in the corpus rather than a
   * defect in the host.
   */
  readonly floorUnspecified: boolean;
}

const scenarioBasename = (id: string): string => id.split('/').pop() ?? id;

/**
 * Verify a bundle's claim for one profile per RFC 0089 §B. A consumer MUST
 * re-derive (this function) rather than trust `claimedProfiles` verbatim.
 */
export function verifyBundleProfile(bundle: CertificationBundleLike, profile: string): BundleProfileVerdict {
  const derivable = profileDerivable(bundle.discovery.document, profile);
  const floor = PROFILE_FLOOR_SCENARIOS[profile];

  // An UNDEFINED floor set makes §B(2) unevaluable, so the claim is unprovable —
  // never proven. Reading the old code, `missingFloor` fell to `[]` and
  // `prefixOk` to `[].every(...)` === true, so `floorProven` came out TRUE for
  // every profile this map omitted: the verifier reported a claim as floor-proven
  // having checked nothing. An empty floor that is a real decision says so with
  // `discoveryOnly` (RFC 0148 §C, gap G6).
  if (floor === undefined) {
    return { profile, derivable, floorProven: false, valid: false, missingFloor: [], floorUnspecified: true };
  }

  const passed = new Set(bundle.results.passed.map(scenarioBasename));
  // Discovery-conditional floors (RFC 0148 §C G7): evaluate the conditional
  // branches against the bundle's own captured discovery document.
  const requiredFiles: string[] = [...floor.required];
  for (const c of floor.conditional ?? []) {
    let cur: unknown = bundle.discovery.document;
    for (const seg of c.path.split('.')) cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined;
    if (Array.isArray(cur) && cur.includes(c.includes)) requiredFiles.push(...c.required);
  }
  const missingFloor = requiredFiles.filter((r) => !passed.has(scenarioBasename(r)));
  const prefixOk = (floor.requiredAnyPrefix ?? []).every((p) => [...passed].some((s) => s.startsWith(p)));
  // A conditional floor none of whose branches matched requires nothing — that
  // is unprovable for a non-discovery-only profile, not proven.
  const evaluable = floor.discoveryOnly === true || requiredFiles.length > 0 || (floor.requiredAnyPrefix ?? []).length > 0;
  const floorProven = evaluable && missingFloor.length === 0 && prefixOk;
  return {
    profile,
    derivable,
    floorProven,
    valid: derivable && floorProven,
    missingFloor,
    floorUnspecified: false,
  };
}

/** Verify every profile in `bundle.claimedProfiles`; the bundle is valid iff all claims are valid. */
export function verifyBundle(bundle: CertificationBundleLike): {
  readonly valid: boolean;
  readonly verdicts: readonly BundleProfileVerdict[];
} {
  const verdicts = bundle.claimedProfiles.map((p) => verifyBundleProfile(bundle, p));
  return { valid: verdicts.every((v) => v.valid), verdicts };
}
