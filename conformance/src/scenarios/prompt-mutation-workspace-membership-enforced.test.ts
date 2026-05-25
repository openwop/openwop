/**
 * prompt-mutation-workspace-membership-enforced — RFC 0028 Tier-2 §"Workspace
 * membership on workspace-scoped writes" verification.
 *
 * Status: ACTIVE (capability-gated; behavioral when the host advertises
 * `capabilities.prompts.mutableLibrary: true`). Hosts that don't advertise
 * mutableLibrary soft-skip cleanly.
 *
 * The contract (spec/v1/prompts.md §"Discovery & distribution" §"REST
 * endpoints" §"Workspace membership on workspace-scoped writes"):
 *
 *   Hosts MUST verify that the authenticated principal is a member of the
 *   target workspace BEFORE honoring any POST / PUT / DELETE to a
 *   workspace-scoped /v1/prompts* resource. A workspaceId supplied by the
 *   caller (request body, URL, or query string) MUST NOT be trusted as
 *   authorization on its own. Non-members MUST be rejected fail-closed
 *   (typically 403) before any persistence occurs.
 *
 * The probe drives `POST /v1/prompts` with a `workspaceId` the conformance
 * principal cannot be a member of (a cryptographically-unique random value
 * by default; operator-overridable via `OPENWOP_TEST_NONMEMBER_WORKSPACE_ID`
 * for hosts that need a specific synthetic workspace shape). The behavioral
 * MUST is that the host refuses — NOT a 2xx. Any 4xx/5xx is acceptable
 * (401 = auth not configured for this surface; 403 = membership check;
 * 404 = endpoint absent; 422 = body validation; 501 = capability not
 * provided). The failure mode this invariant guards against is a SILENT
 * 2xx with a write to a workspace the caller doesn't belong to — that's the
 * RFC 0028 Tier-2 vulnerability self-disclosed by an adopter on 2026-05-25.
 *
 * Why a random workspaceId is sufficient: a non-member workspace check is
 * negative-space — the host MUST refuse for ANY workspace the principal
 * isn't a member of, and a random UUID has astronomically-low collision
 * probability with any real workspace membership grant.
 *
 * @see RFCS/0028-prompt-library-endpoints.md §"Post-promotion notes"
 * @see spec/v1/prompts.md §"Security invariants" §prompt-mutation-workspace-membership-enforced
 * @see spec/v1/auth.md §"Identity claims — tenant · workspace · principal"
 * @see RFCS/0048-tenant-workspace-principal-identity-model.md §D
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      mutableLibrary?: unknown;
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)(
  'prompt-mutation-workspace-membership-enforced: writes to non-member workspaces MUST be refused (RFC 0028 Tier-2)',
  () => {
    it('POST /v1/prompts with a workspaceId the principal is not a member of MUST NOT succeed with 2xx', async (ctx) => {
      const d = await readDiscovery();
      if (d === null) {
        ctx.skip();
        return;
      }
      const mutableLibrary = d.capabilities?.prompts?.mutableLibrary;
      if (mutableLibrary !== true) {
        ctx.skip();
        return;
      }

      const nonMemberWorkspaceId =
        process.env.OPENWOP_TEST_NONMEMBER_WORKSPACE_ID ??
        `openwop-conformance-nonmember-${randomUUID()}`;

      const res = await driver.post('/v1/prompts', {
        workspaceId: nonMemberWorkspaceId,
        templateId: `conformance-membership-probe-${randomUUID()}`,
        version: '1.0.0',
        kind: 'system',
        text: 'conformance probe — SHOULD NOT persist',
      });

      // The conformance MUST: the host MUST NOT honor a write to a workspace
      // the caller cannot prove membership of. Any refusal (4xx/5xx) is
      // acceptable; a 2xx silent success is the failure mode that the RFC
      // 0028 Tier-2 self-disclosed vulnerability demonstrated.
      expect(
        res.status,
        driver.describe(
          'spec/v1/prompts.md §Workspace membership on workspace-scoped reads and writes',
          `mutating /v1/prompts MUST refuse a write to a non-member workspace; ` +
            `got ${res.status} ${res.text.slice(0, 200)}`,
        ),
      ).toBeGreaterThanOrEqual(400);

      // T1 canonicalization (2026-05-25): when the host CHOOSES 403 to
      // signal the authz boundary, the response envelope MUST carry
      // `error: "workspace_membership_required"` per rest-endpoints.md
      // §"Common error codes". Hosts that refuse with other codes
      // (401 if they treat the failure as authentication-level, 404 to
      // avoid existence disclosure, 5xx on infra failure) have the
      // refusal accepted above but the envelope shape is NOT constrained
      // by this scenario — the canonical envelope is conditional on the
      // 403 status code, not a forced upgrade.
      if (res.status === 403) {
        const body = res.json as { error?: unknown } | null;
        expect(
          body?.error,
          driver.describe(
            'spec/v1/rest-endpoints.md §Common error codes — workspace_membership_required',
            `403 refusal of a workspace-scoped mutation MUST carry error: "workspace_membership_required"; got error: ${JSON.stringify(body?.error)}`,
          ),
        ).toBe('workspace_membership_required');
      }
    });
  },
);
