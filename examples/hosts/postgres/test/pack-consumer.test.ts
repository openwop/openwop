/**
 * PACK-1 / PACK-2 host-internal smoke (from
 * plans/openwop-protocol-gap-closure-plan.md).
 *
 * Exercises every code path in `src/pack-consumer.ts` against a known-
 * good pack from the in-tree registry mirror — `core.openwop.examples
 * @1.0.0` (signed over the whole tarball with `openwop-registry-root`).
 *
 *   1. Positive — lockfile + tarball + signature all verify; returns
 *      `signatureVerified: true`.
 *   2. Lockfile JSON parse error.
 *   3. Lockfile shape error (missing required field).
 *   4. SRI mismatch (tampered tarball — flip one byte).
 *   5. Ed25519 signature mismatch (corrupted signature bytes).
 *   6. Version drift (registry manifest version != lockfile pin).
 *   7. Missing/invalid public key.
 *   8. Lockfile signature absent — verified=false but does NOT throw
 *      (the consumer only refuses when present-and-invalid).
 *
 * Pure-function test — no host server boots. The consumer is a pure
 * function the host invokes at startup or run-setup; surfacing the
 * algorithm independently of the server makes mechanical proof
 * straightforward.
 *
 * @see examples/hosts/postgres/src/pack-consumer.ts
 * @see plans/openwop-protocol-gap-closure-plan.md §"Workstream 5 PACK-1/PACK-2"
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  consumePack,
  loadLockfile,
  parseLockfile,
  sriOf,
  PackConsumerError,
  type ResolvedPack,
} from '../src/pack-consumer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PACK_DIR = join(REPO_ROOT, 'registry', 'v1', 'packs', 'core.openwop.examples', '-');
const KEYS_DIR = join(REPO_ROOT, 'registry', 'keys');

function loadCanonicalResolved(): { resolved: ResolvedPack; tarball: Buffer; manifest: { name: string; version: string } } {
  const tarball = readFileSync(join(PACK_DIR, '1.0.0.tgz'));
  const sigBytes = readFileSync(join(PACK_DIR, '1.0.0.sig'));
  const publicKeyPem = readFileSync(join(KEYS_DIR, 'openwop-registry-root.pub'), 'utf8');
  const integrity = sriOf(tarball);
  const resolved: ResolvedPack = {
    name: 'core.openwop.examples',
    version: '1.0.0',
    integrity,
    signature: {
      algorithm: 'ed25519',
      publicKey: publicKeyPem,
      value: sigBytes.toString('base64'),
    },
  };
  const manifestRaw = JSON.parse(readFileSync(join(PACK_DIR, '1.0.0.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return {
    resolved,
    tarball,
    manifest: { name: manifestRaw.name, version: manifestRaw.version },
  };
}

function expectError(fn: () => unknown, code: string, hint: string): void {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof PackConsumerError, `${hint}: expected PackConsumerError, got ${err}`);
    assert.equal(err.code, code, `${hint}: expected code='${code}', got '${err.code}'`);
    return;
  }
  assert.fail(`${hint}: expected throw with code='${code}', got no error`);
}

function main(): void {
  // 1. Positive path.
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const result = consumePack({ resolved, tarball, manifest });
    assert.equal(result.name, 'core.openwop.examples');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.signatureVerified, true);
    assert.ok(result.byteSize > 0);
  }

  // 2. Lockfile JSON parse error.
  expectError(
    () => parseLockfile('not json'),
    'pack_lockfile_invalid',
    'malformed JSON',
  );

  // 3. Lockfile shape error (missing required field).
  expectError(
    () => parseLockfile(JSON.stringify({ lockfileVersion: 1, generatedAt: '2026-05-15T00:00:00Z' })),
    'pack_lockfile_invalid',
    'missing packs[]',
  );
  expectError(
    () =>
      parseLockfile(
        JSON.stringify({
          lockfileVersion: 1,
          generatedAt: '2026-05-15T00:00:00Z',
          packs: [{ name: 'core.bad', version: '1.0.0', integrity: 'sha256-not-real' }],
        }),
      ),
    'pack_lockfile_invalid',
    'malformed integrity',
  );

  // 4. SRI mismatch — flip one byte of the tarball.
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const tampered = Buffer.from(tarball);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    expectError(
      () => consumePack({ resolved, tarball: tampered, manifest }),
      'pack_integrity_mismatch',
      'tampered tarball',
    );
  }

  // 5. Ed25519 signature mismatch — corrupt the signature bytes (NOT the
  //    tarball — that would fail at SRI check before reaching the sig).
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const sigBuf = Buffer.from(resolved.signature!.value, 'base64');
    sigBuf[0] ^= 0xff;
    const corrupted: ResolvedPack = {
      ...resolved,
      signature: { ...resolved.signature!, value: sigBuf.toString('base64') },
    };
    expectError(
      () => consumePack({ resolved: corrupted, tarball, manifest }),
      'pack_signature_invalid',
      'corrupted signature',
    );
  }

  // 6. Version drift — registry manifest version != lockfile pin.
  {
    const { resolved, tarball } = loadCanonicalResolved();
    expectError(
      () =>
        consumePack({
          resolved,
          tarball,
          manifest: { name: 'core.openwop.examples', version: '1.0.1' },
        }),
      'pack_version_mismatch',
      'manifest version drift',
    );
    expectError(
      () =>
        consumePack({
          resolved,
          tarball,
          manifest: { name: 'core.openwop.imposter', version: '1.0.0' },
        }),
      'pack_manifest_invalid',
      'manifest name drift',
    );
  }

  // 7. Invalid public key.
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const badKey: ResolvedPack = {
      ...resolved,
      signature: { ...resolved.signature!, publicKey: 'not-a-pem-key' },
    };
    expectError(
      () => consumePack({ resolved: badKey, tarball, manifest }),
      'pack_signature_unverifiable',
      'non-PEM public key',
    );
  }
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const truncatedSig: ResolvedPack = {
      ...resolved,
      signature: { ...resolved.signature!, value: Buffer.from('short').toString('base64') },
    };
    expectError(
      () => consumePack({ resolved: truncatedSig, tarball, manifest }),
      'pack_signature_unverifiable',
      'truncated signature',
    );
  }

  // 8. Lockfile signature absent — verified=false, but does NOT throw.
  {
    const { resolved, tarball, manifest } = loadCanonicalResolved();
    const noSig: ResolvedPack = {
      name: resolved.name,
      version: resolved.version,
      integrity: resolved.integrity,
    };
    const result = consumePack({ resolved: noSig, tarball, manifest });
    assert.equal(result.signatureVerified, false);
    assert.equal(result.name, 'core.openwop.examples');
  }

  // 9. loadLockfile roundtrip — write a minimal canonical lockfile to
  //    /tmp and parse it back. Sanity-check the disk path.
  {
    const minimal = JSON.stringify({
      lockfileVersion: 1,
      generatedAt: '2026-05-15T00:00:00Z',
      packs: [
        {
          name: 'core.openwop.examples',
          version: '1.0.0',
          integrity: 'sha256-51hpp3dgCvSR72r2bB1JTIyRwKsZ54rQTBouOOhPKso=',
        },
      ],
    });
    const tmpPath = join(__dirname, '..', 'test-tmp-lockfile.json');
    writeFileSync(tmpPath, minimal);
    try {
      const parsed = loadLockfile(tmpPath);
      assert.equal(parsed.lockfileVersion, 1);
      assert.equal(parsed.packs.length, 1);
      assert.equal(parsed.packs[0]!.name, 'core.openwop.examples');
    } finally {
      unlinkSync(tmpPath);
    }
  }

  // eslint-disable-next-line no-console
  console.log('ok pack-consumer — 9 paths verified (positive + 7 fail-closed + sig-absent permitted + loadLockfile roundtrip)');
}

main();
