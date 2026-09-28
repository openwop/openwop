/**
 * RFC 0218 §C — an audit anomaly's shape, server-free
 * (`spec/v1/auth-profiles.md` §"Audit-log integrity" 4).
 *
 * A black-box caller cannot tamper with a host's audit log, so an untampered log
 * serves no anomaly and `audit-log-integrity.test.ts` sees an empty array. This
 * file holds the shape instead: one sample anomaly of every `kind` validates
 * against `audit-verify-result.schema.json` (v1 and the derived v2 copy), and the
 * shapes that must not are refused, the reference hosts' pre-§C
 * `{ atSequence, kind, detail }` first among them. The host side is the tamper
 * tests in openwop-examples, which assert every kind's member set.
 *
 * Sabotages, each of which turns a leg red: dropping the `checkpoint` conditional
 * (a `merkle-mismatch` without it validates); dropping the `chain-break`
 * conditional (a `chain-break` without its hashes validates); dropping the
 * `else` arms (a mixed entry validates); dropping the root `chainValid`
 * conditional (a forged-signature report with `chainValid: true` validates);
 * admitting `atSequence` and dropping `atSeq` from `required` (the hosts' old
 * hash-mismatch validates).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const SPEC = 'RFC 0218 §C · spec/v1/auth-profiles.md §"Audit-log integrity" 4';
const SHAPE = 'openwop.requirement.0218.anomaly-shape';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CHECKPOINT = { checkpoint: 'cp_5', atSequence: 5, merkleRoot: HASH_A, signature: 'c2ln' };

const result = (anomalies: object[], chainValid = anomalies.length === 0): object => ({
  fromSeq: 1,
  toSeq: 5,
  chainValid,
  checkpoints: [CHECKPOINT],
  anomalies,
});

const VALID: Array<[string, object]> = [
  ['a chain-break with both hashes', { atSeq: 4, kind: 'chain-break', expectedPrevHash: HASH_A, actualPrevHash: HASH_B, detail: 'prev_hash differs' }],
  ['a chain-break at the genesis entry (null hashes)', { atSeq: 1, kind: 'chain-break', expectedPrevHash: null, actualPrevHash: HASH_B }],
  ['a legacy entry without kind (a chain-break)', { atSeq: 4, expectedPrevHash: HASH_A, actualPrevHash: '' }],
  ['a hash-mismatch', { atSeq: 3, kind: 'hash-mismatch', detail: 'recomputed != stored' }],
  ['a missing-entry', { atSeq: 2, kind: 'missing-entry' }],
  ['a merkle-mismatch with its checkpoint', { atSeq: 5, kind: 'merkle-mismatch', checkpoint: 'cp_5' }],
  ['a signature-invalid with its checkpoint', { atSeq: 5, kind: 'signature-invalid', checkpoint: 'cp_5', detail: 'does not verify' }],
];

const INVALID: Array<[string, object]> = [
  // The reference hosts' pre-§C hash-mismatch, verbatim: wrong only in the
  // sequence member's name, so nothing but `atSeq` can refuse it.
  ['`atSequence` for `atSeq` (the reference hosts\' pre-§C shape)', { atSequence: 3, kind: 'hash-mismatch', detail: 'recomputed != stored' }],
  ['a merkle-mismatch without `checkpoint`', { atSeq: 5, kind: 'merkle-mismatch' }],
  ['a signature-invalid without `checkpoint`', { atSeq: 5, kind: 'signature-invalid', detail: 'x' }],
  ['a chain-break without its hashes', { atSeq: 4, kind: 'chain-break', detail: 'x' }],
  ['a legacy entry without kind or hashes', { atSeq: 4 }],
  ['a mixed entry: a merkle-mismatch carrying the chain hashes', { atSeq: 5, kind: 'merkle-mismatch', checkpoint: 'cp_5', expectedPrevHash: HASH_A, actualPrevHash: HASH_B }],
  ['a mixed entry: a chain-break carrying a checkpoint', { atSeq: 4, kind: 'chain-break', expectedPrevHash: HASH_A, actualPrevHash: HASH_B, checkpoint: 'cp_5' }],
  ['a hash-mismatch carrying a checkpoint', { atSeq: 3, kind: 'hash-mismatch', checkpoint: 'cp_5' }],
  ['an unknown kind', { atSeq: 3, kind: 'row-rewritten' }],
];

const SCHEMAS = [['v1', 'audit-verify-result.schema.json'], ['v2', join('v2', 'audit-verify-result.schema.json')]].map(([label, file]) => {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file!), 'utf8')) as object;
  return { label: label!, validate: new Ajv2020({ strict: false, allErrors: true }).compile(schema) };
});

describe('RFC 0218 §C — audit anomaly shape (server-free, v1 and v2 schemas)', () => {
  it('every anomaly kind validates in its own shape', () => {
    for (const { label, validate } of SCHEMAS) {
      for (const [name, anomaly] of VALID) {
        const ok = validate(result([anomaly]));
        expect(ok, req(SHAPE, SPEC, `${label}: ${name} validates: ${JSON.stringify(validate.errors)}`)).toBe(true);
      }
      expect(validate(result([])), req(SHAPE, SPEC, `${label}: an untampered result with no anomaly validates`)).toBe(true);
    }
  });

  it('an anomaly outside its kind\'s shape is refused', () => {
    for (const { label, validate } of SCHEMAS) {
      for (const [name, anomaly] of INVALID) {
        expect(validate(result([anomaly])), req(SHAPE, SPEC, `${label}: ${name} is refused`)).toBe(false);
      }
    }
  });

  it('chainValid is false exactly when anomalies is non-empty', () => {
    const forged = { atSeq: 5, kind: 'signature-invalid', checkpoint: 'cp_5' };
    for (const { label, validate } of SCHEMAS) {
      expect(validate(result([forged], true)), req(SHAPE, SPEC, `${label}: chainValid: true beside a signature-invalid anomaly is refused`)).toBe(false);
      expect(validate(result([], false)), req(SHAPE, SPEC, `${label}: chainValid: false with no anomaly is refused`)).toBe(false);
      expect(validate(result([forged], false)), req(SHAPE, SPEC, `${label}: chainValid: false beside the anomaly validates`)).toBe(true);
    }
  });
});
