/**
 * core.openwop.crypto — pure cryptographic primitives.
 *
 * Hash, HMAC, AEAD, sign/verify, JWT, TOTP, x509.
 * Built on node:crypto (Node 20+). Zero npm deps.
 *
 * All nodes are pure with respect to keys passed in via inputs.
 * This pack is NOT a key store — resolve long-lived keys via
 * the host secret resolver and pass them in as inputs.
 */

import {
  createHash, createHmac, createCipheriv, createDecipheriv, randomBytes,
  createSign, createVerify, sign as cryptoSign, verify as cryptoVerify,
  timingSafeEqual, X509Certificate, createPublicKey, createPrivateKey,
} from 'node:crypto';

/* ─── Helpers ─────────────────────────────────────────────────── */

function toBuffer(value, encoding) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value, encoding || 'utf8');
}

function encodeBuffer(buf, encoding) {
  return buf.toString(encoding || 'hex');
}

const HASH_ALGS = new Set(['sha256','sha384','sha512','sha1','md5','blake2b512']);
const HMAC_ALGS = new Set(['sha256','sha384','sha512']);
const AEAD_ALGS = new Set(['aes-256-gcm','chacha20-poly1305']);
const SIGN_ALGS = new Set(['ed25519','rs256','ps256','es256']);
const JWT_ALGS  = new Set(['HS256','HS384','HS512','RS256','PS256','ES256','EdDSA']);

function ensure(cond, code, msg) {
  if (!cond) throw Object.assign(new Error(msg), { code });
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/* ─── Hash / HMAC ─────────────────────────────────────────────── */

export async function hash(ctx) {
  const alg = (ctx.config.algorithm || 'sha256').toLowerCase().replace('-','');
  ensure(HASH_ALGS.has(alg), 'CONFIG_INVALID', `unsupported hash algorithm: ${alg}`);
  const data = toBuffer(ctx.inputs.data, ctx.config.inputEncoding);
  const h = createHash(alg).update(data).digest();
  return { status: 'success', outputs: { digest: encodeBuffer(h, ctx.config.outputEncoding), algorithm: alg } };
}

export async function hmacSign(ctx) {
  const alg = (ctx.config.algorithm || 'sha256').toLowerCase().replace('-','');
  ensure(HMAC_ALGS.has(alg), 'CONFIG_INVALID', `unsupported HMAC algorithm: ${alg}`);
  const key = toBuffer(ctx.inputs.key, ctx.config.keyEncoding);
  const data = toBuffer(ctx.inputs.data, ctx.config.inputEncoding);
  const mac = createHmac(alg, key).update(data).digest();
  return { status: 'success', outputs: { signature: encodeBuffer(mac, ctx.config.outputEncoding), algorithm: alg } };
}

export async function hmacVerify(ctx) {
  const alg = (ctx.config.algorithm || 'sha256').toLowerCase().replace('-','');
  ensure(HMAC_ALGS.has(alg), 'CONFIG_INVALID', `unsupported HMAC algorithm: ${alg}`);
  const key = toBuffer(ctx.inputs.key, ctx.config.keyEncoding);
  const data = toBuffer(ctx.inputs.data, ctx.config.inputEncoding);
  const expected = createHmac(alg, key).update(data).digest();
  const provided = toBuffer(ctx.inputs.signature, ctx.config.signatureEncoding || 'hex');
  if (expected.length !== provided.length) return { status: 'success', outputs: { valid: false } };
  return { status: 'success', outputs: { valid: timingSafeEqual(expected, provided) } };
}

/* ─── AEAD ────────────────────────────────────────────────────── */

export async function aeadEncrypt(ctx) {
  const alg = ctx.config.algorithm || 'aes-256-gcm';
  ensure(AEAD_ALGS.has(alg), 'CONFIG_INVALID', `unsupported AEAD algorithm: ${alg}`);
  const key = toBuffer(ctx.inputs.key, ctx.config.keyEncoding);
  const plaintext = toBuffer(ctx.inputs.plaintext, ctx.config.inputEncoding);
  const aad = ctx.inputs.aad ? toBuffer(ctx.inputs.aad, ctx.config.aadEncoding) : null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(alg, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const enc = ctx.config.outputEncoding || 'base64';
  return {
    status: 'success',
    outputs: {
      ciphertext: encodeBuffer(ciphertext, enc),
      iv: encodeBuffer(iv, enc),
      authTag: encodeBuffer(tag, enc),
      algorithm: alg,
    },
  };
}

export async function aeadDecrypt(ctx) {
  const alg = ctx.config.algorithm || 'aes-256-gcm';
  ensure(AEAD_ALGS.has(alg), 'CONFIG_INVALID', `unsupported AEAD algorithm: ${alg}`);
  const key = toBuffer(ctx.inputs.key, ctx.config.keyEncoding);
  const enc = ctx.config.inputEncoding || 'base64';
  const ciphertext = toBuffer(ctx.inputs.ciphertext, enc);
  const iv = toBuffer(ctx.inputs.iv, enc);
  const tag = toBuffer(ctx.inputs.authTag, enc);
  const aad = ctx.inputs.aad ? toBuffer(ctx.inputs.aad, ctx.config.aadEncoding) : null;
  const decipher = createDecipheriv(alg, key, iv);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(aad);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw Object.assign(new Error('AEAD decrypt failed: ' + e.message), { code: 'INVALID_AUTH_TAG' });
  }
  return { status: 'success', outputs: { plaintext: encodeBuffer(plain, ctx.config.outputEncoding || 'utf8'), algorithm: alg } };
}

/* ─── Asymmetric sign / verify ────────────────────────────────── */

function nodeAlgFor(alg) {
  switch (alg) {
    case 'ed25519': return null; // use sign() free function
    case 'rs256': case 'ps256': return 'sha256';
    case 'es256': return 'sha256';
    default: throw Object.assign(new Error(`unsupported sign algorithm: ${alg}`), { code: 'CONFIG_INVALID' });
  }
}

export async function sign(ctx) {
  const alg = (ctx.config.algorithm || 'ed25519').toLowerCase();
  ensure(SIGN_ALGS.has(alg), 'CONFIG_INVALID', `unsupported sign algorithm: ${alg}`);
  const data = toBuffer(ctx.inputs.data, ctx.config.inputEncoding);
  const pem = ctx.inputs.privateKeyPem;
  const keyObj = createPrivateKey(pem);
  let sig;
  if (alg === 'ed25519') {
    sig = cryptoSign(null, data, keyObj);
  } else if (alg === 'ps256') {
    sig = createSign('sha256').update(data).sign({ key: keyObj, padding: 6 });
  } else {
    sig = createSign(nodeAlgFor(alg)).update(data).sign(keyObj);
  }
  return { status: 'success', outputs: { signature: encodeBuffer(sig, ctx.config.outputEncoding || 'base64'), algorithm: alg } };
}

export async function verify(ctx) {
  const alg = (ctx.config.algorithm || 'ed25519').toLowerCase();
  ensure(SIGN_ALGS.has(alg), 'CONFIG_INVALID', `unsupported sign algorithm: ${alg}`);
  const data = toBuffer(ctx.inputs.data, ctx.config.inputEncoding);
  const sig = toBuffer(ctx.inputs.signature, ctx.config.signatureEncoding || 'base64');
  const pem = ctx.inputs.publicKeyPem;
  const keyObj = createPublicKey(pem);
  let valid;
  if (alg === 'ed25519') {
    valid = cryptoVerify(null, data, keyObj, sig);
  } else if (alg === 'ps256') {
    valid = createVerify('sha256').update(data).verify({ key: keyObj, padding: 6 }, sig);
  } else {
    valid = createVerify(nodeAlgFor(alg)).update(data).verify(keyObj, sig);
  }
  return { status: 'success', outputs: { valid } };
}

/* ─── JWT ─────────────────────────────────────────────────────── */

function jwtSign(header, payload, key, alg) {
  const h = b64url(JSON.stringify({ ...header, alg, typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const signing = `${h}.${p}`;
  let sig;
  switch (alg) {
    case 'HS256': case 'HS384': case 'HS512': {
      const a = 'sha' + alg.slice(2);
      sig = createHmac(a, key).update(signing).digest();
      break;
    }
    case 'RS256':
      sig = createSign('sha256').update(signing).sign(key);
      break;
    case 'PS256':
      sig = createSign('sha256').update(signing).sign({ key: createPrivateKey(key), padding: 6 });
      break;
    case 'ES256':
      sig = createSign('sha256').update(signing).sign({ key: createPrivateKey(key), dsaEncoding: 'ieee-p1363' });
      break;
    case 'EdDSA':
      sig = cryptoSign(null, Buffer.from(signing), createPrivateKey(key));
      break;
    default:
      throw Object.assign(new Error(`unsupported JWT alg: ${alg}`), { code: 'CONFIG_INVALID' });
  }
  return `${signing}.${b64url(sig)}`;
}

function jwtVerifySig(token, key, alg) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw Object.assign(new Error('malformed JWT'), { code: 'JWT_MALFORMED' });
  const signing = `${h}.${p}`;
  const sig = b64urlDecode(s);
  switch (alg) {
    case 'HS256': case 'HS384': case 'HS512': {
      const a = 'sha' + alg.slice(2);
      const mac = createHmac(a, key).update(signing).digest();
      return mac.length === sig.length && timingSafeEqual(mac, sig);
    }
    case 'RS256':
      return createVerify('sha256').update(signing).verify(key, sig);
    case 'PS256':
      return createVerify('sha256').update(signing).verify({ key: createPublicKey(key), padding: 6 }, sig);
    case 'ES256':
      return createVerify('sha256').update(signing).verify({ key: createPublicKey(key), dsaEncoding: 'ieee-p1363' }, sig);
    case 'EdDSA':
      return cryptoVerify(null, Buffer.from(signing), createPublicKey(key), sig);
    default:
      throw Object.assign(new Error(`unsupported JWT alg: ${alg}`), { code: 'CONFIG_INVALID' });
  }
}

export async function jwtMint(ctx) {
  const alg = ctx.config.algorithm || 'HS256';
  ensure(JWT_ALGS.has(alg), 'CONFIG_INVALID', `unsupported JWT alg: ${alg}`);
  const now = Math.floor(Date.now() / 1000);
  const ttl = ctx.config.ttlSeconds ?? 3600;
  const payload = {
    ...ctx.inputs.claims,
    iat: ctx.inputs.claims?.iat ?? now,
    ...(ctx.inputs.claims?.exp == null && ttl > 0 ? { exp: now + ttl } : {}),
  };
  const key = alg.startsWith('HS') ? toBuffer(ctx.inputs.key, ctx.config.keyEncoding) : ctx.inputs.key;
  const header = ctx.config.headerExtras || {};
  if (ctx.inputs.kid) header.kid = ctx.inputs.kid;
  const token = jwtSign(header, payload, key, alg);
  return { status: 'success', outputs: { token, algorithm: alg, expiresAt: payload.exp ?? null } };
}

export async function jwtVerifyNode(ctx) {
  const token = ctx.inputs.token;
  const [h] = token.split('.');
  const header = JSON.parse(b64urlDecode(h).toString('utf8'));
  const alg = header.alg;
  ensure(JWT_ALGS.has(alg), 'JWT_ALG_UNSUPPORTED', `unsupported JWT alg: ${alg}`);
  let key;
  if (ctx.inputs.jwks) {
    const k = (ctx.inputs.jwks.keys || []).find((x) => x.kid === header.kid);
    ensure(k, 'JWT_KID_UNKNOWN', `kid not found in JWKS: ${header.kid}`);
    key = createPublicKey({ key: k, format: 'jwk' });
  } else {
    key = alg.startsWith('HS') ? toBuffer(ctx.inputs.key, ctx.config.keyEncoding) : ctx.inputs.key;
  }
  const valid = jwtVerifySig(token, key, alg);
  if (!valid) return { status: 'success', outputs: { valid: false, reason: 'signature' } };
  const [, p] = token.split('.');
  const claims = JSON.parse(b64urlDecode(p).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp != null && claims.exp < now) return { status: 'success', outputs: { valid: false, reason: 'expired', claims } };
  if (claims.nbf != null && claims.nbf > now) return { status: 'success', outputs: { valid: false, reason: 'not-yet-valid', claims } };
  if (ctx.config.expectedIssuer && claims.iss !== ctx.config.expectedIssuer) return { status: 'success', outputs: { valid: false, reason: 'iss', claims } };
  if (ctx.config.expectedAudience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(ctx.config.expectedAudience)) return { status: 'success', outputs: { valid: false, reason: 'aud', claims } };
  }
  return { status: 'success', outputs: { valid: true, claims } };
}

/* ─── TOTP ────────────────────────────────────────────────────── */

function totpCode(secret, t, digits, alg) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t)));
  const hmac = createHmac(alg, secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode = ((hmac[offset] & 0x7f) << 24)
                | ((hmac[offset + 1] & 0xff) << 16)
                | ((hmac[offset + 2] & 0xff) << 8)
                | (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, '0');
}

function decodeBase32(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '', out = [];
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw Object.assign(new Error('invalid base32'), { code: 'TOTP_SECRET_INVALID' });
    bits += idx.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

function totpSecret(secret, encoding) {
  if (encoding === 'base32') return decodeBase32(secret);
  return toBuffer(secret, encoding || 'utf8');
}

export async function totpGenerate(ctx) {
  const step = ctx.config.stepSeconds ?? 30;
  const digits = ctx.config.digits ?? 6;
  const alg = ctx.config.algorithm || 'sha1';
  const at = ctx.inputs.at ? Math.floor(new Date(ctx.inputs.at).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const secret = totpSecret(ctx.inputs.secret, ctx.config.secretEncoding);
  const code = totpCode(secret, at / step, digits, alg);
  return { status: 'success', outputs: { code, at, step, digits, algorithm: alg } };
}

export async function totpVerify(ctx) {
  const step = ctx.config.stepSeconds ?? 30;
  const digits = ctx.config.digits ?? 6;
  const alg = ctx.config.algorithm || 'sha1';
  const drift = ctx.config.driftWindow ?? 1;
  const at = ctx.inputs.at ? Math.floor(new Date(ctx.inputs.at).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const secret = totpSecret(ctx.inputs.secret, ctx.config.secretEncoding);
  const target = String(ctx.inputs.code);
  for (let d = -drift; d <= drift; d++) {
    if (totpCode(secret, at / step + d, digits, alg) === target) {
      return { status: 'success', outputs: { valid: true, drift: d } };
    }
  }
  return { status: 'success', outputs: { valid: false, drift: null } };
}

/* ─── x509 ────────────────────────────────────────────────────── */

function summarizeCert(cert) {
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    san: cert.subjectAltName || null,
    fingerprint256: cert.fingerprint256,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
    serialNumber: cert.serialNumber,
    ca: cert.ca,
    keyUsage: cert.keyUsage || null,
  };
}

export async function x509Parse(ctx) {
  const cert = new X509Certificate(ctx.inputs.pem);
  return { status: 'success', outputs: summarizeCert(cert) };
}

export async function x509VerifyChain(ctx) {
  const leaf = new X509Certificate(ctx.inputs.leafPem);
  const intermediates = (ctx.inputs.intermediatesPem || []).map((p) => new X509Certificate(p));
  const roots = (ctx.inputs.trustRootsPem || []).map((p) => new X509Certificate(p));
  // Build chain leaf → intermediates → root by issuer matching.
  const chain = [leaf];
  const pool = intermediates.slice();
  let current = leaf;
  let safety = 16;
  while (safety-- > 0) {
    const issuer = pool.findIndex((c) => c.subject === current.issuer);
    if (issuer < 0) break;
    current = pool.splice(issuer, 1)[0];
    chain.push(current);
  }
  const trustedRoot = roots.find((r) => r.subject === current.issuer || r.subject === current.subject);
  if (!trustedRoot) return { status: 'success', outputs: { valid: false, reason: 'untrusted-root', chain: chain.map(summarizeCert) } };
  // Pairwise verification.
  let priorIssuer = trustedRoot;
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i];
    if (!c.checkIssued(priorIssuer) && !c.verify(priorIssuer.publicKey)) {
      return { status: 'success', outputs: { valid: false, reason: 'signature', failedAt: i, chain: chain.map(summarizeCert) } };
    }
    const now = Date.now();
    if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) {
      return { status: 'success', outputs: { valid: false, reason: 'validity', failedAt: i, chain: chain.map(summarizeCert) } };
    }
    priorIssuer = c;
  }
  return { status: 'success', outputs: { valid: true, chain: chain.map(summarizeCert) } };
}

/* ─── Pack registry ───────────────────────────────────────────── */

export const nodes = {
  'core.crypto.hash': hash,
  'core.crypto.hmac-sign': hmacSign,
  'core.crypto.hmac-verify': hmacVerify,
  'core.crypto.aead-encrypt': aeadEncrypt,
  'core.crypto.aead-decrypt': aeadDecrypt,
  'core.crypto.sign': sign,
  'core.crypto.verify': verify,
  'core.crypto.jwt-mint': jwtMint,
  'core.crypto.jwt-verify': jwtVerifyNode,
  'core.crypto.totp-generate': totpGenerate,
  'core.crypto.totp-verify': totpVerify,
  'core.crypto.x509-parse': x509Parse,
  'core.crypto.x509-verify-chain': x509VerifyChain,
};

export default nodes;
