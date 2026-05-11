/**
 * Approval-payload scenarios — `capabilities.md` §"interrupt" +
 * `interrupt.md` §"`ApprovalResume`" + `schemas/run-event-payloads
 * .schema.json#$defs/approvalReceived`.
 *
 * Vendor-neutral DISCOVERY-SHAPE contracts for the approval payload
 * vocabulary. These run against every host's `/.well-known/openwop`
 * surface — they don't drive an actual approval flow, which would
 * require a configured workflow + RBAC + interactive interrupt
 * resolution (outside the black-box contract surface this suite
 * asserts).
 *
 * Why discovery-shape only:
 *
 *   The wire vocabulary (action enum, refineFeedback object shape,
 *   decidedBy contract) is the cross-implementation contract. The
 *   round-trip path (configure → trigger → resolve → assert event
 *   shape) needs server fixtures the conformance suite doesn't
 *   currently provide. Hosts MUST run their own integration tests
 *   against their resolution endpoints.
 *
 *   Per-action required-fields scenarios (`refine` MUST carry
 *   `refineFeedback.scope`; `edit-accept` MUST carry
 *   `editedArtifactData`) are deferred pending a future test-mode
 *   capability that lets conformance suites trigger an
 *   `awaiting_approval` state without going through the full
 *   workflow registration + run-create flow.
 *
 * Scenario gating:
 *
 *   - **Vocabulary advertisement** runs against every host. Asserts
 *     that any approval-related capability the host advertises uses
 *     the spec-documented action vocabulary, not the legacy
 *     pre-correction `'edit'` form.
 *
 *   - **Interrupt-payload retrieval** is a future scenario gated
 *     on test-mode capability (see CHANGELOG entry).
 *
 * @see interrupt.md §"`ApprovalResume`"
 * @see schemas/run-event-payloads.schema.json#$defs/approvalReceived
 * @see schemas/suspend-request.schema.json (actions[] enum)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const CANONICAL_ACTIONS = ['accept', 'reject', 'refine', 'edit-accept', 'ask'] as const;
const CANONICAL_EVENT_ACTIONS = ['accept', 'reject', 'refine', 'edit-accept', 'timeout'] as const;
const CANONICAL_REFINE_SCOPES = ['whole', 'section', 'items'] as const;

describe('approval-payload: vocabulary discovery contract', () => {
  it('host capability declaration does not regress on the legacy `edit` form (§7 drift pin)', async () => {
    // The spec briefly used `'edit'` for the edit-accept action in
    // commit 0e0171b (2026-04-30) before being corrected to
    // `'edit-accept'`. Any host that captured the spec during that
    // ~30-min window MAY have surfaced `'edit'` somewhere observable
    // in their capability declaration.
    //
    // This scenario walks the discovery payload looking for any
    // string-array field containing the legacy `'edit'` (without the
    // `-accept` suffix). Findings are an indicator the host needs to
    // re-derive its capability declaration from the corrected spec.
    //
    // Most hosts won't surface action vocabularies in /.well-known/openwop
    // at all — that's a `runtimeCapabilities` extension, not a v1
    // mandate. Pass-through (no occurrences) is the expected result.
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    expect(res.status).toBe(200);

    const text = JSON.stringify(res.json ?? {});
    // We look for `"edit"` (quoted) to avoid false positives on
    // `"edit-accept"`. The trailing `-accept` ensures the legacy form
    // is distinguishable from the canonical form.
    const legacyHits = text.match(/"edit"/g) ?? [];

    expect(legacyHits.length, driver.describe(
      'interrupt.md §"`ApprovalResume`"',
      'capability declaration MUST NOT contain the legacy `"edit"` action token (use `"edit-accept"` per spec)',
    )).toBe(0);
  });

  it('canonical action vocabulary is documented in spec (assertion-free reference)', () => {
    // Self-documenting test. The canonical resume actions per spec are
    // accept/reject/refine/edit-accept/ask. Per-host advertisement is
    // optional; this test pins the vocabulary itself for future
    // scenarios that gate on it.
    expect(CANONICAL_ACTIONS).toHaveLength(5);
    expect(new Set(CANONICAL_ACTIONS)).toEqual(
      new Set(['accept', 'reject', 'refine', 'edit-accept', 'ask']),
    );
  });

  it('canonical event action vocabulary differs from resume (timeout instead of ask)', () => {
    // Subtle: `'ask'` is a resume action that does NOT exit the
    // suspend (per interrupt.md), so it doesn't appear in the
    // approval.received event vocabulary. `'timeout'` IS an event-
    // emitted action (host emits when the suspend window elapses)
    // but isn't a resume action (clients can't submit a timeout).
    //
    // Pin this asymmetry so it doesn't drift.
    expect(CANONICAL_EVENT_ACTIONS).toHaveLength(5);
    expect(new Set(CANONICAL_EVENT_ACTIONS)).toEqual(
      new Set(['accept', 'reject', 'refine', 'edit-accept', 'timeout']),
    );
    // Resume-only token (ask) MUST NOT appear in event vocabulary.
    expect(CANONICAL_EVENT_ACTIONS as readonly string[]).not.toContain('ask');
    // Event-only token (timeout) MUST NOT appear in resume vocabulary.
    expect(CANONICAL_ACTIONS as readonly string[]).not.toContain('timeout');
  });

  it('refineFeedback scope vocabulary pin (§7 audit, A.5 prereq)', () => {
    // The 3 documented scopes `whole/section/items` MUST be a stable
    // set in v1.x. Adding a scope is additive (clients tolerating
    // unknown values) but semantic changes need a spec discussion.
    expect(CANONICAL_REFINE_SCOPES).toHaveLength(3);
    expect(new Set(CANONICAL_REFINE_SCOPES)).toEqual(
      new Set(['whole', 'section', 'items']),
    );
  });
});
