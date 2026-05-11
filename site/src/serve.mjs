#!/usr/bin/env node
/**
 * Tiny static-file server for local site preview. Zero-dependency.
 * Serves dist/ on http://localhost:8989.
 */

import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

if (!existsSync(DIST)) {
  console.error(`dist/ does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

const PORT = process.env.PORT ?? 8989;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = resolve(DIST, '.' + urlPath);
  if (!filePath.startsWith(DIST)) {
    // Path traversal guard
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let resolved = filePath;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    resolved = join(filePath, 'index.html');
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 — ${urlPath}\n`);
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const body = readFileSync(resolved);
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}).listen(PORT, () => {
  console.log(`[openwop-site] serving dist/ on http://localhost:${PORT}`);
});
