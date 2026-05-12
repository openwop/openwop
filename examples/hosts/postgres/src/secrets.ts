/**
 * Host-side secret resolver for the Postgres reference host.
 *
 * Per spec/v1/auth.md §"Secret resolution" + run-options.md §"Credential
 * references", clients reference stored secrets via opaque ids
 * (`credentialRef`); the host resolves to cleartext server-side and
 * NEVER echoes the resolved value into event payloads, debug bundles,
 * webhook envelopes, or logs.
 *
 * **Reference implementation scope.** This module supports the
 * conformance canary id only (`openwop-conformance-canary-secret`).
 * Production deployers replace `resolveCanarySecret` with a real KMS /
 * Vault adapter behind the same `SecretResolver` interface. The wire
 * contract stays: `{secretId} → cleartext | null`, with `null` mapped
 * to `credential_unavailable` per auth.md.
 *
 * Security invariants honored:
 *
 *   - **SR-1** (threat-model-secret-leakage.md): the resolver returns
 *     cleartext ONLY to the caller (node executor) and the caller hashes
 *     before any emission. Every observable surface — events, debug
 *     bundle, webhooks, logs, variables — sees the hash + length, never
 *     the raw value. See `conformance.secret.echo` case in `server.ts`.
 *
 *   - **CTI-1** (agent-memory.md): per-tenant scope. The reference host
 *     is single-tenant; multi-tenant deployers MUST scope resolution by
 *     authenticated principal so tenant A cannot resolve tenant B's
 *     credentialRefs.
 *
 * @see spec/v1/auth.md §"Secret resolution"
 * @see spec/v1/run-options.md §"Credential references"
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

/**
 * Resolve a host-provisioned secret by opaque id.
 *
 * Returns the cleartext value when the id is known and provisioned,
 * `null` otherwise. The conformance canary id is honored unconditionally
 * (with `OPENWOP_CANARY_SECRET_VALUE` env override for ops scenarios).
 *
 * Production deployers SHOULD replace this function with a KMS / Vault
 * lookup that:
 *   1. Authenticates the request against the calling tenant.
 *   2. Audit-logs the resolution (without the cleartext).
 *   3. Returns `null` rather than throwing on miss, so the executor can
 *      surface `credential_unavailable` rather than crash the run.
 */
export function resolveCanarySecret(secretId: string): string | null {
  if (secretId === 'openwop-conformance-canary-secret') {
    return (
      process.env.OPENWOP_CANARY_SECRET_VALUE ??
      'openwop-canary-secret-value-not-a-real-credential'
    );
  }
  return null;
}

/**
 * Capability advertisement helper. Hosts that resolve any secret at all
 * advertise `secrets.supported: true`; those that permit BYOK additionally
 * declare which AI providers permit credentialRef. See capabilities.md
 * §`secrets` + §`aiProviders`.
 *
 * The reference host advertises:
 *   - `secrets.supported: true` (canary resolver exists)
 *   - `secrets.scopes: ["tenant"]` (multi-tenant deployers extend this)
 *   - `secrets.resolution: "host-managed"` (v1.x only option)
 *
 * AI-provider claims (anthropic / openai / etc.) require an actual
 * AI-proxy implementation — landed in H.1″ alongside `core.llm.chat`.
 * Until that ships, the host advertises BYOK-ready (`aiProviders.byok`
 * non-empty) but does not claim AI proxying.
 */
export interface SecretsCapability {
  readonly supported: true;
  readonly scopes: ReadonlyArray<'tenant' | 'user' | 'run'>;
  readonly resolution: 'host-managed';
}

export const REFERENCE_SECRETS_CAPABILITY: SecretsCapability = {
  supported: true,
  scopes: ['tenant'],
  resolution: 'host-managed',
};
