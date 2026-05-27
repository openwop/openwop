import type { Ctx } from '../context.js';
/** `openwop packs ...` — operate the signed node-pack registry (C-5). */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as ed25519Sign, verify as ed25519Verify } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import { CliError, HttpError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { parseJsonResponse } from '../api.js';
import { requireRepoRoot } from '../repo.js';
import { DEFAULT_REGISTRY_URL } from '../constants.js';
import { normalizeBaseUrl, parseNodeVersion } from './shared.js';

export const PACKS_HELP = `Usage:
  openwop packs search [query] [--registry-url url] [--limit n] [--json]
  openwop packs info <name> [--version v] [--registry-url url] [--json]
  openwop packs install <name>[@version] [--version v] [--dir path] [--no-verify] [--registry-url url] [--json]
  openwop packs publish <dir> [--key ed25519.pem] [--key-id id] [--out dir] [--json]
  openwop packs yank <name>[@version] [--version v] [--undo] [--json]

Operates the signed node-pack registry (default: https://packs.openwop.dev,
override with --registry-url or OPENWOP_REGISTRY_URL). The registry is a
separate surface from the host --base-url.

  search    Reads /v1/index.json and filters the catalog client-side.
  info      Reads /v1/packs/{name}/index.json (+ the version manifest with --version).
  install   Downloads /v1/packs/{name}/-/{version}.tgz, checks sha256 integrity
            against the manifest, and verifies the detached Ed25519 .sig against
            the publisher key at /keys/{keyId}.pub (skip with --no-verify). Places
            the tarball + manifest under ~/.openwop/packs/{name}/{version}/
            (override with --dir).
  publish   The reference registry has NO write API (publish is PR-based). This
            packages + Ed25519-signs a local pack dir into a signed tarball +
            sidecars (mirrors scripts/build-pack-tarball.mjs --signed), ready to
            commit + open a PR. Private key: --key, else ~/.openwop-keys/{keyId}.private.pem.
  yank      Edits a local registry checkout — flips "yanked": true in the version
            manifest (--undo reverses). The published change lands via PR + a
            build-index.mjs rerun. Run from inside the repo.
`;

export async function runPacks(ctx: Ctx, argv: string[]) {
  const sub = argv[0];
  const args = argv.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  switch (sub) {
    case 'search':
      return runPacksSearch(ctx, args);
    case 'info':
      return runPacksInfo(ctx, args);
    case 'install':
      return runPacksInstall(ctx, args);
    case 'publish':
      return runPacksPublish(ctx, args);
    case 'yank':
      return runPacksYank(ctx, args);
    default:
      throw new CliError(`Unknown packs command: ${sub}\nRun \`openwop packs --help\` for usage.`);
  }
}

function registryUrlFor(options: any, env: any) {
  return normalizeBaseUrl(options.registryUrl ?? env.OPENWOP_REGISTRY_URL ?? DEFAULT_REGISTRY_URL);
}

async function registryJson(ctx: Ctx, registryUrl: any, path: any) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  const text = await res.text();
  const body = text.length > 0 ? parseJsonResponse(text) : null;
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body;
}

async function registryBytes(ctx: Ctx, registryUrl: any, path: any) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/octet-stream' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(`HTTP ${res.status}`, res.status, text ? parseJsonResponse(text) : null);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runPacksSearch(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--registry-url', '--limit'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  const query = String(positionals[0] ?? '').toLowerCase();
  const registryUrl = registryUrlFor(options, ctx.env);
  // The canonical file-backed registry serves the full catalog at
  // /v1/index.json; we filter client-side. (The dynamic demo backend's
  // /v1/packs/-/search only knows in-process nodes — not the published
  // catalog — so the index is the authoritative search source.)
  const index = await registryJson(ctx, registryUrl, '/v1/index.json');
  const packs = Array.isArray(index?.packs) ? index.packs : [];
  const matched = packs.filter((p: any) => {
    if (!query) return true;
    const haystack = [p.name, p.description, ...(p.tags ?? []), ...(p.typeIds ?? [])]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const limit = Number(options.limit ?? 30);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { query: positionals[0] ?? '', total: matched.length, packs: matched });
    return 0;
  }
  if (matched.length === 0) {
    writeLine(ctx.io.stdout, query ? `No packs match "${positionals[0]}".` : 'Registry is empty.');
    return 0;
  }
  const rows = matched.slice(0, limit).map((p: any) => ({
    name: p.name,
    version: p.latestVersion ?? '',
    kind: p.kind ?? 'node',
    license: p.license ?? '',
    flags: p.yanked ? 'yanked' : p.deprecated ? 'deprecated' : '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['name', 'version', 'kind', 'license', 'flags']));
  if (matched.length > rows.length) {
    writeLine(ctx.io.stdout, `... ${matched.length - rows.length} more. Use --limit ${matched.length} or --json.`);
  }
  return 0;
}

async function runPacksInfo(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--registry-url', '--version'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  const name = positionals[0];
  if (!name) throw new CliError('packs info requires a pack name.\nUsage: openwop packs info <name> [--version v]');
  const registryUrl = registryUrlFor(options, ctx.env);
  const pack = await registryJson(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/index.json`);

  // When a specific --version is given, also fetch its version manifest so
  // callers see the per-version detail (signing key, integrity).
  let versionManifest = null;
  if (options.version) {
    versionManifest = await registryJson(
      ctx, registryUrl,
      `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(options.version)}.json`,
    );
  }

  if (ctx.json) {
    writeJson(ctx.io.stdout, versionManifest ? { ...pack, requestedVersion: versionManifest } : pack);
    return 0;
  }
  const lines = [
    `Name:        ${pack.name}`,
    `Kind:        ${pack.kind ?? 'node'}`,
    `Latest:      ${pack.latest ?? '(none)'}`,
    `License:     ${pack.license || '—'}`,
    `Author:      ${pack.author || '—'}`,
    `Description: ${pack.description || '—'}`,
  ];
  if (pack.homepage) lines.push(`Homepage:    ${pack.homepage}`);
  lines.push('');
  const versions = Array.isArray(pack.versions) ? pack.versions : [];
  if (versions.length > 0) {
    writeLine(ctx.io.stdout, lines.join('\n'));
    const rows = versions.map((v: any) => ({
      version: v.version,
      keyId: v.signingKeyId ?? '',
      flags: v.yanked ? 'yanked' : v.deprecated ? 'deprecated' : '',
      integrity: typeof v.integrity === 'string' ? v.integrity.slice(0, 24) + '…' : '',
    }));
    writeLine(ctx.io.stdout, formatTable(rows, ['version', 'keyId', 'flags', 'integrity']));
  } else {
    writeLine(ctx.io.stdout, lines.join('\n'));
  }
  return 0;
}

async function runPacksInstall(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--no-verify'],
    value: ['--registry-url', '--version', '--dir'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // Accept either `name@version` or `name --version v`.
  let name = positionals[0];
  let version = options.version;
  if (name && name.includes('@')) {
    const at = name.lastIndexOf('@');
    version = version ?? name.slice(at + 1);
    name = name.slice(0, at);
  }
  if (!name) throw new CliError('packs install requires a pack name.\nUsage: openwop packs install <name>[@version] [--version v]');
  const registryUrl = registryUrlFor(options, ctx.env);

  // Resolve the version: explicit --version, or the pack's `latest`.
  if (!version) {
    const pack = await registryJson(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/index.json`);
    version = pack?.latest;
    if (!version) throw new CliError(`Could not resolve a version for ${name}; pass --version.`);
  }

  // Fetch the version manifest (carries the signing.keyId + integrity).
  const manifest = await registryJson(
    ctx, registryUrl,
    `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.json`,
  );
  if (manifest?.yanked) {
    throw new CliError(`${name}@${version} has been yanked and cannot be installed.`, 1);
  }

  // Download the tarball.
  const tgz = await registryBytes(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`);

  // Integrity (SRI) check against the manifest's `integrity` field.
  const integrity = 'sha256-' + createHash('sha256').update(tgz).digest('base64');
  if (manifest?.integrity && manifest.integrity !== integrity) {
    throw new CliError(
      `Integrity mismatch for ${name}@${version}: manifest declares ${manifest.integrity} but tarball hashes to ${integrity}.`,
      1,
    );
  }

  // Signature verification (unless --no-verify). Mirrors verify-signatures.mjs:
  // method 'ed25519' signs the whole tarball; method 'manual' signs the
  // pack.json bytes inside the tarball. The publisher key is fetched from
  // /keys/{keyId}.pub.
  let verifyResult = 'skipped';
  if (!options.noVerify) {
    const keyId = manifest?.signing?.keyId ?? manifest?.signing?.publicKeyRef;
    if (!keyId) throw new CliError(`${name}@${version} manifest has no signing key reference; re-run with --no-verify to bypass.`, 1);
    const sig = await registryBytes(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.sig`);
    if (sig.length !== 64) throw new CliError(`Signature for ${name}@${version} is ${sig.length} bytes; expected 64 for Ed25519.`, 1);
    const pubPem = (await registryBytes(ctx, registryUrl, `/keys/${encodeURIComponent(keyId)}.pub`)).toString('utf8');
    const publicKey = createPublicKey(pubPem);
    const method = manifest?.signing?.method ?? 'ed25519';
    const signedBytes = method === 'manual' ? extractPackJsonBytes(tgz) : tgz;
    const valid = ed25519Verify(null, signedBytes, publicKey, sig);
    if (!valid) {
      throw new CliError(`Signature verification FAILED for ${name}@${version} (keyId=${keyId}, method=${method}).`, 1);
    }
    verifyResult = `verified (keyId=${keyId}, method=${method})`;
  }

  // Place under a local pack cache: <dir>/<name>/<version>/. Default dir is
  // ~/.openwop/packs (honors OPENWOP_CONFIG_HOME like the rest of the CLI).
  const baseDir = options.dir
    ? resolvePath(ctx.cwd, options.dir)
    : join(configHomeDir(ctx.env), 'packs');
  const destDir = join(baseDir, name, version);
  mkdirSync(destDir, { recursive: true });
  const tgzPath = join(destDir, `${version}.tgz`);
  const manifestPath = join(destDir, `${version}.json`);
  writeFileSync(tgzPath, tgz);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (ctx.json) {
    writeJson(ctx.io.stdout, {
      name, version, integrity, signature: verifyResult,
      tarball: tgzPath, manifest: manifestPath,
    });
    return 0;
  }
  writeLine(ctx.io.stdout, `Installed ${name}@${version}`);
  writeLine(ctx.io.stdout, `  signature: ${verifyResult}`);
  writeLine(ctx.io.stdout, `  integrity: ${integrity}`);
  writeLine(ctx.io.stdout, `  tarball:   ${tgzPath}`);
  return 0;
}

async function runPacksPublish(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--key', '--key-id', '--out'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // The reference registry has NO write API (.well-known declares
  // writeApi.supported=false, publishMethod=github-pull-request). So
  // `publish` performs the LOCAL packaging + signing flow — producing the
  // signed tarball + sidecar artifacts that the publisher then commits and
  // opens a PR with (per registry/README.md §Publishing). This mirrors
  // scripts/build-pack-tarball.mjs's --signed path.
  const packDir = positionals[0];
  if (!packDir) throw new CliError('packs publish requires a pack directory.\nUsage: openwop packs publish <dir> --key <ed25519.pem> --key-id <id>');
  const absPackDir = resolvePath(ctx.cwd, packDir);
  const manifestPath = join(absPackDir, 'pack.json');
  if (!existsSync(manifestPath)) {
    throw new CliError(`No pack.json found in ${absPackDir}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const name = manifest.name;
  const version = manifest.version;
  if (!name || !version) throw new CliError('pack.json must declare both "name" and "version".');

  const keyId = options.keyId ?? 'openwop-team-1';
  // Augment the manifest with the signing block (method 'manual'), then sign
  // the CANONICAL (key-sorted) JSON — exactly what the registry verifier
  // re-derives from the in-tarball pack.json.
  const signedManifest = {
    ...manifest,
    signing: { method: 'manual', publicKeyRef: keyId, signatureRef: 'keys/pack.json.sig' },
  };
  const canonical = canonicalJsonStringify(signedManifest);

  // Load (or, for dev, generate) the Ed25519 private key.
  let privateKey;
  let ephemeralPublicB64: string | null = null;
  if (options.key) {
    privateKey = createPrivateKey({ key: readFileSync(resolvePath(ctx.cwd, options.key), 'utf8'), format: 'pem' });
  } else {
    // Convention: ~/.openwop-keys/<keyId>.private.pem (per project layout).
    const conventional = join(homedir(), '.openwop-keys', `${keyId}.private.pem`);
    if (existsSync(conventional)) {
      privateKey = createPrivateKey({ key: readFileSync(conventional, 'utf8'), format: 'pem' });
    } else {
      const kp = generateKeyPairSync('ed25519');
      privateKey = kp.privateKey;
      ephemeralPublicB64 = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    }
  }
  const sig = ed25519Sign(null, Buffer.from(canonical, 'utf8'), privateKey);

  // Build the deterministic tarball: replace pack.json with the canonical
  // bytes + embed keys/pack.json.sig.
  const entries = walkPackDir(absPackDir)
    .filter((e) => e.name !== 'keys/pack.json.sig')
    .map((e) => (e.name === 'pack.json' ? { name: 'pack.json', content: Buffer.from(canonical, 'utf8') } : e));
  entries.push({ name: 'keys/pack.json.sig', content: sig });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tgz = buildUstarGzip(entries);
  const sha = createHash('sha256').update(tgz).digest('hex');

  const outDir = options.out ? resolvePath(ctx.cwd, options.out) : join(ctx.cwd, 'dist', 'packs');
  mkdirSync(outDir, { recursive: true });
  const base = `${name}-${version}`;
  const tgzPath = join(outDir, `${base}.tgz`);
  const sigPath = join(outDir, `${base}.sig`);
  const manifestOut = join(outDir, `${base}.manifest.json`);
  writeFileSync(tgzPath, tgz);
  writeFileSync(sigPath, sig);
  writeFileSync(manifestOut, JSON.stringify(signedManifest, null, 2) + '\n', 'utf8');

  if (ctx.json) {
    writeJson(ctx.io.stdout, {
      name, version, keyId, integrity: `sha256:${sha}`,
      tarball: tgzPath, signature: sigPath, manifest: manifestOut,
      writeApi: false, publishMethod: 'github-pull-request',
      ephemeralPublicKey: ephemeralPublicB64 ?? undefined,
    });
    return 0;
  }
  writeLine(ctx.io.stdout, `Packaged + signed ${name}@${version} (keyId=${keyId})`);
  writeLine(ctx.io.stdout, `  tarball:   ${tgzPath}`);
  writeLine(ctx.io.stdout, `  signature: ${sigPath}`);
  writeLine(ctx.io.stdout, `  manifest:  ${manifestOut}`);
  writeLine(ctx.io.stdout, `  integrity: sha256:${sha}`);
  if (ephemeralPublicB64) {
    writeLine(ctx.io.stdout, `  WARNING: no --key and no ~/.openwop-keys/${keyId}.private.pem — used an EPHEMERAL key.`);
    writeLine(ctx.io.stdout, `  Pre-register this public key (SPKI DER base64) with the registry before publishing:`);
    writeLine(ctx.io.stdout, `    ${ephemeralPublicB64}`);
  }
  writeLine(ctx.io.stdout, '');
  writeLine(ctx.io.stdout, 'The reference registry has no write API. To publish:');
  writeLine(ctx.io.stdout, `  1. Copy the artifacts into registry/v1/packs/${name}/-/`);
  writeLine(ctx.io.stdout, '  2. Run `node registry/scripts/build-index.mjs` to refresh the index.');
  writeLine(ctx.io.stdout, '  3. Open a pull request (publishMethod: github-pull-request).');
  return 0;
}

async function runPacksYank(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--undo'],
    value: ['--version'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // Yank is a registry-state change. The reference registry exposes no write
  // API (writeApi.supported=false), and lifecycle.yankSupported=true means it
  // is performed via PR: flip `"yanked": true` in the version manifest, then
  // rebuild the index. This subcommand applies that edit LOCALLY to a checked-
  // out registry tree so the change is ready to commit + PR.
  let name = positionals[0];
  let version = options.version;
  if (name && name.includes('@')) {
    const at = name.lastIndexOf('@');
    version = version ?? name.slice(at + 1);
    name = name.slice(0, at);
  }
  if (!name || !version) {
    throw new CliError('packs yank requires <name>@<version> (or <name> --version v).');
  }
  const root = requireRepoRoot(ctx);
  const manifestPath = join(root, 'registry', 'v1', 'packs', name, '-', `${version}.json`);
  if (!existsSync(manifestPath)) {
    throw new CliError(`Version manifest not found: ${manifestPath}\n(packs yank edits a local registry checkout; the published change lands via PR.)`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const newValue = !options.undo;
  if (Boolean(manifest.yanked) === newValue) {
    writeLine(ctx.io.stdout, `${name}@${version} is already ${newValue ? 'yanked' : 'un-yanked'}; no change.`);
    return 0;
  }
  manifest.yanked = newValue;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (ctx.json) {
    writeJson(ctx.io.stdout, { name, version, yanked: newValue, manifest: manifestPath, publishMethod: 'github-pull-request' });
    return 0;
  }
  writeLine(ctx.io.stdout, `${newValue ? 'Yanked' : 'Un-yanked'} ${name}@${version}`);
  writeLine(ctx.io.stdout, `  edited: ${manifestPath}`);
  writeLine(ctx.io.stdout, '  Next: run `node registry/scripts/build-index.mjs`, commit, and open a PR.');
  return 0;
}

function canonicalJsonStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k: string) => JSON.stringify(k) + ':' + canonicalJsonStringify(value[k])).join(',') + '}';
}

function configHomeDir(env = process.env) {
  const base = env.OPENWOP_CONFIG_HOME ? env.OPENWOP_CONFIG_HOME : homedir();
  return join(base, '.openwop');
}

function extractPackJsonBytes(tarballBytes: any) {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (!name) break;
    const sizeStr = decompressed.subarray(off + 124, off + 136).toString('ascii').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new CliError('Tarball uses USTAR extended headers (entry names > 100 bytes); cannot verify pack.json signature.', 1);
    }
    if (name === 'pack.json' || name === './pack.json') {
      return decompressed.subarray(off + BLOCK, off + BLOCK + size);
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new CliError('pack.json not found in tarball.', 1);
}

function walkPackDir(packDir: any) {
  const ALLOWED_TOPS = new Set(['pack.json', 'README.md', 'LICENSE', 'index.mjs']);
  const ALLOWED_DIRS = new Set(['schemas', 'keys']);
  const entries: any[] = [];
  for (const entry of readdirSync(packDir).sort()) {
    const full = join(packDir, entry);
    const st = statSync(full);
    if (st.isFile()) {
      if (!ALLOWED_TOPS.has(entry)) continue;
      entries.push({ name: entry, content: readFileSync(full) });
    } else if (st.isDirectory() && ALLOWED_DIRS.has(entry)) {
      for (const f of readdirSync(full).sort()) {
        if (!f.endsWith('.json') && !f.endsWith('.pem') && !f.endsWith('.sig')) continue;
        entries.push({ name: `${entry}/${f}`, content: readFileSync(join(full, f)) });
      }
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

function buildUstarGzip(entries: any) {
  const ustarHeader = (name: any, size: any) => {
    const buf = Buffer.alloc(512, 0);
    const writeOctal = (n: any, len: any, offset: any) => {
      const s = n.toString(8).padStart(len - 1, '0') + '\0';
      buf.write(s, offset, len, 'ascii');
    };
    if (name.length > 100) throw new CliError(`Pack entry path too long for USTAR (>100 bytes): ${name}`, 1);
    buf.write(name, 0, 100, 'ascii');
    writeOctal(0o644, 8, 100);
    writeOctal(0, 8, 108);
    writeOctal(0, 8, 116);
    writeOctal(size, 12, 124);
    writeOctal(0, 12, 136);
    for (let i = 148; i < 156; i++) buf[i] = 0x20;
    buf[156] = 0x30;
    buf.write('ustar\0', 257, 6, 'ascii');
    buf.write('00', 263, 2, 'ascii');
    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += buf[i];
    writeOctal(chksum, 8, 148);
    return buf;
  };
  const chunks: Uint8Array[] = [];
  for (const { name, content } of entries) {
    chunks.push(ustarHeader(name, content.length));
    chunks.push(content);
    const pad = 512 - (content.length % 512);
    if (pad !== 512) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
  gz[4] = 0; gz[5] = 0; gz[6] = 0; gz[7] = 0;
  gz[9] = 0xff;
  return gz;
}
