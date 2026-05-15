#!/usr/bin/env node
/**
 * Standalone audit-checkpoint verifier per CF-11
 * (plans/openwop-protocol-gap-closure-plan.md Workstream 2).
 *
 * Verifies an exported audit-checkpoint bundle produced by a host
 * that claims `openwop-audit-log-integrity` per
 * `auth-profiles.md` §"openwop-audit-log-integrity". The verifier is
 * **out-of-band**: it runs independently of the host, takes only the
 * exported JSON document as input, and verifies every checkpoint's
 * Ed25519 signature against the embedded public key.
 *
 * Usage:
 *
 *   node scripts/verify-audit-checkpoints.mjs <path-to-export.json>
 *
 * Exit codes:
 *   0 — bundle shape valid + all checkpoint signatures verify
 *   1 — at least one signature failed verification (TAMPER suspected)
 *   2 — bundle shape malformed (cannot proceed)
 *
 * Pure Node 20+ stdlib. No npm install required.
 *
 * @see examples/hosts/postgres/src/audit-export.ts (canonical export
 *      producer)
 * @see spec/v1/auth-profiles.md §"openwop-audit-log-integrity"
 */

import { readFileSync } from 'node:fs';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { argv, exit } from 'node:process';

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', yellow: '\x1b[33m', reset: '\x1b[0m' }
  : { red: '', green: '', dim: '', yellow: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.error(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset} ${s}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);

if (argv.length < 3) {
  console.error('Usage: node scripts/verify-audit-checkpoints.mjs <path-to-export.json>');
  exit(2);
}

const bundlePath = argv[2];
let bundle;
try {
  bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
} catch (err) {
  fail(`cannot read or parse ${bundlePath}: ${err.message}`);
  exit(2);
}

// Shape validation — strict for fields we sign over; lenient on metadata.
const requiredTop = ['bundleVersion', 'exportedAt', 'signingKey', 'checkpoints'];
for (const f of requiredTop) {
  if (bundle[f] === undefined) {
    fail(`bundle is missing required field '${f}'`);
    exit(2);
  }
}
if (bundle.bundleVersion !== '1') {
  fail(`unsupported bundleVersion '${bundle.bundleVersion}'; this verifier handles version '1'`);
  exit(2);
}
if (!bundle.signingKey || bundle.signingKey.algorithm !== 'ed25519') {
  fail(`bundle.signingKey.algorithm MUST be 'ed25519' (got '${bundle.signingKey?.algorithm}')`);
  exit(2);
}
if (typeof bundle.signingKey.publicKeyPEM !== 'string' || !bundle.signingKey.publicKeyPEM.startsWith('-----BEGIN')) {
  fail('bundle.signingKey.publicKeyPEM MUST be a PEM-encoded public key');
  exit(2);
}
if (!Array.isArray(bundle.checkpoints)) {
  fail('bundle.checkpoints MUST be an array');
  exit(2);
}

// Load the embedded public key.
let publicKey;
try {
  publicKey = createPublicKey(bundle.signingKey.publicKeyPEM);
} catch (err) {
  fail(`failed to load publicKeyPEM: ${err.message}`);
  exit(2);
}

dim(`bundle: ${bundlePath}`);
dim(`exportedAt: ${bundle.exportedAt}`);
dim(`host: ${bundle.host?.name ?? '(unnamed)'}${bundle.host?.version ? ` @ ${bundle.host.version}` : ''}`);
dim(`signingKey.keyId: ${bundle.signingKey.keyId}`);
dim(`checkpoints: ${bundle.checkpoints.length}`);
console.log('');

if (bundle.checkpoints.length === 0) {
  warn('bundle contains zero checkpoints — nothing to verify');
  exit(0);
}

let pass = 0;
let failures = 0;
let prevAtSequence = -1;

for (const cp of bundle.checkpoints) {
  // Per-checkpoint shape.
  const required = ['checkpointId', 'atSequence', 'merkleRoot', 'signature', 'signedAt', 'signingKeyId'];
  let shapeOk = true;
  for (const f of required) {
    if (cp[f] === undefined) {
      fail(`checkpoint ${cp.checkpointId ?? '<unknown>'} missing field '${f}'`);
      shapeOk = false;
    }
  }
  if (!shapeOk) {
    failures++;
    continue;
  }

  // Monotonic ordering: atSequence MUST strictly increase across the
  // exported list. A non-monotonic export hints at tampering OR at
  // accidental dedup loss; either way the verifier MUST surface it.
  if (cp.atSequence <= prevAtSequence) {
    fail(`checkpoint ${cp.checkpointId} atSequence=${cp.atSequence} is not strictly increasing (previous ${prevAtSequence})`);
    failures++;
    continue;
  }
  prevAtSequence = cp.atSequence;

  // signingKeyId cross-check: every checkpoint MUST be signed by the
  // bundle's declared key. (Future key rotation would ship multiple
  // bundles, one per key.)
  if (cp.signingKeyId !== bundle.signingKey.keyId) {
    fail(`checkpoint ${cp.checkpointId} signingKeyId='${cp.signingKeyId}' but bundle declares keyId='${bundle.signingKey.keyId}'`);
    failures++;
    continue;
  }

  // Ed25519 verify: signature over the merkleRoot bytes.
  let sigBytes;
  try {
    sigBytes = Buffer.from(cp.signature, 'base64');
  } catch (err) {
    fail(`checkpoint ${cp.checkpointId} signature is not valid base64: ${err.message}`);
    failures++;
    continue;
  }
  if (sigBytes.length !== 64) {
    fail(`checkpoint ${cp.checkpointId} signature MUST be 64 bytes for Ed25519 (got ${sigBytes.length})`);
    failures++;
    continue;
  }
  const rootBytes = Buffer.from(cp.merkleRoot, 'hex');
  if (rootBytes.length === 0) {
    fail(`checkpoint ${cp.checkpointId} merkleRoot is not valid hex or is empty`);
    failures++;
    continue;
  }
  const valid = cryptoVerify(null, rootBytes, publicKey, sigBytes);
  if (!valid) {
    fail(`checkpoint ${cp.checkpointId} (atSequence=${cp.atSequence}) signature DOES NOT verify — possible tampering`);
    failures++;
    continue;
  }
  ok(`checkpoint ${cp.checkpointId} (atSequence=${cp.atSequence}) verified`);
  pass++;
}

console.log('');
if (failures === 0) {
  ok(`all ${pass} checkpoints verify`);
  exit(0);
} else {
  fail(`${failures}/${pass + failures} checkpoint(s) failed verification`);
  exit(1);
}
