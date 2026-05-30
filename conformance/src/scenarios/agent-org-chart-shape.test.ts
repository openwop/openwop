/**
 * Agent org-chart — record + capability + the non-authority guarantee (RFC 0087).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.orgChart` is declared with its `supported` /
 *     `installScope` / `departmentNesting` / `responsibilityView` sub-flags.
 *   - `agent-org-chart.schema.json` compiles and round-trips a conforming
 *     chart, and rejects malformed ones (a non-`host:` member rosterId).
 *   - the §B structural non-authority guarantee: the schema REJECTS an
 *     authority-bearing field on a member (`scopes` / `canDispatch` /
 *     `permissions`) — every object is `additionalProperties:false`, so a
 *     host cannot express position-as-authority through it. This is the public
 *     test for the protocol-tier SECURITY invariant
 *     `org-position-no-authority-escalation`.
 *
 * Behavioral assertions (a manager's tool over-reach is refused; an RFC 0049
 * decision is invariant to org position; the cross-tenant 404; the §D roll-up
 * over live roster portfolios) are gated on `capabilities.agents.orgChart.supported`
 * and land at Active → Accepted (reference-host org store deferred per RFC 0087
 * §Conformance — the host-extension at `/v1/host/sample/org-chart`, #371, is the
 * reference demonstration). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-org-chart.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0087-agent-org-chart.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (org-position-no-authority-escalation)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

/** Server-free assertion-message helper. */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

const CHART = {
  owner: { tenantId: 'acme', workspaceId: 'growth' },
  departments: [
    {
      departmentId: 'dept-marketing',
      name: 'Marketing',
      parentDepartmentId: null,
      roles: [
        { roleId: 'role-cm', name: 'Campaign Manager' },
        { roleId: 'role-bw', name: 'Brief Writer' },
      ],
    },
  ],
  members: [
    { rosterId: 'host:sally-marketing', departmentId: 'dept-marketing', roleId: 'role-bw', reportsTo: 'host:morgan-cmo' },
    { rosterId: 'host:morgan-cmo', departmentId: 'dept-marketing', roleId: 'role-cm', reportsTo: null },
  ],
};

describe('agent-org-chart-shape: capability advertisement (RFC 0087, server-free)', () => {
  it('the capabilities schema declares agents.orgChart with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).agents;
    const orgChart = agents?.properties?.orgChart;
    expect(orgChart, why('capabilities.md §agents', 'agents.orgChart MUST be declared')).toBeDefined();
    for (const flag of ['supported', 'installScope', 'departmentNesting', 'responsibilityView']) {
      expect(orgChart?.properties?.[flag], why('agent-org-chart.md §E', `agents.orgChart.${flag} MUST be declared`)).toBeDefined();
    }
  });
});

describe('agent-org-chart-shape: chart record (RFC 0087 §A, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const chart = ajv.compile(loadSchema('agent-org-chart.schema.json'));

  it('AgentOrgChart validates a conforming chart', () => {
    expect(chart(CHART), why('RFC 0087 §A', 'a conforming org-chart MUST validate')).toBe(true);
  });

  it('rejects a non-host: member rosterId and a chart missing required arrays', () => {
    const badMember = { ...CHART, members: [{ rosterId: 'core.openwop.agents.sally', departmentId: 'dept-marketing', roleId: 'role-bw', reportsTo: null }] };
    expect(chart(badMember), why('RFC 0087 §A', 'a non-`host:` member rosterId MUST be rejected')).toBe(false);
    expect(chart({ owner: { tenantId: 'acme' }, departments: [] }), why('RFC 0087 §A', 'a chart without `members` MUST be rejected')).toBe(false);
  });
});

describe('agent-org-chart-shape: §B non-authority guarantee (RFC 0087, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const chart = ajv.compile(loadSchema('agent-org-chart.schema.json'));

  it('the schema rejects an authority-bearing field on a member (org-position-no-authority-escalation)', () => {
    for (const authorityField of ['scopes', 'canDispatch', 'permissions', 'authority']) {
      const withAuthority = {
        ...CHART,
        members: [{ ...CHART.members[1], [authorityField]: ['anything'] }],
      };
      expect(
        chart(withAuthority),
        why('SECURITY invariant org-position-no-authority-escalation', `a member carrying \`${authorityField}\` MUST be rejected (additionalProperties:false — position confers no authority)`),
      ).toBe(false);
    }
  });

  it('a conforming member object carries exactly the descriptive key set — nothing authority-bearing', () => {
    const memberKeys = Object.keys(CHART.members[1]!).sort();
    expect(memberKeys, why('RFC 0087 §B', 'a member is descriptive only: {departmentId, reportsTo, roleId, rosterId}')).toEqual(['departmentId', 'reportsTo', 'roleId', 'rosterId']);
  });
});
