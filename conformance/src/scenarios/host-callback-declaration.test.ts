/**
 * Every callback-shaped scenario declares itself.
 *
 * See `../lib/host-callback.ts` for the rule and why it is a declaration rather
 * than a detector. In short: a scenario needing the HOST to originate a
 * connection back to the harness cannot be witnessed when the host is in a
 * separate network namespace, and **that is a networking property, not host
 * non-conformance.**
 *
 * This gate enforces the declaration where the signal is unambiguous — a
 * scenario importing a module that stands up a harness-hosted server. It is a
 * floor, not an oracle, and the docblock next door says so.
 *
 * Server-free; reads the suite's own sources.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS_DIR } from '../lib/paths.js';
import { HARNESS_DOUBLE_MODULES } from '../lib/host-callback.js';

const DECLARATION = /export\s+const\s+REQUIRES_HOST_CALLBACK\s*[:=]/;
/**
 * The authored opt-out, for a scenario that imports a double but drives BOTH
 * ends itself. Importing a harness module is the signal the gate can see; it is
 * not proof a host participates. The opt-out carries a reason for the same
 * reason the declaration does — an unexplained exception is indistinguishable
 * from an author who forgot.
 */
const OPT_OUT = /export\s+const\s+HOST_CALLBACK_NOT_REQUIRED\s*[:=]/;

interface Scenario {
  readonly file: string;
  readonly source: string;
  readonly doubles: readonly string[];
  readonly declared: boolean;
  readonly optedOut: boolean;
}

function scan(dir: string): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(dir, file), 'utf8');
      return {
        file,
        source,
        doubles: HARNESS_DOUBLE_MODULES.filter((m) =>
          new RegExp(`from '\\.\\./lib/${m}(\\.js)?'`).test(source),
        ),
        declared: DECLARATION.test(source),
        optedOut: OPT_OUT.test(source),
      };
    });
}

describe.skipIf(SCENARIOS_DIR === null)('host-callback declaration (conformance/README §"Where the suite runs")', () => {
  const all = SCENARIOS_DIR === null ? [] : scan(SCENARIOS_DIR);

  it('the scan reaches the scenario corpus', () => {
    // Guard: an empty scan makes every leg below vacuously true, which is the
    // shape RFC 0148 §C found in the floor verifier. A gate that passes by
    // having looked at nothing is worse than no gate, because it reports clean.
    expect(all.length, 'the scenario directory MUST be readable and populated').toBeGreaterThan(100);
    expect(
      all.filter((s) => s.doubles.length > 0).length,
      'the suite MUST contain scenarios that drive harness doubles — if this hits zero the ' +
        'module list in `host-callback.ts` has drifted from the imports it is meant to track, ' +
        'and the gate is measuring nothing',
    ).toBeGreaterThan(0);
  });

  it('every scenario driving a harness double declares the callback', () => {
    const undeclared = all
      .filter((s) => s.doubles.length > 0 && !s.declared && !s.optedOut)
      .map((s) => `${s.file} (imports ${s.doubles.join(', ')})`);
    expect(
      undeclared,
      'A scenario that hands the host a harness-hosted endpoint MUST export ' +
        '`REQUIRES_HOST_CALLBACK` naming the connection the host has to originate — or ' +
        '`HOST_CALLBACK_NOT_REQUIRED` explaining why it drives both ends itself.\n\n' +
        'Without it, a consumer running the suite off-process — against a container, VM, or ' +
        'remote origin — discovers the scenario is unwitnessable by watching it fail, and reads ' +
        'a routing problem as host non-conformance. RFC 0148 §A resolves an unwitnessed ' +
        'requirement to `blocked` rather than to a pass, and a consumer can only honour that ' +
        'for scenarios they can identify in advance.\n  ' + undeclared.join('\n  '),
    ).toEqual([]);
  });

  it('the declaration states a reason rather than a bare flag', () => {
    // A boolean records that somebody ticked a box. A sentence records what a
    // consumer must route, and is checkable against the scenario body by anyone
    // reading the diff — the same annotated-vs-bare rule RFC 0149 §D applies to
    // acceptance criteria, one artifact over.
    const bare: string[] = [];
    for (const s of all.filter((x) => x.declared || x.optedOut)) {
      const m = /export\s+const\s+(?:REQUIRES_HOST_CALLBACK|HOST_CALLBACK_NOT_REQUIRED)\s*[:=][^\n]*(?:\n[^\n;]*)?/.exec(s.source);
      const line = m?.[0] ?? '';
      if (/=\s*(true|false)\s*;?\s*$/.test(line) || !/['"`]/.test(line)) bare.push(`${s.file}: ${line.trim()}`);
    }
    expect(
      bare,
      '`REQUIRES_HOST_CALLBACK` MUST be a string naming which connection the host originates — ' +
        'a bare boolean says a box was ticked, not what a consumer has to route.\n  ' +
        bare.join('\n  '),
    ).toEqual([]);
  });

  it('nothing declares a callback it does not make', () => {
    // The reverse direction, and the one that keeps the list honest as the
    // corpus moves. A declaration left behind after the double was removed
    // would tell a consumer to route something nobody needs — a stale claim,
    // and the cheapest kind to leave lying around.
    const orphaned = all
      .filter((s) => s.declared && s.doubles.length === 0)
      .filter((s) => !/endpoint\(\)/.test(s.source))
      .map((s) => s.file);
    expect(
      orphaned,
      'a scenario declaring `REQUIRES_HOST_CALLBACK` MUST actually drive a harness-hosted ' +
        'endpoint. A declaration that outlived its double is a routing instruction for a ' +
        'connection nobody makes.\n  ' + orphaned.join('\n  '),
    ).toEqual([]);
  });
});
