/**
 * envelopeDirective — type-only re-export shim.
 *
 * The substantive `buildReasoningDirective` implementation lived here until
 * @openwop/openwop@1.1.3 published the canonical SDK helper (commit ec6625a,
 * release tag openwop/v1.1.3). The body of this module was byte-identical to
 * `sdk/typescript/src/envelope-directive.ts`; lifting to the SDK consolidates
 * the matrix in one place for cross-host consistency.
 *
 * This file now exists solely to re-export the `ReasoningDirectiveStrength`
 * type so existing imports in `host/envelopeReasoningConfig.ts` (and any
 * future host code) keep resolving. Removing it would require updating
 * those imports to point at `@openwop/openwop` directly — defer to a
 * follow-up if/when the shim outlives its usefulness.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §A
 * @see sdk/typescript/src/envelope-directive.ts (canonical source)
 */

export type { ReasoningDirectiveStrength } from '@openwop/openwop';
