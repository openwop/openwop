/**
 * Per-run secret context with strip-on-persist.
 *
 * Holds resolved secret values in-memory only — keyed by runId — for
 * the duration of run execution. The storage adapter MUST call
 * `stripSecretsFromPersisted()` before any RunRecord write so secret
 * material never reaches the database.
 *
 * Tested invariant: after `setRunSecrets(runId, {...})` →
 * `stripSecretsFromPersisted(rec)` → the resulting object contains no
 * secret values, only `credentialRef` placeholders.
 */

const ephemeralByRun = new Map<string, Record<string, string>>();

export function setRunSecrets(runId: string, secrets: Record<string, string>): void {
  ephemeralByRun.set(runId, { ...secrets });
}

export function getRunSecrets(runId: string): Record<string, string> {
  return ephemeralByRun.get(runId) ?? {};
}

export function clearRunSecrets(runId: string): void {
  ephemeralByRun.delete(runId);
}

/**
 * Build a Proxy view over a secrets map that allows direct key
 * lookup (`secrets[ref]`) but throws when code attempts to ENUMERATE
 * the map (`Object.keys`, `Object.entries`, `JSON.stringify`,
 * spread, `for…in`, etc.).
 *
 * Used by the executor to hand pack-loaded node code a non-iterable
 * view of `ctx.secrets` — packs that need to authenticate against a
 * provider can look up a known ref by name, but can't exfiltrate the
 * whole keyring through an `outputs` field. The host-owned adapter
 * (`aiProvidersHost.ts`) receives the RAW map so its convention-
 * based lookup still works.
 *
 * NOTE: This is defense-in-depth. A malicious pack with arbitrary
 * code execution could still call `String.prototype` tricks or use
 * `Reflect.ownKeys` shenanigans. The true sandbox is the worker-
 * thread / wasm isolation per RFC 0008 (not implemented in this sample).
 */
export function nonEnumerableSecretsView(secrets: Record<string, string>): Record<string, string> {
  return new Proxy(secrets, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      return target[prop];
    },
    has(target, prop) {
      return typeof prop === 'string' && prop in target;
    },
    ownKeys() {
      throw new Error('secrets_view_not_enumerable: ctx.secrets is non-enumerable in pack code; look up known refs by name (e.g., secrets["anthropic"]).');
    },
    getOwnPropertyDescriptor() {
      throw new Error('secrets_view_not_enumerable: ctx.secrets is non-enumerable in pack code; look up known refs by name (e.g., secrets["anthropic"]).');
    },
  }) as Record<string, string>;
}

/**
 * Returns a deep-copy of `payload` with any string value matching a
 * known secret replaced by `"<<redacted:${credentialRef}>>"`. Walks
 * nested objects + arrays.
 *
 * Called by the storage adapter immediately before persistence and by
 * the event-log adapter immediately before append.
 */
export function stripSecretsFromPersisted<T>(payload: T): T {
  const allSecrets = new Map<string, string>();
  for (const [_runId, perRun] of ephemeralByRun) {
    for (const [ref, val] of Object.entries(perRun)) {
      if (val) allSecrets.set(val, ref);
    }
  }
  if (allSecrets.size === 0) return payload;

  function walk(value: unknown): unknown {
    if (typeof value === 'string') {
      const ref = allSecrets.get(value);
      return ref ? `<<redacted:${ref}>>` : value;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  }

  return walk(payload) as T;
}
