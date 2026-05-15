/**
 * Read-only pack catalog. Public — no auth required per
 * spec/v1/node-packs.md §"Registry HTTP API".
 *
 * Routes:
 *   GET /v1/packs                            — list installed packs
 *   GET /v1/packs/-/search?q=                — search (sample returns empty results)
 *   GET /v1/packs/{name}                     — pack metadata
 *   GET /v1/packs/{name}/-/{version}.json    — version manifest (or 404 / 400)
 *   GET /v1/packs/{name}/-/{version}.sig     — version signature (or 404)
 *
 * Sample only serves what's been registered in the in-process
 * NodeRegistry. No publish/yank/SBOM surface — that's the scope of
 * `examples/node-pack-publishing/` and the postgres reference host.
 */

import type { Express } from 'express';
import type { Storage } from '../storage/storage.js';
import { getNodeRegistry } from '../executor/nodeRegistry.js';
import { OpenwopError } from '../types.js';

interface Deps {
  storage: Storage;
}

/** Reverse-DNS pack-name pattern from spec/v1/node-packs.md §Naming. */
const PACK_NAME_RE = /^(core|vendor|community|private|local|sample)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;
/** SemVer 2.0.0 — major.minor.patch with optional pre-release / build metadata. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

export function registerPackRoutes(app: Express, _deps: Deps): void {
  // ── search (more-specific routes registered first so they win over
  //     the wildcard `:name` route below) ──
  app.get('/v1/packs/-/search', (req, res) => {
    const q = String(req.query.q ?? '');
    const registry = getNodeRegistry();
    const matches = registry.listTypeIds().filter((id) => !q || id.includes(q));
    res.json({
      results: matches.map((typeId) => ({ typeId, version: 'in-process' })),
      total: matches.length,
      q,
    });
  });

  // ── version-scoped routes (.json + .sig). MUST be registered BEFORE
  //     the bare `/v1/packs/:name` route so Express doesn't bind
  //     `:name = "<pkname>"` and miss the `.json` suffix. ──
  app.get(/^\/v1\/packs\/([^/]+)\/-\/([^/]+)\.json$/, (req, _res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const name = decodeURIComponent(params['0'] ?? '');
      const version = params['1'] ?? '';
      if (!PACK_NAME_RE.test(name)) {
        throw new OpenwopError(
          'invalid_pack_name',
          `Pack name "${name}" does not match the reverse-DNS pattern (scope.org.subname).`,
          400,
          { name },
        );
      }
      if (!SEMVER_RE.test(version)) {
        throw new OpenwopError(
          'invalid_version',
          `Version "${version}" is not a valid semver 2.0.0 string.`,
          400,
          { version },
        );
      }
      // Sample doesn't ship a real catalog — every (name, version) lookup misses.
      throw new OpenwopError(
        'pack_not_found',
        `Pack ${name}@${version} not found in this registry.`,
        404,
        { name, version },
      );
    } catch (err) {
      next(err);
    }
  });

  app.get(/^\/v1\/packs\/([^/]+)\/-\/([^/]+)\.sig$/, (req, _res, next) => {
    try {
      const params = req.params as Record<string, string>;
      const name = decodeURIComponent(params['0'] ?? '');
      const version = params['1'] ?? '';
      if (!PACK_NAME_RE.test(name)) {
        throw new OpenwopError('invalid_pack_name', `Pack name "${name}" malformed.`, 400, { name });
      }
      if (!SEMVER_RE.test(version)) {
        throw new OpenwopError('invalid_version', `Version "${version}" not semver.`, 400, { version });
      }
      // Per spec: nonexistent / yanked / unsigned / storage-unwired all
      // collapse to the same canonical 404.
      throw new OpenwopError(
        'signature_not_available',
        `Signature for ${name}@${version} not available.`,
        404,
        { name, version },
      );
    } catch (err) {
      next(err);
    }
  });

  // ── catalog list (root) ──
  app.get('/v1/packs', (_req, res) => {
    const registry = getNodeRegistry();
    const typeIds = registry.listTypeIds();
    const packs = new Map<string, { name: string; nodes: string[] }>();
    for (const typeId of typeIds) {
      const segments = typeId.split('.');
      const packName = segments.slice(0, -1).join('.') || typeId;
      const existing = packs.get(packName) ?? { name: packName, nodes: [] };
      existing.nodes.push(typeId);
      packs.set(packName, existing);
    }
    res.json({
      packs: Array.from(packs.values()),
      total: packs.size,
    });
  });

  // ── pack-name lookup. Registered LAST so the more-specific routes above
  //     get first crack at matching. ──
  app.get('/v1/packs/:name', (req, res, next) => {
    try {
      const name = req.params.name;
      // The `-` token is reserved for sub-routes (e.g., /v1/packs/-/search)
      // — we shouldn't get here for that, but reject defensively.
      if (name === '-') {
        throw new OpenwopError('invalid_pack_name', 'Reserved name token.', 400, { name });
      }
      if (!PACK_NAME_RE.test(name)) {
        throw new OpenwopError(
          'invalid_pack_name',
          `Pack name "${name}" does not match the reverse-DNS pattern.`,
          400,
          { name },
        );
      }
      const registry = getNodeRegistry();
      const matches = registry.listTypeIds().filter((id) => id.startsWith(name + '.') || id === name);
      if (matches.length === 0) {
        throw new OpenwopError(
          'pack_not_found',
          `Pack "${name}" not found in this registry.`,
          404,
          { name },
        );
      }
      res.json({ name, nodes: matches });
    } catch (err) {
      next(err);
    }
  });
}
