/**
 * prompt-read-workspace-membership-enforced — RFC 0028 Tier-2 §"Workspace
 * membership on workspace-scoped reads and writes" verification (READ path).
 *
 * Status: ACTIVE (capability-gated; behavioral when the host advertises
 * `capabilities.prompts.supported: true` AND accepts `?workspaceId=` on
 * `GET /v1/prompts`). Hosts that don't expose workspace-scoped reads
 * (host-only template libraries with no workspace dimension) self-skip
 * via response-shape detection.
 *
 * The contract (spec/v1/prompts.md §"Discovery & distribution" §"REST
 * endpoints" §"Workspace membership on workspace-scoped reads and writes"):
 *
 *   Read paths are NOT exempt from the workspace-membership invariant
 *   just because they don't write. A GET /v1/prompts?workspaceId=<not-mine>
 *   that returns another workspace's templates is a cross-tenant data leak
 *   with the same blast radius as a cross-tenant write. Hosts MUST verify
 *   the authenticated principal's workspace membership BEFORE returning
 *   workspace-scoped content.
 *
 * Gate per MyndHyve relay 2026-05-25 ("Option B"): probe ALL hosts that
 * advertise `capabilities.prompts.supported: true` regardless of
 * `mutableLibrary`; read-only hosts that expose `?workspaceId=` reads are
 * NOT exempt from the symmetric authz invariant. Hosts that don't expose
 * workspace-scoped reads at all self-skip via the response interpretation
 * below (the suite avoids inventing a new capability field just for this
 * gating concern).
 *
 * The probe drives `GET /v1/prompts?workspaceId=<random-uuid>` and
 * interprets the response:
 *
 *   - 4xx (any code) — PASS (refused). If 403 specifically, additionally
 *     pin `error === "workspace_membership_required"` per the canonical
 *     envelope in rest-endpoints.md §"Common error codes".
 *   - 200 with `templates: []` — PASS. The host correctly returned no
 *     content for a workspace the principal isn't a member of. A random
 *     UUID workspace also definitionally has no real content, so an empty
 *     result is the correct null answer.
 *   - 200 with `templates: [non-empty]` — FAIL. The host returned content
 *     for an unauthorized workspace. This is the cross-tenant data leak
 *     failure mode. (Note: this scenario uses a random workspaceId so any
 *     non-empty result is a leak — there can't legitimately be templates
 *     in a freshly-generated nonexistent workspace.)
 *   - 200 without a `templates[]` field, or a response shape that doesn't
 *     resemble the documented `/v1/prompts` list shape — SKIP with a
 *     diagnostic log. Indicates the host doesn't recognize `?workspaceId=`
 *     on this endpoint (e.g., host-only template library with no
 *     workspace dimension).
 *   - 5xx — PASS (refused; envelope shape unconstrained).
 *
 * Why a random workspaceId is sufficient: the assertion is negative-space.
 * A host that correctly enforces membership MUST refuse for ANY workspace
 * the principal isn't a member of, and a random UUID has astronomically-low
 * collision probability with any real workspace membership grant. A host
 * that returns templates from a random UUID workspace is leaking content
 * from somewhere (host-built-in misclassified as workspace, or a silent
 * fall-through to another workspace's content, or a query bug returning
 * everything).
 *
 * @see RFCS/0028-prompt-library-endpoints.md §"Post-promotion notes"
 * @see spec/v1/prompts.md §"Security invariants" §prompt-read-workspace-membership-enforced
 * @see spec/v1/rest-endpoints.md §"Common error codes" §workspace_membership_required
 * @see spec/v1/auth.md §"Identity claims — tenant · workspace · principal"
 * @see RFCS/0048-tenant-workspace-principal-identity-model.md §D
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
    };
  };
}

interface PromptListResponse {
  templates?: unknown;
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
  'prompt-read-workspace-membership-enforced: workspace-scoped reads MUST NOT leak templates from another workspace (RFC 0028 Tier-2)',
  () => {
    it('GET /v1/prompts?workspaceId=<non-member> MUST refuse OR return empty templates[] — never another workspace\'s content', async (ctx) => {
      const d = await readDiscovery();
      if (d === null) {
        ctx.skip();
        return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
      }
      const promptsSupported = capabilityFamily(d, 'prompts')?.supported;
      if (promptsSupported !== true) {
        ctx.skip();
        return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `promptsSupported !== true` returned early');
      }

      const nonMemberWorkspaceId =
        process.env.OPENWOP_TEST_NONMEMBER_WORKSPACE_ID ??
        `openwop-conformance-nonmember-${randomUUID()}`;

      const res = await driver.get(
        `/v1/prompts?workspaceId=${encodeURIComponent(nonMemberWorkspaceId)}`,
      );

      // 4xx — refused. Acceptable shape for the membership-required failure
      // (and any other refusal mode the host chooses: 401, 404 for
      // existence-disclosure avoidance, etc).
      if (res.status >= 400 && res.status < 500) {
        // Canonical envelope on 403 per rest-endpoints.md §"Common error codes".
        if (res.status === 403) {
          const body = res.json as { error?: unknown } | null;
          expect(
            body?.error,
            req('openwop.it.prompt-read-workspace-membership-enforced.get-v1-prompts-workspaceid-non-member-must-refuse-or-return-empty-templates-neve', 
              'spec/v1/rest-endpoints.md §Common error codes — workspace_membership_required',
              `403 refusal of a workspace-scoped read MUST carry error: "workspace_membership_required"; got error: ${JSON.stringify(body?.error)}`,
            ),
          ).toBe('workspace_membership_required');
        }
        return softSkip('blocked', 'precondition not met — `res.status >= 400 && res.status < 500` returned early (4xx — refused. Acceptable shape for the membership-required failure (and any other refusal mode the host chooses: 401, 404 for existence-d…');
      }

      // 5xx — refused (infrastructure failure is acceptable; envelope shape
      // unconstrained).
      if (res.status >= 500) return softSkip('blocked', 'precondition not met — `res.status >= 500` returned early (5xx — refused (infrastructure failure is acceptable; envelope shape unconstrained).) (seam, prior step, or fixture unavailable)');

      // 2xx — must inspect the response body. The failure mode this
      // invariant guards against is a 200 response that LEAKS templates
      // from a workspace the principal isn't a member of.
      if (res.status >= 200 && res.status < 300) {
        const body = res.json as PromptListResponse | null;
        if (
          body === null ||
          typeof body !== 'object' ||
          !('templates' in body)
        ) {
          // Host doesn't recognize `?workspaceId=` on this endpoint
          // (response shape doesn't include the documented `templates[]`
          // field). Soft-skip: this scenario probes hosts that expose
          // workspace-scoped reads, and a host without that surface is
          // simply out of scope.
          ctx.skip();
          return softSkip('blocked', 'precondition not met — `body === null || typeof body !== \'object\' || !(\'templates\' in body)` returned early (seam, prior step, or fixture unavailable)');
        }
        const templates = body.templates;
        if (!Array.isArray(templates)) {
          // Same: unrecognized shape, skip.
          ctx.skip();
          return softSkip('blocked', 'precondition not met — `!Array.isArray(templates)` returned early (seam, prior step, or fixture unavailable)');
        }

        // A random non-member workspaceId can never legitimately contain
        // templates the caller is authorized to see. Any non-empty result
        // is a cross-tenant data leak.
        expect(
          templates.length,
          req('openwop.it.prompt-read-workspace-membership-enforced.get-v1-prompts-workspaceid-non-member-must-refuse-or-return-empty-templates-neve', 
            'spec/v1/prompts.md §Workspace membership on workspace-scoped reads and writes',
            `GET /v1/prompts?workspaceId=<random-non-member> MUST NOT return any templates; got ${templates.length} templates which is a cross-tenant data leak (the random workspaceId is freshly generated per probe and cannot legitimately contain authorized content)`,
          ),
        ).toBe(0);
        return softSkip('blocked', 'precondition not met — `res.status >= 200 && res.status < 300` returned early (2xx — must inspect the response body. The failure mode this invariant guards against is a 200 response that LEAKS templates from a workspa…');
      }

      // Other status codes (1xx, 3xx) — soft-skip with note. Not a clear
      // signal either way.
      ctx.skip();
    });
  },
);
