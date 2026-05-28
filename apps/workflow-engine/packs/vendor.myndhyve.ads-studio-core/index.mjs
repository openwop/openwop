/**
 * vendor.myndhyve.ads-studio-core — four pure-logic ads-studio executors.
 *
 * Lifted from MyndHyve's `src/canvas-types/campaign-studio/nodes/adsStudioPack/`
 * (the four wrapper executors) + their underlying service modules:
 *   - CreativeBriefBuilder.ts       (354 LOC) → ads.brief.build
 *   - VariantPlanService.ts         (425 LOC) → ads.variant.plan
 *   - VideoQAService.ts             (532 LOC) → ads.video.qa
 *   - WinnerSynthesisService.ts     (312 LOC) → ads.winner.synthesize
 *
 * All four are deterministic — no AI calls, no host capabilities required
 * beyond the core NodeContext. `ctx.log` is used for diagnostic info when
 * present; nothing else.
 *
 * Differences vs. MyndHyve source:
 *   - `createScopedLogger` replaced with a `ctx.log` shim
 *   - `createSimpleService` replaced with plain singletons
 *   - Zod schemas replaced with the pack's JSON Schemas (validation is
 *     done by the host at dispatch time)
 *   - VideoQA's optional `PlatformSpecRegistry` + `AdComplianceBridge`
 *     dynamic imports are DROPPED. Callers that want safe-zone /
 *     duration / claims checks inject `safeZones` / `videoSpec` /
 *     `checkClaimsFn` via `inputs.options`. The MyndHyve in-tree
 *     executor still supports the registry fallback; the pack version
 *     surfaces the same checks via explicit injection only.
 */

/* ─── shared log helper ────────────────────────────────── */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

/* ─── CreativeBriefBuilder ─────────────────────────────── */

const DEFAULT_CLAIMS_POLICY = {
  bannedPhrases: [],
  regulatedCategories: [],
  proofRequirementRules: [
    { pattern: '\\d+%', action: 'needs-review', description: 'Percentage claims require substantiation' },
    { pattern: '\\d+x', action: 'needs-review', description: 'Multiplier claims require substantiation' },
    { pattern: '#1|number one|best in class', action: 'needs-review', description: 'Superlative claims require substantiation' },
  ],
  defaultStrictness: 'moderate',
};

function validateBrief(brief) {
  const issues = [];
  if (!brief.sellingPoints?.length) {
    issues.push({ field: 'sellingPoints', severity: 'error', message: 'At least one selling point is required' });
  }
  if (!brief.targetAudience || brief.targetAudience.trim().length === 0) {
    issues.push({ field: 'targetAudience', severity: 'error', message: 'Target audience is required' });
  }
  if (!brief.angles?.length) {
    issues.push({ field: 'angles', severity: 'warning', message: 'No angles defined — ad copy may lack variety' });
  }
  if (brief.offer) {
    if (!brief.offer.promise || brief.offer.promise.trim().length === 0) {
      issues.push({ field: 'offer.promise', severity: 'error', message: 'Offer promise is required when offer is defined' });
    }
    if (!brief.offer.ctaPrimary || brief.offer.ctaPrimary.trim().length === 0) {
      issues.push({ field: 'offer.ctaPrimary', severity: 'warning', message: 'Primary CTA is recommended' });
    }
  }
  if (brief.icp) {
    if (!brief.icp.personaName || brief.icp.personaName.trim().length === 0) {
      issues.push({ field: 'icp.personaName', severity: 'warning', message: 'Persona name helps personalize ad copy' });
    }
    if (!brief.icp.painPoints?.length) {
      issues.push({ field: 'icp.painPoints', severity: 'warning', message: 'Pain points help generate problem-focused hooks' });
    }
  }
  if (brief.platformTargets && brief.platformTargets.length === 0) {
    issues.push({ field: 'platformTargets', severity: 'warning', message: 'No platform targets selected' });
  }
  return issues;
}

function resolveCreativeBriefFields(input) {
  const fields = {};
  if (input.icp) {
    fields.icp = {
      personaName: input.icp.personaName,
      industry: input.icp.industry,
      companyType: input.icp.companyType,
      stage: input.icp.stage,
      painPoints: input.icp.painPoints ?? [],
      desiredOutcomes: input.icp.desiredOutcomes ?? [],
      objections: input.icp.objections ?? [],
    };
  }
  if (input.offer) {
    fields.offer = {
      promise: input.offer.promise ?? '',
      mechanism: input.offer.mechanism,
      proofPoints: input.offer.proofPoints ?? [],
      deliverables: input.offer.deliverables ?? [],
      ctaPrimary: input.offer.ctaPrimary ?? 'Learn More',
      ctaSecondary: input.offer.ctaSecondary,
    };
  }
  if (input.positioning) {
    fields.positioning = {
      angleName: input.positioning.angleName ?? '',
      tagline: input.positioning.tagline,
      differentiators: input.positioning.differentiators ?? [],
      antiPositioning: input.positioning.antiPositioning,
    };
  }
  if (input.messageRules) {
    fields.messageRules = {
      tone: input.messageRules.tone ?? 'professional',
      taboos: input.messageRules.taboos ?? [],
      doSay: input.messageRules.doSay ?? [],
      dontSay: input.messageRules.dontSay ?? [],
      claimsPolicy: input.messageRules.claimsPolicy ?? { ...DEFAULT_CLAIMS_POLICY },
    };
  }
  if (input.assetRefs) {
    fields.assetRefs = {
      logos: input.assetRefs.logos ?? [],
      screenshots: input.assetRefs.screenshots ?? [],
      productImages: input.assetRefs.productImages ?? [],
      icons: input.assetRefs.icons ?? [],
    };
  }
  if (input.platformTargets) fields.platformTargets = input.platformTargets;
  if (input.primaryKpis) fields.primaryKpis = input.primaryKpis;
  return fields;
}

function briefBuildFromExtraction(baseBrief, input) {
  const now = new Date().toISOString();
  const fields = resolveCreativeBriefFields(input);
  return { ...baseBrief, ...fields, updatedAt: now };
}

function briefBuildManual(input) {
  const now = new Date().toISOString();
  const fields = resolveCreativeBriefFields(input);
  return {
    id: crypto.randomUUID(),
    campaignId: undefined,
    contentContext: {
      businessName: '',
      productName: '',
      targetAudience: input.targetAudience,
      uniqueSellingPoints: input.sellingPoints.slice(0, 5),
      brandVoice: input.tone ?? '',
      pageGoal: input.goal === 'leads' ? 'lead-generation' : input.goal === 'sales' ? 'sales' : 'awareness',
    },
    sellingPoints: input.sellingPoints,
    targetAudience: input.targetAudience,
    tone: input.tone ?? 'professional',
    goal: input.goal,
    angles: input.angles ?? [],
    constraints: [],
    source: input.source ?? { sectionIds: [] },
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

function briefMerge(existing, partial) {
  const merged = { ...existing, updatedAt: new Date().toISOString() };
  if (partial.icp !== undefined) merged.icp = partial.icp;
  if (partial.offer !== undefined) merged.offer = partial.offer;
  if (partial.positioning !== undefined) merged.positioning = partial.positioning;
  if (partial.messageRules !== undefined) merged.messageRules = partial.messageRules;
  if (partial.assetRefs !== undefined) merged.assetRefs = partial.assetRefs;
  if (partial.platformTargets !== undefined) merged.platformTargets = partial.platformTargets;
  if (partial.primaryKpis !== undefined) merged.primaryKpis = partial.primaryKpis;
  return merged;
}

/* ─── VariantPlanService ───────────────────────────────── */

const DEFAULT_MAX_VARIANTS = 20;
const DEFAULT_NAMING_CONVENTION = {
  campaignSlug: 'campaign',
  adsetSlug: 'adset',
  creativeSlugPattern: '{dimension_values}',
  separator: '_',
  caseStyle: 'lowercase',
};

function createVariantPlan(input) {
  const now = new Date().toISOString();
  const namingConvention = { ...DEFAULT_NAMING_CONVENTION, ...(input.namingConvention ?? {}) };
  return {
    id: crypto.randomUUID(),
    briefId: input.briefId,
    variantAxes: input.axes ?? [],
    maxVariantsTotal: input.maxVariants ?? DEFAULT_MAX_VARIANTS,
    generateStrategy: input.strategy ?? 'balanced',
    focusAxis: input.focusAxis,
    namingConvention,
    constraints: input.constraints ?? [],
    generatedVariants: [],
    targetPlacements: input.targetPlacements ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

function cartesianProduct(axes) {
  if (axes.length === 0) return [{}];
  const [first, ...rest] = axes;
  const restProduct = cartesianProduct(rest);
  const result = [];
  for (const value of first.values) {
    for (const combo of restProduct) {
      result.push({ [first.dimension]: value, ...combo });
    }
  }
  return result;
}

function countCombinations(axes) {
  if (axes.length === 0) return 0;
  return axes.reduce((p, a) => p * Math.max(a.values.length, 1), 1);
}

function applyConstraints(combinations, constraints, _axes) {
  if (constraints.length === 0) return combinations;
  return combinations.filter((combo) => {
    for (const c of constraints) {
      if (c.type === 'incompatible') {
        const allMatch = c.axes.every((axis) => {
          if (!c.values) return false;
          return c.values.includes(combo[axis] ?? '');
        });
        if (allMatch && c.axes.length >= 2) return false;
      }
      if (c.type === 'requires') {
        if (c.axes.length >= 2 && c.values && c.values.length >= 2) {
          if (combo[c.axes[0]] === c.values[0] && combo[c.axes[1]] !== c.values[1]) return false;
        }
      }
    }
    return true;
  });
}

function isFocusOnlyVariation(combo, focusAxis, controlValues) {
  for (const [dim, value] of Object.entries(combo)) {
    if (dim === focusAxis) continue;
    if (value !== controlValues[dim]) return false;
  }
  return true;
}

function applyFocusedStrategy(combinations, focusAxis, axes) {
  const controlValues = {};
  for (const axis of axes) {
    if (axis.values.length > 0) controlValues[axis.dimension] = axis.values[0];
  }
  return [...combinations].sort((a, b) => {
    const af = isFocusOnlyVariation(a, focusAxis, controlValues);
    const bf = isFocusOnlyVariation(b, focusAxis, controlValues);
    if (af && !bf) return -1;
    if (!af && bf) return 1;
    return 0;
  });
}

function balancedTruncate(combinations, axes, max) {
  if (combinations.length <= max) return combinations;
  const selected = [];
  const valueCounts = {};
  for (const axis of axes) {
    valueCounts[axis.dimension] = {};
    for (const value of axis.values) valueCounts[axis.dimension][value] = 0;
  }
  const remaining = [...combinations];
  while (selected.length < max && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const combo = remaining[i];
      let score = 0;
      for (const [dim, value] of Object.entries(combo)) {
        score += valueCounts[dim]?.[value] ?? 0;
      }
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    for (const [dim, value] of Object.entries(chosen)) {
      if (valueCounts[dim]) valueCounts[dim][value] = (valueCounts[dim][value] ?? 0) + 1;
    }
  }
  return selected;
}

function generateSlug(axisValues, convention) {
  const { separator, caseStyle, creativeSlugPattern } = convention;
  let slug;
  if (creativeSlugPattern.includes('{') && creativeSlugPattern.includes('}')) {
    slug = creativeSlugPattern.replace(/\{(\w+)\}/g, (_m, key) => {
      if (key === 'dimension_values') return Object.values(axisValues).join(separator);
      return axisValues[key] ?? key;
    });
  } else {
    slug = Object.values(axisValues).join(separator);
  }
  switch (caseStyle) {
    case 'lowercase': slug = slug.toLowerCase(); break;
    case 'uppercase': slug = slug.toUpperCase(); break;
    case 'titlecase': slug = slug.replace(/\b\w/g, (c) => c.toUpperCase()); break;
    case 'kebab': slug = slug.toLowerCase().replace(/\s+/g, '-'); break;
  }
  slug = slug.replace(/\s+/g, separator);
  const escapedSep = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  slug = slug.replace(new RegExp(`${escapedSep}{2,}`, 'g'), separator);
  return slug;
}

function generateVariantMatrix(plan) {
  if (plan.variantAxes.length === 0) return [];
  let combinations = cartesianProduct(plan.variantAxes);
  combinations = applyConstraints(combinations, plan.constraints, plan.variantAxes);
  if (plan.generateStrategy === 'focused' && plan.focusAxis) {
    combinations = applyFocusedStrategy(combinations, plan.focusAxis, plan.variantAxes);
  }
  if (combinations.length > plan.maxVariantsTotal) {
    if (plan.generateStrategy === 'balanced') {
      combinations = balancedTruncate(combinations, plan.variantAxes, plan.maxVariantsTotal);
    } else {
      combinations = combinations.slice(0, plan.maxVariantsTotal);
    }
  }
  return combinations.map((axisValues) => ({
    id: crypto.randomUUID(),
    axisValues,
    slug: generateSlug(axisValues, plan.namingConvention),
  }));
}

function validateVariantPlan(plan) {
  const issues = [];
  if (plan.variantAxes.length === 0) {
    issues.push({ field: 'variantAxes', severity: 'error', message: 'At least one variant axis is required' });
  }
  for (const axis of plan.variantAxes) {
    if (!axis.dimension || axis.dimension.trim().length === 0) {
      issues.push({ field: 'variantAxes.dimension', severity: 'error', message: 'Axis dimension name is required' });
    }
    if (axis.values.length < 2) {
      issues.push({ field: `variantAxes.${axis.dimension}`, severity: 'warning', message: `Axis "${axis.dimension}" has fewer than 2 values — no variation possible` });
    }
  }
  const dims = plan.variantAxes.map((a) => a.dimension);
  if (new Set(dims).size < dims.length) {
    issues.push({ field: 'variantAxes', severity: 'error', message: 'Duplicate axis dimensions found' });
  }
  if (plan.maxVariantsTotal < 1) {
    issues.push({ field: 'maxVariantsTotal', severity: 'error', message: 'maxVariantsTotal must be at least 1' });
  }
  if (plan.generateStrategy === 'focused') {
    if (!plan.focusAxis) {
      issues.push({ field: 'focusAxis', severity: 'error', message: 'focusAxis is required when strategy is "focused"' });
    } else if (!dims.includes(plan.focusAxis)) {
      issues.push({ field: 'focusAxis', severity: 'error', message: `focusAxis "${plan.focusAxis}" is not a defined axis` });
    }
  }
  for (const c of plan.constraints) {
    for (const a of c.axes) {
      if (!dims.includes(a)) {
        issues.push({ field: 'constraints', severity: 'warning', message: `Constraint references unknown axis "${a}"` });
      }
    }
  }
  const totalCombinations = countCombinations(plan.variantAxes);
  if (totalCombinations > 1000) {
    issues.push({ field: 'variantAxes', severity: 'warning', message: `Axes produce ${totalCombinations} combinations — will be capped at ${plan.maxVariantsTotal}` });
  }
  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    estimatedVariantCount: Math.min(totalCombinations, plan.maxVariantsTotal),
  };
}

/* ─── VideoQAService ───────────────────────────────────── */

const QA_DEFAULTS = {
  minTextScaleRatio: 0.04,
  maxCharsPerScene: 120,
  maxTextBlocksPerScene: 2,
};

function checkLegibility(storyboard, options) {
  const checks = [];
  const minScale = options.minTextScaleRatio ?? QA_DEFAULTS.minTextScaleRatio;
  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    if (!scene.textOverlay) continue;
    const wordCount = scene.textOverlay.split(/\s+/).filter(Boolean).length;
    const wordsPerSec = wordCount / scene.duration;
    if (wordsPerSec > 4) {
      checks.push({
        name: 'Text reading speed', category: 'legibility', passed: false, severity: 'warning',
        message: `Scene "${scene.label}": ${wordCount} words in ${scene.duration}s (${wordsPerSec.toFixed(1)} w/s) — may be too fast to read`,
        sceneIndex: i, autoFixAvailable: true,
        suggestedFix: { type: 'editPacing', sceneIndex: i, durationSec: Math.ceil(wordCount / 3) },
      });
    } else {
      checks.push({
        name: 'Text reading speed', category: 'legibility', passed: true, severity: 'info',
        message: `Scene "${scene.label}": reading speed OK (${wordsPerSec.toFixed(1)} w/s)`,
        sceneIndex: i, autoFixAvailable: false,
      });
    }
    const scaleMatch = scene.visualPrompt?.match(/\[text-scale:([\d.]+)\]/);
    if (scaleMatch) {
      const scale = parseFloat(scaleMatch[1]);
      if (scale < minScale) {
        checks.push({
          name: 'Text scale', category: 'legibility', passed: false, severity: 'warning',
          message: `Scene "${scene.label}": text scale ${scale} is below minimum ${minScale}`,
          sceneIndex: i, autoFixAvailable: true,
          suggestedFix: { type: 'editTextScale', sceneIndex: i, scale: minScale },
        });
      }
    }
  }
  return checks;
}

function checkSafeZones(storyboard, options) {
  const checks = [];
  const safeZones = options.safeZones ?? [];
  if (safeZones.length === 0) return checks;
  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    if (scene.contentType === 'cta' && scene.textOverlay) {
      const hasBottom = safeZones.some((z) => z.top >= 70);
      if (hasBottom) {
        checks.push({
          name: 'CTA safe zone', category: 'safe-zone', passed: false, severity: 'warning',
          message: `Scene "${scene.label}": CTA text may overlap with platform UI in the bottom safe zone for ${options.placement ?? 'target placement'}`,
          sceneIndex: i, autoFixAvailable: false,
        });
      }
    }
    if (i === 0 && scene.textOverlay) {
      const hasTop = safeZones.some((z) => z.top <= 15 && z.height >= 10);
      if (hasTop) {
        checks.push({
          name: 'Opening text safe zone', category: 'safe-zone', passed: false, severity: 'info',
          message: `Scene "${scene.label}": opening text overlay may overlap with top status bar area for ${options.placement ?? 'target placement'}`,
          sceneIndex: i, autoFixAvailable: false,
        });
      }
    }
  }
  if (checks.length === 0) {
    checks.push({
      name: 'Safe zone compliance', category: 'safe-zone', passed: true, severity: 'info',
      message: `No safe zone conflicts detected for ${options.placement ?? 'target placement'}`,
      autoFixAvailable: false,
    });
  }
  return checks;
}

function checkDuration(storyboard, options) {
  const checks = [];
  const videoSpec = options.videoSpec;
  if (!videoSpec) return checks;
  const placementLabel = options.placement ?? 'target placement';
  const totalDuration = storyboard.totalDuration;
  if (totalDuration < videoSpec.minDuration) {
    checks.push({
      name: 'Minimum duration', category: 'duration', passed: false, severity: 'error',
      message: `Total duration ${totalDuration}s is below the ${videoSpec.minDuration}s minimum for ${placementLabel}`,
      autoFixAvailable: false,
    });
  } else if (totalDuration > videoSpec.maxDuration) {
    checks.push({
      name: 'Maximum duration', category: 'duration', passed: false, severity: 'error',
      message: `Total duration ${totalDuration}s exceeds the ${videoSpec.maxDuration}s maximum for ${placementLabel}`,
      autoFixAvailable: true,
      suggestedFix: { type: 'shortenDuration', maxTotalSec: videoSpec.maxDuration },
    });
  } else {
    checks.push({
      name: 'Duration compliance', category: 'duration', passed: true, severity: 'info',
      message: `Total duration ${totalDuration}s is within ${videoSpec.minDuration}-${videoSpec.maxDuration}s range for ${placementLabel}`,
      autoFixAvailable: false,
    });
  }
  if (videoSpec.recommendedDuration && totalDuration > videoSpec.recommendedDuration * 1.5) {
    checks.push({
      name: 'Recommended duration', category: 'duration', passed: false, severity: 'warning',
      message: `Total duration ${totalDuration}s exceeds recommended ${videoSpec.recommendedDuration}s for ${placementLabel} — shorter ads tend to perform better`,
      autoFixAvailable: true,
      suggestedFix: { type: 'shortenDuration', maxTotalSec: videoSpec.recommendedDuration },
    });
  }
  return checks;
}

function checkTextDensity(storyboard, options) {
  const checks = [];
  const maxChars = options.maxCharsPerScene ?? QA_DEFAULTS.maxCharsPerScene;
  const maxBlocks = options.maxTextBlocksPerScene ?? QA_DEFAULTS.maxTextBlocksPerScene;
  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    let blocks = 0;
    if (scene.textOverlay) blocks++;
    if (scene.voiceover) blocks++;
    const totalChars = (scene.textOverlay?.length ?? 0) + (scene.voiceover?.length ?? 0);
    if (totalChars > maxChars) {
      checks.push({
        name: 'Text character count', category: 'text-density', passed: false, severity: 'warning',
        message: `Scene "${scene.label}": ${totalChars} characters exceeds ${maxChars} limit — viewers may not read it all`,
        sceneIndex: i, autoFixAvailable: false,
      });
    }
    if (blocks > maxBlocks) {
      checks.push({
        name: 'Text block count', category: 'text-density', passed: false, severity: 'warning',
        message: `Scene "${scene.label}": ${blocks} text blocks exceeds ${maxBlocks} limit — too much visual noise`,
        sceneIndex: i, autoFixAvailable: false,
      });
    }
  }
  if (checks.length === 0) {
    checks.push({
      name: 'Text density', category: 'text-density', passed: true, severity: 'info',
      message: 'Text density is within acceptable limits across all scenes',
      autoFixAvailable: false,
    });
  }
  return checks;
}

function checkClaims(storyboard, options) {
  const checks = [];
  if (!options.claimsPolicy || typeof options.checkClaimsFn !== 'function') return checks;
  const policy = options.claimsPolicy;
  const checkFn = options.checkClaimsFn;
  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const textOverlay = scene.textOverlay ?? '';
    const voiceover = scene.voiceover ?? '';
    if (!textOverlay && !voiceover) continue;
    const copyText = {
      headline: textOverlay || voiceover,
      ...(textOverlay && voiceover ? { bodyText: voiceover } : {}),
    };
    const result = checkFn(copyText, policy);
    if (result?.issues?.length) {
      for (const issue of result.issues) {
        const suggestedFix = issue.action === 'block'
          ? { type: 'updateText', sceneIndex: i, textIndex: 0, newText: '' }
          : undefined;
        checks.push({
          name: `Claims: ${issue.ruleType}`, category: 'claims', passed: false,
          severity: issue.action === 'block' ? 'error' : 'warning',
          message: `Scene "${scene.label}": ${issue.message}`,
          sceneIndex: i, autoFixAvailable: issue.action === 'block', suggestedFix,
        });
      }
    }
  }
  if (checks.length === 0) {
    checks.push({
      name: 'Claims compliance', category: 'claims', passed: true, severity: 'info',
      message: 'No claims policy violations found in storyboard text',
      autoFixAvailable: false,
    });
  }
  return checks;
}

function runVideoQA(storyboard, options) {
  const opts = options ?? {};
  const checks = [
    ...checkLegibility(storyboard, opts),
    ...checkSafeZones(storyboard, opts),
    ...checkDuration(storyboard, opts),
    ...checkTextDensity(storyboard, opts),
    ...checkClaims(storyboard, opts),
  ];
  const errors = checks.filter((c) => !c.passed && c.severity === 'error').length;
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  const score = total > 0
    ? Math.round(((passed * 100) - (errors * 20) - (warnings * 5)) / total)
    : 100;
  return {
    passed: errors === 0,
    checks,
    overallScore: Math.max(0, Math.min(100, score)),
  };
}

/* ─── WinnerSynthesisService ───────────────────────────── */

const SYNTHESIS_DEFAULT_DIMENSIONS = ['copy', 'creative', 'targeting', 'combined'];
const SYNTHESIS_DIMENSION_METRICS = { copy: 'ctr', creative: 'ctr', targeting: 'conversion_rate', combined: 'roas' };

function summarizeTest(r) {
  return {
    testId: r.testId,
    hasWinner: !!r.winner,
    winnerVariantId: r.winner?.variantId,
    winnerVariantName: r.winner?.variantName,
    improvement: r.winner?.improvement ?? 0,
    confidence: r.winner?.confidence ?? 0,
    recommendation: r.recommendation,
    totalImpressions: r.totalImpressions,
    totalSpend: r.totalSpend,
  };
}

function computeAggregateStats(summaries, results) {
  const testsWithWinner = summaries.filter((s) => s.hasWinner).length;
  const improvements = summaries.filter((s) => s.hasWinner).map((s) => s.improvement);
  return {
    totalTests: summaries.length,
    testsWithWinner,
    testsWithoutWinner: summaries.length - testsWithWinner,
    totalImpressions: results.reduce((s, r) => s + r.totalImpressions, 0),
    totalClicks: results.reduce((s, r) => s + r.totalClicks, 0),
    totalConversions: results.reduce((s, r) => s + r.totalConversions, 0),
    totalSpend: results.reduce((s, r) => s + r.totalSpend, 0),
    averageImprovement: improvements.length > 0 ? improvements.reduce((a, b) => a + b, 0) / improvements.length : 0,
  };
}

function deriveSynthesisInsights(summaries, stats) {
  const insights = [];
  if (stats.testsWithWinner > 0) {
    insights.push({ type: 'winner', severity: 'success', message: `${stats.testsWithWinner} of ${stats.totalTests} tests found a statistically significant winner.` });
  }
  if (stats.testsWithoutWinner > 0) {
    insights.push({ type: 'no_winner', severity: 'warning', message: `${stats.testsWithoutWinner} test(s) did not reach significance. Consider extending duration or increasing sample size.` });
  }
  const lowData = summaries.filter((s) => s.recommendation === 'needs_more_data');
  if (lowData.length > 0) {
    insights.push({ type: 'low_data', severity: 'warning', message: `${lowData.length} test(s) need more data before conclusions can be drawn.` });
  }
  if (stats.averageImprovement > 20) {
    insights.push({ type: 'trend', severity: 'success', message: `Strong average improvement of ${stats.averageImprovement.toFixed(1)}% across winning variants.` });
  } else if (stats.averageImprovement > 0 && stats.averageImprovement <= 5) {
    insights.push({ type: 'efficiency', severity: 'info', message: `Marginal improvement of ${stats.averageImprovement.toFixed(1)}%. Consider testing bolder creative variations.` });
  }
  return insights;
}

function suggestNextTests(summaries, stats, platforms, priority) {
  const suggestions = [];
  let p = 1;
  const primary = platforms[0];
  if (stats.testsWithWinner === 0) {
    const dim = priority[0] ?? 'copy';
    suggestions.push({ dimension: dim, metric: SYNTHESIS_DIMENSION_METRICS[dim], rationale: 'No winners found yet. Start with the highest-priority dimension.', priority: p++, platform: primary });
  }
  for (const dim of priority) {
    if (suggestions.length >= 3) break;
    if (suggestions.some((s) => s.dimension === dim)) continue;
    const wins = summaries.filter((s) => s.hasWinner);
    const rationale = wins.length > 0
      ? `Build on ${wins.length} winning insight(s) by testing the ${dim} dimension next.`
      : `Test ${dim} to find optimization opportunities.`;
    suggestions.push({ dimension: dim, metric: SYNTHESIS_DIMENSION_METRICS[dim], rationale, priority: p++, platform: primary });
  }
  if (stats.averageImprovement > 10 && !suggestions.some((s) => s.dimension === 'combined')) {
    suggestions.push({ dimension: 'combined', metric: 'roas', rationale: 'Strong individual winners found. Test winning combinations together for compounding gains.', priority: p++, platform: primary });
  }
  return suggestions;
}

function synthesize(input) {
  const testSummaries = input.testResults.map(summarizeTest);
  const aggregateStats = computeAggregateStats(testSummaries, input.testResults);
  const insights = deriveSynthesisInsights(testSummaries, aggregateStats);
  const nextTests = suggestNextTests(testSummaries, aggregateStats, input.platforms, input.dimensionPriority ?? SYNTHESIS_DEFAULT_DIMENSIONS);
  return {
    id: crypto.randomUUID(),
    variantPlanId: input.variantPlanId,
    createdAt: new Date().toISOString(),
    testSummaries,
    insights,
    nextTests,
    aggregateStats,
  };
}

function generateSynthesisMarkdown(result) {
  const lines = [];
  lines.push('# Winner Synthesis Report', '');
  lines.push(`**Variant Plan:** ${result.variantPlanId}`);
  lines.push(`**Generated:** ${result.createdAt}`);
  lines.push(`**Tests Analyzed:** ${result.aggregateStats.totalTests}`, '');
  lines.push('## Aggregate Statistics', '');
  lines.push('| Metric | Value |');
  lines.push('| ------ | ----- |');
  lines.push(`| Tests with Winner | ${result.aggregateStats.testsWithWinner} / ${result.aggregateStats.totalTests} |`);
  lines.push(`| Total Impressions | ${result.aggregateStats.totalImpressions.toLocaleString()} |`);
  lines.push(`| Total Spend | $${result.aggregateStats.totalSpend.toFixed(2)} |`);
  lines.push(`| Average Improvement | ${result.aggregateStats.averageImprovement.toFixed(1)}% |`, '');
  if (result.insights.length > 0) {
    lines.push('## Insights', '');
    for (const insight of result.insights) {
      const icon = insight.severity === 'success' ? '+' : insight.severity === 'warning' ? '!' : '-';
      lines.push(`- [${icon}] ${insight.message}`);
    }
    lines.push('');
  }
  if (result.testSummaries.length > 0) {
    lines.push('## Test Results', '');
    for (const s of result.testSummaries) {
      const status = s.hasWinner
        ? `Winner: ${s.winnerVariantName} (+${s.improvement.toFixed(1)}%)`
        : 'No winner determined';
      lines.push(`- **${s.testId}**: ${status} — ${s.recommendation}`);
    }
    lines.push('');
  }
  if (result.nextTests.length > 0) {
    lines.push('## Suggested Next Tests', '');
    for (const t of result.nextTests) {
      lines.push(`${t.priority}. **${t.dimension}** (metric: ${t.metric})`);
      lines.push(`   ${t.rationale}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/* ─── executors ────────────────────────────────────────── */

export async function briefBuild(ctx) {
  const log = makeLog(ctx);
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  const mode = config.mode ?? 'manual';
  const validateOutput = config.validateOutput !== false;

  log.info('Executing brief build', { mode });

  try {
    let brief;
    if (mode === 'extraction' && inputs.baseBrief) {
      brief = briefBuildFromExtraction(inputs.baseBrief, inputs.briefInput ?? {});
    } else if (mode === 'merge' && inputs.baseBrief) {
      brief = briefMerge(inputs.baseBrief, inputs.briefInput ?? {});
    } else {
      const briefInput = inputs.briefInput;
      if (!briefInput) {
        return {
          status: 'success',
          outputs: { brief: null, validationIssues: [{ field: 'briefInput', message: 'Brief input is required for manual mode' }] },
        };
      }
      brief = briefBuildManual(briefInput);
    }
    const validationIssues = validateOutput ? validateBrief(brief) : [];
    return { status: 'success', outputs: { brief, validationIssues } };
  } catch (err) {
    log.error('Brief build failed', { error: err?.message });
    return {
      status: 'success',
      outputs: {
        brief: null,
        validationIssues: [{ field: '_executor', message: err instanceof Error ? err.message : String(err) }],
      },
    };
  }
}

export async function variantPlan(ctx) {
  const log = makeLog(ctx);
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  const mode = config.mode ?? 'create';

  log.info('Executing variant plan', { mode });

  try {
    if (mode === 'generate') {
      if (!inputs.plan) {
        return { status: 'success', outputs: { variants: [], error: 'inputs.plan is required for generate mode' } };
      }
      const variants = generateVariantMatrix(inputs.plan);
      return { status: 'success', outputs: { plan: inputs.plan, variants } };
    }
    if (mode === 'validate') {
      if (!inputs.plan) {
        return { status: 'success', outputs: { validation: { valid: false, issues: [{ field: 'plan', severity: 'error', message: 'inputs.plan is required for validate mode' }], estimatedVariantCount: 0 } } };
      }
      return { status: 'success', outputs: { plan: inputs.plan, validation: validateVariantPlan(inputs.plan) } };
    }
    // create
    if (!inputs.briefId || !Array.isArray(inputs.axes)) {
      return { status: 'success', outputs: { plan: null, error: 'briefId and axes[] are required for create mode' } };
    }
    const plan = createVariantPlan(inputs);
    return { status: 'success', outputs: { plan, validation: validateVariantPlan(plan) } };
  } catch (err) {
    log.error('Variant plan failed', { error: err?.message });
    return {
      status: 'error',
      error: { code: 'VARIANT_PLAN_FAILED', message: err instanceof Error ? err.message : String(err), retryable: false },
    };
  }
}

export async function videoQA(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  if (!inputs.storyboard) {
    return {
      status: 'error',
      error: { code: 'MISSING_STORYBOARD', message: 'inputs.storyboard is required', retryable: false },
    };
  }
  log.info('Running video QA', { storyboardId: inputs.storyboard.id });
  const result = runVideoQA(inputs.storyboard, inputs.options ?? {});
  return { status: 'success', outputs: result };
}

export async function winnerSynthesize(ctx) {
  const log = makeLog(ctx);
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  if (!Array.isArray(inputs.testResults) || inputs.testResults.length === 0) {
    return {
      status: 'error',
      error: { code: 'MISSING_TEST_RESULTS', message: 'inputs.testResults is required and must be non-empty', retryable: false },
    };
  }
  log.info('Synthesizing winner results', { variantPlanId: inputs.variantPlanId, testCount: inputs.testResults.length });
  const result = synthesize(inputs);
  if (config.emitMarkdown) {
    result.report = generateSynthesisMarkdown(result);
  }
  return { status: 'success', outputs: result };
}

/* ─── default export — typeId → executor map ───────────── */

const nodes = {
  'ads.brief.build': briefBuild,
  'ads.variant.plan': variantPlan,
  'ads.video.qa': videoQA,
  'ads.winner.synthesize': winnerSynthesize,
};

export default nodes;
