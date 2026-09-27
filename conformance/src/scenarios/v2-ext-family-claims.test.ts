/**
 * v2-ext-family-claims — RFC 0220 §B, the `claims-check` witness for the 11
 * discovery-only extension families (suite 2.42.7, target major 2).
 *
 * Each family is a reservation: v2 defines no portable operation for it, so the
 * only thing a server-oriented suite can check is the claim itself. A host that
 * advertises `extensions["<org>.<extensionName>"]` records `executed-pass` under
 * `openwop.family.<key>` when the claim is well formed (lib/ext-claims.ts), and
 * `executed-fail` when it is not. A host that does not advertise the family
 * records `inapplicable`.
 *
 * Why not behaviorGate: an ext family is outside every profile
 * (spec/v2/ext/README.md), so strict mode has nothing to demand here — a host
 * that serves no `kanban` has made no promise about one. The gate is the claim.
 *
 * Every req() id is a literal so the requirement registry collects it. That a
 * leg exists for every claims-check family in the declaration is a corpus fact,
 * checked by the self-test in src/lib/ext-claims.test.ts, not by a host run.
 *
 * @see RFCS/0220-ext-families-graduate-on-evidence.md
 * @see spec/v2/ext/README.md
 * @see spec/v2/core/capabilities.md §3.2
 */
import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { extDeclaration, classifyExtClaim } from '../lib/ext-claims.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const LEGS = ['brand', 'canvas', 'chat', 'coordination', 'dataIntegration', 'entities', 'kanban', 'knowledge', 'launchStudio', 'messaging', 'webResearch'] as const;

async function leg(key: (typeof LEGS)[number], cite: (why: string) => string): Promise<undefined> {
  const decl = extDeclaration();
  if (!decl) return softSkip('blocked', 'spec/v2/declaration.json is not resolvable in this layout — the extension name and the org registry come from it, and guessing either would make the suite the registry (conformance.md §Whose fact is the reason?)');
  const family = decl.families.find((f) => f.key === key);
  if (!family) return softSkip('blocked', `the declaration has no ext row for ${key} — this leg is stale against the corpus`);
  const doc = await v2Discovery();
  if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
  const claims = classifyExtClaim(doc, family, decl);
  if (claims.length === 1 && claims[0].state === 'absent') return softSkip('inapplicable', `no extensions["<org>.${family.extensionName}"] record under a registered org — the host does not advertise ${key}`);
  for (const c of claims) {
    if (c.state === 'absent') continue;
    expect(c.state, cite(c.state === 'malformed' ? `extensions["${c.key}"]: ${c.why}` : `extensions["${c.key}"] is a well-formed claim`)).toBe('well-formed');
  }
  return undefined;
}

const S = (key: string): string => `spec/v2/ext/${key}/README.md §Conformance`;

describe('RFC 0220 §B — an extension family is claimed in a well-formed extensions record (claims-check)', () => {
  it('brand', () => leg('brand', (why) => req('openwop.family.brand', S('brand'), why)));
  it('canvas', () => leg('canvas', (why) => req('openwop.family.canvas', S('canvas'), why)));
  it('chat', () => leg('chat', (why) => req('openwop.family.chat', S('chat'), why)));
  it('coordination', () => leg('coordination', (why) => req('openwop.family.coordination', S('coordination'), why)));
  it('dataIntegration', () => leg('dataIntegration', (why) => req('openwop.family.dataIntegration', S('dataIntegration'), why)));
  it('entities', () => leg('entities', (why) => req('openwop.family.entities', S('entities'), why)));
  it('kanban', () => leg('kanban', (why) => req('openwop.family.kanban', S('kanban'), why)));
  it('knowledge', () => leg('knowledge', (why) => req('openwop.family.knowledge', S('knowledge'), why)));
  it('launchStudio', () => leg('launchStudio', (why) => req('openwop.family.launchStudio', S('launchStudio'), why)));
  it('messaging', () => leg('messaging', (why) => req('openwop.family.messaging', S('messaging'), why)));
  it('webResearch', () => leg('webResearch', (why) => req('openwop.family.webResearch', S('webResearch'), why)));
});
