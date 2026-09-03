/**
 * exec-class tools MUST NOT be protocol-tier (RFC 0069, `Draft`).
 *
 * Always-on, server-free structural assertion over the spec corpus. Verifies
 * the SECURITY invariant `exec-must-not-be-protocol-tier`: the protocol
 * defines NO arbitrary-command (`exec`-class) primitive under a
 * protocol-owned namespace (`core.*` / `openwop.*`), NO exec capability
 * flag in `capabilities.schema.json`, and NO exec-class entry in the
 * canonical RunEventType vocabulary.
 *
 * This guards against an independent implementer reading the protocol's
 * silence as permission to ship a `core.exec` RCE primitive other hosts
 * would treat as canonical. The assertion is against the protocol's OWN
 * surface — it must hold for every release of the corpus regardless of
 * which host runs it. A `vendor.acme.exec` / `x-host-acme-exec` identifier
 * is allowed (host-extension namespace); the check fires only on
 * protocol-owned namespaces.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-extensions.md §"exec-class tools"
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/threat-model-prompt-injection.md §"exec tools"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0069-exec-class-tool-host-extension-safety-contract.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

/**
 * Closed denylist of exec-class identifier *segments* (whole tokens). The
 * check matches a protocol-owned namespaced id whose final segment IS one
 * of these — it does NOT flag substrings like `execution` in
 * `multi-agent-execution` or `subprocess` inside an unrelated word.
 */
const EXEC_SEGMENTS = new Set([
  'exec',
  'shell',
  'spawn',
  'runcommand',
  'runscript',
  'subprocess',
  'systemcall',
  'eval',
]);

/** Protocol-owned namespace prefixes per host-extensions.md §"Canonical prefixes". */
const PROTOCOL_PREFIXES = ['core.', 'openwop.'];

/** Pull every `"core.*"` / `"openwop.*"` quoted identifier out of a corpus file. */
function protocolOwnedIds(text: string): string[] {
  const out: string[] = [];
  const re = /["'`](core|openwop)\.[a-zA-Z0-9_.-]+["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].slice(1, -1));
  }
  return out;
}

function isExecClass(id: string): boolean {
  if (!PROTOCOL_PREFIXES.some((p) => id.startsWith(p))) return false;
  const lastSegment = id.split('.').pop()?.toLowerCase().replace(/-/g, '') ?? '';
  return EXEC_SEGMENTS.has(lastSegment);
}

describe('exec-not-protocol-tier: no exec-class primitive in the protocol corpus (RFC 0069, server-free)', () => {
  it('no protocol-owned (core.* / openwop.*) identifier denotes arbitrary command execution', () => {
    const schemaFiles = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'));
    const offenders: string[] = [];
    for (const f of schemaFiles) {
      const text = readFileSync(join(SCHEMAS_DIR, f), 'utf8');
      for (const id of protocolOwnedIds(text)) {
        if (isExecClass(id)) offenders.push(`${f}: ${id}`);
      }
    }
    expect(
      offenders,
      req('openwop.it.exec-not-protocol-tier.no-protocol-owned-core-openwop-identifier-denotes-arbitrary-command-execution', 
        'host-extensions.md §exec-class tools',
        'the protocol corpus MUST NOT define a core.*/openwop.* exec-class identifier',
      ),
    ).toEqual([]);
  });

  it('no capabilities.schema.json property name denotes arbitrary command execution', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as Record<string, unknown>;
    const offenders: string[] = [];
    const walkProps = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      const props = obj.properties as Record<string, unknown> | undefined;
      if (props) {
        for (const key of Object.keys(props)) {
          if (EXEC_SEGMENTS.has(key.toLowerCase().replace(/-/g, ''))) {
            offenders.push(`${path}.${key}`);
          }
          walkProps(props[key], `${path}.${key}`);
        }
      }
    };
    walkProps(caps, 'capabilities');
    expect(
      offenders,
      req('openwop.it.exec-not-protocol-tier.no-capabilities-schema-json-property-name-denotes-arbitrary-command-execution', 'host-extensions.md §exec-class tools', 'capabilities.schema.json MUST NOT declare an exec-class capability flag'),
    ).toEqual([]);
  });

  it('the canonical RunEventType vocabulary contains no exec-class event', () => {
    const runEvent = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event.schema.json'), 'utf8')) as {
      $defs?: { RunEventType?: { enum?: string[] } };
    };
    const enumVals = runEvent.$defs?.RunEventType?.enum ?? [];
    const offenders = enumVals.filter((v) => {
      const lastSegment = v.split('.').pop()?.toLowerCase().replace(/-/g, '') ?? '';
      return EXEC_SEGMENTS.has(lastSegment);
    });
    expect(
      offenders,
      req('openwop.it.exec-not-protocol-tier.the-canonical-runeventtype-vocabulary-contains-no-exec-class-event', 'host-extensions.md §exec-class tools', 'no RunEventType MUST denote arbitrary command execution'),
    ).toEqual([]);
  });

  it('positive control: a vendor / x-host exec identifier is allowed (host-extension namespace)', () => {
    expect(isExecClass('vendor.acme.exec'), req('openwop.it.exec-not-protocol-tier.positive-control-a-vendor-x-host-exec-identifier-is-allowed-host-extension-names', 'RFC 0069', 'positive control: a vendor / x-host exec identifier is allowed (host-extension namespace)')).toBe(false);
    expect(isExecClass('x-host-acme-exec')).toBe(false);
    expect(isExecClass('private.host.shell')).toBe(false);
    // And the denylist actually fires on a protocol-owned id:
    expect(isExecClass('core.exec')).toBe(true);
    expect(isExecClass('openwop.shell')).toBe(true);
    // Negative control: a benign substring is not flagged.
    expect(isExecClass('core.workflowChain.event')).toBe(false);
  });
});
