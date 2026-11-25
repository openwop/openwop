/**
 * `v2-exec-not-protocol-tier` (target major 2) — arbitrary-command execution is
 * never a protocol-tier primitive (RFC 0069; invariant
 * `exec-must-not-be-protocol-tier`).
 *
 * The v2 rule: `spec/v2/core/tool-catalog.md` §The descriptor — "`safetyTier:
 * "exec"` MUST carry `source: "host-extension"`", encoded as the `allOf`
 * conditional in `schemas/v2/tool-descriptor.schema.json`. The v1 file
 * `exec-not-protocol-tier` reads only the v1 schema tree, so nothing checked the
 * v2 wire or a v2 host.
 *
 * Legs:
 *   1. `tool-catalog.exec-not-protocol-owned` (server-free) — no
 *      `core.*` / `openwop.*` identifier in `schemas/v2/*.schema.json` names an
 *      exec-class primitive; no property of `schemas/v2/capabilities.schema.json`
 *      is an exec flag; no v2 run-event type is an exec-class event.
 *   2. `tool-catalog.exec-host-extension-only` (server-free) — the v2 tool
 *      descriptor schema refuses an `exec` descriptor sourced from anything but
 *      `host-extension`, and admits the host-extension one (positive control).
 *   3. `tool-catalog.exec-not-protocol-owned` (live; gated on `toolCatalog`) —
 *      `GET /tools` serves no `core.` / `openwop.` exec-class toolId.
 *   4. `tool-catalog.exec-host-extension-only` (live; gated as 3) —
 *      every descriptor `GET /tools` serves with `safetyTier: "exec"` carries
 *      `source: "host-extension"` and a `toolId` outside the protocol-owned
 *      `core.` / `openwop.` / `openwop:` namespaces. A catalog with no exec tool
 *      passes vacuously for this rule and says so in the record.
 *
 * Dispositions: legs 3 and 4 — no target ⇒ `inapplicable`; discovery unreachable ⇒
 * `blocked`; `toolCatalog` not advertised ⇒ `inapplicable`; `GET /tools`
 * unserved or not a list ⇒ `blocked`.
 *
 * Sabotage (corpus, local): dropping the exec ⇒ host-extension conditional from
 * `schemas/v2/tool-descriptor.schema.json` fails leg 2; adding a `core.exec`
 * identifier to a v2 schema enum fails leg 1.
 *
 * @see spec/v2/core/tool-catalog.md §The descriptor
 * @see RFCS/0069-exec-class-tool-host-extension-safety-contract.md
 * @see SECURITY/invariants.yaml id: exec-must-not-be-protocol-tier
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { listTools } from '../lib/toolCatalog.js';
import { softSkip } from '../lib/soft-skip.js';
import { noteObservation } from '../lib/row-observation.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/tool-catalog.md §The descriptor';
const ID_CORPUS = 'openwop.requirement.tool-catalog.exec-not-protocol-owned';
const ID_SOURCE = 'openwop.requirement.tool-catalog.exec-host-extension-only';
const V2 = join(SCHEMAS_DIR, 'v2');
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];

/** Whole-token exec-class segments — the v1 file's closed list. */
const EXEC_SEGMENTS = new Set(['exec', 'shell', 'spawn', 'runcommand', 'runscript', 'subprocess', 'systemcall', 'eval']);
const seg = (id: string): string => id.split(/[.:]/).pop()?.toLowerCase().replace(/[-_]/g, '') ?? '';
const protocolOwned = (id: string): boolean => /^(core\.|openwop\.|openwop:)/.test(id);
const isExecClass = (id: string): boolean => protocolOwned(id) && EXEC_SEGMENTS.has(seg(id));

describe('v2 exec is never protocol-tier (tool-catalog.md §The descriptor; RFC 0069)', () => {
  it('no v2 schema defines a protocol-owned exec-class identifier, capability flag or event type', () => {
    expect([isExecClass('core.exec'), isExecClass('openwop:shell'), isExecClass('x-host-acme-exec'), isExecClass('core.workflowChain.event')], req(ID_CORPUS, 'RFC 0069', 'control: the detector fires on core.exec / openwop:shell and not on a host-extension id or a benign one')).toEqual([true, true, false, false]);
    const offenders: string[] = [];
    for (const f of readdirSync(V2).filter((n) => n.endsWith('.schema.json'))) {
      for (const m of readFileSync(join(V2, f), 'utf8').matchAll(/["'`]((?:core|openwop)[.:][a-zA-Z0-9_.:-]+)["'`]/g)) if (isExecClass(m[1]!)) offenders.push(`${f}: ${m[1]}`);
    }
    expect(offenders, req(ID_CORPUS, 'RFC 0069; schemas/v2', 'the v2 wire MUST NOT define a core.* / openwop.* exec-class identifier')).toEqual([]);
    const caps = JSON.parse(readFileSync(join(V2, 'capabilities.schema.json'), 'utf8')) as Record<string, unknown>;
    const flags: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return;
      const props = (node as { properties?: Record<string, unknown> }).properties;
      if (props) for (const [k, v] of Object.entries(props)) { if (EXEC_SEGMENTS.has(k.toLowerCase().replace(/[-_]/g, ''))) flags.push(`${path}.${k}`); walk(v, `${path}.${k}`); }
    };
    walk(caps, 'capabilities');
    expect(flags, req(ID_CORPUS, 'RFC 0069; schemas/v2/capabilities.schema.json', 'the v2 capability document MUST NOT declare an exec-class flag')).toEqual([]);
    const types = ((JSON.parse(readFileSync(join(V2, 'run-event.schema.json'), 'utf8')) as { properties?: { type?: { oneOf?: Array<{ enum?: string[] }> } } }).properties?.type?.oneOf ?? []).flatMap((o) => o.enum ?? []);
    expect(types.length, req(ID_CORPUS, 'schemas/v2/run-event.schema.json', 'the v2 event-type vocabulary MUST be readable (non-vacuity)')).toBeGreaterThan(0);
    expect(types.filter((t) => EXEC_SEGMENTS.has(seg(t))), req(ID_CORPUS, 'RFC 0069; schemas/v2/run-event.schema.json', 'no v2 event type MUST denote arbitrary command execution')).toEqual([]);
  });

  it('the v2 tool descriptor refuses an exec tool not sourced from host-extension', () => {
    const validate = v2Validator('tool-descriptor');
    const good = { toolId: 'x-host-acme:shell', source: 'host-extension', safetyTier: 'exec' };
    expect(validate(good).ok, req(ID_SOURCE, DOC, `control: an exec descriptor sourced from host-extension MUST validate (${validate(good).errors})`)).toBe(true);
    for (const source of ['node-pack', 'workflow', 'mcp', 'connector']) {
      expect(validate({ ...good, toolId: `openwop:run-shell-${source}`, source }).ok, req(ID_SOURCE, DOC, `an exec descriptor with source ${source} MUST be refused — exec MUST carry source: host-extension`)).toBe(false);
    }
  });

  it('a v2 host serves no protocol-owned exec-class tool', async () => {
    if (HTTP_SKIP) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    if (!(await v2Discovery().catch(() => null))) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('toolCatalog'))) return softSkip('inapplicable', 'toolCatalog is not advertised — the host serves no tool catalog');
    const read = await listTools();
    if (read.tools === null) return softSkip('blocked', `GET /tools answered ${read.status}${read.unserved ? ' (unserved)' : ''} — not a descriptor list`);
    expect(read.tools.filter((t) => typeof t.toolId === 'string' && isExecClass(t.toolId)).map((t) => t.toolId), req(ID_CORPUS, DOC, 'a host MUST NOT serve a protocol-owned (core. / openwop.) exec-class tool')).toEqual([]);
  });

  it('every exec tool a v2 host serves is a host extension', async () => {
    if (HTTP_SKIP) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    if (!(await v2Discovery().catch(() => null))) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('toolCatalog'))) return softSkip('inapplicable', 'toolCatalog is not advertised — the host serves no tool catalog');
    const read = await listTools();
    if (read.tools === null) return softSkip('blocked', `GET /tools answered ${read.status}${read.unserved ? ' (unserved)' : ''} — not a descriptor list`);
    const exec = read.tools.filter((t) => t.safetyTier === 'exec');
    if (exec.length === 0) noteObservation(`the catalog of ${read.tools.length} tool(s) carries no exec-tier tool; the rule holds vacuously on this host`);
    expect(exec.filter((t) => t.source !== 'host-extension' || (typeof t.toolId === 'string' && protocolOwned(t.toolId))).map((t) => `${String(t.toolId)} (${String(t.source)})`), req(ID_SOURCE, DOC, 'every safetyTier: exec tool MUST carry source: host-extension and a host-extension toolId')).toEqual([]);
  });
});
