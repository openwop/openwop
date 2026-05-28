/**
 * vendor.myndhyve.campaign-sequence — pure-control campaign-sequence step nodes.
 *
 * Three executors lifted from MyndHyve's sequence-step engine:
 *   campaign.sequence.wait       — completes a scheduled wait step
 *   campaign.sequence.tag        — validates + emits a tag action
 *   campaign.sequence.condition  — evaluates enrollment data, picks the next step
 *
 * Self-contained. Only reads ctx.inputs + ctx.log; no host-capability
 * extensions required beyond the core NodeContext. The three sibling
 * integration nodes (email, sms, webhook) ship in a follow-up pack
 * once openwop NodeContext extensions for host.email / host.sms /
 * host.http land — they're side-effectful and need explicit
 * peerDependency declarations.
 *
 * Stage 5 pilot per openwop/openwop#11 — first per-executor pack
 * proving the per-pack publishing flow end-to-end on a known-clean
 * subset before tackling the coupled executors.
 */

/* ─── shared helpers ────────────────────────────────────── */

function readInputs(ctx) {
  const inputs = ctx.inputs ?? {};
  const step = inputs.step ?? {};
  const enrollment = inputs.enrollment ?? {};
  const sequence = inputs.sequence ?? {};
  return { step, enrollment, sequence };
}

function success(extra = {}) {
  return { status: 'success', outputs: { success: true, ...extra } };
}

function failure(error) {
  // Per the source executor in MyndHyve, validation failures yield a
  // success-status envelope with a per-output `success: false` flag +
  // an `error` message — NOT a thrown error or status:'error'. The
  // enrolling host treats these as "step done, do not retry".
  return { status: 'success', outputs: { success: false, error } };
}

/* ─── campaign.sequence.wait ────────────────────────────── */

export async function wait(_ctx) {
  // Pure passthrough. The host's enrollment scheduler decides WHEN to
  // fire this node based on step.delay + enrollment.lastStepCompletedAt;
  // the executor itself just acknowledges completion so the workflow
  // can advance.
  return success();
}

/* ─── campaign.sequence.tag ─────────────────────────────── */

export async function tag(ctx) {
  const { step } = readInputs(ctx);
  if (!step.tagAction || !step.tagName) {
    return failure('Missing tag configuration (non-retryable)');
  }
  if (typeof ctx.log === 'function') {
    ctx.log('debug', 'Sequence tag applied', {
      action: step.tagAction,
      tag: step.tagName,
    });
  }
  return success();
}

/* ─── campaign.sequence.condition ───────────────────────── */

/**
 * Walks a dotted-path into a nested object, returning the leaf value
 * or undefined. Pure helper — no side effects.
 */
function getNestedFieldValue(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function looseEquals(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const numA = Number(a);
    const numB = Number(b);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA === numB;
  }
  return String(a) === String(b);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Evaluates one comparison; mirrors the operator semantics in
 * src/canvas-types/campaign-studio/sequences/conditionUtils.ts so the
 * same step.conditions[] payload yields the same branch decision
 * whether the workflow runs on the MyndHyve host or any openwop host.
 *
 * `matches_regex` rejects patterns >200 chars to defend against
 * pathological backtracking.
 */
function evaluateCondition(actual, operator, expected, ctx) {
  try {
    switch (operator) {
      case 'equals':
        return looseEquals(actual, expected);
      case 'not_equals':
        return !looseEquals(actual, expected);
      case 'contains':
        return String(actual ?? '').includes(String(expected ?? ''));
      case 'not_contains':
        return !String(actual ?? '').includes(String(expected ?? ''));
      case 'greater_than':
        return toNumber(actual) > toNumber(expected);
      case 'greater_than_or_equals':
        return toNumber(actual) >= toNumber(expected);
      case 'less_than':
        return toNumber(actual) < toNumber(expected);
      case 'less_than_or_equals':
        return toNumber(actual) <= toNumber(expected);
      case 'is_empty':
        return isEmpty(actual);
      case 'is_not_empty':
        return !isEmpty(actual);
      case 'is_set':
        return actual !== null && actual !== undefined;
      case 'is_not_set':
        return actual === null || actual === undefined;
      case 'starts_with':
        return String(actual ?? '').startsWith(String(expected ?? ''));
      case 'ends_with':
        return String(actual ?? '').endsWith(String(expected ?? ''));
      case 'in_list':
        return Array.isArray(expected) && expected.some((item) => looseEquals(actual, item));
      case 'not_in_list':
        return !Array.isArray(expected) || !expected.some((item) => looseEquals(actual, item));
      case 'matches_regex': {
        const pattern = String(expected ?? '');
        if (pattern.length > 200) {
          if (ctx?.log) ctx.log('warn', 'Regex pattern too long, rejecting', { length: pattern.length });
          return false;
        }
        try {
          return new RegExp(pattern).test(String(actual ?? ''));
        } catch {
          if (ctx?.log) ctx.log('warn', 'Invalid regex pattern in condition', { pattern });
          return false;
        }
      }
      default:
        if (ctx?.log) ctx.log('warn', 'Unknown condition operator', { operator });
        return false;
    }
  } catch (error) {
    if (ctx?.log) {
      ctx.log('warn', 'Condition evaluation error', {
        operator,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }
}

export async function condition(ctx) {
  const { step, enrollment } = readInputs(ctx);
  const conditions = Array.isArray(step.conditions) ? step.conditions : [];

  if (conditions.length === 0) {
    return success({ nextStepId: step.yesNextStepId });
  }

  const data = { ...enrollment, enrollmentId: enrollment.id };
  const results = conditions.map((c) =>
    evaluateCondition(getNestedFieldValue(data, c.field), c.operator, c.value, ctx),
  );
  const logic = step.conditionLogic ?? 'and';
  const conditionMet = logic === 'and' ? results.every(Boolean) : results.some(Boolean);

  return success({
    nextStepId: conditionMet ? step.yesNextStepId : step.noNextStepId,
  });
}

/* ─── default export — typeId → executor map ───────────── */

const nodes = {
  'campaign.sequence.wait': wait,
  'campaign.sequence.tag': tag,
  'campaign.sequence.condition': condition,
};

export default nodes;
