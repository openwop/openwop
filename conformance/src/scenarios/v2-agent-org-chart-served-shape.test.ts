/**
 * RFC 0087 §A/§D — the SERVED bodies of the org-chart read pair validate against
 * `schemas/v2/agent-org-chart.schema.json` and
 * `schemas/v2/org-chart-responsibility-view.schema.json`. Target major 2; the
 * major-1 twin is the served-shape leg of `agent-org-chart-scoping.test.ts`.
 *
 * Why this exists: until 2026-09-28 only a server-free probe compiled the
 * schema. openwop-app served its stored record (`{ tenantId, departments,
 * members, updatedAt }` — `owner` missing, two extra keys on an
 * `additionalProperties:false` object) on `GET /agents/org-chart` at both
 * majors and nothing in the suite noticed (fixed in openwop-app #4189).
 *
 * Gate: the v2 `agents` record carries `orgChart` (presence is the claim,
 * capabilities.md; there is no `supported` seat), else `inapplicable` — never a
 * strict-mode failure. The department leg runs when the record carries
 * `responsibilityView: true` and the chart has a department to read.
 *
 * @see api/v2/openapi.yaml `/agents/org-chart`, `/agents/org-chart/{departmentId}`
 * @see RFCS/0087-agent-org-chart.md
 */
import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { familyAdvertised, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.it.v2-agent-org-chart-served-shape.serves-the-org-chart-read-pair-in-the-exact-v2-schema-shape';

describe('RFC 0087 §A/§D — org-chart served shape (major 2, gated on agents.orgChart)', () => {
  it('serves the org-chart read pair in the exact v2 schema shape', async () => {
    const agents = await familyAdvertised('agents');
    const orgChart = agents?.['orgChart'];
    if (!orgChart || typeof orgChart !== 'object') return softSkip('inapplicable', 'agents.orgChart not advertised in the v2 discovery document');

    const chartRes = await driver.get('/agents/org-chart');
    expect(
      chartRes.status,
      req(ID, 'api/v2/openapi.yaml /agents/org-chart (RFC 0087 §D)', 'a host advertising agents.orgChart MUST serve GET /agents/org-chart with 200'),
    ).toBe(200);
    const chartCheck = v2Validator('agent-org-chart')(chartRes.json);
    expect(
      chartCheck.ok ? 'valid' : chartCheck.errors,
      req(ID, 'schemas/v2/agent-org-chart.schema.json (RFC 0087 §A)', 'the served GET /agents/org-chart body MUST validate against agent-org-chart.schema.json (owner required; no extra keys)'),
    ).toBe('valid');

    const departments = (chartRes.json as { departments?: Array<{ departmentId?: unknown }> } | undefined)?.departments;
    const probeDeptId = Array.isArray(departments) ? departments[0]?.departmentId : undefined;
    // The view leg needs a department to read; an empty chart is still
    // validated above (an empty chart is a conforming chart).
    if ((orgChart as Record<string, unknown>)['responsibilityView'] === true && typeof probeDeptId === 'string') {
      const view = await driver.get(`/agents/org-chart/${encodeURIComponent(probeDeptId)}`);
      expect(
        view.status,
        req(ID, 'api/v2/openapi.yaml /agents/org-chart/{departmentId} (RFC 0087 §D)', "a host advertising agents.orgChart.responsibilityView MUST serve GET /agents/org-chart/{departmentId} with 200 for a department in the caller's chart"),
      ).toBe(200);
      const viewCheck = v2Validator('org-chart-responsibility-view')(view.json);
      expect(
        viewCheck.ok ? 'valid' : viewCheck.errors,
        req(ID, 'schemas/v2/org-chart-responsibility-view.schema.json (RFC 0087 §D)', 'the served GET /agents/org-chart/{departmentId} body MUST validate against org-chart-responsibility-view.schema.json'),
      ).toBe('valid');
    }
  });
});
