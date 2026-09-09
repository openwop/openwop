/**
 * RFC 0149 §A — canonical URL resolution.
 *
 * A generator resolves an operation's URL by joining a `servers[].url` with a
 * path key. Both halves are individually valid here, and every existing
 * validator checks them separately: `redocly lint` accepts the server, accepts
 * the paths, and never composes the two. The defect only exists in the join.
 *
 * That is why this gate resolves the PAIR. `servers[].url` ending in `/v1`
 * against path keys beginning with `/v1/` yields `/v1/v1/runs` — a route no
 * host serves, emitted by every client generated from the canonical contract.
 * The reference SDKs are the control: `OpenwopClient` issues `/v1/runs`
 * against a bare base URL, so the SDKs and the OpenAPI document disagree about
 * where the version segment lives, and the SDKs are the ones that work.
 *
 * Server-free and always-on: this is a property of the corpus, not of a host,
 * so there is no capability to gate on and nothing to skip.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const OPENAPI_PATH = join(API_DIR, 'openapi.yaml');

/**
 * Top-level `servers[].url` values.
 *
 * Text-scanned rather than YAML-parsed to match the rest of the corpus gates
 * (`spec-corpus-validity.test.ts` uses `readYamlHeader`), which keeps the
 * conformance package free of a YAML dependency.
 */
function serverUrls(raw: string): string[] {
  const urls: string[] = [];
  let inServers = false;
  for (const line of raw.split('\n')) {
    if (/^servers:/.test(line)) {
      inServers = true;
      continue;
    }
    // Any other unindented, non-comment, non-blank line ends the block.
    if (inServers && /^[^\s#]/.test(line)) break;
    if (!inServers) continue;
    const m = /^\s*-\s*url:\s*(\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined) urls.push(m[1]);
  }
  return urls;
}

/** Top-level path keys under `paths:` (two-space indented, starting with `/`). */
function pathKeys(raw: string): string[] {
  const keys: string[] = [];
  let inPaths = false;
  for (const line of raw.split('\n')) {
    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[^\s#]/.test(line)) break;
    if (!inPaths) continue;
    const m = /^ {2}(\/\S*):\s*$/.exec(line);
    if (m?.[1] !== undefined) keys.push(m[1]);
  }
  return keys;
}

/**
 * The path portion of a resolved URL, with the `{host}` template left intact —
 * `URL` cannot parse a templated authority, and substituting a placeholder
 * host would test a string this corpus never emits.
 */
function resolvedPath(serverUrl: string, pathKey: string): string {
  const afterScheme = serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  const basePath = slash === -1 ? '' : afterScheme.slice(slash);
  return `${basePath.replace(/\/$/, '')}${pathKey}`;
}

describe('RFC 0149 §A — every server/path pair resolves to exactly one /v1 segment', () => {
  const raw = readFileSync(OPENAPI_PATH, 'utf8');
  const servers = serverUrls(raw);
  const paths = pathKeys(raw);

  it('the document declares at least one server and one path', () => {
    // Guards the gate itself: an extraction that silently found nothing would
    // make every assertion below vacuously true — the exact failure mode
    // RFC 0148 exists to prevent.
    expect(servers.length, req('openwop.it.openapi-resolved-paths.the-document-declares-at-least-one-server-and-one-path', 'RFC 0149 §A', `${OPENAPI_PATH} MUST declare servers[]`)).toBeGreaterThan(0);
    expect(paths.length, req('openwop.it.openapi-resolved-paths.the-document-declares-at-least-one-server-and-one-path', 'RFC 0149 §A', `${OPENAPI_PATH} MUST declare paths`)).toBeGreaterThan(0);
  });

  it('no versioned operation resolves to a duplicated /v1 prefix', () => {
    const offenders: string[] = [];
    for (const server of servers) {
      for (const pathKey of paths) {
        if (!pathKey.startsWith('/v1/') && pathKey !== '/v1') continue;
        const resolved = resolvedPath(server, pathKey);
        const segments = resolved.split('/').filter((s) => s === 'v1');
        if (segments.length !== 1) offenders.push(`${server} + ${pathKey} -> ${resolved}`);
      }
    }
    expect(
      offenders,
      req('openwop.it.openapi-resolved-paths.no-versioned-operation-resolves-to-a-duplicated-v1-prefix', 'RFC 0149 §A', 'RFC 0149 §A: a versioned operation MUST resolve with exactly one `/v1` segment. ' +
        'Offending server/path pairs:\n  ' +
        offenders.join('\n  ') +
        '\nFix: drop `/v1` from `servers[].url` and keep it in the path keys.'),
    ).toEqual([]);
  });

  it('the unversioned discovery route stays unversioned when resolved', () => {
    // `/.well-known/openwop` is unversioned by RFC 0149 §A. A server base path
    // would silently version it, which is the same class of defect pointing
    // the other way.
    const wellKnown = paths.filter((p) => p.startsWith('/.well-known/'));
    for (const server of servers) {
      for (const pathKey of wellKnown) {
        const resolved = resolvedPath(server, pathKey);
        expect(
          resolved,
          req('openwop.it.openapi-resolved-paths.the-unversioned-discovery-route-stays-unversioned-when-resolved', 'RFC 0149 §A', `RFC 0149 §A: ${pathKey} MUST remain unversioned; resolved as ${resolved}`),
        ).toBe(pathKey);
      }
    }
  });
});
