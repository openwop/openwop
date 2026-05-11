#!/usr/bin/env node
/**
 * Local-development static server for the openwop registry.
 *
 * Mirrors the Firebase Hosting rewrite rules from `firebase.json` so
 * `npm run registry:dev` (or `node registry/scripts/serve.mjs`) returns
 * the same content shape as a production deploy. Single dependency:
 * Node 20 stdlib only.
 *
 * Listens on http://127.0.0.1:4319 by default.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // registry/
const PORT = Number(process.env.OPENWOP_REGISTRY_PORT ?? 4319);

const REWRITES = [
  { match: /^\/v1\/packs\/([^/]+)$/, to: (m) => `/v1/packs/${m[1]}/index.json` },
  { match: /^\/\.well-known\/openwop-registry$/, to: () => `/.well-known/openwop-registry.json` },
];

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.tgz': 'application/octet-stream',
  '.sig': 'application/octet-stream',
  '.pub': 'application/x-pem-file',
};

function applyRewrites(urlPath) {
  for (const r of REWRITES) {
    const m = r.match.exec(urlPath);
    if (m) return r.to(m);
  }
  return urlPath;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const rewritten = applyRewrites(url.pathname);
  const normalized = normalize(rewritten);
  if (normalized.includes('..')) {
    res.writeHead(400).end('path traversal');
    return;
  }
  const filePath = join(ROOT, normalized);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', message: `No file at ${url.pathname}` }));
    return;
  }
  const ct = TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': ct,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(readFileSync(filePath));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[registry-dev] serving ${ROOT} at http://127.0.0.1:${PORT}`);
});
