/**
 * vendor.myndhyve.ads-metrics-import
 *
 * Single typeId: `ads.metrics.import`
 *
 * Pure-logic pack. Takes caller-supplied ad metric snapshots and
 * aggregates them — replicating the source's
 * AdMetricsService.getAggregatedMetrics math.
 *
 * Why pure-logic: the source `AdMetricsService` is a client-side cache
 * (Map<key, snapshot>) with Phase-2 platform API integration marked
 * TBD. The current executor `ads.metrics.import` just reads from that
 * cache + aggregates — there is no external fetching. This pack
 * mirrors that exactly via caller-supplied `inputs.snapshots[]`.
 *
 * When external platform API fetching is needed, callers chain:
 *   (future) vendor.myndhyve.ads-publish-platform fetch-metrics step
 *   → vendor.myndhyve.ads-metrics-import (this pack — aggregation)
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/services/
 *   AdMetricsService.ts (316 LOC of cache + aggregation).
 *
 * Pure-JS, Node-20 stdlib only.
 */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

const VALID_ENTITY_TYPES = ['campaign', 'ad', 'variant'];

function nullableNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampNonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function validateSnapshot(s, index) {
  if (!s || typeof s !== 'object') return { error: `snapshot ${index}: not an object` };
  if (typeof s.entityId !== 'string' || s.entityId.length === 0) return { error: `snapshot ${index}: missing entityId` };
  if (typeof s.platform !== 'string' || s.platform.length === 0) return { error: `snapshot ${index}: missing platform` };

  const entityType = VALID_ENTITY_TYPES.includes(s.entityType) ? s.entityType : 'ad';
  const dr = s.dateRange ?? {};
  const dateRange = {
    start: typeof dr.start === 'string' ? dr.start : '',
    end: typeof dr.end === 'string' ? dr.end : '',
  };

  return {
    snapshot: {
      entityId: s.entityId,
      entityType,
      platform: s.platform,
      dateRange,
      // Core metrics — clamp to non-negative numbers (matches source's implicit semantics).
      impressions: clampNonNeg(s.impressions),
      clicks: clampNonNeg(s.clicks),
      ctr: clampNonNeg(s.ctr),
      spend: clampNonNeg(s.spend),
      cpc: clampNonNeg(s.cpc),
      cpm: clampNonNeg(s.cpm),
      conversions: clampNonNeg(s.conversions),
      conversionRate: clampNonNeg(s.conversionRate),
      costPerConversion: clampNonNeg(s.costPerConversion),
      conversionValue: clampNonNeg(s.conversionValue),
      roas: clampNonNeg(s.roas),
      // Optional engagement metrics (preserved as null when missing).
      reach: nullableNumber(s.reach),
      frequency: nullableNumber(s.frequency),
      videoViews: nullableNumber(s.videoViews),
      videoCompletions: nullableNumber(s.videoCompletions),
      // Quality metrics (optional).
      qualityScore: nullableNumber(s.qualityScore),
      relevanceScore: nullableNumber(s.relevanceScore),
      fetchedAt: typeof s.fetchedAt === 'string' ? s.fetchedAt : new Date().toISOString(),
    },
  };
}

function aggregate(snapshots) {
  // Mirrors AdMetricsService.getAggregatedMetrics math exactly.
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalConversionValue = 0;
  const byPlatform = {};

  for (const s of snapshots) {
    totalSpend += s.spend;
    totalImpressions += s.impressions;
    totalClicks += s.clicks;
    totalConversions += s.conversions;
    totalConversionValue += s.conversionValue;
    // Per source: last snapshot wins per platform (overwrites). Preserve that semantic.
    byPlatform[s.platform] = s;
  }

  return {
    totalSpend,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalConversionValue,
    overallCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    overallCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    overallRoas: totalSpend > 0 ? totalConversionValue / totalSpend : 0,
    overallConversionRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
    byPlatform,
  };
}

function filterByAdIds(snapshots, platformAdIds, platform, dateRange) {
  const idSet = new Set(platformAdIds);
  return snapshots.filter((s) => {
    if (!idSet.has(s.entityId)) return false;
    if (platform && s.platform !== platform) return false;
    if (dateRange?.start && dateRange?.end) {
      // Source's cache key includes dateRange.start/end as exact-match strings.
      // Preserve that filter — only return snapshots whose dateRange matches.
      if (s.dateRange.start !== dateRange.start || s.dateRange.end !== dateRange.end) return false;
    }
    return true;
  });
}

export async function adsMetricsImport(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};

  const snapshots = Array.isArray(inputs.snapshots) ? inputs.snapshots : [];
  const platformAdIds = Array.isArray(inputs.platformAdIds) ? inputs.platformAdIds.filter((id) => typeof id === 'string') : [];
  const platform = typeof inputs.platform === 'string' && inputs.platform.length > 0 ? inputs.platform : null;
  const dateRange = inputs.dateRange ?? null;

  if (snapshots.length === 0) {
    return {
      status: 'success',
      outputs: {
        snapshots: [],
        aggregated: aggregate([]),
        matchedCount: 0,
        droppedCount: 0,
        warnings: ['inputs.snapshots is empty — pack returns zero-valued aggregation. Caller must populate snapshots upstream (e.g., from a platform-API fetch node).'],
        success: true,
      },
    };
  }

  if (platformAdIds.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.platformAdIds must contain at least one entityId to filter on', retryable: false },
    };
  }

  const warnings = [];
  const validated = [];
  for (let i = 0; i < snapshots.length; i++) {
    const r = validateSnapshot(snapshots[i], i);
    if (r.error) {
      warnings.push(r.error);
      continue;
    }
    validated.push(r.snapshot);
  }

  const matched = filterByAdIds(validated, platformAdIds, platform, dateRange);
  const droppedCount = validated.length - matched.length;

  log.debug('Aggregating ad metrics', {
    totalSnapshots: snapshots.length,
    validatedSnapshots: validated.length,
    matchedSnapshots: matched.length,
    platformAdIds: platformAdIds.length,
    platform,
  });

  const aggregated = aggregate(matched);

  log.info('Metrics aggregation completed', {
    matchedCount: matched.length,
    droppedCount,
    totalSpend: aggregated.totalSpend,
    overallRoas: aggregated.overallRoas,
  });

  return {
    status: 'success',
    outputs: {
      snapshots: matched,
      aggregated,
      matchedCount: matched.length,
      droppedCount,
      warnings: warnings.length > 0 ? warnings : undefined,
      success: true,
    },
  };
}

const nodes = {
  'ads.metrics.import': adsMetricsImport,
};

export default nodes;
