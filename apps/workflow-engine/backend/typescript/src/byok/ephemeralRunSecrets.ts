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
