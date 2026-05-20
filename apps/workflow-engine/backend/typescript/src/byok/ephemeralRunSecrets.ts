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
/**
 * Vendor-pattern detector for credential-shaped strings the host
 * SHOULD scrub from event payloads even without an explicit BYOK
 * registration. Per `capabilities.md §"Secrets" + NFR-7`: arbitrary
 * credential-shaped inputs MUST NOT leak verbatim into observable
 * surfaces (event log, OTel spans, debug bundle, etc.).
 *
 * Patterns: prefix + 20+ allowed chars (covers OpenAI `sk-`,
 * Anthropic `sk-ant-`, OpenAI project keys `sk-proj-`, generic
 * Bearer tokens, GitHub `ghp_`/`gho_`). Conservative — these prefixes
 * rarely false-positive against normal text. Plus the conformance
 * suite's `CANARY-openwop-CONFORMANCE-NEVER-SECRET` marker for
 * explicit-canary test fixtures.
 *
 * Returns the redaction marker for matching substrings.
 */
// Negative lookbehind/lookahead boundaries instead of `\b` because the
// token classes include `_` and `-`, which `\b` treats inconsistently
// (`_` is a word char; `-` isn't). A `_`/`-` adjacent to a credential
// shape would skip detection via `\b`. The lookarounds anchor to
// alphanumerics + underscore explicitly, so a token followed by `_xyz`
// (snake_case context) still matches.
const CREDENTIAL_SHAPE_RE = /(?<![A-Za-z0-9_])(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,})(?![A-Za-z0-9])|CANARY-openwop-CONFORMANCE-NEVER-SECRET[A-Za-z0-9_-]*/g;

function scrubCredentialShapes(s: string): string {
  return s.replace(CREDENTIAL_SHAPE_RE, '<<redacted:credential-shape>>');
}

export function stripSecretsFromPersisted<T>(payload: T): T {
  const allSecrets = new Map<string, string>();
  for (const [_runId, perRun] of ephemeralByRun) {
    for (const [ref, val] of Object.entries(perRun)) {
      if (val) allSecrets.set(val, ref);
    }
  }

  function walk(value: unknown): unknown {
    if (typeof value === 'string') {
      // Tier 1: known BYOK-resolved secrets get a labeled redaction
      // (preserves credentialRef → marker mapping for audit trails).
      const ref = allSecrets.get(value);
      if (ref) return `<<redacted:${ref}>>`;
      // Tier 2: credential-shaped strings AND conformance canaries
      // get a generic shape-based scrub. Defense-in-depth against
      // canaries the BYOK layer never saw.
      return scrubCredentialShapes(value);
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
