/**
 * Agent org-chart — host-extension routes (sample-grade, non-normative).
 *
 * The reference implementation of RFCS/0087 §B/§D. Surface under
 * `/v1/host/sample/org-chart`:
 *   GET    /                         the caller's full chart (tenant-scoped)
 *   PUT    /                         replace the chart (validate acyclic + same-tenant members)
 *   DELETE /                         remove the chart
 *   GET    /{departmentId}           one department's subtree + responsibility roll-up
 *                                    (?recursive=false scopes to direct members)
 *
 * Tenant-scoped per chart ownership (the RFC 0074 carry-forward). The chart
 * is DESCRIPTIVE — there is no permissions/scopes surface here, and these
 * routes never read or mutate toolAllowlist / RBAC / approval gates
 * (RFC 0087 §B `org-position-no-authority-escalation`: position describes,
 * it never authorizes).
 *
 * @see src/host/orgChartService.ts
 * @see RFCS/0087-agent-org-chart.md §A/§B/§C/§D
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import {
  deleteChart,
  getChart,
  putChart,
  responsibilityView,
  type OrgDepartment,
  type OrgMember,
} from '../host/orgChartService.js';

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerOrgChartRoutes(app: Express): void {
  app.get('/v1/host/sample/org-chart', (req, res) => {
    const chart = getChart(tenantOf(req));
    res.json(chart ?? { tenantId: tenantOf(req), departments: [], members: [], updatedAt: null });
  });

  app.put('/v1/host/sample/org-chart', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { departments?: unknown; members?: unknown };
      if (!Array.isArray(body.departments) || !Array.isArray(body.members)) {
        throw new OpenwopError('validation_error', 'Fields `departments` and `members` are required arrays.', 400, {
          field: 'departments|members',
        });
      }
      const result = putChart({
        tenantId: tenantOf(req),
        departments: body.departments as OrgDepartment[],
        members: body.members as OrgMember[],
      });
      if ('error' in result) {
        // A cycle / cross-tenant member / dangling ref is a client error.
        throw new OpenwopError('validation_error', result.error.message, 400, {
          reason: result.error.code,
          detail: result.error.detail,
        });
      }
      res.status(200).json(result.chart);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/org-chart', (req, res) => {
    deleteChart(tenantOf(req));
    res.status(204).end();
  });

  app.get('/v1/host/sample/org-chart/:departmentId', (req, res, next) => {
    try {
      const recursive = req.query.recursive !== 'false';
      const view = responsibilityView(tenantOf(req), req.params.departmentId, recursive);
      if (!view) {
        throw new OpenwopError('not_found', 'Department not found in this tenant\'s org-chart.', 404, {
          departmentId: req.params.departmentId,
        });
      }
      res.json(view);
    } catch (err) {
      next(err);
    }
  });
}
