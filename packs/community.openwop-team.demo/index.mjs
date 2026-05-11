/**
 * community.openwop-team.demo — community-namespace demo pack runtime.
 *
 * Single node (`uppercase`) + one agent (`greeter`, host-interpreted).
 * The greeter has no runtime export here — agents are instantiated
 * from the manifest at host install time.
 *
 * Zero deps. Node >= 20.
 *
 * @see spec/v1/node-packs.md
 * @see docs/PACKS-MVP-PLAN.md (Phase 1 #4)
 */

/**
 * community.openwop-team.demo.uppercase
 *
 * Returns the input string uppercased. Pure, replay-safe, no side
 * effects. Smoke node — useful as a sentinel that a community-tier
 * pack can be loaded alongside core.* packs in the same workflow.
 */
export async function uppercase(ctx) {
  const text = String(ctx.inputs.text);
  return {
    status: 'success',
    outputs: { text: text.toUpperCase() },
  };
}

export const nodes = {
  'community.openwop-team.demo.uppercase': uppercase,
};

export default nodes;
