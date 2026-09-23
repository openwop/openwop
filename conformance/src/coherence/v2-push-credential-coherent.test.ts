/**
 * RFC 0214 §A–§B — `openwop.requirement.0214.push-credential-coherent`: the
 * corpus states the A2A push-credential exception in every place a reader meets
 * the rule it excepts, so the body-credential clause of security-defaults.md
 * §"Onward hops" and A2A v1.0.1 §4.3.3 can no longer be read as contradicting.
 *
 * Runs in the corpus gate, never in a host bundle. No host advertises
 * `a2a.pushNotifications` (2026-09-23), so this is the only witness the
 * correction has; it witnesses the TEXT, not host behavior.
 *
 * A predicate that is true on the tracked corpus witnesses nothing on its own,
 * so the same `it` also feeds the predicate sabotaged copies — each a regression
 * the check exists to catch — and asserts every one is refused.
 *
 * @see RFCS/0214-a2a-push-credential-is-a-destination-credential.md §A, §B
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ROOT = join(SCHEMAS_DIR, '..');
const ID = 'openwop.requirement.0214.push-credential-coherent';
const DOC = 'RFCS/0214 §A–§B; spec/v2/core/security-defaults.md §"Onward hops"; spec/v2/core/interop.md §"A2A push delivery"';

interface Corpus { security: string; interop: string; webhooks: string; replay: string; createRule: string; readRule: string }

interface OpRow { upstream?: string; rule?: string }
function load(): Corpus {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
  const map = JSON.parse(read('spec/v2/interop-map.json')) as { a2a: { operations: OpRow[] } };
  const rule = (name: string): string => map.a2a.operations.find((r) => (r.upstream ?? '').startsWith(name))?.rule ?? '';
  return {
    security: read('spec/v2/core/security-defaults.md'),
    interop: read('spec/v2/core/interop.md'),
    webhooks: read('spec/v2/core/webhooks.md'),
    replay: read('spec/v2/core/replay.md'),
    createRule: rule('CreateTaskPushNotificationConfig'),
    readRule: rule('GetTaskPushNotificationConfig'),
  };
}

/** Every clause the correction depends on, as a list of the ones missing. */
function missing(c: Corpus): string[] {
  const out: string[] = [];
  const onward = c.security.slice(c.security.indexOf('### Onward hops'));
  if (!/push-config credential/.test(onward) || !/registered push URL/.test(onward)) out.push('security-defaults.md §"Onward hops" names the push-config credential and binds it to the registered push URL');
  if (!/MUST NOT attach it after a redirect/.test(onward)) out.push('security-defaults.md §"Onward hops" forbids the push credential after a redirect');
  if (!/^## A2A push delivery/m.test(c.interop)) out.push('interop.md has §"A2A push delivery"');
  if (!/binds at delivery time/.test(c.interop)) out.push('interop.md §"A2A push delivery" binds the webhook egress guard at delivery time');
  if (!/bind an A2A push identically/.test(c.webhooks)) out.push('webhooks.md §Egress names A2A push');
  if (!/A2A push, outbound streams/.test(c.replay) || !/MUST NOT inherit its source's A2A push configs/.test(c.replay)) out.push('replay.md Fan-out names A2A push and forbids inheriting push configs');
  if (!/destination credential/.test(c.createRule) || !/again at delivery/.test(c.createRule)) out.push('the CreateTaskPushNotificationConfig rule names the destination credential and the delivery-time guard');
  if (!/answered as an unknown id/.test(c.readRule) || !/PushNotificationNotSupportedError/.test(c.readRule)) out.push('the Get/List/Delete rule states unknown-id isolation and the unadvertised refusal');
  return out;
}

const SABOTAGE: Array<[string, (c: Corpus) => Corpus]> = [
  ['the carve-out sentence removed from §"Onward hops"', (c) => ({ ...c, security: c.security.replace(/One credential is not inbound in this sense:[^\n]*/, '') })],
  ['the redirect clause dropped', (c) => ({ ...c, security: c.security.replace('MUST NOT attach it after a redirect or', 'MUST NOT attach it') })],
  ['interop.md §"A2A push delivery" removed', (c) => ({ ...c, interop: c.interop.replace(/## A2A push delivery[\s\S]*?(?=\n## )/, '') })],
  ['webhooks.md cross-reference removed', (c) => ({ ...c, webhooks: c.webhooks.replace(/ These delivery-time rules bind an A2A push identically[^\n]*?\./, '') })],
  ['replay.md Fan-out reverted', (c) => ({ ...c, replay: c.replay.replace('webhook delivery, A2A push, outbound streams', 'webhook delivery, outbound streams') })],
  ['Create rule reverted to registration-only', (c) => ({ ...c, createRule: c.createRule.replace('and again at delivery', '') })],
  ['Get/List/Delete rule loses isolation', (c) => ({ ...c, readRule: c.readRule.replace(/ An unreadable task[^.]*\./, '') })],
];

describe('RFC 0214 — v2-push-credential-coherent (corpus)', () => {
  it('the push-credential exception is stated wherever the rule it excepts is read, and each regression is refused', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout — the core prose and interop map live in the corpus repository');
    const corpus = load();
    expect(missing(corpus), req(ID, DOC, 'every clause of the RFC 0214 correction is present in the tracked corpus')).toEqual([]);
    for (const [label, mutate] of SABOTAGE) {
      expect(missing(mutate(corpus)).length, req(ID, DOC, `sabotage "${label}" MUST be refused by the check`)).toBeGreaterThan(0);
    }
  });
});
