/**
 * Self-test for lib/ext-claims.ts (RFC 0220 §B). Each negative control is a
 * claim a host could really emit; the classifier must call it malformed or
 * absent, never well-formed. The last block is the corpus fact the scenario
 * header defers to: every claims-check family has a leg.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extDeclaration, classifyExtClaim, type ExtDeclaration, type ExtFamily } from './ext-claims.js';
import { SCENARIOS_DIR } from './paths.js';

const DECL: ExtDeclaration = {
  families: [],
  registeredOrgs: new Set(['myndhyve', 'openwop-app']),
  reservedOrgs: new Set(['openwop', 'vendor']),
  keyPattern: /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
};
const KANBAN: ExtFamily = { key: 'kanban', extensionName: 'kanban', witness: 'claims-check' };
const WEB: ExtFamily = { key: 'webResearch', extensionName: 'web-research', witness: 'claims-check' };
const states = (doc: Record<string, unknown>, f: ExtFamily): string[] => classifyExtClaim(doc, f, DECL).map((c) => c.state);

describe('classifyExtClaim', () => {
  it('a registered org with an object record is well-formed', () => {
    expect(states({ extensions: { 'myndhyve.kanban': { boards: true } } }, KANBAN)).toEqual(['well-formed']);
    expect(states({ extensions: { 'openwop-app.web-research': {} } }, WEB)).toEqual(['well-formed']);
  });
  it('no record, or no extensions object, is absent', () => {
    expect(states({}, KANBAN)).toEqual(['absent']);
    expect(states({ extensions: [] }, KANBAN)).toEqual(['absent']);
    expect(states({ extensions: { 'myndhyve.chat': {} } }, KANBAN)).toEqual(['absent']);
  });
  it('the camelCase family key is not the extension name — it is absent, not a claim', () => {
    expect(states({ extensions: { 'myndhyve.webResearch': {} } }, WEB)).toEqual(['absent']);
  });
  it('an unregistered org is someone else\'s name, not a claim', () => {
    expect(states({ extensions: { 'acme.kanban': {} } }, KANBAN)).toEqual(['absent']);
  });
  it('a reserved org is malformed', () => {
    expect(states({ extensions: { 'openwop.kanban': {} } }, KANBAN)).toEqual(['malformed']);
  });
  it('an array, a scalar or null record is malformed', () => {
    expect(states({ extensions: { 'myndhyve.kanban': [] } }, KANBAN)).toEqual(['malformed']);
    expect(states({ extensions: { 'myndhyve.kanban': true } }, KANBAN)).toEqual(['malformed']);
    expect(states({ extensions: { 'myndhyve.kanban': null } }, KANBAN)).toEqual(['malformed']);
  });
  it('a root copy of the family key makes the claim malformed', () => {
    expect(states({ kanban: {}, extensions: { 'myndhyve.kanban': {} } }, KANBAN)).toEqual(['malformed']);
  });
  it('two orgs yield two classified claims', () => {
    expect(states({ extensions: { 'myndhyve.kanban': {}, 'openwop-app.kanban': [] } }, KANBAN)).toEqual(['well-formed', 'malformed']);
  });
});

describe('the corpus: every claims-check ext family has a leg', () => {
  it('v2-ext-family-claims cites openwop.family.<key> for each claims-check family, and no other', () => {
    const decl = extDeclaration();
    expect(decl, 'spec/v2/declaration.json must resolve in a checkout').toBeDefined();
    if (!decl || SCENARIOS_DIR === null) return;
    const src = readFileSync(join(SCENARIOS_DIR, 'v2-ext-family-claims.test.ts'), 'utf8');
    const cited = new Set([...src.matchAll(/req\('openwop\.family\.([A-Za-z]+)'/g)].map((m) => m[1]));
    const want = new Set(decl.families.filter((f) => f.witness === 'claims-check').map((f) => f.key));
    expect([...cited].sort()).toEqual([...want].sort());
    expect(want.size).toBe(11);
  });
});
