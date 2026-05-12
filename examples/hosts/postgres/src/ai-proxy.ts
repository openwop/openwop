/**
 * AI proxy + provider-policy enforcement for the Postgres reference host.
 *
 * Phase H.1″ — myndhyve.ai launch-blocker. Implements `core.llm.chat`
 * and `core.llm.completion` typeIds plus the 4-mode policy enforcement
 * from `capabilities.md` §`aiProviders.policies`.
 *
 * **Provider routing.** The reference host does NOT call real LLM
 * providers — it stubs the response with a deterministic SHA-256-based
 * mock so myndhyve.ai (or any downstream deployer) can swap in the
 * real provider clients (`@anthropic-ai/sdk`, `openai`, etc.) without
 * changing the policy-enforcement contract above. The stub preserves
 * the wire shape conformance scenarios care about: `node.completed`
 * payload includes `{provider, model, outputText, inputTokens,
 * outputTokens, durationMs}` with the resolved credentialRef NEVER
 * appearing on any observable surface (SR-1).
 *
 * **Policy modes** per `capabilities.md` §`aiProviders.policies`:
 *
 *   - `disabled`   — reject before LLM call with reason `provider_disabled`
 *   - `optional`   — permit (default when no policy advertised)
 *   - `required`   — credentialRef MUST be present and resolvable;
 *                    rejects with `byok_required` (absent) or
 *                    `byok_required_but_unresolved` (present-but-unresolves)
 *   - `restricted` — model MUST match one of `allowedModels` (glob);
 *                    rejects with `model_not_allowed`
 *
 * **Fail-open vs fail-closed.** Per spec §"Resolver behavior":
 *   - Resolver outage → fail-open to `optional`.
 *   - `restricted` policy resolved with empty `allowedModels` → fail-CLOSED
 *     (misconfiguration, not outage) → `model_not_allowed` with
 *     `details.allowed: []`.
 *
 * **No raw credential ever lands on events / variables / logs.** The
 * resolver returns cleartext to this module only; we use it locally for
 * the (mocked) provider call and discard. The event-log payload carries
 * `{credentialRefHashed: <sha256>, ...}` so audit trails can correlate
 * runs to credentialRefs without exposing the underlying secret.
 *
 * @see spec/v1/capabilities.md §`aiProviders` + §`aiProviders.policies`
 * @see spec/v1/run-options.md §"Credential references"
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

import { createHash } from 'node:crypto';
import { resolveCanarySecret } from './secrets.js';

export type PolicyMode = 'disabled' | 'optional' | 'required' | 'restricted';

export interface AiProviderPolicy {
  readonly mode: PolicyMode;
  readonly allowedModels?: ReadonlyArray<string>;
}

/**
 * Reference host's policy store: a single in-memory map keyed by
 * provider id. Production deployers replace this with workspace/
 * project/canvas-type scoped resolution per spec §"Resolver behavior".
 * For the reference host we only support a single layer keyed by
 * env-driven configuration (the conformance suite injects via
 * `OPENWOP_AI_POLICY_<PROVIDER>=<mode>[:model1,model2]`).
 */
export function resolveProviderPolicy(provider: string): AiProviderPolicy {
  const envKey = `OPENWOP_AI_POLICY_${provider.toUpperCase()}`;
  const raw = process.env[envKey];
  if (!raw) {
    return { mode: 'optional' };
  }
  const [modePart, modelsPart] = raw.split(':');
  const mode = ((): PolicyMode => {
    switch (modePart) {
      case 'disabled':
      case 'optional':
      case 'required':
      case 'restricted':
        return modePart;
      default:
        // Unknown → fail-open to optional (resolver-outage equivalence).
        return 'optional';
    }
  })();
  const allowedModels = modelsPart
    ? modelsPart.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : [];
  return { mode, allowedModels };
}

export interface AiCallRequest {
  readonly provider: string;
  readonly model: string;
  readonly credentialRef?: string;
  /** chat messages (for core.llm.chat) OR completion prompt (for core.llm.completion). */
  readonly input: unknown;
}

export interface AiCallResult {
  readonly provider: string;
  readonly model: string;
  readonly outputText: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  /** SHA-256 of the resolved credentialRef cleartext (NEVER the raw value). */
  readonly credentialRefHashed: string | null;
}

export class AiPolicyDenied extends Error {
  constructor(
    public readonly reason:
      | 'provider_disabled'
      | 'byok_required'
      | 'byok_required_but_unresolved'
      | 'model_not_allowed',
    public readonly details: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = 'AiPolicyDenied';
  }
}

export class AiProviderUnknown extends Error {
  constructor(public readonly provider: string) {
    super(`AI provider "${provider}" is not in the host's supported list`);
    this.name = 'AiProviderUnknown';
  }
}

const HOST_SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'gemini',
]);
const HOST_BYOK_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'gemini',
]);

/**
 * Glob match for `allowedModels` patterns (`*` matches any character
 * sequence; case-sensitive). `gpt-4*` matches `gpt-4`, `gpt-4-turbo`,
 * `gpt-4o`. No escape semantics — `*` is the only metacharacter.
 */
function modelMatchesGlob(model: string, pattern: string): boolean {
  // Convert glob to regex, escaping regex special chars except `*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(model);
}

/**
 * Enforce the resolved policy for a (provider, model, credentialRef)
 * tuple. Throws `AiPolicyDenied` on denial; returns the resolved
 * credential cleartext (or null when no credentialRef supplied).
 *
 * Callers MUST treat the returned cleartext as ephemeral — pass to the
 * provider client, then discard. Do NOT log, persist, or echo onto an
 * event payload.
 */
export function enforcePolicy(
  policy: AiProviderPolicy,
  request: AiCallRequest,
): { credentialCleartext: string | null } {
  if (!HOST_SUPPORTED_PROVIDERS.has(request.provider)) {
    throw new AiProviderUnknown(request.provider);
  }

  switch (policy.mode) {
    case 'disabled':
      throw new AiPolicyDenied(
        'provider_disabled',
        { provider: request.provider },
        `Provider "${request.provider}" is disabled by host policy`,
      );

    case 'optional':
      // No restriction. Resolve credentialRef opportunistically.
      if (request.credentialRef !== undefined) {
        const resolved = resolveCanarySecret(request.credentialRef);
        return { credentialCleartext: resolved };
      }
      return { credentialCleartext: null };

    case 'required': {
      if (request.credentialRef === undefined || request.credentialRef === '') {
        throw new AiPolicyDenied(
          'byok_required',
          { provider: request.provider },
          `Provider "${request.provider}" requires BYOK; credentialRef MUST be supplied`,
        );
      }
      const resolved = resolveCanarySecret(request.credentialRef);
      if (resolved === null) {
        throw new AiPolicyDenied(
          'byok_required_but_unresolved',
          { provider: request.provider, credentialRef: request.credentialRef },
          `Provider "${request.provider}" requires BYOK and credentialRef "${request.credentialRef}" did not resolve`,
        );
      }
      return { credentialCleartext: resolved };
    }

    case 'restricted': {
      const allowed = policy.allowedModels ?? [];
      const matches = allowed.length > 0 && allowed.some((p) => modelMatchesGlob(request.model, p));
      if (!matches) {
        throw new AiPolicyDenied(
          'model_not_allowed',
          { provider: request.provider, model: request.model, allowed: [...allowed] },
          allowed.length === 0
            ? `Provider "${request.provider}" has restricted policy with empty allowedModels (fail-closed)`
            : `Provider "${request.provider}" model "${request.model}" does not match allowedModels (${allowed.join(', ')})`,
        );
      }
      // Restricted permits the call (with or without BYOK). Resolve
      // credentialRef opportunistically like `optional`.
      if (request.credentialRef !== undefined) {
        const resolved = resolveCanarySecret(request.credentialRef);
        return { credentialCleartext: resolved };
      }
      return { credentialCleartext: null };
    }

    default:
      // Forward-compat: unknown mode → fail-open to optional.
      return { credentialCleartext: null };
  }
}

/**
 * Stub LLM call. Deterministic mock response derived from a SHA-256
 * digest of the request (so replay scenarios get identical outputs
 * for identical inputs). The cleartext credential, when supplied,
 * influences the mock to validate that the credential reached the
 * provider boundary — but the cleartext is NEVER returned in the
 * result; only its SHA-256 is exposed via `credentialRefHashed`.
 *
 * Production deployers replace this function with real provider SDK
 * calls (`@anthropic-ai/sdk`, `openai`, etc.). The wire contract
 * (input → AiCallResult) stays identical.
 */
export async function callAiProvider(
  request: AiCallRequest,
  credentialCleartext: string | null,
): Promise<AiCallResult> {
  const started = Date.now();
  const inputBytes = JSON.stringify(request.input).length;
  // Mock output text: include the model so tests can verify routing,
  // but do NOT include any portion of the credential. The credential
  // cleartext is used solely to compute the redaction hash.
  const outputText = `[reference-host-mock] provider=${request.provider} model=${request.model} input-bytes=${inputBytes}`;
  // Naive token counts: 1 token ≈ 4 bytes (approximation).
  const inputTokens = Math.ceil(inputBytes / 4);
  const outputTokens = Math.ceil(outputText.length / 4);
  const credentialRefHashed = credentialCleartext !== null
    ? createHash('sha256').update(credentialCleartext, 'utf8').digest('hex')
    : null;
  // Cleartext is now discarded — it never lands on AiCallResult.
  void credentialCleartext;
  return {
    provider: request.provider,
    model: request.model,
    outputText,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
    credentialRefHashed,
  };
}

/**
 * Capability advertisement payload — the host emits this under
 * `capabilities.aiProviders` in `/.well-known/openwop`. Mirrors the
 * spec example in capabilities.md §`aiProviders.policies`.
 */
export const REFERENCE_AI_PROVIDERS_CAPABILITY = {
  supported: [...HOST_SUPPORTED_PROVIDERS],
  byok: [...HOST_BYOK_PROVIDERS],
  policies: {
    modes: ['disabled', 'optional', 'required', 'restricted'] as const,
    scopes: ['workspace'] as const,
    errorCode: 'provider_policy_denied',
  },
} as const;
