/**
 * Managed-provider dispatch — server-held API key, per-tenant daily
 * token cap, underlying provider identity hidden from callers.
 *
 * The operator configures a managed provider (e.g. `openwop-free`) by
 * setting `MINIMAX_API_KEY` (etc.) in the environment. On boot,
 * `bootstrapManagedProvider()` encrypts the env key with the BYOK
 * master key and writes it to the `byok_secrets` table under a
 * well-known ref (`managed:openwop-free`). Subsequent dispatches read
 * the encrypted row, decrypt in-process, and call into the standard
 * `dispatchChat()` plumbing with the actual underlying provider
 * (e.g. `minimax`) and model.
 *
 * Caller contract:
 *   - `req.userFacingProvider` is the providers.json id ('openwop-free').
 *   - `req.tenantId` MUST be a signed-in tenant (`user:*`). Anonymous
 *     tenants are rejected with `sign_in_required`.
 *   - Daily token cap: input+output combined, per (tenant, day, provider).
 *     Reset at 00:00 UTC. Configurable via
 *     `OPENWOP_MANAGED_DAILY_TOKEN_CAP` (default 50000).
 *
 * Result rewriting:
 *   - The returned `provider` / `model` are the user-facing ids, NOT
 *     the underlying provider. Event log, audit log, and FE outputs
 *     therefore stay free of the underlying provider name.
 *
 * Not wired to: aiProvidersHost invocation-log cache, policy resolver,
 * or per-call OTel span (managed dispatch is ad-hoc chat, not replay-
 * deterministic workflow run). The chat-responder node calls this
 * module directly when it sees the managed credentialRef prefix.
 */

import { resolve as resolvePath } from 'node:path';
import {
  decrypt,
  encrypt,
  loadMasterKey,
  type EncryptedRecord,
} from '../byok/encryption.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import { dispatchChat, type ChatMessage, type ProviderId } from './dispatch.js';

const log = createLogger('providers.managed');

export const MANAGED_REF_PREFIX = 'managed:';

/** Default grounding prompt for the "Try it free" tier. Overridable via
 *  `OPENWOP_MANAGED_SYSTEM_PROMPT`. Kept short so it doesn't dominate
 *  the context window for every turn. */
const DEFAULT_SYSTEM_PROMPT =
  'You are an assistant for OpenWOP — a vendor-neutral open spec for AI workflow and agent orchestration. ' +
  'OpenWOP defines a wire protocol so different hosts can run the same agent workflows; it is a specification, ' +
  'not a platform or hosted service. The repo lives at https://github.com/openwop/openwop. ' +
  'Keep answers concise (2-4 sentences for most questions). ' +
  "When you don't actually know something, say so plainly rather than guessing.";

interface ManagedTarget {
  /** Underlying provider the dispatcher actually calls. Never leaks past this module. */
  provider: ProviderId;
  /** Underlying model id. */
  model: string;
  /** Storage ref under which the encrypted server-held key lives. */
  storageRef: string;
  /** Env var read at bootstrap to seed the storage row. */
  envKeyName: string;
  /** Per-tenant per-day cap (input + output tokens combined). */
  dailyTokenCap: number;
  /** System prompt prepended when the caller didn't supply one. Grounds
   *  the model in OpenWOP context so it doesn't hallucinate about what
   *  the product is. */
  defaultSystemPrompt: string;
}

/**
 * Build the managed-target map fresh on each call so env-var changes
 * (in tests or after a config push) take effect without restarting
 * the process. The hot path runs this once per dispatch — negligible
 * cost vs. an upstream LLM call.
 */
function getTargets(): Record<string, ManagedTarget> {
  const capRaw = Number(process.env.OPENWOP_MANAGED_DAILY_TOKEN_CAP);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 50000;
  return {
    'openwop-free': {
      provider: 'minimax',
      model: process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7',
      storageRef: `${MANAGED_REF_PREFIX}openwop-free`,
      envKeyName: 'MINIMAX_API_KEY',
      dailyTokenCap: cap,
      defaultSystemPrompt: process.env.OPENWOP_MANAGED_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    },
  };
}

export function isManagedCredentialRef(ref: string | undefined | null): boolean {
  return typeof ref === 'string' && ref.startsWith(MANAGED_REF_PREFIX);
}

/** Convert a managed credentialRef back to its user-facing provider id. */
export function managedProviderIdFromRef(ref: string): string {
  return ref.slice(MANAGED_REF_PREFIX.length);
}

export type ManagedErrorCode =
  | 'sign_in_required'
  | 'daily_limit_reached'
  | 'managed_unavailable'
  | 'managed_unknown';

export class ManagedProviderError extends Error {
  readonly code: ManagedErrorCode;
  constructor(code: ManagedErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ManagedProviderError';
  }
}

let storageRef: Storage | null = null;
let masterKeyPathRef: string | null = null;
const decryptCache = new Map<string, string>();

export function configureManagedProvider(input: { storage: Storage; dataDir: string }): void {
  storageRef = input.storage;
  masterKeyPathRef = resolvePath(input.dataDir, '.byok-master-key');
}

/**
 * Seed each configured managed provider's key from its env var into
 * storage on boot. Idempotent: skips when the stored cipher decrypts
 * to the same plaintext; overwrites when the env value changed; logs
 * + skips when the env var is unset (provider becomes unavailable
 * until the operator sets it).
 */
export async function bootstrapManagedProvider(): Promise<void> {
  if (!storageRef || !masterKeyPathRef) {
    throw new Error('managedProvider not configured — call configureManagedProvider() first.');
  }
  for (const [providerId, t] of Object.entries(getTargets())) {
    const envKey = process.env[t.envKeyName];
    if (!envKey) {
      log.info('managed provider env key absent — provider unavailable until set', {
        providerId,
        envVar: t.envKeyName,
      });
      continue;
    }
    const existing = await storageRef.getEncryptedSecret(t.storageRef);
    if (existing) {
      try {
        const rec = JSON.parse(existing) as EncryptedRecord;
        const current = decrypt(rec, loadMasterKey(masterKeyPathRef));
        if (current === envKey) {
          log.info('managed provider key unchanged from env — no rotation needed', { providerId });
          continue;
        }
      } catch {
        // Stored record undecryptable — overwrite below.
      }
    }
    const masterKey = loadMasterKey(masterKeyPathRef);
    const record = encrypt(envKey, masterKey);
    await storageRef.upsertEncryptedSecret(
      t.storageRef,
      JSON.stringify(record),
      new Date().toISOString(),
    );
    decryptCache.delete(t.storageRef);
    log.info('managed provider key seeded from env', { providerId, envVar: t.envKeyName });
  }
}

async function resolveManagedKey(storageRefName: string): Promise<string | null> {
  const cached = decryptCache.get(storageRefName);
  if (cached !== undefined) return cached;
  if (!storageRef || !masterKeyPathRef) return null;
  const enc = await storageRef.getEncryptedSecret(storageRefName);
  if (!enc) return null;
  try {
    const rec = JSON.parse(enc) as EncryptedRecord;
    const pt = decrypt(rec, loadMasterKey(masterKeyPathRef));
    decryptCache.set(storageRefName, pt);
    return pt;
  } catch (err) {
    log.error('failed to decrypt managed key', {
      storageRef: storageRefName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSignedInTenant(tenantId: string): boolean {
  return tenantId.startsWith('user:');
}

export interface ManagedDispatchRequest {
  /** providers.json id, e.g. 'openwop-free'. */
  userFacingProvider: string;
  /** Caller tenant — must be signed-in (`user:*`). */
  tenantId: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  onDelta?: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Mirrors the relevant subset of DispatchResult. `provider` / `model`
 *  are the user-facing ids — the underlying provider is intentionally
 *  not exposed past this boundary. */
export interface ManagedDispatchResult {
  provider: string;
  model: string;
  completion: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  finishReason?: string;
}

export async function dispatchManagedChat(
  req: ManagedDispatchRequest,
): Promise<ManagedDispatchResult> {
  const target = getTargets()[req.userFacingProvider];
  if (!target) {
    throw new ManagedProviderError(
      'managed_unknown',
      `No managed target configured for provider "${req.userFacingProvider}".`,
    );
  }
  if (!isSignedInTenant(req.tenantId)) {
    throw new ManagedProviderError('sign_in_required', 'Sign in to use the free tier.');
  }
  if (!storageRef) {
    throw new ManagedProviderError(
      'managed_unavailable',
      'Free tier not configured on this server.',
    );
  }

  const date = todayUtc();
  const usage = await storageRef.getManagedUsage(req.tenantId, req.userFacingProvider, date);
  const totalUsed = usage.inputTokens + usage.outputTokens;
  if (totalUsed >= target.dailyTokenCap) {
    throw new ManagedProviderError(
      'daily_limit_reached',
      `Daily limit reached (${target.dailyTokenCap} tokens). Resets at 00:00 UTC.`,
    );
  }

  const apiKey = await resolveManagedKey(target.storageRef);
  if (!apiKey) {
    throw new ManagedProviderError(
      'managed_unavailable',
      'Free tier is temporarily unavailable. Try again later or bring your own key.',
    );
  }

  // Inject the default system prompt when the caller didn't supply one.
  // Grounds the model in OpenWOP context so the "what is openwop?"
  // hallucination from a stock chat model doesn't reach end users.
  // Callers who DO supply a system message (workflow authors, packs)
  // keep full control.
  const hasSystem = req.messages.some((m) => m.role === 'system');
  const messages = hasSystem
    ? req.messages
    : [
        { role: 'system' as const, content: target.defaultSystemPrompt },
        ...req.messages,
      ];

  const result = await dispatchChat({
    provider: target.provider,
    model: target.model,
    apiKey,
    messages,
    ...(req.maxTokens != null ? { maxTokens: req.maxTokens } : {}),
    ...(req.onDelta ? { onDelta: req.onDelta } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });

  // Best-effort usage increment — never fail the call on a write error
  // (a failed write means this turn is effectively free for the user,
  // which is the safer skew vs. blocking the response).
  const inTok = result.usage?.inputTokens ?? 0;
  const outTok = result.usage?.outputTokens ?? 0;
  if (inTok > 0 || outTok > 0) {
    try {
      await storageRef.incrementManagedUsage(
        req.tenantId,
        req.userFacingProvider,
        date,
        inTok,
        outTok,
      );
    } catch (err) {
      log.warn('failed to increment managed usage', {
        tenantId: req.tenantId,
        provider: req.userFacingProvider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    provider: req.userFacingProvider,
    model: req.userFacingProvider,
    completion: result.completion,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
}

/** Test affordance — drop in-process caches without touching storage. */
export function _clearManagedCacheForTests(): void {
  decryptCache.clear();
}
