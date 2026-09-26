/**
 * Does any event's payload carry `sent`, as JSON — member order ignored?
 *
 * `v2-a2ui-v09-surface` asserted RFC 0209 §C.11 ("recorded surface envelopes
 * are returned as recorded") by comparing `JSON.stringify(subtree)` with
 * `JSON.stringify(sent)`. That comparison is ORDER-sensitive, and RFC 8259 §4
 * gives object member order no meaning. A Postgres JSONB host returns every
 * member and every value but re-sorts keys (shorter first, then bytewise):
 * measured on pg16, `{version,catalogId,surfaceId,messages}` came back as
 * `{version,messages,catalogId,surfaceId}`. So a conforming host could never
 * pass the leg (suite 2.42.2 correction).
 *
 * The comparison is now between RFC 8785 (JCS) forms, the corpus's canonical
 * JSON (`lib/jcs.ts`; conformance.md §"Canonical JSON"). JCS sorts members and
 * fixes number and string serialization, so two values are JCS-equal exactly
 * when they are the same JSON value. What §C.11 forbids, a regenerated or
 * altered surface, still fails: a changed value, a dropped or added member, or
 * a reordered ARRAY (message order is meaningful) all change the JCS form.
 */

import { canonicalJSON } from './jcs.js';

/** Every subtree of `v`, depth-first. */
function* subtrees(v: unknown): Generator<unknown> {
  yield v;
  if (Array.isArray(v)) for (const x of v) yield* subtrees(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* subtrees(x);
}

/** JCS form, or null for a value JCS refuses (not I-JSON), which then matches nothing. */
function jcs(v: unknown): string | null {
  try { return canonicalJSON(v); } catch { return null; }
}

export function carriesPayload(events: readonly unknown[], sent: unknown): boolean {
  const want = jcs(sent);
  if (want === null) return false;
  return events.some((e) => {
    const payload = e !== null && typeof e === 'object' ? (e as Record<string, unknown>)['payload'] : undefined;
    return [...subtrees(payload)].some((s) => jcs(s) === want);
  });
}
