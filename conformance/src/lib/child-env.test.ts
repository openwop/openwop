import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARENT_ONLY_ENV, childEnv } from './child-env.js';

describe('childEnv — material only the parent uses never enters the vitest child', () => {
  it('drops the bundle signing key and keeps everything else, without mutating the parent', () => {
    const parent = { OPENWOP_BUNDLE_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nMC4C…', OPENWOP_BUNDLE_SIGNING_KEY_ID: 'host-key-1', OPENWOP_BASE_URL: 'https://h', PATH: '/bin' };
    const child = childEnv(parent);
    expect(child['OPENWOP_BUNDLE_SIGNING_KEY']).toBeUndefined();
    expect('OPENWOP_BUNDLE_SIGNING_KEY' in child).toBe(false);
    expect(child['OPENWOP_BUNDLE_SIGNING_KEY_ID']).toBe('host-key-1'); // an id is not a secret
    expect(child['OPENWOP_BASE_URL']).toBe('https://h');
    expect(child['PATH']).toBe('/bin');
    expect(parent.OPENWOP_BUNDLE_SIGNING_KEY).toContain('PRIVATE KEY'); // the parent still signs with it
  });

  // The helper is worthless if a spawn site forgets it. Every place cli.ts
  // builds a child environment MUST go through childEnv — asserted on the
  // source, because the alternative is discovering the omission in a transcript.
  it('cli.ts builds no child environment from a bare spread of process.env', () => {
    const cli = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts'), 'utf8');
    expect(cli).not.toMatch(/env\s*:\s*NodeJS\.ProcessEnv\s*=\s*\{\s*\.\.\.process\.env\s*\}/);
    expect((cli.match(/childEnv\(process\.env\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(PARENT_ONLY_ENV).toContain('OPENWOP_BUNDLE_SIGNING_KEY');
  });
});
