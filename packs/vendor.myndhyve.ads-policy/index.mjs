/**
 * vendor.myndhyve.ads-policy — ads.policy.check executor.
 *
 * Built-in policy text-rule scanner. Detects claims, trademark mentions,
 * prohibited content, and discriminatory targeting in ad copy. Lifted
 * from MyndHyve's AdApprovalGateService.runComplianceChecks (text-rule
 * branch only) + the 7 BUILT_IN_RULES constants.
 *
 * Caller-supplied augmentations:
 *   inputs.placementTextLimits — per-placement text-length limits for
 *     headline/description/bodyText/ctaText. Resolved upstream by the
 *     workflow (via vendor.myndhyve.ads-platforms pack OR host.adPlatformSpecs).
 *   inputs.trustGuardrailChecks — pre-computed trust-guardrail results.
 *     Resolved upstream by a TrustGuardrail-aware node OR
 *     host.trustGuardrails capability. Merged into riskFlags.
 *
 * Asset-format checks (image/video dimensions, file sizes, durations)
 * deferred to vendor.myndhyve.ads-creative-validate when shipped —
 * they need a richer subset of platform spec data + asset metadata.
 */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

/* ─── BUILT_IN_RULES ────────────────────────────────────── */

const BUILT_IN_RULES = [
  {
    id: 'claims-guarantee',
    name: 'Unqualified Guarantees',
    description: 'Detects unqualified guarantee language without disclaimers',
    category: 'claims',
    severity: 'high',
    platforms: [],
    autoResolvable: false,
    patterns: ['\\b(100%|guaranteed|risk[- ]?free|no[- ]?risk|money[- ]?back)\\b'],
    keywords: ['guarantee', 'guaranteed', 'risk-free', 'no risk'],
    recommendation: 'Add appropriate disclaimers or qualify the guarantee claim.',
    enabled: true,
  },
  {
    id: 'claims-income',
    name: 'Income Claims',
    description: 'Detects income or earnings claims that may be unsubstantiated',
    category: 'claims',
    severity: 'critical',
    platforms: [],
    autoResolvable: false,
    patterns: [
      '\\b(earn|make|income|salary|revenue)\\s+\\$?\\d',
      '\\$\\d[\\d,]*\\s*(per|a|every|each)\\s*(day|week|month|year|hour)',
    ],
    keywords: [],
    recommendation: 'Remove specific income claims or provide verifiable substantiation.',
    enabled: true,
  },
  {
    id: 'claims-superlative',
    name: 'Unsubstantiated Superlatives',
    description: 'Detects superlative claims that may require evidence',
    category: 'claims',
    severity: 'medium',
    platforms: [],
    autoResolvable: false,
    patterns: ['\\b(best|#1|number one|top[- ]?rated|fastest|cheapest|most popular)\\b'],
    keywords: ['best', 'number one', '#1', 'top rated'],
    recommendation: 'Qualify the claim with context (e.g., "one of the best") or provide supporting evidence.',
    enabled: true,
  },
  {
    id: 'trademark-competitor',
    name: 'Competitor Brand Mentions',
    description: 'Flags use of competitor brand names in ad copy',
    category: 'trademark',
    severity: 'medium',
    platforms: ['meta', 'google'],
    autoResolvable: false,
    patterns: [],
    keywords: [],
    recommendation: 'Review whether competitor brand mention complies with platform trademark policies.',
    enabled: true,
  },
  {
    id: 'prohibited-before-after',
    name: 'Before/After Claims',
    description: 'Detects before/after claims prohibited on some platforms',
    category: 'prohibited_content',
    severity: 'high',
    platforms: ['meta'],
    autoResolvable: false,
    patterns: ['\\b(before\\s+and\\s+after|transformation|results\\s+in\\s+\\d+\\s+days)\\b'],
    keywords: ['before and after', 'transformation'],
    recommendation: 'Meta prohibits before/after imagery and claims for personal attributes.',
    enabled: true,
  },
  {
    id: 'prohibited-urgency-scam',
    name: 'Deceptive Urgency',
    description: 'Detects manipulative urgency language that may violate policies',
    category: 'prohibited_content',
    severity: 'medium',
    platforms: [],
    autoResolvable: false,
    patterns: ['\\b(act now|last chance|expires (today|tonight|soon)|only \\d+ left|limited time)\\b'],
    keywords: [],
    recommendation: 'Ensure urgency claims are truthful. If using countdown language, it must reflect real deadlines.',
    enabled: true,
  },
  {
    id: 'targeting-discrimination',
    name: 'Discriminatory Language',
    description: 'Detects language that implies discriminatory targeting',
    category: 'targeting',
    severity: 'critical',
    platforms: [],
    autoResolvable: false,
    patterns: ['\\b(only for (men|women|whites|blacks)|not for (disabled|elderly))\\b'],
    keywords: [],
    recommendation: 'Remove discriminatory language. Ad platforms prohibit targeting based on protected characteristics.',
    enabled: true,
  },
];

/* ─── helpers ──────────────────────────────────────────── */

function evaluateRule(rule, textContent, log) {
  const lowerText = String(textContent).toLowerCase();
  if (Array.isArray(rule.keywords) && rule.keywords.length > 0) {
    if (rule.keywords.some((kw) => lowerText.includes(String(kw).toLowerCase()))) {
      return {
        rule: rule.id,
        category: rule.category,
        status: rule.severity === 'critical' || rule.severity === 'high' ? 'fail' : 'warning',
        message: `${rule.name}: ${rule.recommendation}`,
        autoResolvable: !!rule.autoResolvable,
      };
    }
  }
  if (Array.isArray(rule.patterns) && rule.patterns.length > 0) {
    for (const pattern of rule.patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(textContent)) {
          return {
            rule: rule.id,
            category: rule.category,
            status: rule.severity === 'critical' || rule.severity === 'high' ? 'fail' : 'warning',
            message: `${rule.name}: ${rule.recommendation}`,
            autoResolvable: !!rule.autoResolvable,
          };
        }
      } catch (err) {
        log.warn('Invalid regex pattern in rule', { ruleId: rule.id, pattern, error: err?.message });
      }
    }
  }
  return null;
}

/**
 * Validate a copy block's text-length against caller-supplied placement
 * limits. Replaces MyndHyve's validateTextForPlacement (which sourced
 * limits from PlatformSpecRegistry); here the caller supplies the
 * resolved subset via `inputs.placementTextLimits`.
 */
function checkTextLengths(copyText, placement, limits) {
  if (!limits) return [];
  const checks = [];
  const labels = {
    headline: 'Headline',
    description: 'Description',
    bodyText: 'Body text',
    ctaText: 'Call-to-action',
  };
  for (const field of ['headline', 'description', 'bodyText', 'ctaText']) {
    const limit = limits[field];
    const value = copyText[field];
    if (value === undefined || !limit || typeof limit.max !== 'number') continue;
    const length = String(value).length;
    if (typeof limit.min === 'number' && length < limit.min) {
      checks.push({
        rule: `format-text-${placement}`,
        category: 'format',
        status: 'fail',
        message: `${labels[field]} must be at least ${limit.min} characters for ${placement} (currently ${length})`,
        autoResolvable: true,
      });
    } else if (length > limit.max) {
      checks.push({
        rule: `format-text-${placement}`,
        category: 'format',
        status: 'fail',
        message: `${labels[field]} exceeds the ${limit.max}-character limit for ${placement} (currently ${length})`,
        autoResolvable: true,
      });
    } else if (typeof limit.recommended === 'number' && length > limit.recommended) {
      checks.push({
        rule: `format-text-${placement}`,
        category: 'format',
        status: 'warning',
        message: `${labels[field]} exceeds the recommended ${limit.recommended} characters for ${placement}`,
        autoResolvable: true,
      });
    }
  }
  return checks;
}

/* ─── executor ──────────────────────────────────────────── */

export async function policyCheck(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};
  const copyText = inputs.copyText ?? {};

  log.info('Running policy check', {
    platforms: inputs.platforms,
    adId: inputs.adId,
    customRuleCount: Array.isArray(config.customRules) ? config.customRules.length : 0,
  });

  const platforms = Array.isArray(inputs.platforms) ? inputs.platforms : [];
  const placements = Array.isArray(inputs.placements) ? inputs.placements : [];
  const customRules = Array.isArray(config.customRules) ? config.customRules : [];
  const allRules = [...BUILT_IN_RULES, ...customRules];

  const textContent = [
    copyText.headline,
    copyText.description ?? '',
    copyText.bodyText ?? '',
    copyText.ctaText ?? '',
  ].filter(Boolean).join(' ');

  const checks = [];
  let rulesEvaluated = 0;

  for (const rule of allRules) {
    if (!rule.enabled) continue;
    if (Array.isArray(rule.platforms) && rule.platforms.length > 0
        && !rule.platforms.some((p) => platforms.includes(p))) continue;
    rulesEvaluated++;
    const check = evaluateRule(rule, textContent, log);
    if (check) checks.push(check);
  }

  if (inputs.placementTextLimits && typeof inputs.placementTextLimits === 'object') {
    for (const placement of placements) {
      const limits = inputs.placementTextLimits[placement];
      if (!limits) continue;
      rulesEvaluated++;
      checks.push(...checkTextLengths(copyText, placement, limits));
    }
  }

  // Caller-supplied trust-guardrail results.
  if (Array.isArray(inputs.trustGuardrailChecks)) {
    for (const c of inputs.trustGuardrailChecks) {
      rulesEvaluated++;
      if (c && (c.status === 'fail' || c.status === 'warning')) {
        checks.push({
          rule: c.rule ?? 'trust-guardrail',
          category: c.category ?? 'trust',
          status: c.status,
          message: c.message,
          autoResolvable: !!c.autoResolvable,
        });
      }
    }
  }

  const riskFlags = checks.filter((c) => c.status === 'fail' || c.status === 'warning');
  const disclaimers = riskFlags.filter((f) => f.autoResolvable).map((f) => f.message);
  const isCompliant = riskFlags.every((f) => f.status !== 'fail');

  return {
    status: 'success',
    outputs: {
      riskFlags,
      disclaimers,
      isCompliant,
      rulesEvaluated,
      success: true,
    },
  };
}

const nodes = {
  'ads.policy.check': policyCheck,
};

export default nodes;
