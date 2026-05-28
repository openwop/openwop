/**
 * vendor.myndhyve.ads-export — ads.export.pack executor.
 *
 * Lifted from MyndHyve's src/canvas-types/campaign-studio/ads-studio/
 * export/AdExportPackService.ts (296 LOC). The in-memory pack-store
 * (this.packs Map + getPack/listPacks methods) is dropped — pack
 * consumers store the returned pack record themselves (or pipe it to
 * a downstream `core.openwop.http.fetch` for upload). The remaining
 * functions are pure: createPack + exportAsJSON + exportAsCSV +
 * generateManifest.
 *
 * Pure logic — no host capabilities required.
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

const DEFAULT_CONFIG = {
  maxItemsPerPack: 50,
  maxTotalAssetSize: 500 * 1024 * 1024,
  manifestVersion: '1.0.0',
};

function csvEscape(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function createPack(input, config) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Export pack must contain at least 1 item.');
  }
  if (input.items.length > config.maxItemsPerPack) {
    throw new Error(`Export pack cannot exceed ${config.maxItemsPerPack} items.`);
  }

  const totalAssetSize = input.items.reduce(
    (sum, item) => sum + (Array.isArray(item.assets) ? item.assets.reduce((s, a) => s + (a.fileSize ?? 0), 0) : 0),
    0,
  );
  if (totalAssetSize > config.maxTotalAssetSize) {
    throw new Error(
      `Total asset size (${Math.round(totalAssetSize / (1024 * 1024))} MiB) exceeds maximum (${Math.round(config.maxTotalAssetSize / (1024 * 1024))} MiB).`,
    );
  }

  const now = new Date().toISOString();
  const items = input.items.map((item) => ({
    adId: item.adId,
    adName: item.adName,
    copyVariants: [...(item.copyVariants ?? [])],
    assets: [...(item.assets ?? [])],
    trackingLinks: [...(item.trackingLinks ?? [])],
    placements: [...(item.placements ?? [])],
  }));
  const combinationCount = items.reduce(
    (count, item) => count + item.placements.length,
    0,
  );

  return {
    id: crypto.randomUUID(),
    name: input.name,
    campaignId: input.campaignId,
    items,
    format: input.format,
    exportedAt: now,
    exportedBy: input.exportedBy,
    totalAssetSize,
    combinationCount,
  };
}

function exportAsJSON(pack) {
  return JSON.stringify(pack, null, 2);
}

function exportAsCSV(pack) {
  const headers = [
    'ad_id', 'ad_name', 'placement', 'headline', 'description', 'body_text',
    'cta_text', 'asset_url', 'asset_type', 'tracking_url', 'platform',
  ];
  const rows = [];
  for (const item of pack.items) {
    for (const variant of item.copyVariants) {
      for (const placement of item.placements) {
        const adaptation = Array.isArray(variant.platformAdaptations)
          ? variant.platformAdaptations.find((a) => a.placement === placement)
          : null;
        const asset = item.assets[0];
        const trackingLink = item.trackingLinks.find(
          (tl) => tl.platform === placement.split('-')[0],
        );
        rows.push([
          item.adId,
          item.adName,
          placement,
          csvEscape(adaptation?.headline ?? variant.headline),
          csvEscape(adaptation?.description ?? variant.description ?? ''),
          csvEscape(adaptation?.bodyText ?? variant.bodyText ?? ''),
          csvEscape(adaptation?.ctaText ?? variant.ctaText ?? ''),
          asset?.url ?? '',
          asset?.type ?? '',
          trackingLink?.fullUrl ?? '',
          placement.split('-')[0],
        ]);
      }
    }
  }
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

function generateManifest(pack, campaignName, manifestVersion) {
  const manifestItems = pack.items.map((item) => ({
    adId: item.adId,
    adName: item.adName,
    placements: [...item.placements],
    files: item.assets.map((asset) => ({
      filename: `${item.adId}/${asset.name ?? 'asset'}`,
      type: asset.type === 'carousel' ? 'image' : asset.type,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
    })),
    copy: item.copyVariants.map((v) => ({
      headline: v.headline,
      description: v.description,
      bodyText: v.bodyText,
      ctaText: v.ctaText,
    })),
    trackingLinks: item.trackingLinks.map((tl) => ({
      platform: tl.platform,
      url: tl.fullUrl,
    })),
  }));
  return {
    version: manifestVersion,
    exportedAt: pack.exportedAt,
    campaign: { id: pack.campaignId, name: campaignName },
    items: manifestItems,
  };
}

export async function exportPack(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = { ...DEFAULT_CONFIG, ...(ctx.config ?? {}) };

  if (!inputs.name || !inputs.campaignId || !inputs.format || !inputs.exportedBy || !Array.isArray(inputs.items)) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'name + campaignId + format + exportedBy + items[] required', retryable: false },
    };
  }

  let pack;
  try {
    pack = createPack(inputs, config);
  } catch (err) {
    return {
      status: 'error',
      error: { code: 'EXPORT_PACK_CREATE_FAILED', message: err instanceof Error ? err.message : String(err), retryable: false },
    };
  }

  log.info('Export pack created', {
    packId: pack.id,
    items: pack.items.length,
    format: pack.format,
    totalAssetSize: pack.totalAssetSize,
  });

  const outputs = { pack, success: true };
  if (config.emitJson) outputs.json = exportAsJSON(pack);
  if (config.emitCsv) outputs.csv = exportAsCSV(pack);
  if (typeof inputs.campaignName === 'string') {
    outputs.manifest = generateManifest(pack, inputs.campaignName, config.manifestVersion);
  }

  return { status: 'success', outputs };
}

const nodes = {
  'ads.export.pack': exportPack,
};

export default nodes;
