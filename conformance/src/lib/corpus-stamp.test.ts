/**
 * Suite self-tests for the corpus-stamp digest check (suite 1.154.0). They
 * prove the VERIFIER against a synthetic package root, not a host, so they
 * live in `src/lib/` and are excluded from the published tarball.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digestVendoredFiles, listVendoredFiles, verifyCorpusStamp, describeVerdict, STAMP_RELATIVE_PATH, type StampVerdict } from './corpus-stamp.js';

function fakePackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'owp-stamp-'));
  mkdirSync(join(root, 'api'));
  mkdirSync(join(root, 'schemas', 'envelopes'), { recursive: true });
  writeFileSync(join(root, 'api', 'openapi.yaml'), 'openapi: 3.1.0\n');
  writeFileSync(join(root, 'schemas', 'a.schema.json'), '{"a":1}\n');
  writeFileSync(join(root, 'schemas', 'envelopes', 'b.schema.json'), '{"b":2}\n');
  return root;
}

function writeStamp(root: string, files: Record<string, string> | undefined): void {
  writeFileSync(
    join(root, STAMP_RELATIVE_PATH),
    JSON.stringify({ suiteVersion: '1.154.0', corpusCommit: 'deadbeef', ...(files === undefined ? {} : { files }) }, null, 2),
  );
}

describe('corpus-stamp: listing and digesting', () => {
  it('lists every vendored file as a POSIX-relative path, sorted, excluding the stamp itself', () => {
    const root = fakePackage();
    writeStamp(root, {});
    expect(listVendoredFiles(root)).toEqual(['api/openapi.yaml', 'schemas/a.schema.json', 'schemas/envelopes/b.schema.json']);
    rmSync(root, { recursive: true, force: true });
  });

  it('digests are lowercase hex SHA-256 of the bytes', () => {
    const root = fakePackage();
    const map = digestVendoredFiles(root);
    expect(Object.keys(map)).toHaveLength(3);
    for (const d of Object.values(map)) expect(d).toMatch(/^[0-9a-f]{64}$/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('corpus-stamp: three-outcome verification', () => {
  it('verified when every digest matches', () => {
    const root = fakePackage();
    writeStamp(root, digestVendoredFiles(root));
    const v = verifyCorpusStamp(root, 'published');
    expect(v.kind).toBe('verified');
    expect(describeVerdict(v)).toContain('VERIFIED');
    rmSync(root, { recursive: true, force: true });
  });

  it('mismatch when a vendored file is altered, missing, or extra — each named', () => {
    const root = fakePackage();
    writeStamp(root, digestVendoredFiles(root));
    writeFileSync(join(root, 'schemas', 'a.schema.json'), '{"a":2}\n');
    rmSync(join(root, 'api', 'openapi.yaml'));
    writeFileSync(join(root, 'schemas', 'z.schema.json'), '{}\n');
    const v = verifyCorpusStamp(root, 'published');
    expect(v.kind).toBe('mismatch');
    if (v.kind === 'mismatch') {
      expect(v.altered).toEqual(['schemas/a.schema.json']);
      expect(v.missing).toEqual(['api/openapi.yaml']);
      expect(v.extra).toEqual(['schemas/z.schema.json']);
    }
    expect(describeVerdict(v)).toContain('MISMATCH');
    rmSync(root, { recursive: true, force: true });
  });

  it('not-applicable in the repo layout (nothing vendored) and for a pre-1.154.0 stamp (no files map) — never a silent pass', () => {
    const root = fakePackage();
    writeStamp(root, digestVendoredFiles(root));
    expect(verifyCorpusStamp(root, 'repo').kind).toBe('not-applicable');
    writeStamp(root, undefined);
    const v = verifyCorpusStamp(root, 'published');
    expect(v.kind).toBe('not-applicable');
    if (v.kind === 'not-applicable') expect(v.reason).toContain('predates');
    rmSync(root, { recursive: true, force: true });
  });

  it('a stamp that is not JSON is a mismatch, not a skip', () => {
    const root = fakePackage();
    writeFileSync(join(root, STAMP_RELATIVE_PATH), 'not json');
    expect(verifyCorpusStamp(root, 'published').kind).toBe('mismatch');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('peer-version is its own verdict, not a digest mismatch', () => {
  // Reported by a tier-2 host: the `next` dist-tag moves per package, so `@next`
  // can resolve @openwop/spec-artifacts@rc.11 alongside the suite at rc.10 —
  // declared EXACT peers that were never published together. The old code folded
  // that into `mismatch`, whose message says the vendored contract "is not the
  // one this suite shipped", and the reader goes hunting a corrupted install.
  const v: StampVerdict = { kind: 'peer-version', peerVersion: '2.0.0-rc.11', lockVersion: '2.0.0-rc.10' };

  it('names BOTH versions, so the reader can see the skew without guessing', () => {
    const msg = describeVerdict(v);
    expect(msg).toContain('2.0.0-rc.11');
    expect(msg).toContain('2.0.0-rc.10');
  });

  it('says nothing is corrupt, and names the dist-tag as the cause', () => {
    const msg = describeVerdict(v);
    expect(msg).toContain('Nothing is corrupt');
    expect(msg).toContain('next');
    // The remedy has to be in the message. A diagnosis the reader cannot act on
    // is the same cost as no diagnosis.
    expect(msg).toContain('same explicit version');
  });

  it('does not reuse the digest-mismatch wording that sent readers to debug an install', () => {
    expect(describeVerdict(v)).not.toContain('not the one this suite shipped');
  });
});
