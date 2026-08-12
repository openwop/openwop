/**
 * RFC 0150 §B — the Layer-2 logical effect identity is stable across retries.
 *
 * `spec/v1/idempotency.md` contradicted itself. §"Idempotency key composition"
 * put `attempt` — documented one line later as the "zero-based retry attempt
 * counter" — inside the hash, while §"Composition: how the layers compose"
 * promised that when "the engine retries the OpenAI call internally (transient
 * 503), Layer 2's `invocationId` is identical, so the second call either
 * short-circuits (cache hit) or hits OpenAI's own idempotency cache".
 *
 * Both cannot hold. A retry counter in the key means every retry hashes to a
 * NEW key, so the invocation log never hits, the injected `Idempotency-Key`
 * differs, and the provider's own dedup is defeated too. The composition
 * guaranteed a duplicate side effect on precisely the path Layer 2 exists to
 * protect — a duplicate charge, a duplicate send, a duplicate completion.
 *
 * The defect was invisible to every gate in the corpus because both halves are
 * prose. Nothing parsed the formula, and nothing cross-read it against the
 * paragraph asserting the opposite.
 *
 * This gate reads the normative composition block and holds it to §B: domain
 * separation, tenant binding, a per-logical-invocation ordinal that is stable
 * across retries, and NO retry counter. `attempt` remains legitimate telemetry;
 * §B's requirement is that it MUST NOT participate in the identity.
 *
 * Server-free and always-on: it reads the corpus, never a host. `spec/v1/`
 * ships in the repository and NOT in the published tarball, so it self-skips
 * under the published layout — the asymmetry that has already produced three
 * defects here (the `CORPUS-STAMP` gate, the link-checker's filesystem walk,
 * and RFC 0146 leg A4).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';

const HEADING = '### Idempotency key composition';

/**
 * The first fenced block under the composition heading. Returns null when the
 * heading or its fence is absent, so the guard leg can fail loudly rather than
 * letting every assertion below pass over an empty string.
 */
function compositionBlock(doc: string): string | null {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start === -1) return null;
  const open = lines.findIndex((l, i) => i > start && /^```/.test(l.trim()));
  if (open === -1) return null;
  const body: string[] = [];
  for (let i = open + 1; i < lines.length && lines[i]!.trim() !== '```'; i++) body.push(lines[i]!);
  return body.length === 0 ? null : body.join('\n');
}

describe.skipIf(V1_DIR === null)('RFC 0150 §B — Layer-2 effect identity is retry-stable', () => {
  const doc = V1_DIR === null ? '' : readFileSync(join(V1_DIR as string, 'idempotency.md'), 'utf8');

  it('the normative composition block is found at all', () => {
    // Guard: an extractor that matched nothing would make every leg below
    // vacuously true. That is the exact failure RFC 0148 exists to close, and
    // this gate must not become an instance of it.
    expect(
      compositionBlock(doc),
      `spec/v1/idempotency.md MUST carry a fenced key composition under "${HEADING}"`,
    ).not.toBeNull();
  });

  it('the retry counter does not participate in the identity', () => {
    const block = compositionBlock(doc) ?? '';
    expect(
      /\battempt\b/.test(block),
      'RFC 0150 §B: `attempt` is separate telemetry and MUST NOT participate in the logical ID. ' +
        'A retry counter inside the hash gives every retry a different key, so the invocation ' +
        'log never hits and the injected Idempotency-Key differs — the duplicate side effect ' +
        'Layer 2 exists to prevent.\n' +
        block,
    ).toBe(false);
  });

  it('the identity is domain-separated and version-tagged', () => {
    const block = compositionBlock(doc) ?? '';
    expect(
      block,
      'RFC 0150 §B: the preimage MUST open with the `openwop:activity:v2` domain tag so a v1 ' +
        'and a v2 identity for the same effect cannot collide.',
    ).toContain('openwop:activity:v2');
  });

  it('the identity binds the tenant', () => {
    const block = compositionBlock(doc) ?? '';
    expect(
      block,
      'RFC 0150 §B: `tenantId` is part of the preimage. Without it two tenants that collide on ' +
        '(runId, nodeId, providerKey) share an invocation-log entry, and one tenant reads the ' +
        "other's cached provider response.",
    ).toContain('tenantId');
  });

  it('the ordinal is documented as stable across retries', () => {
    const block = compositionBlock(doc) ?? '';
    expect(block, 'RFC 0150 §B: the preimage carries `logicalInvocationOrdinal`').toContain(
      'logicalInvocationOrdinal',
    );
    // The ordinal only does its job if the prose pins it. An ordinal that a host
    // is free to re-derive per attempt reintroduces the defect under a new name.
    // Emphasis and code spans are stripped first so the assertion reads the
    // requirement, not the markdown that happens to decorate it.
    const plain = doc.replace(/[`*_]/g, '').replace(/\s+/g, ' ');
    expect(
      /logicalInvocationOrdinal MUST NOT change/.test(plain),
      'RFC 0150 §B: `logicalInvocationOrdinal` MUST NOT change across transport/provider retries, ' +
        'and the spec MUST say so — otherwise a host may re-derive it per attempt and the ' +
        'retry-instability returns under a different field name.',
    ).toBe(true);
  });

  it('the composition agrees with the claim that a retried call reuses the identity', () => {
    // The two halves of the contradiction. This leg anchors the ones above to a
    // real promise in the document rather than to the RFC alone: if the claim
    // is ever deleted instead of the formula being fixed, this fails and says so.
    expect(
      /is identical/.test(doc),
      'spec/v1/idempotency.md §"Composition: how the layers compose" MUST keep the guarantee ' +
        'that an internally retried call reuses the same Layer-2 identity. It is the promise the ' +
        'composition above has to honor.',
    ).toBe(true);
  });
});
