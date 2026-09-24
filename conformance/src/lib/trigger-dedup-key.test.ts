/**
 * A dedup key handed to the trigger bridge is a DURABLE identity, and this pins
 * that no scenario writes one into the file. No host needed, deliberately.
 *
 * `trigger-bridge.md` §C-1 makes the dedup window a ≥24h FLOOR and §F.5 reuses
 * it verbatim for the `stream` / `change` sources. A dedup key spelled as a
 * literal is therefore not a fixture — it is state the host is REQUIRED to
 * remember between runs of this suite, so the second run of the file hands the
 * bridge a key it has already delivered, a conformant host collapses the whole
 * exercise into the first run's outcome, and the leg's `=== 1` convicts it.
 * Cold host passes, warm host fails, nothing about the host having changed.
 *
 * Two files did this. `trigger-bridge-delivery.test.ts` had
 * `'conformance-dedup-key'`; `trigger-stream-cdc-sources.test.ts` had
 * `'events:3:99001'`, and it survived the first sweep because nothing was
 * checking — which is the whole argument for checking at the source rather than
 * trusting the next reader. The mint is in `triggerBridge.ts`
 * (`freshDedupKey` / `freshStreamDedupKey`), and the assertion here is over the
 * CALL SITES, because that is where the regression would reappear.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freshDedupKey, freshStreamDedupKey } from './triggerBridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = join(here, '..', 'scenarios');

describe('trigger-bridge dedup keys belong to one exercise', () => {
  it('freshDedupKey mints a distinct key per call, with the prefix still readable', () => {
    const a = freshDedupKey('queue');
    const b = freshDedupKey('queue');
    expect(a).not.toBe(b);
    expect(a.startsWith('openwop-conformance-queue-')).toBe(true);
  });

  it('freshStreamDedupKey keeps (topic, partition) and mints the OFFSET — the coordinate §F.5 keys on', () => {
    const a = freshStreamDedupKey();
    const b = freshStreamDedupKey();
    expect(a).not.toBe(b);
    // The clause is about `(topic, partition, offset)`; an opaque token would
    // make the scenario's own req() message describe something else.
    const [topicA, partitionA, offsetA] = a.split(':');
    const [topicB, partitionB, offsetB] = b.split(':');
    expect(topicA).toBe(topicB);
    expect(partitionA).toBe(partitionB);
    expect(offsetA).not.toBe(offsetB);
    expect(Number.isInteger(Number(offsetA))).toBe(true);
  });

  it('no scenario hands driveDelivery a literal dedupKey — that is one identity for every run, forever', () => {
    // BOTH spellings, whichever quote style: the inline object property
    // (`dedupKey: 'k'`) and the local binding the object then shorthands
    // (`const dedupKey = 'k'`). Written as one alternation deliberately — the
    // first draft of this guard matched only the property form, and a sabotage
    // that reintroduced the literal as a `const` passed it. A guard that misses
    // the spelling a reader would naturally reach for is not a guard.
    const literal = /\bdedupKey\s*[:=]\s*['"`]/;
    const offenders: string[] = [];
    for (const name of readdirSync(SCENARIOS).filter((f) => f.endsWith('.test.ts'))) {
      const src = readFileSync(join(SCENARIOS, name), 'utf8');
      // Only files that actually drive the bridge seam: elsewhere `dedupKey` is
      // a field in a schema-validation sample, which is in-process and durable
      // nowhere (`trigger-bridge-shape.test.ts` validates envelopes offline).
      if (!src.includes('driveDelivery(')) continue;
      src.split('\n').forEach((line, i) => {
        if (literal.test(line)) offenders.push(`${name}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `a literal dedupKey is durable host state, not a fixture (§C-1's window is a ≥24h floor): ${offenders.join(', ')} — mint it with freshDedupKey()/freshStreamDedupKey()`,
    ).toEqual([]);
  });
});
